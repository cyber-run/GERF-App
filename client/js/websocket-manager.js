// WebSocket Connection Management
class WebSocketManager {
    constructor(sceneManager, recordingManager, throwManager = null) {
        this.sceneManager = sceneManager;
        this.recordingManager = recordingManager;
        this.throwManager = throwManager;
        this.ws = null;
        this.reconnectInterval = null;
        this.maxReconnectAttempts = 10;
        this.reconnectAttempts = 0;
        
        this.connect();
    }
    
    connect() {
        const statusElement = document.getElementById('status');
        statusElement.textContent = 'Connecting...';
        statusElement.className = 'status-connecting';

        try {
            this.ws = new WebSocket('ws://localhost:8765');

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                statusElement.textContent = 'Connected';
                statusElement.className = 'status-connected';
                this.reconnectAttempts = 0;
                
                if (this.reconnectInterval) {
                    clearInterval(this.reconnectInterval);
                    this.reconnectInterval = null;
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    // Update coordinate display
                    this.updateCoordinateDisplay(data);
                    
                    // Add to throw tracking first (this now handles filtered 3D visualization)
                    if (this.throwManager) {
                        this.throwManager.addCoordinate(data);
                    } else {
                        // Fallback: Update 3D visualization directly if no throw manager
                        this.sceneManager.updatePlanePosition(data);
                    }
                    
                    // Add to recording if recording manager is active
                    if (this.recordingManager) {
                        this.recordingManager.addCoordinate(data);
                    }
                    
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                statusElement.textContent = 'Disconnected';
                statusElement.className = 'status-disconnected';
                
                // Attempt to reconnect
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                    
                    this.reconnectInterval = setTimeout(() => {
                        this.connect();
                    }, 2000);
                } else {
                    console.log('Max reconnection attempts reached');
                    statusElement.textContent = 'Connection failed';
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                statusElement.textContent = 'Connection error';
                statusElement.className = 'status-disconnected';
            };

        } catch (error) {
            console.error('Error creating WebSocket:', error);
            statusElement.textContent = 'Connection failed';
            statusElement.className = 'status-disconnected';
        }
    }
    
    updateCoordinateDisplay(data) {
        document.getElementById('coord-x').textContent = data.x || '--';
        document.getElementById('coord-y').textContent = data.y || '--';
        document.getElementById('coord-z').textContent = data.z || '--';
        document.getElementById('trajectory-type').textContent = data.trajectory_type || '--';
    }
} 