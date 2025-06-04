// Throw Management and 3-Throw Round Scoring System
class ThrowManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.currentThrow = null;
        this.currentRound = null;
        this.roundHistory = [];
        this.isThrowActive = false;
        this.autoStopTimeout = null;
        this.throwStartTime = null;
        this.lastCoordinate = null;
        
        // Round configuration
        this.maxThrowsPerRound = 3;
        this.throwsInCurrentRound = 0;
        this.waitingForNextPlayer = false;
        
        // Scoring configuration
        this.dartboardCenter = { x: -60, y: 80, z: 0 }; // From server config
        this.scoringZones = [
            { name: 'Bullseye', maxDistance: 2, points: 50, color: '#FFD700' },
            { name: 'Inner Ring', maxDistance: 5, points: 25, color: '#FF6B6B' },
            { name: 'Outer Ring', maxDistance: 10, points: 10, color: '#4ECDC4' },
            { name: 'Miss', maxDistance: Infinity, points: 0, color: '#95A5A6' }
        ];
        
        // Timing configuration
        this.autoStopDelay = 3000; // 3 seconds of no data
        this.minThrowDuration = 1000; // Minimum 1 second throw
        
        // Session statistics
        this.sessionStats = {
            totalRounds: 0,
            totalThrows: 0,
            totalScore: 0,
            bestRound: 0,
            bullseyes: 0,
            averageScore: 0
        };
        
        this.initializeUI();
        this.loadRoundHistory();
    }
    
    initializeUI() {
        // Get UI elements
        this.playerNameInput = document.getElementById('player-name');
        this.toggleDetailsBtn = document.getElementById('toggle-details');
        this.scoringDetailsSection = document.getElementById('scoring-details');
        this.roundCountDisplay = document.getElementById('throw-count');
        this.currentScoreDisplay = document.getElementById('current-score');
        this.closestDistanceDisplay = document.getElementById('closest-distance');
        this.throwStatusDisplay = document.getElementById('throw-status');
        this.sessionScoreDisplay = document.getElementById('session-score');
        this.bestThrowDisplay = document.getElementById('best-throw');
        this.bullseyeCountDisplay = document.getElementById('bullseye-count');
        this.averageDistanceDisplay = document.getElementById('average-distance');
        this.throwHistoryContainer = document.getElementById('throw-history-container');
        this.clearHistoryBtn = document.getElementById('clear-history');
        this.exportThrowsBtn = document.getElementById('export-throws');
        
        // Bind event listeners
        if (this.clearHistoryBtn) {
            this.clearHistoryBtn.addEventListener('click', () => this.clearRoundHistory());
        }
        if (this.exportThrowsBtn) {
            this.exportThrowsBtn.addEventListener('click', () => this.exportRoundHistory());
        }
        
        // Toggle details functionality
        if (this.toggleDetailsBtn && this.scoringDetailsSection) {
            this.detailsVisible = false;
            this.toggleDetailsBtn.addEventListener('click', () => this.toggleScoringDetails());
        }
        
        // Player name input with auto-start functionality
        if (this.playerNameInput) {
            // Load saved player name
            const savedName = localStorage.getItem('gerf-player-name');
            if (savedName) {
                this.playerNameInput.value = savedName;
            }
            
            // Auto-save player name on typing (but don't auto-start)
            this.playerNameInput.addEventListener('input', () => {
                localStorage.setItem('gerf-player-name', this.playerNameInput.value);
            });
            
            // Auto-start only on Enter key
            this.playerNameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const playerName = this.playerNameInput.value.trim();
                    if (playerName && this.waitingForNextPlayer) {
                        this.startNewRound(playerName);
                    }
                }
            });
        }
        
        this.updateUI();
        this.updateThrowStatus('Waiting for player name');
        this.waitingForNextPlayer = true;
        
        // Load saved preferences after all UI setup is complete
        this.loadDetailsPreference();
    }
    
    startNewRound(playerName) {
        this.waitingForNextPlayer = false;
        this.throwsInCurrentRound = 0;
        
        this.currentRound = {
            player: playerName,
            startTime: new Date().toISOString(),
            throws: [],
            totalScore: 0,
            roundNumber: this.roundHistory.length + 1
        };
        
        // Disable name input during round
        if (this.playerNameInput) {
            this.playerNameInput.disabled = true;
        }
        
        console.log(`Starting new round for player: ${playerName}`);
        this.updateThrowStatus(`${playerName} - Ready for throw 1/3`);
        this.updateUI();
    }
    
    addCoordinate(coordinateData) {
        if (!coordinateData || coordinateData.x === undefined || coordinateData.y === undefined || coordinateData.z === undefined) {
            console.log('Invalid coordinate data received:', coordinateData);
            return;
        }
        
        // Skip if waiting for player name
        if (this.waitingForNextPlayer || !this.currentRound) {
            console.log('Skipping coordinate - waiting for player name or no active round');
            return;
        }
        
        const currentTime = Date.now();
        console.log(`Coordinate received: (${coordinateData.x}, ${coordinateData.y}, ${coordinateData.z}) - Throw active: ${this.isThrowActive}`);
        
        // Start new throw if not active
        if (!this.isThrowActive) {
            this.startThrow(currentTime);
        }
        
        // Get current dartboard center from scene manager (with any offset adjustments)
        const dartboardCenter = this.sceneManager ? this.sceneManager.getDartboardCenter() : this.dartboardCenter;
        
        // Calculate distance to dartboard center
        const distance = this.calculateDistance(coordinateData, dartboardCenter);
        
        // Add coordinate to current throw
        this.currentThrow.coordinates.push({
            ...coordinateData,
            distance: distance,
            throwTime: currentTime - this.throwStartTime
        });
        
        // Update closest distance
        if (distance < this.currentThrow.closestDistance) {
            this.currentThrow.closestDistance = distance;
            this.currentThrow.closestPoint = { ...coordinateData };
            console.log(`New closest point: distance ${distance.toFixed(2)}, coordinates (${coordinateData.x}, ${coordinateData.y}, ${coordinateData.z})`);
        }
        
        this.lastCoordinate = coordinateData;
        
        // Update live UI
        this.updateLiveUI();
        
        // Reset auto-stop timer
        this.resetAutoStopTimer();
    }
    
    startThrow(currentTime) {
        this.isThrowActive = true;
        this.throwStartTime = currentTime;
        
        this.currentThrow = {
            throwNumber: this.throwsInCurrentRound + 1,
            startTime: new Date().toISOString(),
            coordinates: [],
            closestDistance: Infinity,
            closestPoint: null,
            score: 0,
            scoringZone: null,
            duration: 0
        };
        
        console.log(`Throw ${this.currentThrow.throwNumber}/3 started for ${this.currentRound.player}`);
        this.updateThrowStatus(`${this.currentRound.player} - Throw ${this.currentThrow.throwNumber}/3 active`);
    }
    
    endThrow() {
        if (!this.isThrowActive || !this.currentThrow || !this.currentRound) return;
        
        this.isThrowActive = false;
        
        // Clear auto-stop timer
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
            this.autoStopTimeout = null;
        }
        
        // Finalize throw data
        this.currentThrow.endTime = new Date().toISOString();
        this.currentThrow.duration = Date.now() - this.throwStartTime;
        
        // Calculate final score
        const scoringResult = this.calculateScore(this.currentThrow.closestDistance);
        this.currentThrow.score = scoringResult.points;
        this.currentThrow.scoringZone = scoringResult.zone;
        
        // Add to current round
        this.currentRound.throws.push({ ...this.currentThrow });
        this.currentRound.totalScore += this.currentThrow.score;
        this.throwsInCurrentRound++;
        
        // Show throw result
        this.showThrowResult();
        
        // Highlight closest point in 3D scene
        if (this.sceneManager && this.currentThrow.closestPoint) {
            this.sceneManager.highlightClosestPoint(this.currentThrow.closestPoint, scoringResult.zone);
        }
        
        console.log(`Throw ${this.currentThrow.throwNumber}/3 completed: ${this.currentThrow.score} points (${scoringResult.zone.name})`);
        console.log(`Round total so far: ${this.currentRound.totalScore} points`);
        
        // Check if round is complete
        if (this.throwsInCurrentRound >= this.maxThrowsPerRound) {
            this.completeRound();
        } else {
            // Prepare for next throw
            this.updateThrowStatus(`${this.currentRound.player} - Ready for throw ${this.throwsInCurrentRound + 1}/3`);
        }
        
        this.currentThrow = null;
        this.updateUI();
    }
    
    completeRound() {
        if (!this.currentRound) return;
        
        // Finalize round
        this.currentRound.endTime = new Date().toISOString();
        this.currentRound.duration = Date.now() - new Date(this.currentRound.startTime).getTime();
        
        // Add to history
        this.roundHistory.push({ ...this.currentRound });
        
        // Update session statistics
        this.updateSessionStats();
        
        // Save to localStorage
        this.saveRoundHistory();
        
        // Show round completion
        this.showRoundResult();
        
        // Reset for next player
        this.currentRound = null;
        this.throwsInCurrentRound = 0;
        this.waitingForNextPlayer = true;
        
        // Re-enable name input and clear it
        if (this.playerNameInput) {
            this.playerNameInput.disabled = false;
            this.playerNameInput.value = '';
            this.playerNameInput.placeholder = 'Enter next player name...';
            this.playerNameInput.focus();
        }
        
        this.updateThrowStatus('Next player - press Enter');
        this.updateUI();
        
        console.log('Round completed, waiting for next player');
    }
    
    resetAutoStopTimer() {
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
            this.autoStopTimeout = null;
        }
        
        // Always set auto-stop timer when we receive coordinates during an active throw
        if (this.isThrowActive && this.throwStartTime) {
            const throwDuration = Date.now() - this.throwStartTime;
            console.log(`Resetting auto-stop timer. Throw duration: ${throwDuration}ms, Min duration: ${this.minThrowDuration}ms`);
            
            // Set auto-stop timer regardless of duration (but use different delays)
            const delay = throwDuration >= this.minThrowDuration ? this.autoStopDelay : this.autoStopDelay + 1000;
            
            this.autoStopTimeout = setTimeout(() => {
                console.log(`Auto-stopping throw after ${Date.now() - this.throwStartTime}ms due to ${delay}ms of inactivity`);
                this.endThrow();
            }, delay);
        }
    }
    
    calculateDistance(point1, point2) {
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        const dz = point1.z - point2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    calculateScore(distance) {
        for (const zone of this.scoringZones) {
            if (distance <= zone.maxDistance) {
                return { points: zone.points, zone: zone };
            }
        }
        return { points: 0, zone: this.scoringZones[this.scoringZones.length - 1] };
    }
    
    updateSessionStats() {
        this.sessionStats.totalRounds = this.roundHistory.length;
        this.sessionStats.totalThrows = this.roundHistory.reduce((sum, round) => sum + round.throws.length, 0);
        this.sessionStats.totalScore = this.roundHistory.reduce((sum, round) => sum + round.totalScore, 0);
        this.sessionStats.bestRound = Math.max(...this.roundHistory.map(round => round.totalScore), 0);
        this.sessionStats.bullseyes = this.roundHistory.reduce((sum, round) => 
            sum + round.throws.filter(throw_ => throw_.scoringZone?.name === 'Bullseye').length, 0);
        
        this.sessionStats.averageScore = this.roundHistory.length > 0 ? 
            this.sessionStats.totalScore / this.roundHistory.length : 0;
    }
    
    updateLiveUI() {
        if (!this.currentThrow) return;
        
        if (this.closestDistanceDisplay) {
            this.closestDistanceDisplay.textContent = this.currentThrow.closestDistance.toFixed(2);
        }
        
        // Show current potential score
        const potentialScore = this.calculateScore(this.currentThrow.closestDistance);
        if (this.currentScoreDisplay) {
            this.currentScoreDisplay.textContent = potentialScore.points;
            this.currentScoreDisplay.style.color = potentialScore.zone.color;
        }
    }
    
    updateUI() {
        // Update round count (instead of throw count)
        if (this.roundCountDisplay) {
            this.roundCountDisplay.textContent = this.sessionStats.totalRounds;
        }
        
        // Update session statistics (now based on rounds)
        if (this.sessionScoreDisplay) {
            this.sessionScoreDisplay.textContent = this.sessionStats.totalScore;
        }
        if (this.bestThrowDisplay) {
            this.bestThrowDisplay.textContent = this.sessionStats.bestRound;
        }
        if (this.bullseyeCountDisplay) {
            this.bullseyeCountDisplay.textContent = this.sessionStats.bullseyes;
        }
        if (this.averageDistanceDisplay) {
            this.averageDistanceDisplay.textContent = this.sessionStats.averageScore.toFixed(1);
        }
        
        // Update round history display
        this.updateRoundHistoryDisplay();
        
        // Reset current throw display if not active
        if (!this.isThrowActive) {
            if (this.currentScoreDisplay) {
                this.currentScoreDisplay.textContent = this.currentRound ? 
                    this.currentRound.totalScore : '--';
                this.currentScoreDisplay.style.color = '';
            }
            if (this.closestDistanceDisplay) {
                this.closestDistanceDisplay.textContent = '--';
            }
        }
    }
    
    updateThrowStatus(status) {
        if (this.throwStatusDisplay) {
            this.throwStatusDisplay.textContent = status;
            
            // Update CSS class based on status
            if (status.includes('active')) {
                this.throwStatusDisplay.className = 'throw-status-active';
            } else if (status.includes('Ready') || status.includes('Waiting')) {
                this.throwStatusDisplay.className = 'throw-status-ready';
            } else if (status.includes('complete')) {
                this.throwStatusDisplay.className = 'throw-status-complete';
            } else {
                this.throwStatusDisplay.className = '';
            }
        }
    }
    
    updateRoundHistoryDisplay() {
        if (!this.throwHistoryContainer) return;
        
        if (this.roundHistory.length === 0) {
            this.throwHistoryContainer.innerHTML = '<p class="no-throws">No rounds completed yet</p>';
            return;
        }
        
        const historyHTML = this.roundHistory.slice(-10).reverse().map(round => `
            <div class="round-item">
                <div class="round-info">
                    <span class="round-number">#${round.roundNumber}</span>
                    <span class="round-player"><strong>${round.player}</strong></span>
                    <span class="round-score">${round.totalScore} pts</span>
                </div>
                <div class="round-throws">
                    ${round.throws.map(throw_ => `
                        <span class="throw-score-small" style="color: ${throw_.scoringZone?.color || '#95A5A6'}">
                            ${throw_.score}
                        </span>
                    `).join(' + ')}
                </div>
            </div>
        `).join('');
        
        this.throwHistoryContainer.innerHTML = historyHTML;
    }
    
    showThrowResult() {
        if (!this.currentThrow || !this.currentRound) return;
        
        const result = this.currentThrow;
        const message = `Throw ${result.throwNumber}/3: ${result.score} points (${result.scoringZone?.name || 'Miss'})`;
        
        // Create temporary notification
        const notification = document.createElement('div');
        notification.className = 'throw-notification';
        notification.style.cssText = `
            position: fixed;
            top: 40%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            color: ${result.scoringZone?.color || '#95A5A6'};
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            z-index: 1000;
            border: 2px solid ${result.scoringZone?.color || '#95A5A6'};
            backdrop-filter: blur(10px);
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remove after 2 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 2000);
    }
    
    showRoundResult() {
        if (!this.currentRound) return;
        
        const round = this.currentRound;
        const message = `${round.player} completed round ${round.roundNumber}!\nFinal Score: ${round.totalScore} points`;
        
        // Create temporary notification
        const notification = document.createElement('div');
        notification.className = 'round-notification';
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.95);
            color: #FFD700;
            padding: 25px 35px;
            border-radius: 15px;
            font-size: 24px;
            font-weight: bold;
            z-index: 1000;
            border: 3px solid #FFD700;
            backdrop-filter: blur(15px);
            text-align: center;
            white-space: pre-line;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remove after 4 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 4000);
    }
    
    saveRoundHistory() {
        try {
            localStorage.setItem('gerf-round-history', JSON.stringify(this.roundHistory));
            localStorage.setItem('gerf-session-stats', JSON.stringify(this.sessionStats));
        } catch (error) {
            console.error('Error saving round history:', error);
        }
    }
    
    loadRoundHistory() {
        try {
            const savedHistory = localStorage.getItem('gerf-round-history');
            if (savedHistory) {
                this.roundHistory = JSON.parse(savedHistory);
            }
            
            const savedStats = localStorage.getItem('gerf-session-stats');
            if (savedStats) {
                this.sessionStats = { ...this.sessionStats, ...JSON.parse(savedStats) };
            }
        } catch (error) {
            console.error('Error loading round history:', error);
            this.roundHistory = [];
        }
    }
    
    clearRoundHistory() {
        if (confirm('Are you sure you want to clear all round history? This cannot be undone.')) {
            this.roundHistory = [];
            this.sessionStats = {
                totalRounds: 0,
                totalThrows: 0,
                totalScore: 0,
                bestRound: 0,
                bullseyes: 0,
                averageScore: 0
            };
            this.saveRoundHistory();
            this.updateUI();
            console.log('Round history cleared');
        }
    }
    
    exportRoundHistory() {
        if (this.roundHistory.length === 0) {
            alert('No round history to export.');
            return;
        }
        
        const exportData = {
            sessionStats: this.sessionStats,
            rounds: this.roundHistory.map(round => ({
                roundNumber: round.roundNumber,
                player: round.player,
                startTime: round.startTime,
                endTime: round.endTime,
                duration: round.duration,
                totalScore: round.totalScore,
                throws: round.throws.map(throw_ => ({
                    throwNumber: throw_.throwNumber,
                    score: throw_.score,
                    scoringZone: throw_.scoringZone?.name,
                    closestDistance: throw_.closestDistance
                }))
            })),
            exportDate: new Date().toISOString(),
            gameFormat: '3-throw rounds',
            dartboardCenter: this.dartboardCenter,
            scoringZones: this.scoringZones
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `gerf-rounds-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        console.log('Round history exported');
    }
    
    // Manual control methods
    forceEndThrow() {
        if (this.isThrowActive) {
            this.endThrow();
        }
    }
    
    forceEndRound() {
        if (this.currentRound) {
            this.completeRound();
        }
    }
    
    getCurrentRoundInfo() {
        return this.currentRound;
    }
    
    getSessionStats() {
        return { ...this.sessionStats };
    }
    
    toggleScoringDetails() {
        if (!this.scoringDetailsSection || !this.toggleDetailsBtn) return;
        
        if (this.detailsVisible) {
            // Hide details
            this.scoringDetailsSection.style.display = 'none';
            this.toggleDetailsBtn.textContent = 'Show Details';
        } else {
            // Show details
            this.scoringDetailsSection.style.display = 'block';
            this.toggleDetailsBtn.textContent = 'Hide Details';
        }
        
        this.detailsVisible = !this.detailsVisible;
        
        // Save preference
        localStorage.setItem('gerf-details-visible', this.detailsVisible.toString());
    }
    
    loadDetailsPreference() {
        // Load saved preference for details visibility
        const savedPreference = localStorage.getItem('gerf-details-visible');
        if (savedPreference === 'true') {
            this.detailsVisible = false; // Will be toggled to true
            this.toggleScoringDetails();
        }
    }
} 