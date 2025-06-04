#!/usr/bin/env python3
"""
Main test script for GERF-App
Starts both UDP test server and WebSocket bridge server for testing
"""

import subprocess
import sys
import time
import signal
import os

def start_servers():
    """Start both UDP test server and WebSocket bridge server."""
    processes = []
    
    try:
        print("🚀 Starting GERF-App Test Servers...")
        print("=" * 50)
        
        # Change to server directory
        server_dir = os.path.join(os.path.dirname(__file__), 'server')
        
        # Start UDP test server
        print("📡 Starting UDP Test Server...")
        udp_process = subprocess.Popen(
            [sys.executable, 'udp_test_server.py'],
            cwd=server_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        processes.append(('UDP Test Server', udp_process))
        
        # Give UDP server time to start
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
        
        print("=" * 50)
        print("✅ All servers started successfully!")
        print()
        print("📊 Server Status:")
        print("  • UDP Test Server: localhost:12345")
        print("  • WebSocket Bridge: localhost:8765")
        print("  • Frontend: Open client/index.html in browser")
        print()
        print("💡 The UDP test server generates coordinate data for testing.")
        print("   In production, this will be replaced by external UDP data.")
        print()
        print("🌐 The WebSocket bridge forwards UDP data to browser clients.")
        print()
        print("Press Ctrl+C to stop all servers...")
        print("=" * 50)
        
        # Monitor processes and output
        while True:
            for name, process in processes:
                if process.poll() is not None:
                    print(f"❌ {name} has stopped unexpectedly!")
                    return
                
                # Read and display output
                try:
                    line = process.stdout.readline()
                    if line:
                        print(f"[{name}] {line.strip()}")
                except:
                    pass
            
            time.sleep(0.1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutdown signal received...")
        
    except Exception as e:
        print(f"❌ Error starting servers: {e}")
        
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
        
        print("🏁 All servers stopped. Goodbye!")

if __name__ == "__main__":
    start_servers() 