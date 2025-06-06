#!/usr/bin/env python3
"""
UDP Dart Adapter for GERF-App
Receives UDP broadcast data from DART visual tracking system and reformats it for the WebSocket bridge.
This adapter bridges the gap between the DART visual tracking output and GERF-App expected format.
Updated to handle the actual JSON broadcast format from visual_track.py.
"""

import socket
import threading
import json
import time
import logging
from datetime import datetime
from typing import Dict, Any, Optional, Tuple
from config import *

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DartDataAdapter:
    """
    Adapter to receive DART visual tracking broadcast data and convert it to GERF-App format.
    
    Expected DART visual tracking data format (from visual_track.py):
    - JSON: {"timestamp": time, "point_3d": [x, y, z], "frame_id": frame_counter}
    - Broadcast to 255.255.255.255 on UDP port
    
    GERF-App expected format:
    - JSON: {"x": x, "y": y, "z": z, "timestamp": timestamp, ...}
    
    Updated to handle actual visual tracking broadcasts from DART system.
    """
    
    def __init__(self, dart_udp_port: int = 12346, gerf_udp_port: int = 12344):
        self.dart_udp_port = dart_udp_port  # Port to receive DART visual tracking broadcasts
        self.gerf_udp_port = gerf_udp_port  # Port to send data to WebSocket bridge
        
        self.dart_socket = None
        self.gerf_socket = None
        self.running = False
        self.adapter_thread = None
        
        # Data conversion settings
        self.coordinate_scale = 0.1  # Scale factor for coordinates (mm to visualization units)
        self.coordinate_offset = (0, 0, 0)  # Offset for coordinate system alignment
        
        # Statistics
        self.packets_received = 0
        self.packets_sent = 0
        self.last_data_time = None
        
        # Debug tracking
        self.debug_packet_count = 0
        
    def start(self):
        """Start the DART visual tracking data adapter."""
        if self.running:
            logger.warning("Adapter is already running")
            return
        
        try:
            # Set up socket for broadcast reception (same as visual tracking receiver)
            self.dart_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Allow multiple receivers to bind to the same port and receive broadcasts
            self.dart_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            # Try to enable port reuse for multiple listeners (macOS/Linux)
            # try:
            #     self.dart_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            #     logger.info("SO_REUSEPORT enabled - multiple listeners can share the port")
            # except AttributeError:
            #     logger.warning("SO_REUSEPORT not available on this system")
            # except OSError as e:
            #     logger.warning(f"SO_REUSEPORT failed: {e}")
            # Bind to all interfaces to receive broadcast data
            self.dart_socket.bind(('', self.dart_udp_port))
            self.dart_socket.settimeout(1.0)
            
            # Set up fresh UDP socket for sending to bridge
            self.gerf_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Disable buffering to ensure immediate sending
            self.gerf_socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024)
            
            logger.info(f"DART visual tracking adapter listening for JSON broadcasts on port {self.dart_udp_port}")
            logger.info(f"DART adapter forwarding to GERF bridge on port {self.gerf_udp_port}")
            logger.info("Expecting JSON format: {'timestamp': t, 'point_3d': [x,y,z], 'frame_id': f}")
            
            # Start adapter thread
            self.running = True
            self.adapter_thread = threading.Thread(target=self._adapter_loop, daemon=True)
            self.adapter_thread.start()
            
            logger.info("DART visual tracking adapter started successfully")
            
        except Exception as e:
            logger.error(f"Error starting DART adapter: {e}")
            self.stop()
            raise
    
    def stop(self):
        """Stop the DART data adapter."""
        self.running = False
        
        if self.adapter_thread and self.adapter_thread.is_alive():
            self.adapter_thread.join(timeout=2)
        
        if self.dart_socket:
            self.dart_socket.close()
        if self.gerf_socket:
            self.gerf_socket.close()
        
        logger.info(f"DART adapter stopped. Total packets: {self.packets_received}")
    
    def _adapter_loop(self):
        """Main adapter loop to receive and forward visual tracking data."""
        logger.info("DART visual tracking adapter started - listening for JSON broadcasts")
        
        while self.running:
            try:
                # Receive broadcast data from DART visual tracking system
                data, addr = self.dart_socket.recvfrom(4096)
                self.packets_received += 1
                self.last_data_time = time.time()
                
                # Debug: Print first few packets only
                if self.debug_packet_count < 2:
                    logger.info(f"Raw packet #{self.debug_packet_count + 1} from {addr}: {data[:150]}...")
                    self.debug_packet_count += 1
                
                # Parse DART visual tracking data
                dart_data = self._parse_visual_tracking_data(data, addr)
                if dart_data is None:
                    continue
                
                # Convert to GERF format
                gerf_data = self._convert_to_gerf_format(dart_data)
                
                # Send to WebSocket bridge
                self._send_to_bridge(gerf_data)
                
                # Log statistics less frequently
                if self.packets_received % 1000 == 0:
                    logger.info(f"Processed {self.packets_received} visual tracking packets")
                
            except socket.timeout:
                # Normal timeout, continue
                if self.packets_received == 0 and time.time() - (self.last_data_time or time.time()) > 10:
                    logger.warning("No DART visual tracking data received yet. Check if visual tracking is broadcasting.")
                continue
            except Exception as e:
                if self.running:
                    logger.error(f"Error in adapter loop: {e}")
                    time.sleep(0.1)  # Brief pause on error
    
    def _parse_visual_tracking_data(self, data: bytes, addr: tuple) -> Optional[Dict[str, Any]]:
        """
        Parse incoming DART visual tracking broadcast data.
        
        Expected format from visual_track.py:
        JSON: {"timestamp": time, "point_3d": [x, y, z], "frame_id": frame_counter}
        """
        try:
            # Decode as JSON (this is what visual_track.py sends)
            data_str = data.decode('utf-8')
            json_data = json.loads(data_str)
            
            # Validate expected visual tracking format
            if 'point_3d' in json_data and 'timestamp' in json_data:
                point_3d = json_data['point_3d']

                # flip sign on x and y coordinates
                point_3d[0] = -point_3d[0]
                point_3d[1] = -point_3d[1]
                
                # Ensure point_3d is a list/array with 3 elements
                if isinstance(point_3d, (list, tuple)) and len(point_3d) >= 3:
                    return {
                        'position': [float(point_3d[0]), float(point_3d[1]), float(point_3d[2])],
                        'timestamp': float(json_data['timestamp']),
                        'frame_id': json_data.get('frame_id', 0),
                        'source': 'visual_tracking',
                        'source_addr': addr
                    }
                else:
                    logger.warning(f"Invalid point_3d format from {addr}: {point_3d}")
                    return None
            
            # Check if it's already in GERF format (x, y, z)
            elif 'x' in json_data and 'y' in json_data and 'z' in json_data:
                return {
                    'position': [float(json_data['x']), float(json_data['y']), float(json_data['z'])],
                    'timestamp': json_data.get('timestamp', time.time()),
                    'source': 'gerf_compatible',
                    'source_addr': addr
                }
            
            else:
                logger.warning(f"Unrecognized JSON format from {addr}: {json_data}")
                return None
            
        except json.JSONDecodeError as e:
            logger.warning(f"JSON decode error from {addr}: {e} - Data: {data[:100]}")
            return None
        except (UnicodeDecodeError, ValueError) as e:
            logger.warning(f"Data parsing error from {addr}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error parsing data from {addr}: {e}")
            return None
    
    def _convert_to_gerf_format(self, dart_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert DART visual tracking data to GERF-App expected format.
        
        DART visual tracking position is typically in mm, GERF expects appropriate scale for visualization.
        """
        try:
            position = dart_data['position']
            
            # Apply coordinate transformations
            x, y, z = position[0], position[1], position[2]
            
            # Apply scaling (convert mm to appropriate units for visualization)
            x = (x * self.coordinate_scale) + self.coordinate_offset[0]
            y = (y * self.coordinate_scale) + self.coordinate_offset[1]
            z = (z * self.coordinate_scale) + self.coordinate_offset[2]
            
            # Create GERF-compatible data
            gerf_data = {
                'x': round(x, 2),
                'y': round(y, 2),
                'z': round(z, 2),
                'timestamp': dart_data.get('timestamp', time.time()),
                'source': 'dart_visual_tracking',
                'original_source': dart_data.get('source', 'unknown')
            }
            
            # Add additional metadata if available
            if 'frame_id' in dart_data:
                gerf_data['frame_id'] = dart_data['frame_id']
            if 'source_addr' in dart_data:
                gerf_data['dart_source'] = f"{dart_data['source_addr'][0]}:{dart_data['source_addr'][1]}"
            
            return gerf_data
            
        except Exception as e:
            logger.error(f"Error converting to GERF format: {e}")
            return {
                'x': 0, 'y': 0, 'z': 0,
                'timestamp': time.time(),
                'source': 'error',
                'error': str(e)
            }
    
    def _send_to_bridge(self, gerf_data: Dict[str, Any]):
        """Send formatted data to the WebSocket bridge."""
        try:
            # Add sequence number for debugging
            gerf_data['seq'] = self.packets_sent + 1
            
            message = json.dumps(gerf_data).encode('utf-8')
            self.gerf_socket.sendto(message, ('localhost', self.gerf_udp_port))
            self.packets_sent += 1
            
            # Debug: Print occasional packets to verify data flow
            if self.packets_sent <= 5 or self.packets_sent % 500 == 0:
                logger.info(f"Sent packet #{self.packets_sent}: x={gerf_data['x']}, y={gerf_data['y']}, z={gerf_data['z']}")
            
        except Exception as e:
            logger.error(f"Error sending to bridge: {e}")
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get adapter statistics."""
        return {
            'packets_received': self.packets_received,
            'packets_sent': self.packets_sent,
            'last_data_time': self.last_data_time,
            'running': self.running,
            'data_rate': self.packets_received / max(1, time.time() - (self.last_data_time or time.time())) if self.last_data_time else 0
        }

def start_dart_adapter(dart_port: int = 12346, gerf_port: int = 12344):
    """Start the DART visual tracking data adapter."""
    adapter = DartDataAdapter(dart_port, gerf_port)
    
    try:
        adapter.start()
        
        logger.info("DART visual tracking adapter running. Press Ctrl+C to stop...")
        logger.info(f"Listening for DART visual tracking JSON broadcasts on port {dart_port}")
        logger.info(f"Forwarding to GERF bridge on port {gerf_port}")
        logger.info("Expected data format: {'timestamp': t, 'point_3d': [x,y,z], 'frame_id': f}")
        
        # Keep running and show statistics
        while True:
            time.sleep(10)
            stats = adapter.get_statistics()
            if stats['packets_received'] > 0:
                logger.info(f"Stats - Received: {stats['packets_received']}, "
                           f"Sent: {stats['packets_sent']}, "
                           f"Rate: {stats['data_rate']:.1f} Hz")
            else:
                logger.info("Waiting for DART visual tracking broadcast data...")
                logger.info("Troubleshooting: Ensure DART visual_track.py is running and broadcasting JSON")
    
    except KeyboardInterrupt:
        logger.info("Shutdown signal received")
    except Exception as e:
        logger.error(f"Error in DART adapter: {e}")
    finally:
        adapter.stop()
        logger.info("DART visual tracking adapter stopped")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='DART Visual Tracking Data Adapter for GERF-App')
    parser.add_argument('--dart-port', type=int, default=12346,
                        help='Port to receive DART visual tracking broadcast data')
    parser.add_argument('--gerf-port', type=int, default=12344,
                        help='Port to forward data to GERF WebSocket bridge')
    
    args = parser.parse_args()
    
    start_dart_adapter(args.dart_port, args.gerf_port) 