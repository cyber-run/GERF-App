// Recording Management
class RecordingManager {
    constructor() {
        this.isRecording = false;
        this.currentSession = null;
        this.recordedThrows = [];
        this.startTime = null;
        this.lastCoordinate = null;
        this.pointsCount = 0;
        this.autoStopTimeout = null;
        this.durationInterval = null;
        
        // Auto-stop configuration
        this.autoStopDelay = 3000; // 3 seconds of no data
        this.minRecordingDuration = 1000; // Minimum 1 second recording
        
        // NEW: Auto-save configuration
        this.autoSaveEnabled = localStorage.getItem('gerf-auto-save') !== 'false'; // Default true
        this.saveLocation = localStorage.getItem('gerf-save-location') || 'download'; // 'download' or 'picker'
        
        this.initializeUI();
    }
    
    initializeUI() {
        // Get UI elements
        this.playerNameInput = document.getElementById('player-name');
        this.startBtn = document.getElementById('start-recording');
        this.stopBtn = document.getElementById('stop-recording');
        this.statusPanel = document.getElementById('recording-status');
        this.stateDisplay = document.getElementById('recording-state');
        this.pointsDisplay = document.getElementById('points-captured');
        this.durationDisplay = document.getElementById('recording-duration');
        this.playerDisplay = document.getElementById('current-player');
        
        // NEW: Get management UI elements
        this.autoSaveToggle = document.getElementById('auto-save-toggle');
        this.saveLocationSelect = document.getElementById('save-location');
        this.exportAllBtn = document.getElementById('export-all');
        this.viewRecordingsBtn = document.getElementById('view-recordings');
        this.recordingsList = document.getElementById('recordings-list');
        this.recordingsContainer = document.getElementById('recordings-container');
        
        // Bind event listeners
        this.startBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        
        // NEW: Bind management event listeners
        this.autoSaveToggle.addEventListener('change', () => this.toggleAutoSave());
        this.saveLocationSelect.addEventListener('change', (e) => this.setSaveLocation(e.target.value));
        this.exportAllBtn.addEventListener('click', () => this.exportRecordings());
        this.viewRecordingsBtn.addEventListener('click', () => this.toggleRecordingsList());
        
        // Auto-save player name
        this.playerNameInput.addEventListener('input', () => {
            localStorage.setItem('gerf-player-name', this.playerNameInput.value);
        });
        
        // Load saved player name
        const savedName = localStorage.getItem('gerf-player-name');
        if (savedName) {
            this.playerNameInput.value = savedName;
        }
        
        // NEW: Initialize settings UI
        this.initializeSettings();
    }
    
    // NEW: Initialize settings from localStorage
    initializeSettings() {
        // Set auto-save toggle
        this.autoSaveToggle.checked = this.autoSaveEnabled;
        
        // Set save location
        this.saveLocationSelect.value = this.saveLocation;
        
        // Update UI based on File System Access API availability
        if (!('showSaveFilePicker' in window)) {
            // Disable picker option if not supported
            const pickerOption = this.saveLocationSelect.querySelector('option[value="picker"]');
            if (pickerOption) {
                pickerOption.disabled = true;
                pickerOption.textContent += ' (Not supported in this browser)';
            }
            if (this.saveLocation === 'picker') {
                this.saveLocation = 'download';
                this.saveLocationSelect.value = 'download';
                localStorage.setItem('gerf-save-location', 'download');
            }
        }
    }
    
    // NEW: Toggle recordings list visibility
    toggleRecordingsList() {
        const isVisible = this.recordingsList.style.display !== 'none';
        
        if (isVisible) {
            this.recordingsList.style.display = 'none';
            this.viewRecordingsBtn.textContent = 'View Recordings';
        } else {
            this.updateRecordingsList();
            this.recordingsList.style.display = 'block';
            this.viewRecordingsBtn.textContent = 'Hide Recordings';
        }
    }
    
    // NEW: Update recordings list display
    updateRecordingsList() {
        const recordings = this.getAllRecordings();
        
        if (recordings.length === 0) {
            this.recordingsContainer.innerHTML = '<p>No recordings found.</p>';
            return;
        }
        
        const recordingsHTML = recordings.map(recording => `
            <div class="recording-item" data-key="${recording.key}">
                <div class="recording-info">
                    <strong>${recording.player}</strong>
                    <span class="recording-date">${new Date(recording.startTime).toLocaleString()}</span>
                    <span class="recording-stats">${recording.pointCount} points, ${Math.round(recording.duration / 1000)}s</span>
                </div>
                <div class="recording-actions">
                    <button class="btn-small save-recording" data-key="${recording.key}">💾 Save</button>
                    <button class="btn-small delete-recording" data-key="${recording.key}">🗑️ Delete</button>
                </div>
            </div>
        `).join('');
        
        this.recordingsContainer.innerHTML = recordingsHTML;
        
        // Bind action buttons
        this.recordingsContainer.querySelectorAll('.save-recording').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.getAttribute('data-key');
                this.saveSpecificRecording(key);
            });
        });
        
        this.recordingsContainer.querySelectorAll('.delete-recording').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.getAttribute('data-key');
                if (confirm('Are you sure you want to delete this recording?')) {
                    this.deleteRecording(key);
                    this.updateRecordingsList(); // Refresh the list
                }
            });
        });
    }
    
    startRecording() {
        const playerName = this.playerNameInput.value.trim();
        if (!playerName) {
            alert('Please enter a player name before starting recording.');
            this.playerNameInput.focus();
            return;
        }
        
        this.isRecording = true;
        this.startTime = Date.now();
        this.pointsCount = 0;
        this.lastCoordinate = null;
        
        this.currentSession = {
            player: playerName,
            startTime: new Date().toISOString(),
            coordinates: [],
            metadata: {
                userAgent: navigator.userAgent,
                timestamp: Date.now()
            }
        };
        
        // Update UI
        this.updateUI();
        this.startDurationTimer();
        
        console.log(`Recording started for player: ${playerName}`);
    }
    
    stopRecording() {
        if (!this.isRecording) return;
        
        this.isRecording = false;
        
        // Clear timers
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
            this.autoStopTimeout = null;
        }
        
        if (this.durationInterval) {
            clearInterval(this.durationInterval);
            this.durationInterval = null;
        }
        
        // Finalize session
        if (this.currentSession) {
            this.currentSession.endTime = new Date().toISOString();
            this.currentSession.duration = Date.now() - this.startTime;
            this.currentSession.pointCount = this.pointsCount;
            
            // Save the recording
            this.saveRecording(this.currentSession);
            
            // Add to local history
            this.recordedThrows.push(this.currentSession);
            
            console.log(`Recording stopped. Captured ${this.pointsCount} points in ${this.currentSession.duration}ms`);
        }
        
        this.currentSession = null;
        this.updateUI();
    }
    
    addCoordinate(coordinateData) {
        if (!this.isRecording || !this.currentSession) return;
        
        // Add coordinate to current session
        this.currentSession.coordinates.push({
            ...coordinateData,
            recordingTime: Date.now() - this.startTime
        });
        
        this.pointsCount++;
        this.lastCoordinate = coordinateData;
        
        // Update points display
        this.pointsDisplay.textContent = this.pointsCount;
        
        // Reset auto-stop timer
        this.resetAutoStopTimer();
    }
    
    resetAutoStopTimer() {
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
        }
        
        // Only set auto-stop if we've been recording for minimum duration
        const recordingDuration = Date.now() - this.startTime;
        if (recordingDuration >= this.minRecordingDuration) {
            this.autoStopTimeout = setTimeout(() => {
                console.log('Auto-stopping recording due to inactivity');
                this.stopRecording();
            }, this.autoStopDelay);
        }
    }
    
    startDurationTimer() {
        this.durationInterval = setInterval(() => {
            if (this.isRecording && this.startTime) {
                const duration = Math.floor((Date.now() - this.startTime) / 1000);
                this.durationDisplay.textContent = `${duration}s`;
            }
        }, 1000);
    }
    
    updateUI() {
        if (this.isRecording) {
            // Recording active
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.playerNameInput.disabled = true;
            this.statusPanel.className = 'recording-active recording-pulse';
            this.stateDisplay.textContent = 'Recording...';
            this.playerDisplay.textContent = this.currentSession?.player || '--';
        } else {
            // Recording inactive
            this.startBtn.disabled = false;
            this.stopBtn.disabled = true;
            this.playerNameInput.disabled = false;
            this.statusPanel.className = 'recording-inactive';
            this.stateDisplay.textContent = 'Ready';
            this.pointsDisplay.textContent = '0';
            this.durationDisplay.textContent = '0s';
            this.playerDisplay.textContent = '--';
        }
    }
    
    saveRecording(session) {
        try {
            // Save to localStorage (existing functionality)
            const storageKey = `gerf-recording-${Date.now()}`;
            localStorage.setItem(storageKey, JSON.stringify(session));
            
            // Also save to a master list
            const masterList = JSON.parse(localStorage.getItem('gerf-recordings-list') || '[]');
            masterList.push({
                key: storageKey,
                player: session.player,
                startTime: session.startTime,
                pointCount: session.pointCount,
                duration: session.duration
            });
            localStorage.setItem('gerf-recordings-list', JSON.stringify(masterList));
            
            // NEW: Automatically save as individual JSON file
            this.saveRecordingToFile(session, storageKey);
            
            console.log(`Recording saved with key: ${storageKey}`);
            
            // Optional: Show success message
            this.showNotification(`Recording saved! ${session.pointCount} points captured.`);
            
        } catch (error) {
            console.error('Error saving recording:', error);
            this.showNotification('Error saving recording!', 'error');
        }
    }
    
    // NEW: Save individual recording to file
    saveRecordingToFile(session, storageKey) {
        // Check if auto-save is enabled
        if (!this.autoSaveEnabled) {
            console.log('Auto-save disabled, recording only saved to localStorage');
            return;
        }

        try {
            // Create filename with timestamp and player name
            const timestamp = new Date(session.startTime).toISOString().replace(/[:.]/g, '-');
            const playerName = session.player.replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `recording_${playerName}_${timestamp}.json`;
            
            // Create enhanced session data with metadata
            const fileData = {
                ...session,
                fileInfo: {
                    filename: filename,
                    storageKey: storageKey,
                    savedAt: new Date().toISOString(),
                    version: '1.0'
                }
            };
            
            // Convert to JSON string with formatting
            const dataStr = JSON.stringify(fileData, null, 2);
            const dataBlob = new Blob([dataStr], {type: 'application/json'});
            
            // Use preferred save method
            if (this.saveLocation === 'picker' && 'showSaveFilePicker' in window) {
                this.saveWithFileSystemAPI(dataBlob, filename);
            } else {
                // Fallback: automatic download
                this.saveWithDownload(dataBlob, filename);
            }
            
        } catch (error) {
            console.error('Error saving recording to file:', error);
            this.showNotification('Error saving file! Recording saved to browser storage.', 'warning');
        }
    }
    
    // NEW: Save using modern File System Access API
    async saveWithFileSystemAPI(dataBlob, filename) {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'JSON files',
                    accept: {'application/json': ['.json']},
                }],
            });
            
            const writable = await fileHandle.createWritable();
            await writable.write(dataBlob);
            await writable.close();
            
            console.log(`Recording saved to file: ${filename}`);
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('File System API error:', error);
                // Fallback to download
                this.saveWithDownload(dataBlob, filename);
            }
        }
    }
    
    // NEW: Fallback save method using automatic download
    saveWithDownload(dataBlob, filename) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        
        console.log(`Recording downloaded as: ${filename}`);
    }
    
    showNotification(message, type = 'success') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: ${type === 'error' ? '#f44336' : '#4CAF50'};
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            z-index: 1000;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    // Method to export all recordings
    exportRecordings() {
        const masterList = JSON.parse(localStorage.getItem('gerf-recordings-list') || '[]');
        const allRecordings = masterList.map(item => {
            return JSON.parse(localStorage.getItem(item.key) || '{}');
        });
        
        const dataStr = JSON.stringify(allRecordings, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `gerf-recordings-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
    }

    // NEW: Toggle auto-save functionality
    toggleAutoSave() {
        this.autoSaveEnabled = !this.autoSaveEnabled;
        localStorage.setItem('gerf-auto-save', this.autoSaveEnabled.toString());
        this.showNotification(`Auto-save ${this.autoSaveEnabled ? 'enabled' : 'disabled'}`);
        console.log(`Auto-save ${this.autoSaveEnabled ? 'enabled' : 'disabled'}`);
    }

    // NEW: Set save location preference
    setSaveLocation(location) {
        this.saveLocation = location;
        localStorage.setItem('gerf-save-location', location);
        this.showNotification(`Save location set to: ${location}`);
        console.log(`Save location set to: ${location}`);
    }

    // NEW: Manual save of specific recording
    saveSpecificRecording(storageKey) {
        try {
            const sessionData = localStorage.getItem(storageKey);
            if (!sessionData) {
                this.showNotification('Recording not found!', 'error');
                return;
            }

            const session = JSON.parse(sessionData);
            this.saveRecordingToFile(session, storageKey);
        } catch (error) {
            console.error('Error saving specific recording:', error);
            this.showNotification('Error saving recording!', 'error');
        }
    }

    // NEW: Get all saved recordings info
    getAllRecordings() {
        try {
            const masterList = JSON.parse(localStorage.getItem('gerf-recordings-list') || '[]');
            return masterList.map(item => ({
                ...item,
                data: JSON.parse(localStorage.getItem(item.key) || '{}')
            }));
        } catch (error) {
            console.error('Error retrieving recordings:', error);
            return [];
        }
    }

    // NEW: Delete specific recording
    deleteRecording(storageKey) {
        try {
            // Remove from localStorage
            localStorage.removeItem(storageKey);
            
            // Remove from master list
            const masterList = JSON.parse(localStorage.getItem('gerf-recordings-list') || '[]');
            const updatedList = masterList.filter(item => item.key !== storageKey);
            localStorage.setItem('gerf-recordings-list', JSON.stringify(updatedList));
            
            this.showNotification('Recording deleted');
            console.log(`Recording deleted: ${storageKey}`);
        } catch (error) {
            console.error('Error deleting recording:', error);
            this.showNotification('Error deleting recording!', 'error');
        }
    }
} 