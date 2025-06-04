from hardware.camera.camera_manager import CameraManager
from tracking.motion_detector.stereo_cam import StereoCameraMog
from utils.misc_funcs import set_realtime_priority
from utils.perf_timings import PerfSleeper
import logging, queue, threading, time, socket, json
import numpy as np
import cProfile  # Added for visual processing profiling
import pstats    # Added for profile analysis
import os        # Added for file operations

# Create a single PerfSleeper instance for the module
_perf_sleeper = PerfSleeper()

class VisualTracker:
    def __init__(self, full_config_dict):
        set_realtime_priority()
        self.logger = logging.getLogger("Track")
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%H:%M:%S'
        )
        self.full_config_data = full_config_dict

        # Get camera serials from the full config, one from DART_1 and one from DART_2
        try:
            dart1_cameras_conf = self.full_config_data.get("DART_1", {}).get("devices", {}).get("cameras", {})
            dart2_cameras_conf = self.full_config_data.get("DART_2", {}).get("devices", {}).get("cameras", {})
            
            self.serial_number_1 = dart1_cameras_conf.get("static_wide_angle_serial")
            self.serial_number_2 = dart2_cameras_conf.get("static_wide_angle_serial")
            
            if not self.serial_number_1:
                self.logger.error("DART_1 static_wide_angle_serial not found in config.")
                raise ValueError("Missing DART_1 static_wide_angle_serial in config")
            if not self.serial_number_2:
                self.logger.error("DART_2 static_wide_angle_serial not found in config.")
                raise ValueError("Missing DART_2 static_wide_angle_serial in config")
                
        except Exception as e:
            self.logger.error(f"Error retrieving static wide-angle camera serials from full config: {e}")
            self.serial_number_1 = None
            self.serial_number_2 = None
            raise

    def connect_cameras(self):
        if not self.serial_number_1 or not self.serial_number_2:
            self.logger.error("Cannot connect visual tracking cameras: serial numbers not loaded.")
            return False
            
        # Initialise static camera 1
        self.static_camera_1 = CameraManager()
        if not self.static_camera_1.connect_camera(self.serial_number_1):
            self.logger.error(f"Failed to connect to static camera 1 ({self.serial_number_1})")
            return False
        self.static_camera_1.start_frame_thread()
        self.logger.info(f"Connected to static camera 1 ({self.serial_number_1})")

        # Initialise static camera 2
        self.static_camera_2 = CameraManager()
        if not self.static_camera_2.connect_camera(self.serial_number_2):
            self.logger.error(f"Failed to connect to static camera 2 ({self.serial_number_2})")
            # Clean up camera 1 if camera 2 fails
            if hasattr(self, 'static_camera_1') and self.static_camera_1:
                self.static_camera_1.release()
            return False
        self.static_camera_2.start_frame_thread()
        self.logger.info(f"Connected to static camera 2 ({self.serial_number_2})")
        return True


def visual_track(full_config_dict, udp_port, terminate_event):
    """
    Visual tracking function that sends 3D coordinates via UDP instead of queue.
    Optimized for low latency.
    
    Args:
        full_config_dict: Configuration dictionary
        udp_port: UDP port to send data to
        terminate_event: Event to signal termination
    """
    tracker = None
    udp_socket = None
    frame_counter = 0
    
    try:
        # Setup UDP socket for sending data with optimizations
        udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        # Enable broadcasting to support multiple receivers
        udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        # Optimize UDP socket for lower latency
        udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 65536)  # Increase send buffer
        logging.info(f"UDP broadcast socket created for sending to port {udp_port}")
        
        tracker = VisualTracker(full_config_dict)
        if not tracker.connect_cameras():
            logging.error("Visual_track: Failed to connect cameras. Exiting.")
            return
            
        res = tracker.static_camera_1.frame_size
        # No need for calibration directory config - automatically finds newest calibration
        track_params = {
            "cam_res": res, 
            "tau":200, 
            "t_arr":[20,20], 
            "t_arr_chaser":[40,40], 
            "d_array":[180, 130], 
            "r_threshold":2, 
            "threshold":0.00005, 
            "reset_timeout":10,
            "init_z": 2000
        }
        stereo_track = StereoCameraMog(**track_params)
        
        # Wait for frames to become available
        logging.info("Waiting for frames...")
        wait_start_time = time.time()
        frame_wait_timeout = 10.0
        
        while not terminate_event.is_set() and time.time() - wait_start_time < frame_wait_timeout:
            # Get initial frames
            frame_l = tracker.static_camera_1.latest_frame
            frame_r = tracker.static_camera_2.latest_frame
            
            # Check if both frames are available
            if frame_l is not None and frame_r is not None:
                # Check frame dimensions to ensure they're large enough for processing
                h1, w1 = frame_l.shape[:2]
                h2, w2 = frame_r.shape[:2]
                
                min_required_dim = 300  # At least 300 pixels in each dimension
                
                if min(h1, w1, h2, w2) < min_required_dim:
                    logging.warning(f"Frame dimensions too small: Left {frame_l.shape}, Right {frame_r.shape}")
                    logging.warning(f"Waiting for larger frames...")
                    _perf_sleeper.sleep_ms(50)  # Reduced from 100ms to 50ms
                    continue
                    
                logging.info(f"Frame dimensions: Left {frame_l.shape}, Right {frame_r.shape}")
                logging.info("Initial frames received, starting tracking...")
                break
            else:
                # Check for termination every 50ms instead of 100ms
                if terminate_event.is_set():
                    logging.info("Termination requested during frame wait")
                    return
                    
                logging.info("Waiting for frames...")
                _perf_sleeper.sleep_ms(50)  # Reduced from 100ms to 50ms
        
        # Check if we timed out or termination was requested
        if terminate_event.is_set():
            logging.info("Termination requested, exiting tracking loop")
            return
            
        if time.time() - wait_start_time >= frame_wait_timeout:
            logging.error(f"Timed out waiting for camera frames after {frame_wait_timeout} seconds")
            return
        
        # Pre-allocate message template for efficiency
        udp_message_template = {
            "timestamp": 0.0,
            "point_3d": [0.0, 0.0, 0.0],
            "frame_id": 0
        }
        
        # Create profiler for visual processing loop
        profiler = cProfile.Profile()
        logging.info("Starting profiled visual tracking loop")
        
        # Profile the visual processing loop
        profiler.enable()
        
        # Main tracking loop with maximum run duration
        loop_start_time = time.time()
        max_run_time = 12 * 60 * 60  # 12 hours max run time
        
        while not terminate_event.is_set() and time.time() - loop_start_time < max_run_time:
            # Get frames immediately without additional validation for speed
            frame_l = tracker.static_camera_1.latest_frame
            frame_r = tracker.static_camera_2.latest_frame
            
            # Quick null check and continue immediately if frames not ready
            if frame_l is None or frame_r is None:
                continue  # No sleep, just try again immediately
                
            try:
                # Process the images immediately without dimension checks for speed
                stereo_track.update(frame_l, frame_r)
                
                # Send 3D point via UDP with minimal overhead
                frame_counter += 1
                
                # Update message template in-place for efficiency
                udp_message_template["timestamp"] = time.time()
                udp_message_template["point_3d"] = stereo_track.point_3d.tolist()
                udp_message_template["frame_id"] = frame_counter
                
                # Send UDP packet with error handling but no blocking
                try:
                    message_bytes = json.dumps(udp_message_template, separators=(',', ':')).encode('utf-8')
                    udp_socket.sendto(message_bytes, ('255.255.255.255', udp_port))
                except Exception as udp_e:
                    # Minimal logging to avoid latency
                    if frame_counter % 100 == 0:  # Only log every 100th error
                        logging.warning(f"UDP send error (frame {frame_counter}): {udp_e}")
                    
            except Exception as e:
                # Minimal error handling to maintain speed
                if frame_counter % 100 == 0:  # Only log every 100th error
                    logging.error(f"Error in tracking loop (frame {frame_counter}): {e}")
                continue  # Continue immediately without sleep
        
        # Stop profiling
        profiler.disable()
        
        # Save visual tracking profile results
        try:
            # Generate timestamped profile output path
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            profile_filename = f"visual_track_profile_{timestamp}.prof"
            
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
                f.write("VISUAL TRACKING PERFORMANCE ANALYSIS\n")
                f.write("="*80 + "\n")
                f.write(f"Timestamp: {timestamp}\n")
                f.write(f"Total frames processed: {frame_counter}\n")
                f.write("="*80 + "\n\n")
                
                f.write("TOTAL RUNTIME AND CALLS:\n")
                f.write("-"*40 + "\n")
                stats.print_stats(0, file=f)
                
                f.write("\n\nTOP 20 FUNCTIONS BY CUMULATIVE TIME:\n")
                f.write("-"*50 + "\n")
                stats.sort_stats('cumulative')
                stats.print_stats(20, file=f)
                
                f.write("\n\nTOP 15 FUNCTIONS BY TOTAL TIME:\n")
                f.write("-"*45 + "\n")
                stats.sort_stats('tottime') 
                stats.print_stats(15, file=f)
                
                f.write("\n\nFUNCTIONS WITH MOST CALLS:\n")
                f.write("-"*30 + "\n")
                stats.sort_stats('ncalls')
                stats.print_stats(15, file=f)
                
                f.write("\n\nVISUAL PROCESSING SPECIFIC FUNCTIONS:\n")
                f.write("-"*45 + "\n")
                stats.print_stats('stereo|camera|update|StereoCameraMog', file=f)
            
            logging.info(f"Visual tracking profile saved to: {profile_output_path}")
            logging.info(f"Human-readable report saved to: {text_report_path}")
            
        except Exception as e_profile:
            logging.error(f"Error saving visual tracking profile results: {e_profile}", exc_info=True)
        
        # Clean up
        logging.info("Visual tracking stopping, releasing resources...")
        
    except Exception as e:
        logging.error(f"Error in visual tracking: {e}")
    finally:
        # Clean up UDP socket
        if udp_socket:
            try:
                udp_socket.close()
                logging.info("UDP socket closed")
            except Exception as e:
                logging.error(f"Error closing UDP socket: {e}")
                
        # Clean up camera resources
        try:
            if hasattr(tracker, 'static_camera_1') and tracker.static_camera_1:
                if hasattr(tracker.static_camera_1, 'stop_frame_thread'):
                    tracker.static_camera_1.stop_frame_thread()
                if hasattr(tracker.static_camera_1, 'release'):
                    tracker.static_camera_1.release()
            if hasattr(tracker, 'static_camera_2') and tracker.static_camera_2:
                if hasattr(tracker.static_camera_2, 'stop_frame_thread'):
                    tracker.static_camera_2.stop_frame_thread()
                if hasattr(tracker.static_camera_2, 'release'):
                    tracker.static_camera_2.release()
            logging.info("Camera resources released")
        except Exception as e:
            logging.error(f"Error releasing camera resources: {e}")
            
        logging.info("Visual tracking stopped")

if __name__ == '__main__':
    # This __main__ block is for testing visual_track.py directly.
    # It would need a mock or example full_config_dict to run correctly.
    # For example:
    example_full_config = {
        "DART_1": {
            "devices": {
                "cameras": {"static_wide_angle_serial": "SERIAL1"}
            },
            "stereo_param_file_path": "/path/to/stereo.mat"
        },
        "DART_2": {
            "devices": {
                "cameras": {"static_wide_angle_serial": "SERIAL2"}
            }
        }
        # ... other necessary config parts ...
    }
    udp_port = 12345
    terminate_event = threading.Event()
    
    # Start tracking in a separate thread
    tracking_thread = threading.Thread(
        target=visual_track,
        args=(example_full_config, udp_port, terminate_event), # Pass udp_port instead of queue
        daemon=True
    )
    tracking_thread.start()
    
    try:
        # Main thread will listen for UDP data and print to console
        logging.info("Main thread: Monitoring UDP tracking data...")
        
        # Setup UDP receiver for testing
        udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Allow multiple receivers to bind to the same port
        udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        udp_socket.bind(('', udp_port))  # Bind to all interfaces to receive broadcasts
        udp_socket.settimeout(1.0)  # 1 second timeout
        
        while True:
            try:
                # Receive UDP data
                data, addr = udp_socket.recvfrom(1024)
                message = json.loads(data.decode('utf-8'))
                
                logging.info(f"-------- Tracking Data --------")
                logging.info(f"Frame ID: {message['frame_id']}")
                logging.info(f"Timestamp: {message['timestamp']}")
                logging.info(f"3D Position: {message['point_3d']}")
                logging.info(f"------------------------------")
                
            except socket.timeout:
                # No data available, just continue
                continue
            except json.JSONDecodeError as e:
                logging.error(f"JSON decode error: {e}")
                continue
                
    except KeyboardInterrupt:
        logging.info("Keyboard interrupt received, shutting down...")
    finally:
        # Set the termination event to stop the tracking thread
        terminate_event.set()
        
        # Wait for the tracking thread to finish
        tracking_thread.join(timeout=2.0)
        
        # Close UDP socket
        if 'udp_socket' in locals():
            udp_socket.close()
            
        logging.info("Clean shutdown complete")
