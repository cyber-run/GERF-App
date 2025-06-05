#!/usr/bin/env python3
"""
Main test script for GERF-App
Uses the same architecture as production but with a test UDP server instead of real DART system.
Test flow: UDP Test Server → DART Adapter → WebSocket Bridge → Browser
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

def update_config_for_test():
    """Update config to use test server configuration."""
    config_path = os.path.join(os.path.dirname(__file__), 'server', 'config.py')
    
    try:
        # Read current config
        with open(config_path, 'r') as f:
            config_content = f.read()
        
        # Update UDP configuration for test
        lines = config_content.split('\n')
        updated_lines = []
        
        for line in lines:
            if line.startswith('UDP_HOST = '):
                updated_lines.append("UDP_HOST = 'localhost'")
            elif line.startswith('UDP_PORT = '):
                updated_lines.append("UDP_PORT = 12344")  # WebSocket bridge receives from adapter
            else:
                updated_lines.append(line)
        
        # Write updated config
        with open(config_path, 'w') as f:
            f.write('\n'.join(updated_lines))
        
        logger.info("Updated config for test mode")
        
    except Exception as e:
        logger.error(f"Error updating config: {e}")
        raise

def start_servers():
    """Start test servers using production architecture."""
    processes = []
    
    try:
        print("🚀 Starting GERF-App Test Servers...")
        print("=" * 70)
        print("🧪 Test Mode - Using Production Architecture")
        print("📈 Data Flow: UDP Test Server → DART Adapter → WebSocket Bridge → Browser")
        print("=" * 70)
        
        # Change to server directory
        server_dir = os.path.join(os.path.dirname(__file__), 'server')
        
        # Update config for test mode
        update_config_for_test()
        
        # Start UDP test server (broadcasts on port 12346 like DART)
        print("📡 Starting UDP Test Server...")
        udp_process = subprocess.Popen(
            [sys.executable, 'udp_test_server.py', '--dart-mode'],
            cwd=server_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        processes.append(('UDP Test Server', udp_process))
        
        # Give UDP server time to start
        time.sleep(2)
        
        # Start DART adapter (receives from test server, forwards to bridge)
        print("🔄 Starting DART Data Adapter...")
        adapter_process = subprocess.Popen(
            [sys.executable, 'udp_dart_adapter.py', 
             '--dart-port', '12346',
             '--gerf-port', '12344'],
            cwd=server_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        processes.append(('DART Adapter', adapter_process))
        
        # Give adapter time to start
        time.sleep(2)
        
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
        print("✅ All test servers started successfully!")
        print()
        print("📊 Server Status:")
        print("  • UDP Test Server: localhost:12346 (broadcasting test data)")
        print("  • DART Adapter: localhost:12346 → localhost:12344")
        print("  • WebSocket Bridge: localhost:8765")
        print("  • Frontend: Open client/index.html in browser")
        print()
        print("🧪 Test Architecture:")
        print("  • Uses same data flow as production")
        print("  • Test server mimics DART visual tracking broadcasts")
        print("  • DART adapter converts and forwards data")
        print("  • WebSocket bridge streams to browser")
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
        print(f"❌ Error starting test servers: {e}")
        logger.error(f"Test server error: {e}")
        
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
        
        print("🏁 All test servers stopped. Goodbye!")

if __name__ == "__main__":
    print("🧪 GERF-App Test Mode")
    print("🌐 Architecture: UDP Test Server → DART Adapter → WebSocket Bridge → Browser")
    print()
    
    start_servers() 