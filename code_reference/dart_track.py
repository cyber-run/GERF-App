import logging, time, asyncio, atexit, queue, math, multiprocessing, socket, json
from utils.misc_funcs import set_realtime_priority, num_to_range
from utils.perf_timings import perf_counter_ns, PerfSleeper
from hardware.motion.theia_controller import TheiaController
from tracking.kalman_filter import AdaptiveKalmanFilter
from tracking.visual_track import visual_track
from tracking.reprojection import Reprojection
from core.config_manager import ConfigManager
from hardware.motion.dyna_controller import *
from hardware.mocap.qtm_mocap import *
import numpy as np
import cProfile  # Added for tracking loop profiling
import pstats    # Added for profile analysis
import os        # Added for file operations


# Create a single PerfSleeper instance for the module
_perf_sleeper = PerfSleeper()

class DartTracker:
    '''
    Object to track a target using a Dynamixel servo and a QTM mocap system.
    
    - Before running this script, ensure that the Dynamixel servo is connected to
      the computer via USB and that the QTM mocap system is running and streaming
      data.
    '''
    def __init__(self, device_id: str, data_queue, mocap=None):
        self.logger = logging.getLogger("Track")
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%H:%M:%S'
        )

        self.device_id = device_id
        self.config_manager = ConfigManager(device_id=self.device_id)
        self.config_data = self.config_manager.config # Use the device-specific config
        
        self.data_queue = data_queue
        self.mocap_target = mocap

        self.coefficients = None # Initialize coefficients
        initial_zoom_steps = None

        # Get motor mid position from config
        self.motor_mid_pos = self.config_data.get("hardware_params", {}).get("mirror_mid", 45)
        self.logger.info(f"Using motor mid position: {self.motor_mid_pos} for {self.device_id}")
        
        calibration_data = self.config_data.get("calibration", {})
        pan_origin_conf = calibration_data.get("pan_origin")
        tilt_origin_conf = calibration_data.get("tilt_origin")
        rotation_matrix_conf = calibration_data.get("rotation_matrix")

        if pan_origin_conf is None or tilt_origin_conf is None or rotation_matrix_conf is None:
            self.logger.error(f"No calibration data found in config for {self.device_id}.")
            raise ValueError(f"Calibration data not found for {self.device_id}")
        
        self.pan_origin = np.array(pan_origin_conf)
        self.tilt_origin = np.array(tilt_origin_conf)
        self.rotation_matrix = np.array(rotation_matrix_conf)
        self.logger.info(f"Calibration data loaded successfully for {self.device_id}.")

        # Calculate mean_origin after converting to numpy arrays
        self.mean_origin = (self.pan_origin + self.tilt_origin) / 2.0 # Use 2.0 for float division

        device_hw_config = self.config_data.get("devices", {})
        dyna_port = device_hw_config.get("dynamixel_port")
        theia_port = device_hw_config.get("theia_port")
        
        if not dyna_port:
            self.logger.error(f"Dynamixel port not configured for {self.device_id}")
            raise ValueError(f"Dynamixel port configuration missing for {self.device_id}")
        if not theia_port:
            self.logger.warning(f"Theia port not configured for {self.device_id}. Theia features will be unavailable.")
            self.theia = None # Explicitly set Theia to None if port is missing
        else:
            self.theia = TheiaController(port=theia_port)
            if self.theia.connect():
                self.theia.initialise()
                theia_state = device_hw_config.get("theia_state", {})
                zoom_position = theia_state.get("zoom_position", 0)
                focus_position = theia_state.get("focus_position", 0)
                iris_position = theia_state.get("iris_position", 0) # Load iris too
                self.theia.set_absolute_position("A", zoom_position)
                self.theia.set_absolute_position("B", focus_position)
                self.theia.set_absolute_position("C", iris_position) # Set iris too
                self.logger.info(f"Initialized Theia for {self.device_id} with saved positions - Zoom: {zoom_position}, Focus: {focus_position}, Iris: {iris_position}")
                
                # Get lens parameters from ConfigManager and set initial zoom
                self.coefficients, initial_zoom_steps = self.config_manager.get_lens_parameters()
                if self.theia and initial_zoom_steps is not None:
                    self.logger.info(f"Moving Theia zoom to operational position: {initial_zoom_steps} steps for lens config.")
                    self.theia.move_axis("A", initial_zoom_steps) # MOVE to the target zoom step
                    # Optional: Wait for this move to complete if necessary for immediate subsequent operations.
                    # self.theia.wait_for_motion_complete(timeout=5) 
                    self.logger.info(f"Theia operational zoom move command sent. Current position will be {initial_zoom_steps} after move.")
                elif not self.theia:
                    self.logger.warning("Theia not available, cannot set initial zoom from lens config.")
                else: # initial_zoom_steps is None
                    self.logger.warning("Could not retrieve initial zoom steps from lens config. Zoom not moved to operational setting.")
            else:
                self.logger.error(f"Failed to connect to Theia on port {theia_port} for {self.device_id}")
                self.theia = None # Set to None if connection failed

        _perf_sleeper.sleep_ms(100)

        self.dyna = DynaController(dyna_port)
        self.dyna.open_port()

        self.dyna.set_gains(1, 2432, 720, 3200, 0)
        self.dyna.set_gains(2, 2432, 720, 3200, 0)
        
        self.dyna.set_op_mode(self.dyna.pan_id, 3)
        self.dyna.set_op_mode(self.dyna.tilt_id, 3)

        self.dyna.set_torque(self.dyna.pan_id, True)
        self.dyna.set_torque(self.dyna.tilt_id, True)

        self.start_time = time.perf_counter()

        self.counter = 0
        self.dist = 0
        
        # Initialize Kalman Filter only if enabled in config
        self.use_kalman = self.config_data["tracking"].get("use_kalman", True)
        self.kalman = AdaptiveKalmanFilter(mode='position') if self.use_kalman else None
        self.last_time = time.perf_counter()

    def distance_to_steps(self, distance: float) -> int:
        if self.coefficients is None:
            self.logger.warning("Focus coefficients not loaded, cannot calculate steps from distance.")
            return 0 # Or some other default/error indicator
        steps = int(np.polyval(self.coefficients, distance))
        steps = max(0, min(steps, 65535))
        return steps

    def tilt_global_to_local(self, point_global: np.ndarray) -> np.ndarray:
        if self.rotation_matrix is None:
            raise ValueError("Calibration must be completed before transforming points.")
        return np.dot(np.linalg.inv(self.rotation_matrix), point_global - self.tilt_origin)
    
    def pan_global_to_local(self, point_global: np.ndarray) -> np.ndarray:
        if self.rotation_matrix is None:
            raise ValueError("Calibration must be completed before transforming points.")
        return np.dot(np.linalg.inv(self.rotation_matrix), point_global - self.pan_origin)

    def calc_rot_comp(self, point_local: np.ndarray) -> Tuple[float, float]:
        pan_angle = math.degrees(math.atan2(point_local[1], point_local[0]))
        tilt_angle = math.degrees(math.atan2(point_local[2], math.hypot(point_local[0], point_local[1])))
        return pan_angle, tilt_angle
    
    def track(self):
        if self.use_kalman:
            current_time = time.perf_counter()
            delta_t = current_time - self.last_time
            self.last_time = current_time

            # Update Kalman filter time step
            self.kalman.update_F(delta_t)

            if self.mocap_target.lost:
                self.logger.debug("Target lost. Predicting position.")
                self.kalman.predict()
            else:
                # Get the latest measurement
                measurement = np.array(self.mocap_target.position).reshape((3, 1))
                self.kalman.predict()
                self.kalman.update(measurement)
                self.kalman.adapt_Q(measurement)

            # Minimal latency compensation - prioritizing responsiveness over prediction
            latency_duration = 0.001  # Reduced from 0.003 to 0.001 seconds (1 ms) for minimal predictive lag
            self.kalman.predict_latency(latency_duration)

            # Get estimated position and velocity
            estimated_position = self.kalman.get_position()
            estimated_velocity = self.kalman.state_estimate[3:6].flatten()  # Get velocity estimate

            # Minimal velocity-based prediction - only for very fast movements
            velocity_magnitude = np.linalg.norm(estimated_velocity)
            if velocity_magnitude > 5.0:  # Further increased threshold to 5.0 m/s - very rarely triggered
                prediction_time = 0.002  # Reduced to 2ms - minimal prediction
                position_prediction = estimated_position + estimated_velocity * prediction_time
                estimated_position = position_prediction

        else:
            # Use raw target position when Kalman is disabled
            if self.mocap_target.lost:
                self.logger.debug("Target lost.")
                return
            estimated_position = np.array(self.mocap_target.position)

        distance = (np.linalg.norm(estimated_position - self.mean_origin) / 1000)

        # Check if the distance has changed significantly
        if abs(distance - self.dist) > 0.1:
            steps = self.distance_to_steps(distance)
            self.logger.info(f"Distance: {distance} Steps: {steps}")
            steps = max(0, steps)
            self.theia.move_axis("B", steps)
            self.dist = distance

        # Get the local target position
        pan_local_target_pos = self.pan_global_to_local(estimated_position)
        tilt_local_target_pos = self.tilt_global_to_local(estimated_position)

        # Calculate the pan and tilt components of rotation from the positive X-axis
        pan_angle, _ = self.calc_rot_comp(pan_local_target_pos)
        _, tilt_angle = self.calc_rot_comp(tilt_local_target_pos)

        # Convert geometric angles to dynamixel angles
        pan_angle = round(num_to_range(pan_angle, 45, -45, self.motor_mid_pos - 22.5, self.motor_mid_pos + 22.5), 2) 
        tilt_angle = round(num_to_range(tilt_angle, 45, -45, self.motor_mid_pos - 22.5, self.motor_mid_pos + 22.5), 2)

        # Set the dynamixel to the calculated angles
        self.dyna.set_sync_pos(pan_angle, tilt_angle)

        # Very short delay to not burn CPU
        _perf_sleeper.sleep_ms(1)  # 1ms sleep instead of 1/1000 = 0.001s
        
        # Get the current angles of the dynamixels
        encoder_pan_angle, encoder_tilt_angle = self.dyna.get_sync_pos()

        # Put the data into the queue in a non-blocking way
        data = (
            estimated_position,
            pan_angle,
            tilt_angle,
            round(encoder_pan_angle, 2),
            round(encoder_tilt_angle, 2),
            perf_counter_ns() * 1e-6
        )
        try:
            self.data_queue.put_nowait(data)
        except queue.Full:
            self.logger.debug("Data queue is full. Skipping this data point.")

        self.counter += 1

    def shutdown(self) -> None:
        self.logger.info(f"Shutting down DartTracker for {self.device_id}.")
        end_time = time.perf_counter()
        if end_time > self.start_time:
            self.logger.info(f"Control frequency: {self.counter / (end_time - self.start_time)} Hz")
        else:
            self.logger.info("Control frequency: N/A (duration too short)")

        if self.theia and self.theia.ser and self.theia.ser.is_open:
            try:
                zoom_position, focus_position = self.theia.get_current_positions()
                iris_position = self.theia.get_last_commanded_iris()

                if zoom_position is not None and focus_position is not None and iris_position is not None:
                    self.logger.info(f"Current Theia positions for {self.device_id} - Zoom: {zoom_position}, Focus: {focus_position}, Iris: {iris_position}")
                    
                    # Use the existing config_manager instance
                    self.config_manager.update_theia_position(zoom=zoom_position, 
                                                                 focus=focus_position, 
                                                                 iris=iris_position)
                    self.logger.info(f"Successfully saved Theia positions for {self.device_id} via self.config_manager.")
                else:
                    self.logger.warning(f"Could not retrieve all current Theia lens positions for {self.device_id}. Not saving.")
            except Exception as e:
                self.logger.error(f"Error retrieving or saving lens positions for {self.device_id} during shutdown: {e}", exc_info=True)
        else:
            self.logger.warning(f"Theia controller not available/connected for {self.device_id}, skipping lens position save.")

        if self.mocap_target:
            try:
                if hasattr(self.mocap_target, '_close'):
                    asyncio.run_coroutine_threadsafe(self.mocap_target._close(), asyncio.get_event_loop() if asyncio.get_event_loop().is_running() else asyncio.new_event_loop())
                self.mocap_target.close()
            except Exception as e:
                self.logger.error(f"Error closing mocap connection for {self.device_id}: {e}")

        if hasattr(self, 'dyna') and self.dyna:
            self.dyna.close_port()

        if self.theia: # Only disconnect if Theia was initialized
            self.theia.disconnect()

        _perf_sleeper.sleep_ms(100)


def _find_free_port():
    """Find a free UDP port by binding to port 0 and getting the assigned port."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class VisualDartTracker:
    '''
    Object to track a target using a Dynamixel servo and visual tracking.
    Uses the visual_track function to get 3D coordinates via UDP, then performs reprojection
    to calculate pan/tilt angles and distance.
    
    CONFIGURATION: LATENCY ANALYSIS MODE
    - UDP socket in blocking mode (waits for visual data)
    - Simplified tracking loop without outlier detection or Kalman filtering
    - Optimized for measuring pure visual tracking latency vs servo communication overhead
    '''
    def __init__(self, device_id: str, data_queue, udp_port=None):
        set_realtime_priority()
        self.logger = logging.getLogger("Track")
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%H:%M:%S'
        )

        self.device_id = device_id
        self.config_manager = ConfigManager(device_id=self.device_id)
        self.current_dart_config_data = self.config_manager.config # Device-specific config for this DART's hardware
        
        # Load the full config here if needed for the visual_track subprocess
        # This is done because VisualDartTracker itself initiates the visual_track process
        # which requires the full configuration context.
        self.full_config_data_for_subprocess = self.config_manager.load_config()

        self.data_queue = data_queue
        
        # Setup UDP communication - use provided port or default based on device_id
        if udp_port is not None:
            self.udp_port = udp_port
        elif device_id == "DART_1":
            self.udp_port = 12345
        elif device_id == "DART_2":
            self.udp_port = 12346
        else:
            self.udp_port = 12347  # Default for DART_3 or other devices
            
        self.udp_socket = None
        self.logger.info(f"Using UDP port {self.udp_port} for visual tracking communication ({self.device_id})")
        
        # Create a termination event for the visual tracking process
        self.terminate_event = multiprocessing.Event()
        
        self.coefficients = None # Initialize coefficients
        initial_zoom_steps = None
        self.theia = None # Initialize self.theia to None

        # Get motor_mid_pos for Dynamixel angle calculations
        self.motor_mid_pos = self.current_dart_config_data.get("hardware_params", {}).get("mirror_mid", 45)
        self.logger.info(f"Using motor mid position: {self.motor_mid_pos} for VisualDartTracker {self.device_id}")

        self.use_kalman = self.current_dart_config_data.get("tracking", {}).get("use_kalman", True)
        self.kalman = AdaptiveKalmanFilter(mode='position') if self.use_kalman else None
        self.last_time = time.perf_counter()
        
        # Initialize outlier detection parameters
        self.max_distance_threshold = 500  # mm - maximum acceptable jump between frames
        self.probation_counter = 0         # How many consistent frames we've seen of a potential new target
        self.probation_limit = 10           # How many consistent frames needed to accept a new target
        self.probation_position = None     # Position of the potential new target
        
        # Load and ensure calibration data are numpy arrays before use
        calibration_cfg_data = self.current_dart_config_data.get("calibration", {})
        pan_origin_list = calibration_cfg_data.get("pan_origin")
        tilt_origin_list = calibration_cfg_data.get("tilt_origin")
        rotation_matrix_list = calibration_cfg_data.get("rotation_matrix")

        if pan_origin_list is None or tilt_origin_list is None or rotation_matrix_list is None:
            self.logger.error(f"No calibration data found in config for VisualDartTracker {self.device_id}.")
            raise ValueError(f"Calibration data not found for VisualDartTracker {self.device_id}")

        self.pan_origin = np.array(pan_origin_list)
        self.tilt_origin = np.array(tilt_origin_list)
        self.rotation_matrix = np.array(rotation_matrix_list)
        self.logger.info(f"Calibration data loaded successfully for VisualDartTracker {self.device_id}.")
        
        # Calculate mean_origin after ensuring numpy arrays
        self.mean_origin = (self.pan_origin + self.tilt_origin) / 2.0 # Use 2.0 for float division

        # Reprojection params from current DART's config (if applicable, or should this be global?)
        d_tilt_list = self.current_dart_config_data.get("reprojection_params", {}).get("d_tilt", [0.0, -0.070, -0.06])
        d_m_list = self.current_dart_config_data.get("reprojection_params", {}).get("d_m", [0, -0.05, 0])
        d_cam_list = self.current_dart_config_data.get("reprojection_params", {}).get("d_cam", [0.11, 0, 0, 1])
        target_z = self.current_dart_config_data.get("reprojection_params", {}).get("target_z", 2000)

        self.reprojection = Reprojection(target_z=target_z, d_tilt=d_tilt_list, d_m=d_m_list, d_cam=d_cam_list)
        
        # Setup UDP socket for receiving data
        try:
            self.udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Allow multiple receivers to bind to the same port and receive broadcasts
            self.udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.udp_socket.bind(('', self.udp_port))  # Bind to all interfaces to receive broadcasts
            # Optimize UDP socket for lower latency
            self.udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 65536)  # Increase receive buffer
            # BLOCKING MODE: Wait for actual visual tracking data instead of timing out
            # This will help isolate visual tracking latency from servo communication bottlenecks
            self.logger.info(f"UDP broadcast receiver socket bound to port {self.udp_port} in BLOCKING mode for visual tracking latency analysis")
        except Exception as e:
            self.logger.error(f"Failed to setup UDP socket: {e}")
            raise
        
        # Start the visual tracking process, pass the UDP port instead of queue
        udp_ports = [12345, 12346, 12347]  # Broadcast to three ports
        self.visual_process = multiprocessing.Process(
            target=visual_track,
            args=(self.full_config_data_for_subprocess, udp_ports, self.terminate_event),
            daemon=True
        )
        self.visual_process.start()
        self.logger.info(f"Visual tracking process started, broadcasting to ports {udp_ports}")

        # Create dynamixel controller object and open serial port
        self.dyna = DynaController(self.current_dart_config_data["devices"]["dynamixel_port"])  # Use configured port
        self.dyna.open_port()

        self.dyna.set_gains(1, 2432, 720, 3200, 0)
        self.dyna.set_gains(2, 2432, 720, 3200, 0)
        
        self.dyna.set_op_mode(self.dyna.pan_id, 3)
        self.dyna.set_op_mode(self.dyna.tilt_id, 3)

        self.dyna.set_torque(self.dyna.pan_id, True)
        self.dyna.set_torque(self.dyna.tilt_id, True)

        self.start_time = time.perf_counter()

        self.counter = 0
        self.dist = 0
        
        # Flag to track if the target is lost
        self.target_lost = False
        
        # Last known position (used when target is lost)
        self.last_position = np.zeros(3)
        
        # Initialize Dynamixel and Theia controllers
        device_hw_config = self.current_dart_config_data.get("devices", {})
        dyna_port = device_hw_config.get("dynamixel_port")
        theia_port = device_hw_config.get("theia_port")

        if not dyna_port:
            self.logger.error(f"Dynamixel port not configured for VisualDartTracker {self.device_id}")
            raise ValueError(f"Dynamixel port configuration missing for VisualDartTracker {self.device_id}")
        
        self.dyna = DynaController(dyna_port)
        self.dyna.open_port()
        self.dyna.set_gains(1, 2432, 720, 3200, 0)
        self.dyna.set_gains(2, 2432, 720, 3200, 0)
        self.dyna.set_op_mode(self.dyna.pan_id, 3)
        self.dyna.set_op_mode(self.dyna.tilt_id, 3)
        self.dyna.set_torque(self.dyna.pan_id, True)
        self.dyna.set_torque(self.dyna.tilt_id, True)

        if not theia_port:
            self.logger.warning(f"Theia port not configured for VisualDartTracker {self.device_id}. Theia features will be unavailable.")
            # self.theia remains None
        else:
            _theia_controller = TheiaController(port=theia_port)
            if _theia_controller.connect():
                self.theia = _theia_controller # Assign to self.theia only on successful connection
                self.theia.initialise()
                theia_state = device_hw_config.get("theia_state", {})
                zoom_position = theia_state.get("zoom_position", 0)
                focus_position = theia_state.get("focus_position", 0)
                iris_position = theia_state.get("iris_position", 0)
                self.theia.set_absolute_position("A", zoom_position)
                self.theia.set_absolute_position("B", focus_position)
                self.theia.set_absolute_position("C", iris_position)
                self.logger.info(f"Initialized Theia for {self.device_id} with saved positions - Zoom: {zoom_position}, Focus: {focus_position}, Iris: {iris_position}")
                
                self.coefficients, initial_zoom_steps = self.config_manager.get_lens_parameters()
                if self.theia and initial_zoom_steps is not None:
                    self.logger.info(f"Moving Theia zoom to operational position: {initial_zoom_steps} steps for lens config (visual tracker).")
                    self.theia.move_axis("A", initial_zoom_steps) # MOVE to the target zoom step
                    # Optional: Wait for this move to complete if necessary.
                    # self.theia.wait_for_motion_complete(timeout=5)
                    self.logger.info(f"Theia operational zoom move command sent for visual tracker. Current position will be {initial_zoom_steps} after move.")
                elif not self.theia: # This case might be redundant
                     self.logger.warning("Theia not available, cannot set initial zoom from lens config for visual tracking.")
                else: # initial_zoom_steps is None
                    self.logger.warning("Could not retrieve initial zoom steps from lens config for visual tracking. Zoom not moved to operational setting.")
            else:
                self.logger.error(f"Failed to connect to Theia on port {theia_port} for VisualDartTracker {self.device_id}")
                # self.theia remains None

    def track(self):
        # SIMPLIFIED TRACKING LOOP FOR LATENCY ANALYSIS
        # Waits for actual visual tracking data instead of handling timeouts
        # This isolates visual tracking latency from servo communication bottlenecks
        
        try:
            # BLOCKING: Wait for actual UDP data from visual tracking
            data, addr = self.udp_socket.recvfrom(1024)
            udp_message = json.loads(data.decode('utf-8'))
            point_3d = np.array(udp_message['point_3d'])
            print(f"3D coordinate received: {point_3d}")
            time.sleep(0.01)
            
            # Minimal logging for performance analysis
            if self.counter % 500 == 0:  # Log every 500 frames
                self.logger.info(f"Frame {self.counter}: Visual data received from {addr}")
            
            # Use raw position data (no Kalman filtering for pure latency analysis)
            position_3d = point_3d
            
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            self.logger.warning(f"Error parsing UDP message: {e}")
            return
        except (ConnectionResetError, OSError) as e:
            self.logger.error(f"UDP socket error: {e}")
            return
        except Exception as e:
            self.logger.error(f"Unexpected error in visual tracking UDP reception: {e}")
            return
        
        # Calculate pursuit angles using reprojection on position
        pan_angle_rad, tilt_angle_rad = self.reprojection.calculate_angles(position_3d)
        
        # Calculate distance
        # distance = self.reprojection.calculate_distance(position_3d)
        distance = 1.0 # TODO: Remove this
        
        # Check if the distance has changed significantly for focus adjustment
        if abs(distance - self.dist) > 0.3:
            steps = self.distance_to_steps(distance)
            if self.counter % 50 == 0:  # Reduced logging
                self.logger.debug(f"Distance: {distance:.3f}m Steps: {steps}")
            steps = max(0, steps)
            if self.theia:
                self.theia.move_axis("B", steps)
            self.dist = distance
            
        # Convert radians to degrees
        pan_angle_deg = np.rad2deg(pan_angle_rad)
        tilt_angle_deg = np.rad2deg(tilt_angle_rad)
        
        # Convert optical angles to motor positions for mirror control
        pan_angle = round(num_to_range(pan_angle_deg, -45, 45, self.motor_mid_pos - 22.5, self.motor_mid_pos + 22.5), 2)
        tilt_angle = round(num_to_range(tilt_angle_deg, 45, -45, self.motor_mid_pos - 22.5, self.motor_mid_pos + 22.5), 2)
        
        # Set the dynamixel to the calculated angles
        # self.dyna.set_sync_pos(pan_angle, tilt_angle)
        
        # Get the current angles of the dynamixels
        # encoder_pan_angle, encoder_tilt_angle = self.dyna.get_sync_pos()
        encoder_pan_angle = 0 # TODO: Remove this
        encoder_tilt_angle = 0 # TODO: Remove this
        
        # Put the data into the output queue in a non-blocking way
        data = (
            position_3d,  # Position coordinates from visual tracking
            pan_angle,
            tilt_angle,
            round(encoder_pan_angle, 2),
            round(encoder_tilt_angle, 2),
            perf_counter_ns() * 1e-6
        )
        try:
            self.data_queue.put_nowait(data)
        except queue.Full:
            if self.counter % 100 == 0:  # Reduced logging frequency
                self.logger.debug("Data queue is full. Skipping this data point.")
            
        self.counter += 1

    def shutdown(self) -> None:
        self.logger.info(f"Shutting down visual tracking for {self.device_id}.")
        end_time = time.perf_counter()
        if end_time > self.start_time:
            self.logger.info(f"Control frequency: {self.counter / (end_time - self.start_time)} Hz")
        else:
            self.logger.info("Control frequency: N/A (duration too short)")

        self.terminate_event.set()
        if self.visual_process.is_alive():
            self.logger.info("Waiting for visual tracking sub-process to terminate...")
            self.visual_process.join(timeout=5.0)
            if self.visual_process.is_alive():
                self.logger.warning("Visual tracking sub-process did not terminate gracefully, terminating forcefully.")
                self.visual_process.terminate()
                self.visual_process.join(timeout=2.0)

        # Close UDP socket
        if self.udp_socket:
            try:
                self.udp_socket.close()
                self.logger.info("UDP socket closed")
            except Exception as e:
                self.logger.error(f"Error closing UDP socket: {e}")

        if self.theia and self.theia.ser and self.theia.ser.is_open:
            try:
                self.logger.info(f"Getting lens positions for visual tracker ({self.device_id})...")
                zoom_position, focus_position = self.theia.get_current_positions()
                iris_position = self.theia.get_last_commanded_iris()

                if zoom_position is not None and focus_position is not None and iris_position is not None:
                    self.logger.info(f"Current Theia positions (visual - {self.device_id}) - Zoom: {zoom_position}, Focus: {focus_position}, Iris: {iris_position}")

                    # Use the existing config_manager instance
                    self.config_manager.update_theia_position(zoom=zoom_position, 
                                                                 focus=focus_position, 
                                                                 iris=iris_position)
                    self.logger.info(f"Successfully saved Theia positions (visual - {self.device_id}) via self.config_manager.")
                else:
                    self.logger.warning(f"Could not retrieve all current Theia lens positions for visual tracker ({self.device_id}). Not saving.")
            except Exception as e:
                self.logger.error(f"Error retrieving or saving lens positions during visual tracker ({self.device_id}) shutdown: {e}", exc_info=True)
        else:
            self.logger.warning(f"Theia controller not available/connected for visual tracker ({self.device_id}), skipping lens position save.")

        if hasattr(self, 'dyna') and self.dyna:
            try:
                self.logger.info(f"Closing Dynamixel port for {self.device_id}...")
                self.dyna.close_port()
                self.logger.info(f"Dynamixel port closed for {self.device_id}.")
            except Exception as e:
                self.logger.error(f"Error closing Dynamixel port for {self.device_id}: {e}")

        if self.theia: # Only disconnect if Theia was initialized
            try:
                self.logger.info(f"Disconnecting from Theia controller for {self.device_id}...")
                self.theia.disconnect()
                self.logger.info(f"Theia controller disconnected for {self.device_id}.")
            except Exception as e:
                self.logger.error(f"Error disconnecting Theia controller for {self.device_id}: {e}")

        self.logger.info(f"Visual tracking shutdown complete for {self.device_id}.")
        return

    def distance_to_steps(self, distance: float) -> int:
        if self.coefficients is None:
            self.logger.warning("Focus coefficients not loaded, cannot calculate steps from distance.")
            return 0 # Or some other default/error indicator
        steps = int(np.polyval(self.coefficients, distance))
        steps = max(0, min(steps, 65535))
        return steps

def dart_track(current_device_id, data_queue, terminate_event):
    tracker = None
    proc_logger = logging.getLogger("DartTrackProcess") 
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    def cleanup():
        if tracker:
            try:
                proc_logger.info(f"Initiating tracker shutdown for {current_device_id}...")
                tracker.shutdown()
                proc_logger.info(f"Tracker shutdown completed for {current_device_id}.")
            except Exception as e:
                proc_logger.error(f"Error during tracker ({current_device_id}) shutdown: {e}", exc_info=True)
        
        while not data_queue.empty():
            try:
                data_queue.get_nowait()
            except queue.Empty:
                pass
            except Exception as e_q:
                 proc_logger.error(f"Error clearing data queue for {current_device_id}: {e_q}")

    atexit.register(cleanup)
    
    # This initial ConfigManager call is primarily to get the tracking_mode for the current_device_id.
    # The trackers themselves will create their own ConfigManager instances for detailed config.
    try:
        initial_config_manager = ConfigManager(device_id=current_device_id)
        current_dart_tracking_mode = initial_config_manager.config.get("tracking", {}).get("mode", "mocap")
        proc_logger.info(f"Determined tracking mode for {current_device_id}: {current_dart_tracking_mode}")

        if current_dart_tracking_mode == "visual":
            proc_logger.info(f"Starting visual tracking for {current_device_id}")
            # VisualDartTracker now uses UDP instead of queue for communication with visual_track subprocess.
            tracker = VisualDartTracker(device_id=current_device_id, 
                                        data_queue=data_queue)
        else: # Default to mocap or if mode is explicitly "mocap"
            proc_logger.info(f"Starting mocap tracking for {current_device_id}")
            # Mocap system details (IP, port) are needed for Mocap Streamer initialization.
            # These are fetched via the initial_config_manager here.
            mocap_hw_config = initial_config_manager.config.get("devices", {}).get("mocap", {})
            system = mocap_hw_config.get("system", "qualisys")
            mocap_ip = mocap_hw_config.get("ip")
            mocap_port = mocap_hw_config.get("port")

            if not mocap_ip:
                raise ValueError(f"Mocap IP not configured for {current_device_id}")

            mocap_streamer = None
            if system == "qualisys":
                from hardware.mocap.qtm_mocap import QTMStream
                mocap_streamer = QTMStream(qtm_ip=mocap_ip)
            elif system == "vicon":
                from hardware.mocap.vicon_stream import ViconStream
                if not mocap_port:
                    raise ValueError(f"Vicon port not configured for {current_device_id} for mocap system: {system}")
                mocap_streamer = ViconStream(vicon_host=mocap_ip, udp_port=mocap_port)
            else:
                raise ValueError(f"Unknown mocap system: {system} for {current_device_id}")
                
            mocap_streamer.start()
            # mocap_streamer.calibration_target = True # This should be set based on actual need/config
            
            tracker = DartTracker(device_id=current_device_id, 
                                  data_queue=data_queue, 
                                  mocap=mocap_streamer)
            
        # Create profiler and profile only the tracking loop
        profiler = cProfile.Profile()
        proc_logger.info(f"Starting profiled tracking loop for {current_device_id}")
        
        # Profile only the tracking loop
        profiler.enable()
        while not terminate_event.is_set():
            tracker.track()
        profiler.disable()
        
        # Save profile results
        try:
            # Generate timestamped profile output path
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            tracking_mode_str = current_dart_tracking_mode.replace(" ", "_").lower()
            device_id_str = current_device_id.replace("_", "").lower()
            profile_filename = f"tracking_loop_profile_{device_id_str}_{tracking_mode_str}_{timestamp}.prof"
            
            # Create profiles directory if it doesn't exist
            profiles_dir = "profiles"
            os.makedirs(profiles_dir, exist_ok=True)
            profile_output_path = os.path.join(profiles_dir, profile_filename)
            
            # Save binary profile
            profiler.dump_stats(profile_output_path)
            
            # Create human-readable text report
            text_report_path = profile_output_path.replace('.prof', '_report.txt')
            with open(text_report_path, 'w') as f:
                stats = pstats.Stats(profiler)
                
                f.write("="*80 + "\n")
                f.write("DART TRACKING LOOP PERFORMANCE ANALYSIS\n")
                f.write("="*80 + "\n")
                f.write(f"Device: {current_device_id}\n")
                f.write(f"Mode: {current_dart_tracking_mode}\n")
                f.write(f"Timestamp: {timestamp}\n")
                f.write("="*80 + "\n\n")
                
                f.write("TOTAL RUNTIME AND CALLS:\n")
                f.write("-"*40 + "\n")
                stats.print_stats(0, file=f)
                
                f.write("\n\nTOP 20 FUNCTIONS BY CUMULATIVE TIME:\n")
                f.write("-"*50 + "\n")
                stats.sort_stats('cumulative')
                stats.print_stats(20, file=f)
                
                f.write("\n\nTOP 15 FUNCTIONS BY TOTAL TIME (excluding calls):\n")
                f.write("-"*55 + "\n")
                stats.sort_stats('tottime') 
                stats.print_stats(15, file=f)
                
                f.write("\n\nFUNCTIONS WITH MOST CALLS:\n")
                f.write("-"*30 + "\n")
                stats.sort_stats('ncalls')
                stats.print_stats(15, file=f)
            
            proc_logger.info(f"Tracking loop profile saved to: {profile_output_path}")
            proc_logger.info(f"Human-readable report saved to: {text_report_path}")
            
        except Exception as e_profile:
            proc_logger.error(f"Error saving profile results: {e_profile}", exc_info=True)
    except Exception as e_outer:
        proc_logger.error(f"Critical error in tracking process for {current_device_id}: {e_outer}", exc_info=True)
    finally:
        cleanup() # Ensure cleanup runs
        if 'initial_config_manager' in locals(): # Avoid error if cleanup was already called via atexit
            atexit.unregister(cleanup)
            