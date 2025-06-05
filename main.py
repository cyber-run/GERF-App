#!/usr/bin/env python3
"""
Main production script for GERF-App
Connects WebSocket bridge to actual UDP server (replaces simulated test server)
Supports direct UDP connection or DART tracking system integration via adapter
"""

import subprocess
import sys
import time
import signal
import os
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Production Configuration - Edit these values for your setup
PRODUCTION_UDP_HOST = '192.168.137.1'  # Windows DART server IP address
PRODUCTION_UDP_PORT = 12346        # Port for adapter to receive DART data (confirm this matches your DART server)
WEBSOCKET_PORT = 8765              # WebSocket bridge port
USE_DART_ADAPTER = True            # Set to True to use DART tracking system adapter

def update_config_for_production(udp_host: str, udp_port: int):
    """
    Update the server configuration to point to the production UDP server.
    This modifies the config.py file to use the actual UDP server instead of test server.
    """
    config_path = os.path.join(os.path.dirname(__file__), 'server', 'config.py')
    
    try:
        # Read current config
        with open(config_path, 'r') as f:
            config_content = f.read()
        
        # Update UDP configuration
        lines = config_content.split('\n')
        updated_lines = []
        
        for line in lines:
            if line.startswith('UDP_HOST = '):
                updated_lines.append(f"UDP_HOST = '{udp_host}'")
            elif line.startswith('UDP_PORT = '):
                updated_lines.append(f"UDP_PORT = {udp_port}")
            else:
                updated_lines.append(line)
        
        # Write updated config
        with open(config_path, 'w') as f:
            f.write('\n'.join(updated_lines))
        
        logger.info(f"Updated config to use UDP server at {udp_host}:{udp_port}")
        
    except Exception as e:
        logger.error(f"Error updating config: {e}")
        raise

def start_production_servers():
    """
    Start production servers for GERF-App using default configuration.
    """
    processes = []
    
    try:
        print("🚀 Starting GERF-App Production Server...")
        print("=" * 70)
        
        if USE_DART_ADAPTER:
            print("🎯 Using DART Tracking System Integration")
            print(f"📡 DART system on: {PRODUCTION_UDP_HOST}:{PRODUCTION_UDP_PORT}")
            print("🔄 Adapter will convert DART data to GERF format")
        else:
            print("📡 Direct UDP Connection Mode") 
            print(f"🎯 UDP server: {PRODUCTION_UDP_HOST}:{PRODUCTION_UDP_PORT}")
        
        print("=" * 70)
        
        # Change to server directory
        server_dir = os.path.join(os.path.dirname(__file__), 'server')
        
        # Configure ports based on setup
        if USE_DART_ADAPTER:
            dart_input_port = PRODUCTION_UDP_PORT
            bridge_port = 12344  # Port where adapter forwards data to WebSocket bridge
            
            # Start DART adapter first
            print("🔄 Starting DART Data Adapter...")
            adapter_process = subprocess.Popen(
                [sys.executable, 'udp_dart_adapter.py', 
                 '--dart-port', str(dart_input_port),
                 '--gerf-port', str(bridge_port)],
                cwd=server_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1
            )
            processes.append(('DART Adapter', adapter_process))
            
            # Update config to use adapter output
            update_config_for_production('localhost', bridge_port)
            time.sleep(2)  # Give adapter time to start
        else:
            # Direct connection - update config to point to UDP source
            update_config_for_production(PRODUCTION_UDP_HOST, PRODUCTION_UDP_PORT)
        
        # Start WebSocket bridge server
        print("🌐 Starting WebSocket Bridge Server...")
        ws_process = subprocess.Popen(
            [sys.executable, 'websocket_bridge.py'],
            cwd=server_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        processes.append(('WebSocket Bridge Server', ws_process))
        
        # Give WebSocket server time to start
        time.sleep(2)
        
        print("=" * 70)
        print("✅ Production server started successfully!")
        print()
        print("📊 Server Status:")
        
        if USE_DART_ADAPTER:
            print(f"  • DART Input: {PRODUCTION_UDP_HOST}:{PRODUCTION_UDP_PORT}")
            print(f"  • Data Adapter: localhost:{bridge_port}")
        else:
            print(f"  • UDP Source: {PRODUCTION_UDP_HOST}:{PRODUCTION_UDP_PORT}")
        
        print(f"  • WebSocket Bridge: localhost:{WEBSOCKET_PORT}")
        print("  • Frontend: Open client/index.html in browser")
        print()
        
        if USE_DART_ADAPTER:
            print("🔥 DART Integration Mode:")
            print("  • Adapter converts DART tracking data to GERF format")
            print("  • Supports position coordinates, angles, and metadata")
            print("  • Real-time data transformation and forwarding")
        else:
            print("🔥 Direct UDP Mode:")
            print("  • WebSocket bridge forwards UDP data directly to browser")
            print("  • Expects data in GERF-compatible JSON format")
        
        print()
        print("📈 Data Flow:")
        if USE_DART_ADAPTER:
            print("  DART System → Adapter → WebSocket Bridge → Browser")
        else:
            print("  UDP Source → WebSocket Bridge → Browser")
        
        print()
        print("💡 Configuration:")
        print(f"  • To change UDP server, edit PRODUCTION_UDP_HOST/PORT in main.py")
        print(f"  • To disable DART adapter, set USE_DART_ADAPTER = False")
        print()
        print("Press Ctrl+C to stop all servers...")
        print("=" * 70)
        
        # Monitor processes and output
        while True:
            all_running = True
            for name, process in processes:
                if process.poll() is not None:
                    print(f"❌ {name} has stopped unexpectedly!")
                    all_running = False
                    break
                
                # Read and display output
                try:
                    line = process.stdout.readline()
                    if line:
                        print(f"[{name}] {line.strip()}")
                except:
                    pass
            
            if not all_running:
                break
                    
            time.sleep(0.1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutdown signal received...")
        
    except Exception as e:
        print(f"❌ Error starting production server: {e}")
        logger.error(f"Production server error: {e}")
        
    finally:
        # Clean shutdown
        print("🧹 Stopping all servers...")
        for name, process in processes:
            try:
                print(f"  Stopping {name}...")
                process.terminate()
                process.wait(timeout=5)
                print(f"  ✅ {name} stopped")
            except subprocess.TimeoutExpired:
                print(f"  🔨 Force killing {name}...")
                process.kill()
                process.wait()
                print(f"  ✅ {name} force stopped")
            except Exception as e:
                print(f"  ⚠️  Error stopping {name}: {e}")
        
        print("🏁 Production server stopped. Goodbye!")

if __name__ == "__main__":
    print("🎯 GERF-App Production Mode")
    print(f"🌐 Target: {PRODUCTION_UDP_HOST}:{PRODUCTION_UDP_PORT}")
    print(f"🔄 DART Adapter: {'Enabled' if USE_DART_ADAPTER else 'Disabled'}")
    print()
    
    # Start production servers with default configuration
    start_production_servers() 