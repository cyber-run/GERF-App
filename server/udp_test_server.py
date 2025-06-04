#!/usr/bin/env python3
"""
UDP Test Server for GERF-App
Simple coordinate generator that will be replaced by external UDP server in production.
"""

import socket
import threading
import json
import time
import logging
import math
import random
from datetime import datetime, timedelta
from config import *

# Client management
CLIENTS = {}
CLIENT_LOCK = threading.Lock()

# Trajectory state management
trajectory_state = {
    'type': TRAJECTORY_TYPE,
    'orbital_time': 0,
    'linear_start_time': None,
    'linear_progress': 0.0,
    'linear_in_delay': False,
    'linear_delay_start': None,
    'linear_current_target': None  # Current randomized target position
}

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize random seed if specified
if LINEAR_RANDOM_SEED is not None:
    random.seed(LINEAR_RANDOM_SEED)
    logger.info(f"Random seed set to: {LINEAR_RANDOM_SEED}")

def generate_orbital_coordinates():
    """Generates smooth orbital trajectory coordinates around the origin."""
    trajectory_state['orbital_time'] += ORBITAL_SPEED
    
    # Create smooth orbital motion without randomness
    radius = BASE_RADIUS + math.sin(trajectory_state['orbital_time'] * 0.7) * RADIUS_VARIATION
    
    # Main orbital motion (azimuth)
    azimuth = trajectory_state['orbital_time']
    
    # Vertical oscillation (elevation)
    elevation = math.sin(trajectory_state['orbital_time'] * ELEVATION_SPEED) * 0.6
    
    # Convert spherical coordinates to cartesian
    x = radius * math.cos(elevation) * math.cos(azimuth)
    z = radius * math.cos(elevation) * math.sin(azimuth)
    y = radius * math.sin(elevation)
    
    return x, y, z

def generate_linear_coordinates():
    """Generates linear trajectory coordinates towards the dartboard with delays."""
    current_time = time.time()
    
    # Handle delay between trajectories
    if trajectory_state['linear_in_delay']:
        if trajectory_state['linear_delay_start'] is None:
            trajectory_state['linear_delay_start'] = current_time
        
        elapsed_delay = current_time - trajectory_state['linear_delay_start']
        if elapsed_delay >= LINEAR_LOOP_DELAY:
            # End delay, start new trajectory
            trajectory_state['linear_in_delay'] = False
            trajectory_state['linear_delay_start'] = None
            trajectory_state['linear_start_time'] = None
            trajectory_state['linear_progress'] = 0.0
            trajectory_state['linear_current_target'] = None  # Reset target for new trajectory
        else:
            # Still in delay - return None to indicate no coordinates
            return None
    
    # Initialize start time and target if not set (new trajectory)
    if trajectory_state['linear_start_time'] is None:
        trajectory_state['linear_start_time'] = current_time
        trajectory_state['linear_progress'] = 0.0
        # Generate new random target for this trajectory
        trajectory_state['linear_current_target'] = generate_random_target()
    
    # Calculate elapsed time and progress
    elapsed_time = current_time - trajectory_state['linear_start_time']
    raw_progress = elapsed_time / LINEAR_DURATION
    
    # Handle trajectory completion
    if raw_progress >= 1.0:
        if LINEAR_LOOP:
            # Start delay period
            trajectory_state['linear_in_delay'] = True
            trajectory_state['linear_delay_start'] = current_time
            return None  # No coordinates during delay
        else:
            # Clamp to end position
            raw_progress = 1.0
    
    # Apply speed profile
    if LINEAR_SPEED_PROFILE == 'accelerating':
        # Quadratic acceleration (ease-in)
        progress = raw_progress * raw_progress
    elif LINEAR_SPEED_PROFILE == 'decelerating':
        # Quadratic deceleration (ease-out)
        progress = 1.0 - (1.0 - raw_progress) * (1.0 - raw_progress)
    else:  # linear
        progress = raw_progress
    
    trajectory_state['linear_progress'] = progress
    
    # Interpolate between start and current target positions
    start_x, start_y, start_z = LINEAR_START_POSITION
    target_x, target_y, target_z = trajectory_state['linear_current_target']
    
    x = start_x + (target_x - start_x) * progress
    y = start_y + (target_y - start_y) * progress
    z = start_z + (target_z - start_z) * progress
    
    # Optional: Add slight curve or wobble for realism
    # Add a small sine wave perpendicular to the flight path for natural movement
    curve_amplitude = 5.0  # Adjust for more/less curve
    curve_frequency = 2.0  # Adjust for more/less oscillations
    
    # Calculate perpendicular offset (in Y direction for this trajectory)
    y_offset = math.sin(progress * math.pi * curve_frequency) * curve_amplitude * (1.0 - progress)
    y += y_offset
    
    return x, y, z

def generate_3d_coordinates():
    """Generates coordinates based on the current trajectory type."""
    coordinates = None
    
    if trajectory_state['type'] == 'linear':
        result = generate_linear_coordinates()
        if result is not None:  # Only proceed if not in delay
            x, y, z = result
            coordinates = (x, y, z)
    else:  # default to orbital
        x, y, z = generate_orbital_coordinates()
        coordinates = (x, y, z)
    
    if coordinates is None:
        return None  # No coordinates to send (e.g., during linear delay)
    
    x, y, z = coordinates
    
    # Ensure coordinates stay within reasonable bounds
    x = max(min(x, COORDINATE_RANGE_X[1]), COORDINATE_RANGE_X[0])
    y = max(min(y, COORDINATE_RANGE_Y[1]), COORDINATE_RANGE_Y[0])
    z = max(min(z, COORDINATE_RANGE_Z[1]), COORDINATE_RANGE_Z[0])
    
    return {
        'x': round(x, 2),
        'y': round(y, 2),
        'z': round(z, 2),
        'timestamp': time.time(),
        'trajectory_type': trajectory_state['type'],
        'progress': trajectory_state.get('linear_progress', 0.0) if trajectory_state['type'] == 'linear' else None
    }

def switch_trajectory(new_type):
    """Switch between trajectory types."""
    if new_type in ['orbital', 'linear']:
        logger.info(f"Switching trajectory from {trajectory_state['type']} to {new_type}")
        trajectory_state['type'] = new_type
        
        # Reset trajectory-specific state
        if new_type == 'linear':
            trajectory_state['linear_start_time'] = None
            trajectory_state['linear_progress'] = 0.0
            trajectory_state['linear_in_delay'] = False
            trajectory_state['linear_delay_start'] = None
            trajectory_state['linear_current_target'] = None  # Reset random target
        elif new_type == 'orbital':
            # Keep orbital time continuous for smooth transition
            pass
        
        return True
    return False

def cleanup_inactive_clients():
    """Remove clients that haven't been active within the timeout period."""
    current_time = datetime.now()
    with CLIENT_LOCK:
        inactive_clients = []
        for addr, client_info in CLIENTS.items():
            if current_time - client_info['last_seen'] > timedelta(seconds=CLIENT_TIMEOUT):
                client_info['active'] = False
                inactive_clients.append(addr)
        
        for addr in inactive_clients:
            logger.info(f"Cleaning up inactive client: {addr}")
            del CLIENTS[addr]

def client_handler(sock, client_address):
    """Handles sending data to a single client."""
    logger.info(f"Starting data stream to {client_address}")
    
    try:
        while True:
            # Check if client is still active
            with CLIENT_LOCK:
                if client_address not in CLIENTS or not CLIENTS[client_address]['active']:
                    break
            
            try:
                coordinates = generate_3d_coordinates()
                
                # Only send message if we have coordinates (skip during delays)
                if coordinates is not None:
                    message = json.dumps(coordinates).encode('utf-8')
                    sock.sendto(message, client_address)
                
                # Update last seen time
                with CLIENT_LOCK:
                    if client_address in CLIENTS:
                        CLIENTS[client_address]['last_seen'] = datetime.now()
                
                time.sleep(STREAM_FREQUENCY)
                
            except (ConnectionResetError, OSError) as e:
                logger.warning(f"Network error sending to {client_address}: {e}")
                break
            except Exception as e:
                logger.error(f"Unexpected error sending to {client_address}: {e}")
                break
                
    except Exception as e:
        logger.error(f"Fatal error in client handler for {client_address}: {e}")
    finally:
        # Mark client as inactive
        with CLIENT_LOCK:
            if client_address in CLIENTS:
                CLIENTS[client_address]['active'] = False
        logger.info(f"Client handler stopped for {client_address}")

def start_server():
    """Starts the UDP test server."""
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind((UDP_HOST, UDP_PORT))
        logger.info(f"UDP Test Server started on {UDP_HOST}:{UDP_PORT}")
        logger.info("This server generates test coordinate data and will be replaced by external UDP in production")
        
        while True:
            try:
                # Periodic cleanup of inactive clients
                cleanup_inactive_clients()
                
                # Set socket timeout to allow periodic cleanup
                sock.settimeout(5.0)
                
                try:
                    message, client_address = sock.recvfrom(BUFFER_SIZE)
                    message_str = message.decode(errors='ignore')
                    logger.info(f"Message from {client_address}: {message_str[:50]}")
                    
                    # Simple client connection handling
                    with CLIENT_LOCK:
                        # Check if client exists and is active
                        if client_address not in CLIENTS:
                            # New client
                            logger.info(f"New client connected: {client_address}")
                            CLIENTS[client_address] = {
                                'active': True,
                                'thread': None,
                                'last_seen': datetime.now()
                            }
                        
                        client_info = CLIENTS[client_address]
                        
                        # Check if we need to start a new thread
                        if client_info['thread'] is None or not client_info['thread'].is_alive():
                            if client_info['thread'] is not None:
                                logger.info(f"Previous thread for {client_address} has ended, starting new one")
                            
                            client_info['active'] = True
                            client_info['last_seen'] = datetime.now()
                            
                            thread = threading.Thread(
                                target=client_handler,
                                args=(sock, client_address),
                                daemon=True,
                                name=f"Client-{client_address[0]}:{client_address[1]}"
                            )
                            client_info['thread'] = thread
                            thread.start()
                        else:
                            # Client is already being served, just update last seen
                            client_info['active'] = True
                            client_info['last_seen'] = datetime.now()
                            logger.debug(f"Client {client_address} reconnected, updating status")
                
                except socket.timeout:
                    # Normal timeout for periodic cleanup, continue
                    continue
                    
            except KeyboardInterrupt:
                logger.info("Shutdown signal received")
                break
            except Exception as e:
                logger.error(f"Error in main server loop: {e}")
                time.sleep(1)  # Brief pause before retrying
                
    except OSError as e:
        logger.critical(f"Server socket error: {e}")
    except Exception as e:
        logger.critical(f"Fatal server error: {e}")
    finally:
        logger.info("UDP Test Server shutting down...")
        
        # Stop all client threads
        with CLIENT_LOCK:
            for addr, client_info in CLIENTS.items():
                client_info['active'] = False
                if client_info['thread'] and client_info['thread'].is_alive():
                    logger.info(f"Waiting for thread {addr} to stop...")
                    client_info['thread'].join(timeout=2)
        
        if sock:
            sock.close()
        logger.info("UDP Test Server shutdown complete")

def generate_random_target():
    """Generate a randomized target position around the dartboard."""
    if not LINEAR_TARGET_RANDOMNESS:
        return LINEAR_TARGET_POSITION
    
    base_x, base_y, base_z = LINEAR_TARGET_POSITION
    
    # Generate random position within a circle around the dartboard
    if LINEAR_RANDOM_DISTRIBUTION == 'gaussian':
        # Gaussian distribution (more hits near center, fewer at edges)
        angle = random.uniform(0, 2 * math.pi)
        # Use gaussian with sigma as fraction of max radius
        radius = abs(random.gauss(0, LINEAR_RANDOM_RADIUS * LINEAR_RANDOM_GAUSSIAN_SIGMA))
        # Clamp to maximum radius
        radius = min(radius, LINEAR_RANDOM_RADIUS)
    else:
        # Uniform distribution (even spread)
        angle = random.uniform(0, 2 * math.pi)
        radius = random.uniform(0, LINEAR_RANDOM_RADIUS)
    
    # Apply minimum distance constraint
    if radius < LINEAR_RANDOM_MIN_DISTANCE:
        radius = LINEAR_RANDOM_MIN_DISTANCE
    
    # Apply directional bias if specified
    if LINEAR_RANDOM_BIAS_ANGLE is not None:
        # Blend the random angle with the bias angle
        bias_weight = LINEAR_RANDOM_BIAS_STRENGTH
        angle = (1 - bias_weight) * angle + bias_weight * LINEAR_RANDOM_BIAS_ANGLE
    
    # Calculate random offset in X-Z plane (horizontal plane)
    x_offset = radius * math.cos(angle)
    z_offset = radius * math.sin(angle)
    
    # Add random height variation
    y_offset = random.uniform(-LINEAR_RANDOM_HEIGHT_VARIATION, LINEAR_RANDOM_HEIGHT_VARIATION)
    
    random_target = (
        base_x + x_offset,
        base_y + y_offset,
        base_z + z_offset
    )
    
    # Log with more detail
    distribution_info = f"{LINEAR_RANDOM_DISTRIBUTION}"
    if LINEAR_RANDOM_DISTRIBUTION == 'gaussian':
        distribution_info += f" (σ={LINEAR_RANDOM_GAUSSIAN_SIGMA})"
    
    bias_info = ""
    if LINEAR_RANDOM_BIAS_ANGLE is not None:
        bias_degrees = math.degrees(LINEAR_RANDOM_BIAS_ANGLE)
        bias_info = f", bias: {bias_degrees:.1f}° (strength: {LINEAR_RANDOM_BIAS_STRENGTH})"
    
    logger.info(f"Random target: {random_target} | "
                f"offset: ({x_offset:.1f}, {y_offset:.1f}, {z_offset:.1f}) | "
                f"distance: {radius:.1f} | "
                f"distribution: {distribution_info}{bias_info}")
    
    return random_target

if __name__ == "__main__":
    start_server() 