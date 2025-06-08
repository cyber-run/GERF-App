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
        
        // Trajectory validation configuration
        this.trajectoryValidation = {
            enabled: true,
            initialPointMaxDistance: 199.0,     // Maximum distance from origin for first valid point
            requireMonotonicDistance: true,     // Require points to be progressively further from origin
            minDistanceIncrease: 1,          // Minimum distance increase between consecutive points
            maxPointsWithoutIncrease: 5,       // Allow a few points without distance increase (for noise)
            lowPassAlpha: 0.3                  // Low-pass filter alpha for initial noise reduction (0.0-1.0)
        };
        
        // Trajectory validation state (reset per throw)
        this.trajectoryState = {
            lowPassBuffer: null,                // Buffer for low-pass filtering
            lastValidDistanceFromOrigin: 0,     // Last accepted distance from origin
            pointsWithoutIncrease: 0,           // Counter for consecutive points without distance increase
            firstValidPointAccepted: false     // Whether we've accepted the first valid point
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
            totalThrows: 0,
            totalTrajectoryDistance: 0,
            averageTrajectoryDistance: 0
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
        this.totalThrowsDisplay = document.getElementById('throw-count');
        this.totalDistanceDisplay = document.getElementById('session-score');
        this.averageDistanceDisplay = document.getElementById('average-distance');
        this.throwHistoryContainer = document.getElementById('throw-history-container');
        
        // New leaderboard panel elements
        this.topAttemptsContainer = document.getElementById('top-attempts-container');
        
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
        this.waitingForNextPlayer = true;
    }
    
    startNewRound(playerName) {
        this.waitingForNextPlayer = false;
        this.throwsInCurrentRound = 0;
        
        // Clear any preview trajectory from unfiltered mode
        if (this.sceneManager) {
            if (this.sceneManager.clearTrajectory) {
                this.sceneManager.clearTrajectory();
            }
            if (this.sceneManager.stopTrajectoryTracking) {
                this.sceneManager.stopTrajectoryTracking();
            }
        }
        
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
        this.updateUI();
    }
    
    addCoordinate(coordinateData) {
        if (!coordinateData || coordinateData.x === undefined || coordinateData.y === undefined || coordinateData.z === undefined) {
            console.log('Invalid coordinate data received:', coordinateData);
            return;
        }
        
        // Handle unfiltered trajectory display when not in a round
        if (this.waitingForNextPlayer || !this.currentRound) {
            console.log('Showing unfiltered trajectory - no active round');
            this.handleUnfilteredTrajectory(coordinateData);
            return;
        }
        
        const currentTime = Date.now();
        console.log(`Coordinate received: (${coordinateData.x}, ${coordinateData.y}, ${coordinateData.z}) - Throw active: ${this.isThrowActive}`);
        
        // Start new throw if not active
        if (!this.isThrowActive) {
            this.startThrow(currentTime);
        }
        
        // Step 1: Apply initial low-pass filter to reduce noise
        const lowPassFiltered = this.applyLowPassFilter(coordinateData);
        
        // Step 2: Validate trajectory point (first point constraint + monotonic distance)
        const validation = this.validateTrajectoryPoint(lowPassFiltered);
        
        // Store all coordinates (including rejected ones) for debugging
        const coordinateEntry = {
            ...coordinateData,              // Original coordinates
            lowPassFiltered: lowPassFiltered, // Low-pass filtered coordinates
            validation: validation,         // Validation result
            throwTime: currentTime - this.throwStartTime,
            timestamp: currentTime
        };
        
        this.currentThrow.coordinates.push(coordinateEntry);
        
        if (!validation.valid) {
            // Store rejected coordinate for debugging
            this.currentThrow.rejectedCoordinates.push({
                ...coordinateEntry,
                rejectionReason: validation.reason
            });
            console.log(`Coordinate REJECTED: ${validation.reason}`);
            return; // Don't process rejected coordinates further
        }
        
        console.log(`Coordinate ACCEPTED: ${validation.reason}`);
        
        // Step 3: Apply One Euro Filter to trajectory-validated coordinates
        let filteredCoordinates = lowPassFiltered;
        if (this.trajectoryFilter) {
            filteredCoordinates = this.trajectoryFilter.filter(lowPassFiltered, currentTime / 1000.0);
            console.log(`One Euro filtered coordinates: (${filteredCoordinates.x.toFixed(2)}, ${filteredCoordinates.y.toFixed(2)}, ${filteredCoordinates.z.toFixed(2)})`);
        }
        
        // Update coordinate entry with final filtered coordinates
        coordinateEntry.filtered = filteredCoordinates;
        
        // Store in valid coordinates array
        this.currentThrow.validCoordinates.push({
            ...coordinateEntry,
            filtered: filteredCoordinates
        });
        
        // Get current target center from scene manager
        const targetCenter = this.sceneManager ? this.sceneManager.getTargetCenter() : 
            (() => { throw new Error('SceneManager not available for target center calculation'); })();
        
        // Calculate distance to target center using final filtered coordinates
        const distance = this.calculateDistance(filteredCoordinates, targetCenter);
        coordinateEntry.distance = distance;
        
        // Update closest distance using final filtered coordinates
        if (distance < this.currentThrow.closestDistance) {
            this.currentThrow.closestDistance = distance;
            this.currentThrow.closestPoint = { ...filteredCoordinates };
            console.log(`New closest point: distance ${distance.toFixed(2)}, final filtered coordinates (${filteredCoordinates.x.toFixed(2)}, ${filteredCoordinates.y.toFixed(2)}, ${filteredCoordinates.z.toFixed(2)})`);
        }
        
        // Use final filtered coordinates for visualization
        this.lastCoordinate = filteredCoordinates;
        
        // Update 3D visualization with final filtered coordinates
        if (this.sceneManager) {
            this.sceneManager.updatePlanePosition(filteredCoordinates);
        }
        

        
        // Reset auto-stop timer
        this.resetAutoStopTimer();
    }
    
    // Handle trajectory display when not in a round (unfiltered)
    handleUnfilteredTrajectory(coordinateData) {
        console.log(`Unfiltered coordinate: (${coordinateData.x.toFixed(2)}, ${coordinateData.y.toFixed(2)}, ${coordinateData.z.toFixed(2)})`);
        
        // Update 3D visualization with raw coordinates (no filtering)
        if (this.sceneManager) {
            this.sceneManager.updatePlanePosition(coordinateData);
        }
        
        // Store as last coordinate for reference
        this.lastCoordinate = coordinateData;
        
        // Start/continue trajectory tracking in scene manager for visual feedback
        if (this.sceneManager) {
            // Ensure trajectory tracking is active for visual feedback
            if (this.sceneManager.startTrajectoryTracking) {
                this.sceneManager.startTrajectoryTracking();
            }
        }
        

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
        
        // Reset trajectory validation state for new throw
        this.resetTrajectoryValidationState();
        
        this.currentThrow = {
            throwNumber: this.throwsInCurrentRound + 1,
            startTime: new Date().toISOString(),
            coordinates: [],
            validCoordinates: [],               // Store only trajectory-validated coordinates
            rejectedCoordinates: [],            // Store rejected coordinates for debugging
            closestDistance: Infinity,
            closestPoint: null,
            score: 0,
            scoringZone: null,
            duration: 0,
            trajectoryDistance: 0               // Total distance traveled during trajectory
        };
        
        console.log(`Throw ${this.currentThrow.throwNumber}/3 started for ${this.currentRound.player}`);
        
        // Start trajectory tracking
        if (this.sceneManager && this.sceneManager.startThrowTrajectory) {
            this.sceneManager.startThrowTrajectory();
        }
    }
    
    resetTrajectoryValidationState() {
        this.trajectoryState.lowPassBuffer = null;
        this.trajectoryState.lastValidDistanceFromOrigin = 0;
        this.trajectoryState.pointsWithoutIncrease = 0;
        this.trajectoryState.firstValidPointAccepted = false;
        console.log('Trajectory validation state reset for new throw');
    }
    
    // Apply low-pass filter to reduce initial noise
    applyLowPassFilter(coordinates) {
        if (!this.trajectoryValidation.enabled) return coordinates;
        
        const alpha = this.trajectoryValidation.lowPassAlpha;
        
        if (!this.trajectoryState.lowPassBuffer) {
            // Initialize buffer with first coordinate
            this.trajectoryState.lowPassBuffer = { ...coordinates };
            return coordinates;
        }
        
        // Apply low-pass filter: y[n] = α * x[n] + (1-α) * y[n-1]
        const filtered = {
            x: alpha * coordinates.x + (1 - alpha) * this.trajectoryState.lowPassBuffer.x,
            y: alpha * coordinates.y + (1 - alpha) * this.trajectoryState.lowPassBuffer.y,
            z: alpha * coordinates.z + (1 - alpha) * this.trajectoryState.lowPassBuffer.z,
            ...coordinates // Preserve other properties
        };
        
        this.trajectoryState.lowPassBuffer = { ...filtered };
        return filtered;
    }
    
    // Validate trajectory point based on distance constraints
    validateTrajectoryPoint(coordinates) {
        if (!this.trajectoryValidation.enabled) return { valid: true, reason: 'validation disabled' };
        
        const origin = { x: 0, y: 0, z: 0 };
        const distanceFromOrigin = this.calculateDistance(coordinates, origin);
        
        // Check first point constraint
        if (!this.trajectoryState.firstValidPointAccepted) {
            if (distanceFromOrigin <= this.trajectoryValidation.initialPointMaxDistance) {
                this.trajectoryState.firstValidPointAccepted = true;
                this.trajectoryState.lastValidDistanceFromOrigin = distanceFromOrigin;
                return { 
                    valid: true, 
                    reason: `first valid point at distance ${distanceFromOrigin.toFixed(2)} (threshold: ${this.trajectoryValidation.initialPointMaxDistance})`,
                    distanceFromOrigin 
                };
            } else {
                return { 
                    valid: false, 
                    reason: `first point too far from origin: ${distanceFromOrigin.toFixed(2)} > ${this.trajectoryValidation.initialPointMaxDistance}`,
                    distanceFromOrigin 
                };
            }
        }
        
        // Check monotonic distance constraint (if enabled)
        if (this.trajectoryValidation.requireMonotonicDistance) {
            const distanceIncrease = distanceFromOrigin - this.trajectoryState.lastValidDistanceFromOrigin;
            
            if (distanceIncrease >= this.trajectoryValidation.minDistanceIncrease) {
                // Good - distance is increasing sufficiently
                this.trajectoryState.lastValidDistanceFromOrigin = distanceFromOrigin;
                this.trajectoryState.pointsWithoutIncrease = 0;
                return { 
                    valid: true, 
                    reason: `distance increased by ${distanceIncrease.toFixed(2)} (min: ${this.trajectoryValidation.minDistanceIncrease})`,
                    distanceFromOrigin 
                };
            } else if (this.trajectoryState.pointsWithoutIncrease < this.trajectoryValidation.maxPointsWithoutIncrease) {
                // Allow some points without increase (for noise tolerance)
                this.trajectoryState.pointsWithoutIncrease++;
                return { 
                    valid: true, 
                    reason: `distance increase ${distanceIncrease.toFixed(2)} below threshold, but within tolerance (${this.trajectoryState.pointsWithoutIncrease}/${this.trajectoryValidation.maxPointsWithoutIncrease})`,
                    distanceFromOrigin 
                };
            } else {
                // Too many consecutive points without distance increase
                return { 
                    valid: false, 
                    reason: `distance increase ${distanceIncrease.toFixed(2)} below threshold for too many consecutive points (${this.trajectoryState.pointsWithoutIncrease}/${this.trajectoryValidation.maxPointsWithoutIncrease})`,
                    distanceFromOrigin 
                };
            }
        }
        
        // If monotonic distance is disabled, accept all points after first valid point
        return { valid: true, reason: 'monotonic distance check disabled', distanceFromOrigin };
    }
    
    endThrow() {
        if (!this.isThrowActive || !this.currentThrow || !this.currentRound) return;
        
        this.isThrowActive = false;
        
        // Clear auto-stop timer
        if (this.autoStopTimeout) {
            clearTimeout(this.autoStopTimeout);
            this.autoStopTimeout = null;
        }
        
        // Clean up trajectory filter and validation state
        if (this.trajectoryFilter) {
            this.trajectoryFilter = null;
            console.log('One Euro Filter cleaned up for completed throw');
        }
        
        // Log trajectory validation statistics
        const trajectoryStats = this.getTrajectoryStats();
        if (trajectoryStats) {
            console.log(`Trajectory validation stats - Total: ${trajectoryStats.totalPoints}, Valid: ${trajectoryStats.validPoints}, Rejected: ${trajectoryStats.rejectedPoints}`);
            if (trajectoryStats.rejectedPoints > 0) {
                console.log(`Rejection rate: ${((trajectoryStats.rejectedPoints / trajectoryStats.totalPoints) * 100).toFixed(1)}%`);
            }
        }
        
        // Finalize throw data
        this.currentThrow.endTime = new Date().toISOString();
        this.currentThrow.duration = Date.now() - this.throwStartTime;
        
        // Calculate trajectory distance using valid coordinates (filtered trajectory)
        this.currentThrow.trajectoryDistance = this.calculateTrajectoryDistance(this.currentThrow.validCoordinates);
        
        // Calculate final score (zone points + trajectory distance)
        const scoringResult = this.calculateScore(this.currentThrow.closestDistance);
        const zonePoints = scoringResult.points;
        const totalScore = Math.round(zonePoints + this.currentThrow.trajectoryDistance);
        
        this.currentThrow.score = totalScore;
        this.currentThrow.zonePoints = zonePoints; // Store original zone points separately
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
        
        console.log(`Throw ${this.currentThrow.throwNumber}/3 completed: ${this.currentThrow.score} points (${zonePoints} zone + ${this.currentThrow.trajectoryDistance.toFixed(2)} distance) - ${scoringResult.zone.name}`);
        console.log(`Round total so far: ${this.currentRound.totalScore} points`);
        
        // Check if round is complete
        if (this.throwsInCurrentRound >= this.maxThrowsPerRound) {
            this.completeRound();
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
        
        this.updateUI();
        
        console.log('Round completed, waiting for next player - unfiltered preview mode active');
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
    
    calculateTrajectoryDistance(coordinates) {
        if (!coordinates || coordinates.length < 2) return 0;
        
        let totalDistance = 0;
        for (let i = 1; i < coordinates.length; i++) {
            totalDistance += this.calculateDistance(coordinates[i - 1], coordinates[i]);
        }
        
        return totalDistance;
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
        this.sessionStats.totalThrows = this.roundHistory.reduce((sum, round) => sum + round.throws.length, 0);
        this.sessionStats.totalTrajectoryDistance = this.roundHistory.reduce((sum, round) => 
            sum + round.throws.reduce((throwSum, throw_) => throwSum + (throw_.trajectoryDistance || 0), 0), 0);
        
        this.sessionStats.averageTrajectoryDistance = this.sessionStats.totalThrows > 0 ? 
            this.sessionStats.totalTrajectoryDistance / this.sessionStats.totalThrows : 0;
    }
    
    updateUI() {
        // Update throw count
        if (this.totalThrowsDisplay) {
            this.totalThrowsDisplay.textContent = this.sessionStats.totalThrows;
        }
        
        // Update total trajectory distance
        if (this.totalDistanceDisplay) {
            this.totalDistanceDisplay.textContent = this.sessionStats.totalTrajectoryDistance.toFixed(1);
        }
        
        // Update average trajectory distance
        if (this.averageDistanceDisplay) {
            this.averageDistanceDisplay.textContent = this.sessionStats.averageTrajectoryDistance.toFixed(1);
        }
        
        // Update round history display
        this.updateRoundHistoryDisplay();
        
        // Update top attempts display
        this.updateTopAttemptsDisplay();
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
        const zonePoints = result.zonePoints || 0;
        const trajectoryPoints = Math.round(result.trajectoryDistance || 0);
        const message = `Throw ${result.throwNumber}/3: ${result.score} points\n${zonePoints} (${result.scoringZone?.name || 'Miss'}) + ${trajectoryPoints} (distance)`;
        
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
            text-align: center;
            white-space: pre-line;
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
                totalThrows: 0,
                totalTrajectoryDistance: 0,
                averageTrajectoryDistance: 0
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
                zonePoints: throw_.zonePoints || 0,
                zone: throw_.scoringZone?.name || 'Miss',
                distance: throw_.closestDistance,
                trajectoryDistance: throw_.trajectoryDistance || 0
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
            return `
                <div class="attempt-item ${placementClasses[index]} compact">
                    <div class="attempt-info">
                        <div class="attempt-player">${medals[index]} ${attempt.playerName}</div>
                        <div class="attempt-score">${attempt.totalScore}</div>
                    </div>
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
    
    // Trajectory validation configuration methods
    adjustInitialPointThreshold(delta) {
        this.trajectoryValidation.initialPointMaxDistance = Math.max(5.0, this.trajectoryValidation.initialPointMaxDistance + delta);
        console.log(`Initial point threshold adjusted: ${this.trajectoryValidation.initialPointMaxDistance.toFixed(1)}`);
        console.log('Lower values = stricter first point validation');
    }
    
    adjustMinDistanceIncrease(delta) {
        this.trajectoryValidation.minDistanceIncrease = Math.max(0.1, this.trajectoryValidation.minDistanceIncrease + delta);
        console.log(`Minimum distance increase adjusted: ${this.trajectoryValidation.minDistanceIncrease.toFixed(2)}`);
        console.log('Higher values = stricter monotonic constraint');
    }
    
    adjustLowPassAlpha(delta) {
        this.trajectoryValidation.lowPassAlpha = Math.max(0.1, Math.min(1.0, this.trajectoryValidation.lowPassAlpha + delta));
        console.log(`Low-pass filter alpha adjusted: ${this.trajectoryValidation.lowPassAlpha.toFixed(2)}`);
        console.log('Higher values = less smoothing, lower values = more smoothing');
    }
    
    toggleTrajectoryValidation() {
        this.trajectoryValidation.enabled = !this.trajectoryValidation.enabled;
        console.log(`Trajectory validation ${this.trajectoryValidation.enabled ? 'enabled' : 'disabled'}`);
        return this.trajectoryValidation.enabled;
    }
    
    toggleMonotonicDistance() {
        this.trajectoryValidation.requireMonotonicDistance = !this.trajectoryValidation.requireMonotonicDistance;
        console.log(`Monotonic distance constraint ${this.trajectoryValidation.requireMonotonicDistance ? 'enabled' : 'disabled'}`);
        return this.trajectoryValidation.requireMonotonicDistance;
    }
    
    getTrajectoryValidationConfig() {
        return { ...this.trajectoryValidation };
    }
    
    setTrajectoryValidationConfig(config) {
        this.trajectoryValidation = { ...this.trajectoryValidation, ...config };
        console.log('Trajectory validation configuration updated:', this.trajectoryValidation);
    }
    
    // Get trajectory validation statistics for current throw
    getTrajectoryStats() {
        if (!this.currentThrow) return null;
        
        return {
            totalPoints: this.currentThrow.coordinates.length,
            validPoints: this.currentThrow.validCoordinates ? this.currentThrow.validCoordinates.length : 0,
            rejectedPoints: this.currentThrow.rejectedCoordinates ? this.currentThrow.rejectedCoordinates.length : 0,
            firstValidPointAccepted: this.trajectoryState.firstValidPointAccepted,
            lastValidDistanceFromOrigin: this.trajectoryState.lastValidDistanceFromOrigin
        };
    }
    
    exportFilterConfig() {
        const config = {
            filterConfig: this.filterConfig,
            trajectoryValidation: this.trajectoryValidation,
            timestamp: new Date().toISOString(),
            description: 'GERF-App filtering configuration: One Euro Filter + Trajectory Validation'
        };
        
        const dataStr = JSON.stringify(config, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `gerf-filter-config-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log('Complete filter configuration exported (One Euro + Trajectory Validation)');
    }
    

} 