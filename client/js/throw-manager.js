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
        
        // One Euro Filter for trajectory smoothing (created per throw)
        this.trajectoryFilter = null;
        this.filterConfig = {
            frequency: 60,      // Expected data rate (Hz)
            minCutoff: 1.0,     // Minimum cutoff frequency (lower = more smoothing)
            beta: 0.007,        // Speed adaptation (higher = more responsive)
            dCutoff: 1.0        // Derivative cutoff frequency
        };
        
        // Round configuration
        this.maxThrowsPerRound = 3;
        this.throwsInCurrentRound = 0;
        this.waitingForNextPlayer = false;
        
        // Scoring configuration - use global config
        this.scoringZones = window.GERF_CONFIG.scoringZones;
        
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
        
        // Individual attempts leaderboard (much simpler than player database)
        this.attemptsLeaderboard = [];
        
        this.initializeUI();
        this.loadRoundHistory();
        this.loadAttemptsLeaderboard();
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
        
        // New leaderboard panel elements
        this.topAttemptsContainer = document.getElementById('top-attempts-container');
        this.showFullLeaderboardBtn = document.getElementById('show-full-leaderboard');
        this.clearAttemptsBtn = document.getElementById('clear-attempts');
        
        // Bind event listeners
        if (this.clearHistoryBtn) {
            this.clearHistoryBtn.addEventListener('click', () => this.clearRoundHistory());
        }
        
        // New leaderboard panel event listeners
        if (this.showFullLeaderboardBtn) {
            this.showFullLeaderboardBtn.addEventListener('click', () => this.showLeaderboard());
        }
        if (this.clearAttemptsBtn) {
            this.clearAttemptsBtn.addEventListener('click', () => this.clearAttemptsLeaderboard());
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
        
        // Apply One Euro Filter to smooth trajectory data
        let filteredCoordinates = coordinateData;
        if (this.trajectoryFilter) {
            filteredCoordinates = this.trajectoryFilter.filter(coordinateData, currentTime / 1000.0);
            console.log(`Filtered coordinates: (${filteredCoordinates.x.toFixed(2)}, ${filteredCoordinates.y.toFixed(2)}, ${filteredCoordinates.z.toFixed(2)})`);
        }
        
        // Get current target center from scene manager
        const targetCenter = this.sceneManager ? this.sceneManager.getTargetCenter() : 
            (() => { throw new Error('SceneManager not available for target center calculation'); })();
        
        // Calculate distance to target center using filtered coordinates
        const distance = this.calculateDistance(filteredCoordinates, targetCenter);
        
        // Store both original and filtered coordinates
        this.currentThrow.coordinates.push({
            ...coordinateData,              // Original coordinates
            filtered: filteredCoordinates,  // Filtered coordinates
            distance: distance,
            throwTime: currentTime - this.throwStartTime
        });
        
        // Update closest distance using filtered coordinates
        if (distance < this.currentThrow.closestDistance) {
            this.currentThrow.closestDistance = distance;
            this.currentThrow.closestPoint = { ...filteredCoordinates };
            console.log(`New closest point: distance ${distance.toFixed(2)}, filtered coordinates (${filteredCoordinates.x.toFixed(2)}, ${filteredCoordinates.y.toFixed(2)}, ${filteredCoordinates.z.toFixed(2)})`);
        }
        
        // Use filtered coordinates for visualization
        this.lastCoordinate = filteredCoordinates;
        
        // Update 3D visualization with filtered coordinates
        if (this.sceneManager) {
            this.sceneManager.updatePlanePosition(filteredCoordinates);
        }
        
        // Update live UI
        this.updateLiveUI();
        
        // Reset auto-stop timer
        this.resetAutoStopTimer();
    }
    
    startThrow(currentTime) {
        this.isThrowActive = true;
        this.throwStartTime = currentTime;
        
        // Initialize One Euro Filter for this throw
        this.trajectoryFilter = new OneEuroFilter3D(
            this.filterConfig.frequency,
            this.filterConfig.minCutoff,
            this.filterConfig.beta,
            this.filterConfig.dCutoff
        );
        console.log('One Euro Filter initialized for trajectory smoothing');
        
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
        
        // Start trajectory tracking
        if (this.sceneManager && this.sceneManager.startThrowTrajectory) {
            this.sceneManager.startThrowTrajectory();
        }
    }
    
    endThrow() {
        if (!this.isThrowActive || !this.currentThrow || !this.currentRound) return;
        
        this.isThrowActive = false;
        
        // Clear auto-stop timer
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
            this.autoStopTimeout = null;
        }
        
        // Clean up trajectory filter
        if (this.trajectoryFilter) {
            this.trajectoryFilter = null;
            console.log('One Euro Filter cleaned up for completed throw');
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
        
        // Stop trajectory tracking
        if (this.sceneManager && this.sceneManager.endThrowTrajectory) {
            this.sceneManager.endThrowTrajectory();
        }
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
        
        // Add attempt to leaderboard (replaces complex player database)
        this.addAttemptToLeaderboard(
            this.currentRound.player, 
            this.currentRound.totalScore, 
            this.currentRound.throws,
            this.currentRound.duration
        );
        
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
        // Get target scale factor to adjust scoring zones
        const targetScale = this.getTargetScale();
        
        for (const zone of this.scoringZones) {
            const scaledMaxDistance = zone.maxDistance * targetScale;
            if (distance <= scaledMaxDistance) {
                console.log(`Score calculated: ${zone.points} points (${zone.name}) - Distance: ${distance.toFixed(2)}, Scaled threshold: ${scaledMaxDistance.toFixed(2)}, Scale factor: ${targetScale.toFixed(2)}`);
                return { 
                    points: zone.points, 
                    zone: zone,
                    scaledDistance: scaledMaxDistance,
                    actualDistance: distance,
                    scaleFactor: targetScale
                };
            }
        }
        console.log(`Miss - Distance: ${distance.toFixed(2)}, Scale factor: ${targetScale.toFixed(2)}`);
        return { 
            points: 0, 
            zone: this.scoringZones[this.scoringZones.length - 1],
            scaledDistance: Infinity,
            actualDistance: distance,
            scaleFactor: targetScale
        };
    }
    
    // Get the current target scale factor from the scene manager
    getTargetScale() {
        if (this.sceneManager && this.sceneManager.archeryTarget) {
            // Return the average scale (assuming uniform scaling)
            const scale = this.sceneManager.archeryTarget.scale;
            return (scale.x + scale.y + scale.z) / 3;
        }
        // Default scale if target not available
        return 10.0; // Default scale from scene-manager.js
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
        
        // Update scoring zones display with scaled values
        this.updateScoringZonesDisplay();
        
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
        
        // Update top attempts display
        this.updateTopAttemptsDisplay();
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
        // This method is no longer used after removing Ctrl+T
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
    
    // Individual attempts leaderboard (much simpler than player database)
    loadAttemptsLeaderboard() {
        try {
            const savedLeaderboard = localStorage.getItem('gerf-attempts-leaderboard');
            if (savedLeaderboard) {
                this.attemptsLeaderboard = JSON.parse(savedLeaderboard);
                console.log(`Loaded attempts leaderboard with ${this.attemptsLeaderboard.length} entries`);
                
                // Update displays after loading
                this.updateTopAttemptsDisplay();
            }
        } catch (error) {
            console.error('Error loading attempts leaderboard:', error);
            this.attemptsLeaderboard = [];
        }
    }
    
    saveAttemptsLeaderboard() {
        try {
            localStorage.setItem('gerf-attempts-leaderboard', JSON.stringify(this.attemptsLeaderboard));
        } catch (error) {
            console.error('Error saving attempts leaderboard:', error);
        }
    }
    
    addAttemptToLeaderboard(playerName, roundScore, throws, roundDuration) {
        // Create unique attempt entry
        const attempt = {
            id: `attempt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            playerName: playerName,
            date: new Date().toISOString(),
            totalScore: roundScore,
            throws: throws.map(throw_ => ({
                score: throw_.score,
                zone: throw_.scoringZone?.name || 'Miss',
                distance: throw_.closestDistance
            })),
            duration: roundDuration,
            targetPosition: this.sceneManager ? this.sceneManager.getTargetCenter() : null
        };
        
        // Add to leaderboard
        this.attemptsLeaderboard.push(attempt);
        
        // Keep only the best 1000 attempts to manage storage
        if (this.attemptsLeaderboard.length > 1000) {
            // Sort by score and keep top 1000
            this.attemptsLeaderboard.sort((a, b) => b.totalScore - a.totalScore);
            this.attemptsLeaderboard = this.attemptsLeaderboard.slice(0, 1000);
        }
        
        this.saveAttemptsLeaderboard();
        console.log(`Added attempt: ${playerName} - ${roundScore} points`);
        
        // Update the top attempts display
        this.updateTopAttemptsDisplay();
    }
    
    getLeaderboard(sortBy = 'totalScore', limit = 10) {
        const sortedAttempts = [...this.attemptsLeaderboard].sort((a, b) => {
            switch (sortBy) {
                case 'totalScore':
                    return b.totalScore - a.totalScore;
                case 'date':
                    return new Date(b.date) - new Date(a.date);
                default:
                    return b.totalScore - a.totalScore;
            }
        });
        
        return sortedAttempts.slice(0, limit);
    }
    
    getBestAttemptForPlayer(playerName) {
        const playerAttempts = this.attemptsLeaderboard.filter(
            attempt => attempt.playerName.toLowerCase() === playerName.toLowerCase()
        );
        
        if (playerAttempts.length === 0) return null;
        
        return playerAttempts.reduce((best, current) => 
            current.totalScore > best.totalScore ? current : best
        );
    }
    
    getRecentAttempts(limit = 10) {
        return this.getLeaderboard('date', limit);
    }
    
    exportAttemptsLeaderboard() {
        if (this.attemptsLeaderboard.length === 0) {
            alert('No attempts to export.');
            return;
        }
        
        const exportData = {
            exportDate: new Date().toISOString(),
            totalAttempts: this.attemptsLeaderboard.length,
            topAttempts: this.getLeaderboard('totalScore', 100),
            recentAttempts: this.getRecentAttempts(50),
            allAttempts: this.attemptsLeaderboard
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `gerf-attempts-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        console.log('Attempts leaderboard exported');
    }
    
    clearAttemptsLeaderboard() {
        if (confirm('Are you sure you want to clear all attempts data? This cannot be undone.')) {
            this.attemptsLeaderboard = [];
            this.saveAttemptsLeaderboard();
            this.updateTopAttemptsDisplay();
            console.log('Attempts leaderboard cleared');
        }
    }
    
    showLeaderboard() {
        const topAttempts = this.getLeaderboard('totalScore', 10);
        
        if (topAttempts.length === 0) {
            alert('No attempts recorded yet!');
            return;
        }
        
        let leaderboardText = '🏆 TOP 10 ATTEMPTS - BEST SCORES 🏆\n\n';
        topAttempts.forEach((attempt, index) => {
            const date = new Date(attempt.date).toLocaleDateString();
            const throwScores = attempt.throws.map(t => t.score).join(' + ');
            
            leaderboardText += `${index + 1}. ${attempt.playerName} - ${attempt.totalScore} pts\n`;
            leaderboardText += `   Throws: ${throwScores} | Date: ${date}\n`;
            leaderboardText += `   Best zones: ${attempt.throws.map(t => t.zone).join(', ')}\n\n`;
        });
        
        alert(leaderboardText);
    }
    
    updateTopAttemptsDisplay() {
        if (!this.topAttemptsContainer) return;
        
        const topAttempts = this.getLeaderboard('totalScore', 3);
        
        if (topAttempts.length === 0) {
            this.topAttemptsContainer.innerHTML = '<p class="no-attempts">No attempts yet</p>';
            return;
        }
        
        const placementClasses = ['first-place', 'second-place', 'third-place'];
        const medals = ['🥇', '🥈', '🥉'];
        
        const attemptsHTML = topAttempts.map((attempt, index) => {
            const date = new Date(attempt.date).toLocaleDateString();
            const throwScores = attempt.throws.map(t => t.score).join(' + ');
            
            return `
                <div class="attempt-item ${placementClasses[index]}">
                    <div class="attempt-info">
                        <div class="attempt-player">${medals[index]} ${attempt.playerName}</div>
                        <div class="attempt-score">${attempt.totalScore}</div>
                    </div>
                    <div class="attempt-details">${date}</div>
                    <div class="attempt-throws">${throwScores}</div>
                </div>
            `;
        }).join('');
        
        this.topAttemptsContainer.innerHTML = attemptsHTML;
    }
    
    // One Euro Filter configuration methods
    adjustFilterSmoothness(delta) {
        this.filterConfig.minCutoff = Math.max(0.1, this.filterConfig.minCutoff + delta);
        console.log(`Filter smoothness adjusted. minCutoff: ${this.filterConfig.minCutoff.toFixed(3)}`);
        console.log('Lower values = more smoothing, higher values = less smoothing');
    }
    
    adjustFilterResponsiveness(delta) {
        this.filterConfig.beta = Math.max(0.001, this.filterConfig.beta + delta);
        console.log(`Filter responsiveness adjusted. beta: ${this.filterConfig.beta.toFixed(4)}`);
        console.log('Higher values = more responsive to speed changes');
    }
    
    getFilterConfig() {
        return { ...this.filterConfig };
    }
    
    setFilterConfig(config) {
        this.filterConfig = { ...this.filterConfig, ...config };
        console.log('Filter configuration updated:', this.filterConfig);
    }
    
    exportFilterConfig() {
        const config = {
            filterConfig: this.filterConfig,
            timestamp: new Date().toISOString(),
            description: 'One Euro Filter configuration for GERF-App trajectory smoothing'
        };
        
        const dataStr = JSON.stringify(config, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `gerf-filter-config-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log('Filter configuration exported');
    }
    
    updateScoringZonesDisplay() {
        const targetScale = this.getTargetScale();
        
        // Update the scoring zones text to show scaled distances
        const zoneElements = document.querySelectorAll('.zone-name');
        zoneElements.forEach((element, index) => {
            if (index < this.scoringZones.length - 1) { // Skip the "Miss" zone
                const zone = this.scoringZones[index];
                const scaledDistance = (zone.maxDistance * targetScale).toFixed(1);
                const originalText = element.textContent.split(' (')[0]; // Get zone name without distance
                element.textContent = `${originalText} (≤${scaledDistance})`;
            }
        });
        
        console.log(`Scoring zones UI updated for scale factor: ${targetScale.toFixed(2)}`);
    }
    
    // Public method to refresh scoring zones (called by scene manager when scale changes)
    refreshScoringZones() {
        this.updateScoringZonesDisplay();
    }
} 