# GERF-App Production Setup

This document explains how to connect GERF-App to real UDP tracking systems, including DART tracking systems, replacing the simulated test server with actual data sources.

## 🚀 Quick Start - Production Mode

### Option 1: DART Tracking System (Recommended)
```bash
# Connect to DART system on localhost
python main.py --dart-mode

# Connect to remote DART system
python main.py --dart-mode --udp-host 192.168.1.100 --udp-port 12346
```

### Option 2: Direct UDP Connection
```bash
# Connect directly to UDP server
python main.py --direct-mode --udp-host 192.168.1.200 --udp-port 8080
```

## 🏗️ Architecture Comparison

### Test Mode (main_test.py)
```
UDP Test Server → WebSocket Bridge → Browser
     ↑               ↑
  Simulated      Production
   (replaced)     (persists)
```

### Production Mode (main.py)
```
Option 1 - DART Integration:
DART System → DART Adapter → WebSocket Bridge → Browser

Option 2 - Direct UDP:
UDP Source → WebSocket Bridge → Browser
```

## 📡 DART Tracking System Integration

The DART adapter (`server/udp_dart_adapter.py`) provides seamless integration with DART tracking systems like the one shown in your example script.

### DART Data Format Support

The adapter handles multiple DART data formats:

1. **JSON Format** (preferred):
```json
{
  "position": [x, y, z],
  "pan_angle": 45.2,
  "tilt_angle": -12.8,
  "encoder_pan_angle": 45.1,
  "encoder_tilt_angle": -12.9,
  "timestamp": 1634567890.123
}
```

2. **Point 3D Format**:
```json
{
  "point_3d": [1250.5, 800.2, -300.8],
  "timestamp": 1634567890.123
}
```

3. **String/Tuple Format**:
```
(1250.5, 800.2, -300.8, 45.2, -12.8, 1634567890.123)
```

### DART Integration Features

- **Automatic Format Detection**: Handles JSON, string, and binary data formats
- **Coordinate Transformation**: Converts mm coordinates to appropriate visualization scale
- **Real-time Statistics**: Monitors data flow rate and connection health
- **Error Recovery**: Graceful handling of malformed or missing data
- **Metadata Preservation**: Maintains pan/tilt angles and timing information

## 🔧 Configuration Options

### Command Line Arguments

```bash
python main.py [OPTIONS]

Connection Modes:
  --dart-mode       Use DART tracking system with adapter (default)
  --direct-mode     Direct UDP connection without adapter

Connection Settings:
  --udp-host HOST   UDP server hostname/IP (default: localhost)
  --udp-port PORT   UDP server port (default: 12346)
  --dart-port PORT  DART-specific port if different from --udp-port

Options:
  --skip-test       Skip UDP connection test
  --examples        Show usage examples and exit
```

### Environment Configuration

Edit the constants at the top of `main.py`:

```python
PRODUCTION_UDP_HOST = '192.168.1.100'  # Your UDP server IP
PRODUCTION_UDP_PORT = 12346             # Your UDP server port
WEBSOCKET_PORT = 8765                   # WebSocket port (usually unchanged)
USE_DART_ADAPTER = True                 # Enable DART integration by default
```

## 📈 Data Flow Details

### DART Mode Data Flow
1. **DART System** sends tracking data (position, angles, timestamps)
2. **DART Adapter** receives and parses the data
3. **Format Conversion** transforms to GERF-compatible JSON
4. **WebSocket Bridge** forwards to connected browser clients
5. **Frontend** renders real-time 3D visualization

### Direct Mode Data Flow
1. **UDP Source** sends GERF-compatible JSON data
2. **WebSocket Bridge** forwards directly to browser clients
3. **Frontend** renders real-time 3D visualization

## 🎯 DART System Integration Example

Based on your provided script, here's how to integrate:

### 1. Configure Your DART System
Ensure your DART tracking system is sending UDP data with coordinate information. The data queue from your script should be configured to send UDP packets:

```python
# In your DART system, modify the data output section
data = (
    estimated_position,      # [x, y, z] in mm
    pan_angle,              # degrees
    tilt_angle,             # degrees  
    round(encoder_pan_angle, 2),
    round(encoder_tilt_angle, 2),
    perf_counter_ns() * 1e-6  # timestamp
)

# Send via UDP instead of queue
udp_socket.sendto(json.dumps({
    'position': estimated_position.tolist(),
    'pan_angle': pan_angle,
    'tilt_angle': tilt_angle,
    'encoder_pan_angle': encoder_pan_angle,
    'encoder_tilt_angle': encoder_tilt_angle,
    'timestamp': perf_counter_ns() * 1e-6
}).encode(), ('localhost', 12346))
```

### 2. Start GERF-App Production Server
```bash
python main.py --dart-mode --udp-port 12346
```

### 3. Access the Visualization
Open `client/index.html` in your browser to see real-time tracking visualization.

## 🔍 Testing & Validation

### Connection Testing
The production script includes built-in connection testing:

```bash
# Test connection before starting
python main.py --dart-mode --udp-host 192.168.1.100

# Skip connection test
python main.py --dart-mode --skip-test
```

### DART Adapter Testing
Run the adapter standalone for debugging:

```bash
cd server
python udp_dart_adapter.py --dart-port 12346 --gerf-port 12345
```

### Monitor Data Flow
The system provides real-time statistics:

- **DART Adapter**: Shows packets received/sent and data rate
- **WebSocket Bridge**: Shows client connections and data forwarding
- **Browser Console**: Shows coordinate updates and connection status

## 🛠️ Production Deployment

### 1. Server Setup
```bash
# Install dependencies
pip install websockets

# Configure for your environment
# Edit main.py constants or use command line arguments

# Start production server
python main.py --dart-mode --udp-host YOUR_DART_IP --udp-port YOUR_DART_PORT
```

### 2. Frontend Deployment
Serve the client files via HTTP server:

```bash
# Simple Python server
cd client
python -m http.server 8000

# Or use nginx, apache, etc.
```

### 3. Network Configuration
- Ensure UDP port is accessible from DART system
- Configure firewall for WebSocket port (8765)
- Test network connectivity between components

## 📊 Performance Considerations

### Recommended Specifications
- **Network**: Low-latency connection between DART and GERF systems
- **Processing**: DART adapter adds minimal latency (~1ms)
- **Bandwidth**: ~1KB per coordinate update at typical rates (20-60 Hz)

### Optimization Tips
- Use DART mode for automatic data format handling
- Place adapter on same network as DART system
- Monitor WebSocket client count for scaling needs
- Use direct mode if data is already GERF-compatible

## 🐛 Troubleshooting

### Common Issues

**No Data Received**
- Check UDP port configuration
- Verify DART system is sending data
- Test with `--skip-test` to bypass connection check
- Monitor adapter statistics for received packets

**Format Errors**
- DART adapter handles multiple formats automatically
- Check server logs for parsing errors
- Verify DART data includes position coordinates

**WebSocket Connection Failed**
- Ensure WebSocket bridge is running (port 8765)
- Check browser console for connection errors
- Verify firewall settings

**Poor Performance**
- Monitor data rates (should be 20-60 Hz)
- Check network latency between components
- Consider direct mode for simple JSON data

### Debug Mode
Enable debug logging by editing the server scripts:

```python
logging.basicConfig(level=logging.DEBUG)
```

## 📝 Integration Checklist

- [ ] DART system configured to send UDP data
- [ ] Network connectivity verified
- [ ] GERF-App production server started
- [ ] Browser connects to visualization
- [ ] Real-time data flowing correctly
- [ ] Performance metrics acceptable
- [ ] Error handling tested

## 🔮 Advanced Configuration

### Custom Data Transformations
Modify `_convert_to_gerf_format()` in `udp_dart_adapter.py` to customize coordinate transformations:

```python
# Example: Scale mm to visualization units
self.coordinate_scale = 0.1  # mm to cm
self.coordinate_offset = (100, 50, 0)  # Center offset
```

### Multiple DART Systems
Run multiple adapters on different ports:

```bash
# DART System 1
python server/udp_dart_adapter.py --dart-port 12346 --gerf-port 12345

# DART System 2  
python server/udp_dart_adapter.py --dart-port 12347 --gerf-port 12345
```

### Custom WebSocket Handlers
Extend `websocket_bridge.py` for custom client message handling or data processing.

---

*For development and testing, continue using `main_test.py`. For production with real tracking systems, use `main.py` as documented above.* 