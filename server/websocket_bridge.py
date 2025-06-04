#!/usr/bin/env python3
"""
WebSocket Bridge Server for GERF-App
Forwards UDP coordinate data to WebSocket clients.
This server persists in production deployment.
"""

import asyncio
import websockets
import socket
import json
import logging
import threading
from datetime import datetime
from config import *

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class UDPForwarder:
    """Forwards UDP data to WebSocket clients."""
    
    def __init__(self):
        self.websocket_clients = set()
        self.udp_socket = None
        self.running = False
        self.udp_thread = None
        self.loop = None
        
    def add_client(self, websocket):
        """Add a WebSocket client."""
        self.websocket_clients.add(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.websocket_clients)}")
        
    def remove_client(self, websocket):
        """Remove a WebSocket client."""
        self.websocket_clients.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(self.websocket_clients)}")
        
    async def broadcast_to_clients(self, message):
        """Broadcast message to all connected WebSocket clients."""
        if not self.websocket_clients:
            return
            
        # Create list of clients to avoid modification during iteration
        clients_to_remove = []
        
        for client in list(self.websocket_clients):
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                clients_to_remove.append(client)
            except Exception as e:
                logger.warning(f"Error sending to WebSocket client: {e}")
                clients_to_remove.append(client)
        
        # Remove disconnected clients
        for client in clients_to_remove:
            self.remove_client(client)
    
    def start_udp_listener(self):
        """Start listening for UDP data in a separate thread."""
        packet_count = 0
        try:
            self.udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.udp_socket.settimeout(1.0)  # Allow periodic checks
            
            # Bind to the port to receive data from DART adapter
            self.udp_socket.bind((UDP_HOST, UDP_PORT))
            logger.info(f"UDP listener bound to {UDP_HOST}:{UDP_PORT}")
            logger.info("Waiting for data from DART adapter...")
            
            self.running = True
            
            while self.running:
                try:
                    data, addr = self.udp_socket.recvfrom(BUFFER_SIZE)
                    message = data.decode('utf-8')
                    packet_count += 1
                    
                    # Occasional logging for monitoring
                    if packet_count <= 3 or packet_count % 1000 == 0:
                        try:
                            json_data = json.loads(message)
                            logger.info(f"Received packet #{packet_count}: x={json_data.get('x')}, y={json_data.get('y')}, z={json_data.get('z')}")
                        except:
                            logger.debug(f"Received UDP data from {addr}: {message[:100]}...")
                    
                    # Forward message to all WebSocket clients
                    if self.websocket_clients and self.loop:
                        try:
                            asyncio.run_coroutine_threadsafe(
                                self.broadcast_to_clients(message),
                                self.loop
                            )
                            # Log broadcast activity occasionally
                            if packet_count <= 3 or packet_count % 1000 == 0:
                                logger.info(f"Broadcasted to {len(self.websocket_clients)} WebSocket clients")
                        except Exception as e:
                            logger.error(f"Error scheduling broadcast: {e}")
                    else:
                        # Log when no clients are connected (only first few times)
                        if packet_count <= 3:
                            logger.warning(f"No WebSocket clients connected - packet not forwarded")
                        
                except socket.timeout:
                    # Normal timeout, continue
                    continue
                except Exception as e:
                    if self.running:  # Only log if we're supposed to be running
                        logger.error(f"Error receiving UDP data: {e}")
                        
        except Exception as e:
            logger.error(f"Error in UDP listener: {e}")
        finally:
            if self.udp_socket:
                self.udp_socket.close()
            logger.info("UDP listener stopped")
    
    def start(self, loop):
        """Start the UDP forwarder."""
        if not self.running:
            self.loop = loop
            self.udp_thread = threading.Thread(target=self.start_udp_listener, daemon=True)
            self.udp_thread.start()
            logger.info("UDP forwarder started")
    
    def stop(self):
        """Stop the UDP forwarder."""
        self.running = False
        if self.udp_thread and self.udp_thread.is_alive():
            self.udp_thread.join(timeout=2)
        logger.info("UDP forwarder stopped")

# Global UDP forwarder instance
udp_forwarder = UDPForwarder()

async def websocket_handler(websocket):
    """Handle WebSocket connections."""
    client_address = websocket.remote_address
    logger.info(f"WebSocket client connected from {client_address}")
    
    # Add client to forwarder
    udp_forwarder.add_client(websocket)
    
    try:
        # Keep connection alive and handle any incoming messages
        async for message in websocket:
            try:
                # Parse incoming message
                data = json.loads(message)
                logger.debug(f"Received message from {client_address}: {data}")
                
                # For now, just acknowledge receipt
                # In the future, this could handle commands if needed
                response = {
                    'type': 'acknowledgment',
                    'message': 'Message received',
                    'timestamp': datetime.now().isoformat()
                }
                await websocket.send(json.dumps(response))
                
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON from {client_address}: {message}")
            except Exception as e:
                logger.error(f"Error processing message from {client_address}: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"WebSocket connection closed for {client_address}")
    except Exception as e:
        logger.error(f"Error in WebSocket handler for {client_address}: {e}")
    finally:
        # Remove client from forwarder
        udp_forwarder.remove_client(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(udp_forwarder.websocket_clients)}")

async def start_websocket_server():
    """Start the WebSocket server."""
    logger.info(f"Starting WebSocket Bridge Server on {WEBSOCKET_HOST}:{WEBSOCKET_PORT}")
    logger.info("This server forwards UDP data to WebSocket clients and persists in production")
    
    # Get current event loop and start UDP forwarder
    loop = asyncio.get_event_loop()
    udp_forwarder.start(loop)
    
    try:
        async with websockets.serve(
            websocket_handler,
            WEBSOCKET_HOST,
            WEBSOCKET_PORT,
            ping_interval=20,
            ping_timeout=10
        ):
            logger.info("WebSocket Bridge Server is running...")
            await asyncio.Future()  # Run forever
            
    except KeyboardInterrupt:
        logger.info("Shutdown signal received")
    except Exception as e:
        logger.error(f"WebSocket server error: {e}")
    finally:
        logger.info("WebSocket Bridge Server shutting down...")
        udp_forwarder.stop()

if __name__ == "__main__":
    try:
        asyncio.run(start_websocket_server())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}") 