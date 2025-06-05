# GERF-App - Real-time 3D Coordinate Streaming

A real-time 3D visualization application that streams coordinate data via UDP and displays it in a web browser using Three.js. Features both orbital and linear trajectory types with client-side recording capabilities.

## 🏗️ Architecture

### Simplified Two-Server Design

1. **UDP Test Server** (`server/udp_test_server.py`)
   - Generates test coordinate data (orbital/linear trajectories)
   - Will be replaced by external UDP server in production
   - Simple, focused responsibility

2. **WebSocket Bridge Server** (`server/websocket_bridge.py`)
   - Forwards UDP data to WebSocket clients
   - Persists in production deployment
   - Clean separation of concerns

3. **Frontend Client** (`client/index.html`)
   - 3D visualization using Three.js
   - **All recording logic handled client-side**
   - Data stored in browser localStorage
   - No server-side recording complexity

## 🎯 Key Features

- **Real-time 3D Visualization**: Paper plane flying in 3D space
- **Multiple Trajectory Types**: Orbital motion and linear flight paths
- **Client-side Recording**: Complete recording system in the browser
- **Auto-stop Detection**: Recordings automatically stop when data flow ends
- **Data Export**: Export recordings as JSON files
- **Responsive UI**: Modern, intuitive interface

## 📁 Project Structure

```
GERF-App/
├── client/                          # Frontend application
│   ├── index.html                   # Main HTML file (123 lines)
│   ├── css/
│   │   └── styles.css              # All application styles
│   ├── js/
│   │   ├── recording-manager.js    # Client-side recording logic
│   │   ├── scene-manager.js        # 3D scene and mouse controls
│   │   └── websocket-manager.js    # WebSocket connection handling
│   └── models/
│       ├── Paper Plane.glb         # 3D paper airplane model
│       └── archery_targret.glb     # 3D archery target model
├── server/                          # Backend services
│   ├── udp_test_server.py          # Test coordinate generator
│   ├── websocket_bridge.py         # WebSocket bridge server
│   ├── config.py                   # Configuration settings
│   └── start_servers.py            # Server startup script
├── start_servers.py                # Main startup script
└── README.md                       # This file
```

## 🚀 Quick Start

### Prerequisites

- Python 3.7+
- Modern web browser with WebGL support

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd GERF-App
   ```

2. **Install Python dependencies**
   ```bash
   pip install websockets
   ```

3. **Start the servers**
   ```bash
   python start_servers.py
   ```

4. **Open the frontend**
   - Open `client/index.html` in your web browser
   - Or serve it via a local web server for better performance

## 🎮 Usage

### Basic Operation

1. **Start Servers**: Run `python start_servers.py`
2. **Open Frontend**: Load `client/index.html` in browser
3. **View Visualization**: Watch the paper plane fly in real-time
4. **Record Data**: Use the recording panel to capture trajectory data

### Recording Functionality

The recording system is entirely client-side:

- **Enter Player Name**: Type a name in the input field
- **Start Recording**: Click "Start Recording" or press `Ctrl+R`
- **Auto-stop**: Recording automatically stops when data flow ends
- **Manual Stop**: Click "Stop Recording" or press `Ctrl+R` again
- **Export Data**: Press `Ctrl+E` to download all recordings as JSON

## 🎮 Controls

### Mouse/Trackpad Controls
- **Drag**: Rotate camera around the scene
- **Scroll/Pinch**: Zoom in and out
- **R**: Reset camera to default position
- **S**: Toggle starfield visibility
- **Space**: Toggle auto-rotate mode

### Recording Controls
- **Ctrl+R**: Start/Stop recording
- **Ctrl+E**: Export all recordings
- **UI Panel**: Player name input and manual start/stop buttons

### Camera Behavior
- **Auto-rotate**: Camera slowly orbits around the scene center
- **Manual control**: Dragging disables auto-rotate; press Space to re-enable
- **Zoom limits**: 50-500 units from scene center
- **Vertical limits**: Prevents camera from going completely upside down

## ⚙️ Configuration

Edit `server/config.py` to customize:

### Server Settings
```python
UDP_HOST = 'localhost'
UDP_PORT = 12345
WEBSOCKET_HOST = 'localhost'
WEBSOCKET_PORT = 8765
```

### Trajectory Settings
```python
TRAJECTORY_TYPE = 'linear'  # 'orbital' or 'linear'
LINEAR_DURATION = 15.0      # Flight time in seconds
LINEAR_LOOP_DELAY = 5.0     # Delay between flights
```

## 🔧 Development

### Testing Different Trajectories

Switch between trajectory types by editing `TRAJECTORY_TYPE` in `config.py`:

- `'orbital'`: Smooth orbital motion around origin
- `'linear'`: Linear flight from start position to dartboard

### Data Storage

Recordings are stored in browser localStorage:
- Individual recordings: `gerf-recording-{timestamp}`
- Master list: `gerf-recordings-list`
- Automatic cleanup and export functionality

### Production Deployment

For production:
1. Replace `udp_test_server.py` with external UDP data source
2. Keep `websocket_bridge.py` as-is
3. Deploy frontend to web server
4. Update configuration for production endpoints

## 🐛 Troubleshooting

### Common Issues

1. **WebSocket Connection Failed**
   - Ensure both servers are running
   - Check firewall settings
   - Verify port availability

2. **3D Models Not Loading**
   - Serve frontend via HTTP server (not file://)
   - Check model file paths in `client/models/`

3. **Recording Not Working**
   - Check browser console for errors
   - Ensure localStorage is enabled
   - Try clearing browser cache

### Debug Mode

Enable debug logging by setting `LOG_LEVEL = 'DEBUG'` in `config.py`.

## 📊 Data Format

### Coordinate Data
```json
{
  "x": 45.67,
  "y": 78.90,
  "z": -12.34,
  "timestamp": 1640995200.123,
  "trajectory_type": "linear",
  "progress": 0.75
}
```

### Recording Data
```json
{
  "player": "PlayerName",
  "startTime": "2024-01-01T12:00:00.000Z",
  "endTime": "2024-01-01T12:00:15.000Z",
  "duration": 15000,
  "pointCount": 300,
  "coordinates": [...],
  "metadata": {
    "userAgent": "...",
    "timestamp": 1640995200123
  }
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Three.js for 3D rendering
- WebSocket API for real-time communication
- GLB models for 3D assets