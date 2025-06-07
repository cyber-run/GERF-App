#!/usr/bin/env python3
"""
Optimized WebSocket Bridge Server for GERF-App
Uses "latest data wins" approach - always forwards most recent data, discards old packets.
Eliminates coroutine explosion and performance degradation issues.
"""

import asyncio
import websockets
import socket
import json
import logging
import threading
import time
from datetime import datetime
from config import *

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class OptimizedUDPForwarder:
    """Optimized UDP to WebSocket forwarder using latest-data-wins approach."""
    
    def __init__(self):
        self.websocket_clients = set()
        self.udp_socket = None
        self.running = False
        self.udp_thread = None
        
        # Latest data approach - thread-safe
        self._latest_message = None
        self._message_lock = threading.Lock()
        self._new_data_event = threading.Event()
        
        # Statistics
        self.packets_received = 0
        self.packets_sent = 0
        self.packets_dropped = 0
        
        # Data starvation detection
        self.last_udp_data_time = None
        self.data_starvation_timeout = 5.0  # seconds
        self.startup_grace_period = 15.0   # longer grace period for bridge
        
    def add_client(self, websocket):
        """Add a WebSocket client."""
        self.websocket_clients.add(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.websocket_clients)}")
        
    def remove_client(self, websocket):
        """Remove a WebSocket client."""
        self.websocket_clients.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(self.websocket_clients)}")
    
    def _update_latest_message(self, message: str):
        """Thread-safe update of the latest message. Always overwrites - latest wins."""
        with self._message_lock:
            if self._latest_message is not None:
                self.packets_dropped += 1  # Previous message was never sent
            self._latest_message = message
            self._new_data_event.set()  # Signal that new data is available
    
    def _get_latest_message(self) -> str:
        """Thread-safe retrieval of the latest message."""
        with self._message_lock:
            message = self._latest_message
            self._latest_message = None  # Clear after reading
            self._new_data_event.clear()  # Reset event
            return message
    
    async def continuous_broadcast_task(self):
        """Single async task that continuously broadcasts the latest data."""
        logger.info("Started continuous broadcast task")
        
        while self.running:
            try:
                # Wait for new data (with timeout to check if we should keep running)
                if await asyncio.get_event_loop().run_in_executor(
                    None, self._new_data_event.wait, 1.0
                ):
                    # Get the latest message
                    message = self._get_latest_message()
                    if message and self.websocket_clients:
                        await self._broadcast_to_clients(message)
                        self.packets_sent += 1
                        
                        # Occasional statistics logging
                        if self.packets_sent % 1000 == 0:
                            logger.info(f"Broadcast stats - Sent: {self.packets_sent}, "
                                      f"Received: {self.packets_received}, "
                                      f"Dropped: {self.packets_dropped}")
                
            except Exception as e:
                logger.error(f"Error in broadcast task: {e}")
                await asyncio.sleep(0.1)  # Brief pause on error
        
        logger.info("Continuous broadcast task stopped")
    
    async def _broadcast_to_clients(self, message: str):
        """Broadcast message to all connected WebSocket clients."""
        if not self.websocket_clients:
            return
            
        # Remove disconnected clients
        clients_to_remove = []
        
        for client in list(self.websocket_clients):
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                clients_to_remove.append(client)
            except Exception as e:
                logger.warning(f"Error sending to WebSocket client: {e}")
                clients_to_remove.append(client)
        
        # Clean up disconnected clients
        for client in clients_to_remove:
            self.remove_client(client)
    
    def start_udp_listener(self):
        """Start listening for UDP data in a separate thread - simplified for latest-data-wins."""
        try:
            self.udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.udp_socket.settimeout(1.0)  # Allow periodic checks
            
            # Bind to receive data from DART adapter
            self.udp_socket.bind((UDP_HOST, UDP_PORT))
            logger.info(f"UDP listener bound to {UDP_HOST}:{UDP_PORT} (latest-data-wins mode)")
            logger.info(f"⚠️ Bridge data starvation detection: Will restart if no UDP data for {self.data_starvation_timeout}s")
            
            self.running = True
            self.start_time = time.time()  # Track startup time
            
            while self.running:
                try:
                    data, addr = self.udp_socket.recvfrom(BUFFER_SIZE)
                    message = data.decode('utf-8')
                    self.packets_received += 1
                    self.last_udp_data_time = time.time()  # Track when we last received data
                    
                    # Simply update the latest message - no processing, no queuing
                    self._update_latest_message(message)
                    
                    # Minimal logging for monitoring
                    if self.packets_received <= 3 or self.packets_received % 2000 == 0:
                        try:
                            json_data = json.loads(message)
                            logger.info(f"Latest data: x={json_data.get('x')}, y={json_data.get('y')}, z={json_data.get('z')} "
                                      f"(packet #{self.packets_received})")
                        except:
                            logger.debug(f"Received UDP data from {addr}")
                        
                except socket.timeout:
                    # Normal timeout, but check for data starvation from adapter
                    current_time = time.time()
                    time_since_startup = current_time - self.start_time
                    
                    # Only check after grace period
                    if time_since_startup > self.startup_grace_period:
                        if self.last_udp_data_time is None:
                            # No data from adapter after grace period
                            logger.error(f"🚨 BRIDGE DATA STARVATION: No UDP data from adapter for {time_since_startup:.1f}s")
                            logger.error("Forcing bridge restart to recover...")
                            raise RuntimeError("Bridge data starvation - no data from adapter")
                        else:
                            # Check time since last adapter data
                            time_since_data = current_time - self.last_udp_data_time
                            if time_since_data > self.data_starvation_timeout:
                                logger.error(f"🚨 BRIDGE DATA STARVATION: No UDP data for {time_since_data:.1f}s")
                                logger.error(f"Last received: {self.packets_received} packets total")
                                logger.error("Forcing bridge restart to recover...")
                                raise RuntimeError(f"Bridge data starvation - no UDP data for {time_since_data:.1f}s")
                    
                    # During grace period, just continue
                    continue
                except Exception as e:
                    if self.running:
                        logger.error(f"Error receiving UDP data: {e}")
                        
        except Exception as e:
            logger.error(f"Error in UDP listener: {e}")
        finally:
            if self.udp_socket:
                self.udp_socket.close()
            logger.info("UDP listener stopped")
    
    def start(self, loop):
        """Start the optimized UDP forwarder."""
        if not self.running:
            # Start UDP listener thread
            self.udp_thread = threading.Thread(target=self.start_udp_listener, daemon=True)
            self.udp_thread.start()
            
            # Start continuous broadcast task
            asyncio.create_task(self.continuous_broadcast_task())
            
            logger.info("Optimized UDP forwarder started (latest-data-wins)")
    
    def stop(self):
        """Stop the UDP forwarder."""
        self.running = False
        self._new_data_event.set()  # Wake up broadcast task
        
        if self.udp_thread and self.udp_thread.is_alive():
            self.udp_thread.join(timeout=2)
        
        logger.info(f"Optimized UDP forwarder stopped. Final stats - "
                   f"Received: {self.packets_received}, Sent: {self.packets_sent}, "
                   f"Dropped: {self.packets_dropped}")

# Global optimized forwarder instance
udp_forwarder = OptimizedUDPForwarder()

async def websocket_handler(websocket):
    """Handle WebSocket connections - simplified."""
    client_address = websocket.remote_address
    logger.info(f"WebSocket client connected from {client_address}")
    
    # Add client to forwarder
    udp_forwarder.add_client(websocket)
    
    try:
        # Keep connection alive - minimal message handling
        async for message in websocket:
            try:
                # Simple acknowledgment without processing overhead
                logger.debug(f"Received message from {client_address}")
            except Exception as e:
                logger.error(f"Error processing message from {client_address}: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"WebSocket connection closed for {client_address}")
    except Exception as e:
        logger.error(f"Error in WebSocket handler for {client_address}: {e}")
    finally:
        # Remove client from forwarder
        udp_forwarder.remove_client(websocket)

async def start_websocket_server():
    """Start the optimized WebSocket server."""
    logger.info(f"Starting Optimized WebSocket Bridge Server on {WEBSOCKET_HOST}:{WEBSOCKET_PORT}")
    logger.info("Using latest-data-wins approach - always forwards most recent data")
    
    # Get current event loop and start forwarder
    loop = asyncio.get_event_loop()
    udp_forwarder.start(loop)
    
    try:
        async with websockets.serve(
            websocket_handler,
            WEBSOCKET_HOST,
            WEBSOCKET_PORT,
            ping_interval=30,  # More relaxed ping for stability
            ping_timeout=15    # More forgiving timeout
        ):
            logger.info("Optimized WebSocket Bridge Server is running...")
            await asyncio.Future()  # Run forever
            
    except KeyboardInterrupt:
        logger.info("Shutdown signal received")
    except Exception as e:
        logger.error(f"WebSocket server error: {e}")
    finally:
        logger.info("Optimized WebSocket Bridge Server shutting down...")
        udp_forwarder.stop()

if __name__ == "__main__":
    try:
        asyncio.run(start_websocket_server())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}") 