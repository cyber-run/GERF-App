// 3D Scene Management
class SceneManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.plane = null;
        this.archeryTarget = null;
        this.starfield = null;
        
        // Plane movement tracking
        this.previousPlanePosition = null;
        
        // Archery target center (fixed position - no offset needed)
        this.targetCenter = { x: -60, y: 80, z: 60 };
        
        // Transform controls for target manipulation
        this.transformControls = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isTransformActive = false;
        
        // Camera controls
        this.orbitControls = null;
        this.showStarfield = true;
        
        // Trajectory tracking
        this.trajectoryPoints = [];
        this.trajectoryLine = null;
        this.isTrackingTrajectory = false;
        this.maxTrajectoryPoints = 50; // Limit trail length
        this.trajectoryUpdateInterval = 100; // Update every 50ms
        this.lastTrajectoryUpdate = 0;
        
        this.init();
    }
    
    init() {
        // Scene
        this.scene = new THREE.Scene();
        
        // Create starfield background
        this.createStarfield();

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        // Initial camera position - will be updated when target loads
        this.camera.position.set(150, 100, 150);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true // Enable transparency
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0); // Transparent background
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.getElementById('container').appendChild(this.renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
        
        // Add spotlight focused on target area
        this.targetSpotlight = new THREE.SpotLight(0xffffff, 1.5);
        this.targetSpotlight.position.set(-20, 120, 100); // Position above and in front of target
        this.targetSpotlight.angle = Math.PI / 6; // 30 degree cone
        this.targetSpotlight.penumbra = 0.3; // Soft edges
        this.targetSpotlight.decay = 1;
        this.targetSpotlight.distance = 200;
        this.targetSpotlight.castShadow = true;
        this.targetSpotlight.shadow.mapSize.width = 1024;
        this.targetSpotlight.shadow.mapSize.height = 1024;
        this.scene.add(this.targetSpotlight);
        
        // Store lights for later updates
        this.directionalLight = directionalLight;
        this.ambientLight = ambientLight;

        // Load models
        this.loadModels();

        // Add coordinate system helper (smaller and thicker)
        const axesHelper = new THREE.AxesHelper(25);
        axesHelper.material.linewidth = 3; // Make lines thicker
        this.scene.add(axesHelper);

        // Add grid shifted down in Y plane
        const gridHelper = new THREE.GridHelper(200, 20, 0x888888, 0x444444);
        gridHelper.position.y = -100; // Shift grid down to -100
        this.scene.add(gridHelper);

        // Initialize simple orbit controls
        this.initializeOrbitControls();

        // Initialize keyboard controls
        this.initializeKeyboardControls();

        // Initialize transform controls for target manipulation
        this.initializeTransformControls();

        // Start render loop
        this.animate();
    }
    
    createStarfield() {
        const starGeometry = new THREE.BufferGeometry();
        const starCount = 800;
        const positions = new Float32Array(starCount * 3);
        
        for (let i = 0; i < starCount * 3; i += 3) {
            positions[i] = (Math.random() - 0.5) * 2000;     // x
            positions[i + 1] = (Math.random() - 0.5) * 2000; // y
            positions[i + 2] = (Math.random() - 0.5) * 2000; // z
        }
        
        starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const starMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 2,
            sizeAttenuation: false
        });
        
        this.starfield = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(this.starfield);
    }
    
    initializeOrbitControls() {
        this.orbitControls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.25;
    }
    
    loadModels() {
        const loader = new THREE.GLTFLoader();

        // Load paper plane
        loader.load('models/Paper Plane.glb', (gltf) => {
            this.plane = gltf.scene;
            this.plane.scale.set(100, 100, 100);
            this.plane.position.set(0, 0, 0);
            this.plane.castShadow = true;
            this.scene.add(this.plane);
            console.log('Paper plane loaded successfully');
        }, undefined, (error) => {
            console.error('Error loading paper plane:', error);
        });

        // Load archery target
        loader.load('models/archery_targret.glb', (gltf) => {
            this.archeryTarget = gltf.scene;
            this.archeryTarget.scale.set(10, 10, 10);
            this.archeryTarget.position.set(-60, 80, 60);
            // Rotate 90 degrees around Y-axis (green axis)
            this.archeryTarget.rotation.set(0, Math.PI/2, 0);
            this.archeryTarget.castShadow = true;
            this.archeryTarget.receiveShadow = true;
            
            this.scene.add(this.archeryTarget);
            
            // Load saved target settings if they exist
            if (!this.loadTargetSettings()) {
                console.log('No saved target settings found, using defaults');
            }
            
            // Update lighting to focus on target
            this.updateTargetLighting();
            
            // Update camera to look towards target from behind origin
            this.updateCameraToTargetView();
            
            console.log('Archery target loaded successfully');
        }, undefined, (error) => {
            console.error('Error loading archery target:', error);
        });
    }
    
    updatePlanePosition(data) {
        if (this.plane && data.x !== undefined && data.y !== undefined && data.z !== undefined) {
            const newPosition = new THREE.Vector3(data.x, data.y, data.z);
            
            // Calculate movement direction if we have a previous position
            if (this.previousPlanePosition) {
                const direction = new THREE.Vector3();
                direction.subVectors(newPosition, this.previousPlanePosition);
                
                // Only update orientation if there's significant movement
                if (direction.length() > 0.1) {
                    direction.normalize();
                    
                    // Calculate the target position for lookAt (current position + direction)
                    const lookAtTarget = new THREE.Vector3();
                    lookAtTarget.addVectors(newPosition, direction);
                    
                    // Orient the plane to face the direction of movement
                    this.plane.lookAt(lookAtTarget);
                    
                    // Correct the plane's orientation - rotate 180 degrees around Y-axis
                    // This compensates for the model's default orientation
                    this.plane.rotateY(-Math.PI/2);
                }
            }
            
            // Update plane position
            this.plane.position.copy(newPosition);
            
            // Add point to trajectory if tracking
            this.addTrajectoryPoint(newPosition);
            
            // Store current position as previous for next update
            this.previousPlanePosition = newPosition.clone();
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Update orbit controls
        if (this.orbitControls) {
            this.orbitControls.update();
        }
        
        // Rotate starfield slowly
        if (this.starfield && this.showStarfield) {
            this.starfield.rotation.y += 0.0001;
            this.starfield.rotation.x += 0.00005;
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    // Scoring system visual feedback methods
    highlightClosestPoint(point, scoringZone) {
        // Remove previous highlight if it exists
        this.removeClosestPointHighlight();
        
        // Create a larger, more prominent sphere to mark the closest point
        const geometry = new THREE.SphereGeometry(4, 20, 20); // Increased size from 2 to 4
        const material = new THREE.MeshBasicMaterial({
            color: scoringZone.color,
            transparent: true,
            opacity: 0.95, // Increased opacity from 0.8 to 0.95
            emissive: scoringZone.color, // Add glow effect
            emissiveIntensity: 0.2 // Subtle glow
        });
        
        this.closestPointMarker = new THREE.Mesh(geometry, material);
        this.closestPointMarker.position.set(point.x, point.y, point.z);
        this.scene.add(this.closestPointMarker);
        
        // Add pulsing animation
        this.animateClosestPointMarker();
        
        // Create a line from the closest point to the target center
        this.createDistanceLine(point);
        
        console.log(`Highlighted closest point at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}) - ${scoringZone.name}`);
    }
    
    removeClosestPointHighlight() {
        if (this.closestPointMarker) {
            this.scene.remove(this.closestPointMarker);
            this.closestPointMarker = null;
        }
        
        if (this.distanceLine) {
            this.scene.remove(this.distanceLine);
            this.distanceLine = null;
        }
    }
    
    animateClosestPointMarker() {
        if (!this.closestPointMarker) return;
        
        const startTime = Date.now();
        const duration = 3000; // 3 seconds
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress >= 1.0) {
                // Animation complete, remove marker
                this.removeClosestPointHighlight();
                return;
            }
            
            if (this.closestPointMarker) {
                // More dramatic pulsing scale effect
                const scale = 1 + Math.sin(progress * Math.PI * 8) * 0.5; // Increased from 6 to 8 pulses, 0.3 to 0.5 amplitude
                this.closestPointMarker.scale.setScalar(scale);
                
                // Slower fade out to keep it visible longer
                const opacity = 0.95 * (1 - progress * 0.7); // Slower fade, starts from 0.95
                this.closestPointMarker.material.opacity = opacity;
                
                // Animate glow intensity
                const glowIntensity = 0.2 + Math.sin(progress * Math.PI * 10) * 0.15;
                this.closestPointMarker.material.emissiveIntensity = glowIntensity;
                
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    createDistanceLine(point) {
        // Calculate the forward offset position (same as scoring zones)
        const localForwardOffset = new THREE.Vector3(0, 0, 0.2); // Same as scoring zones
        
        // Transform the local offset to world coordinates using the target's transformation
        const targetForwardPosition = new THREE.Vector3();
        if (this.archeryTarget) {
            // Apply target's transformation to the local offset
            targetForwardPosition.copy(localForwardOffset);
            targetForwardPosition.applyMatrix4(this.archeryTarget.matrixWorld);
        } else {
            // Fallback to basic target center if target not available
            const center = this.getTargetCenter();
            targetForwardPosition.set(center.x, center.y, center.z + 0.2);
        }
        
        const closestPoint = new THREE.Vector3(point.x, point.y, point.z);
        
        const geometry = new THREE.BufferGeometry().setFromPoints([closestPoint, targetForwardPosition]);
        const material = new THREE.LineBasicMaterial({
            color: 0x00ffff, // Changed from white to bright cyan for better visibility
            transparent: true,
            opacity: 0.9, // Increased opacity from 0.6 to 0.9
            linewidth: 4 // Increased linewidth from 2 to 4 (limited support in WebGL)
        });
        
        this.distanceLine = new THREE.Line(geometry, material);
        this.scene.add(this.distanceLine);
        
        console.log(`Distance line created from closest point to target forward position (offset by 0.2 units)`);
    }
    
    createScoringZoneIndicators() {
        // Remove existing indicators
        this.removeScoringZoneIndicators();
        
        // Position zones relative to target's local coordinate system (0,0,0)
        const localCenter = new THREE.Vector3(0, 0, 0.2); // Forward in target's local Z direction
        
        // Use global scoring zone configuration (excluding Miss zone for visual rings)
        const baseScoringZones = window.GERF_CONFIG.scoringZones.slice(0, -1).map(zone => ({
            name: zone.name,
            maxDistance: zone.maxDistance,
            color: zone.colorHex,
            opacity: zone.opacity
        }));
        
        // Since rings will be children of the target, they will automatically scale with it.
        // The ring radii should match the mathematical distance values used in scoring calculation.
        // No conversion needed - use the maxDistance values directly as local coordinates.
        const localScoringSizes = baseScoringZones.map(zone => ({
            ...zone,
            radius: zone.maxDistance // Use scoring distances directly as local coordinates
        }));
        
        this.scoringZoneIndicators = [];
        
        localScoringSizes.forEach((zone, index) => {
            // Create ring geometry
            const geometry = new THREE.RingGeometry(
                index === 0 ? 0 : localScoringSizes[index - 1].radius,
                zone.radius,
                32
            );
            
            const material = new THREE.MeshBasicMaterial({
                color: zone.color,
                transparent: true,
                opacity: zone.opacity,
                side: THREE.DoubleSide,
                depthTest: false // Disable depth testing to ensure visibility
            });
            
            const ring = new THREE.Mesh(geometry, material);
            ring.position.copy(localCenter);
            // No additional rotation needed - rings inherit target's rotation as child objects
            
            // Add as child of target - this makes them scale automatically with the target!
            this.archeryTarget.add(ring);
            this.scoringZoneIndicators.push(ring);
        });
        
        console.log('Scoring zone indicators created (attached to target, will scale automatically)');
        console.log('Zone radii in target-local space:', localScoringSizes.map(z => `${z.name}: ${z.radius.toFixed(2)}`));
    }
    
    removeScoringZoneIndicators() {
        if (this.scoringZoneIndicators && this.archeryTarget) {
            this.scoringZoneIndicators.forEach(indicator => {
                this.archeryTarget.remove(indicator);
            });
            this.scoringZoneIndicators = [];
        }
    }
    
    toggleScoringZoneIndicators() {
        if (this.scoringZoneIndicators && this.scoringZoneIndicators.length > 0) {
            this.removeScoringZoneIndicators();
        } else {
            this.createScoringZoneIndicators();
        }
    }
    
    // Enhanced keyboard controls
    initializeKeyboardControls() {
        document.addEventListener('keydown', (event) => {
            // Ignore keyboard shortcuts when user is typing in input fields
            const activeElement = document.activeElement;
            if (activeElement && (
                activeElement.tagName === 'INPUT' || 
                activeElement.tagName === 'TEXTAREA' || 
                activeElement.contentEditable === 'true'
            )) {
                return;
            }
            
            switch(event.key.toLowerCase()) {
                case 'z':
                    // Toggle scoring zone indicators
                    this.toggleScoringZoneIndicators();
                    break;
                case 'delete':
                case 'backspace':
                    // Reset target settings to defaults
                    if (this.transformControls.object) {
                        this.resetTargetSettings();
                    }
                    break;
                case 't':
                    if (!event.ctrlKey && !event.metaKey) {
                        // Switch to translate mode
                        if (this.transformControls.object) {
                            this.transformControls.setMode('translate');
                            console.log('Transform mode: Translate');
                        }
                    }
                    break;
                case 'r':
                    if (!event.ctrlKey && !event.metaKey) {
                        // Switch to rotate mode or reset camera if no object selected
                        if (this.transformControls.object) {
                            this.transformControls.setMode('rotate');
                            console.log('Transform mode: Rotate');
                        } else {
                            // Reset camera position to behind origin relative to target
                            this.updateCameraToTargetView();
                            console.log('Camera position reset to target view');
                        }
                    }
                    break;
                case 's':
                    if (!event.ctrlKey && !event.metaKey) {
                        // Switch to scale mode or toggle starfield if no object selected
                        if (this.transformControls.object) {
                            this.transformControls.setMode('scale');
                            console.log('Transform mode: Scale (uniform)');
                        } else {
                            // Toggle starfield (existing functionality)
                            this.showStarfield = !this.showStarfield;
                            this.starfield.visible = this.showStarfield;
                            console.log(`Starfield ${this.showStarfield ? 'enabled' : 'disabled'}`);
                        }
                    }
                    break;
            }
        });
    }
    
    // Archery target center calibration methods
    getTargetCenter() {
        return {
            x: this.targetCenter.x,
            y: this.targetCenter.y,
            z: this.targetCenter.z
        };
    }
    
    // Target settings persistence methods
    saveTargetSettings() {
        if (!this.archeryTarget) return;
        
        const settings = {
            position: {
                x: this.archeryTarget.position.x,
                y: this.archeryTarget.position.y,
                z: this.archeryTarget.position.z
            },
            rotation: {
                x: this.archeryTarget.rotation.x,
                y: this.archeryTarget.rotation.y,
                z: this.archeryTarget.rotation.z
            },
            scale: {
                x: this.archeryTarget.scale.x,
                y: this.archeryTarget.scale.y,
                z: this.archeryTarget.scale.z
            },
            targetCenter: {
                x: this.targetCenter.x,
                y: this.targetCenter.y,
                z: this.targetCenter.z
            }
        };
        
        localStorage.setItem('gerf-target-settings', JSON.stringify(settings));
        console.log('Target settings saved automatically');
    }
    
    // Update lighting to focus on target
    updateTargetLighting() {
        if (!this.archeryTarget || !this.targetSpotlight) return;
        
        const targetPos = this.archeryTarget.position;
        
        // Update spotlight target
        this.targetSpotlight.target.position.copy(targetPos);
        this.targetSpotlight.target.updateMatrixWorld();
        
        // Update directional light to illuminate from above and slightly behind
        const offset = new THREE.Vector3(40, 60, -30);
        this.directionalLight.position.copy(targetPos).add(offset);
        this.directionalLight.target.position.copy(targetPos);
        this.directionalLight.target.updateMatrixWorld();
        
        console.log('Lighting updated to focus on target');
    }
    
    // Update camera to position behind origin relative to target
    updateCameraToTargetView() {
        if (!this.archeryTarget) return;
        
        const targetPos = this.archeryTarget.position;
        
        // Calculate direction from origin to target
        const targetDirection = new THREE.Vector3(
            targetPos.x,
            targetPos.y, 
            targetPos.z
        );
        
        // Position camera in opposite direction from origin (behind origin relative to target)
        const cameraDistance = 0.6; // Scale factor for camera distance
        const behindOriginPosition = new THREE.Vector3(
            -targetDirection.x * cameraDistance + 50, // Add positive X offset (red axis direction)
            -targetDirection.y * cameraDistance + 60, // Increased height offset for better viewing
            -targetDirection.z * cameraDistance
        );
        
        // Update camera position
        this.camera.position.copy(behindOriginPosition);
        
        // Make camera look at the target
        this.camera.lookAt(targetPos);
        
        // Update orbit controls target to focus on target
        if (this.orbitControls) {
            this.orbitControls.target.copy(targetPos);
            this.orbitControls.update();
        }
        
        console.log('Camera positioned behind origin relative to target');
    }
    
    loadTargetSettings() {
        const savedSettings = localStorage.getItem('gerf-target-settings');
        if (!savedSettings || !this.archeryTarget) return false;
        
        try {
            const settings = JSON.parse(savedSettings);
            
            // Apply position
            this.archeryTarget.position.set(
                settings.position.x,
                settings.position.y,
                settings.position.z
            );
            
            // Apply rotation
            this.archeryTarget.rotation.set(
                settings.rotation.x,
                settings.rotation.y,
                settings.rotation.z
            );
            
            // Apply scale
            this.archeryTarget.scale.set(
                settings.scale.x,
                settings.scale.y,
                settings.scale.z
            );
            
            // Update target center
            this.targetCenter.x = settings.targetCenter.x;
            this.targetCenter.y = settings.targetCenter.y;
            this.targetCenter.z = settings.targetCenter.z;
            
            // Update lighting to focus on new target position
            this.updateTargetLighting();
            
            // Update camera to new target position
            this.updateCameraToTargetView();
            
            console.log('Target settings loaded from previous session');
            return true;
        } catch (error) {
            console.warn('Failed to load target settings:', error);
            return false;
        }
    }
    
    resetTargetSettings() {
        if (!this.archeryTarget) return;
        
        // Reset to default values
        this.archeryTarget.position.set(-60, 80, 60);
        this.archeryTarget.rotation.set(0, Math.PI/2, 0);
        this.archeryTarget.scale.set(50, 50, 50);
        
        // Update target center
        this.targetCenter.x = -60;
        this.targetCenter.y = 80;
        this.targetCenter.z = 60;
        
        // Update lighting to focus on reset position
        this.updateTargetLighting();
        
        // Update camera to reset position
        this.updateCameraToTargetView();
        
        // Save the reset settings
        this.saveTargetSettings();
        console.log('Target settings reset to defaults');
    }
    
    // Initialize transform controls for target manipulation
    initializeTransformControls() {
        this.transformControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        this.scene.add(this.transformControls);
        
        // Set to local space so arrows follow object orientation
        this.transformControls.setSpace('local');
        
        // Track previous scale for uniform scaling detection
        this.previousTargetScale = null;
        
        // Disable orbit controls when transforming
        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.isTransformActive = event.value;
            if (this.orbitControls) {
                this.orbitControls.enabled = !event.value;
            }
            
            // Store initial scale when starting to drag
            if (event.value && this.archeryTarget && this.transformControls.object === this.archeryTarget) {
                this.previousTargetScale = {
                    x: this.archeryTarget.scale.x,
                    y: this.archeryTarget.scale.y,
                    z: this.archeryTarget.scale.z
                };
            }
        });
        
        // Handle object changes - enforce uniform scaling and update target center
        this.transformControls.addEventListener('objectChange', () => {
            if (this.archeryTarget && this.transformControls.object === this.archeryTarget) {
                // Enforce uniform scaling when in scale mode
                if (this.transformControls.mode === 'scale' && this.previousTargetScale) {
                    const currentScale = this.archeryTarget.scale;
                    const prevScale = this.previousTargetScale;
                    
                    // Calculate which axis changed the most (by ratio)
                    const ratioX = currentScale.x / prevScale.x;
                    const ratioY = currentScale.y / prevScale.y;
                    const ratioZ = currentScale.z / prevScale.z;
                    
                    // Find the axis with the largest change from 1.0
                    const deltaX = Math.abs(ratioX - 1.0);
                    const deltaY = Math.abs(ratioY - 1.0);
                    const deltaZ = Math.abs(ratioZ - 1.0);
                    
                    let targetRatio;
                    if (deltaX >= deltaY && deltaX >= deltaZ) {
                        targetRatio = ratioX;
                    } else if (deltaY >= deltaZ) {
                        targetRatio = ratioY;
                    } else {
                        targetRatio = ratioZ;
                    }
                    
                    // Apply uniform scaling based on the most changed axis
                    const newUniformScale = prevScale.x * targetRatio;
                    currentScale.setScalar(newUniformScale);
                    
                    // Update previous scale for next iteration
                    this.previousTargetScale = {
                        x: currentScale.x,
                        y: currentScale.y,
                        z: currentScale.z
                    };
                    
                    // Refresh scoring zone indicators with new scale
                    if (this.scoringZoneIndicators && this.scoringZoneIndicators.length > 0) {
                        // Remove and recreate indicators to ensure proper scaling
                        this.removeScoringZoneIndicators();
                        this.createScoringZoneIndicators();
                    }
                    
                    // Update throw manager's scoring zones display
                    if (window.throwManager && window.throwManager.refreshScoringZones) {
                        window.throwManager.refreshScoringZones();
                    }
                    
                    console.log(`Target scale updated: ${newUniformScale.toFixed(2)}x (ratio: ${targetRatio.toFixed(3)})`);
                }
                
                // Update target center when position changes
                if (this.transformControls.mode === 'translate') {
                    this.targetCenter.x = this.archeryTarget.position.x;
                    this.targetCenter.y = this.archeryTarget.position.y;
                    this.targetCenter.z = this.archeryTarget.position.z;
                    
                    // Update lighting to follow target
                    this.updateTargetLighting();
                    
                    // Update camera to follow target position
                    this.updateCameraToTargetView();
                }
                
                // Auto-save settings after any transformation
                this.saveTargetSettings();
            }
        });
        
        // Click handling for target selection
        this.renderer.domElement.addEventListener('click', (event) => {
            if (this.isTransformActive) return;
            
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            
            this.raycaster.setFromCamera(this.mouse, this.camera);
            
            if (this.archeryTarget) {
                const intersects = this.raycaster.intersectObject(this.archeryTarget, true);
                
                if (intersects.length > 0) {
                    this.transformControls.attach(this.archeryTarget);
                    console.log('Target selected - use T/R/S keys to switch transform modes, or click elsewhere to deselect');
                    console.log('Transform space: LOCAL (controls follow object orientation)');
                } else {
                    this.transformControls.detach();
                }
            }
        });
    }
    
    // Trajectory tracking methods
    startTrajectoryTracking() {
        this.isTrackingTrajectory = true;
        this.trajectoryPoints = [];
        this.lastTrajectoryUpdate = Date.now();
        this.removeTrajectoryLine();
        console.log('Trajectory tracking started');
    }
    
    stopTrajectoryTracking() {
        this.isTrackingTrajectory = false;
        console.log('Trajectory tracking stopped');
    }
    
    clearTrajectory() {
        this.trajectoryPoints = [];
        this.removeTrajectoryLine();
        console.log('Trajectory cleared');
    }
    
    addTrajectoryPoint(position) {
        if (!this.isTrackingTrajectory) return;
        
        const now = Date.now();
        if (now - this.lastTrajectoryUpdate < this.trajectoryUpdateInterval) return;
        
        this.trajectoryPoints.push(position.clone());
        
        // Limit trajectory length
        if (this.trajectoryPoints.length > this.maxTrajectoryPoints) {
            this.trajectoryPoints.shift();
        }
        
        this.updateTrajectoryLine();
        this.lastTrajectoryUpdate = now;
    }
    
    updateTrajectoryLine() {
        if (this.trajectoryPoints.length < 2) return;
        
        // Remove existing line
        this.removeTrajectoryLine();
        
        // Create dotted line geometry
        const geometry = new THREE.BufferGeometry().setFromPoints(this.trajectoryPoints);
        
        // Create dashed line material
        const material = new THREE.LineDashedMaterial({
            color: 0x00ff88,
            linewidth: 3,
            scale: 1,
            dashSize: 3,
            gapSize: 2,
            transparent: true,
            opacity: 0.8
        });
        
        this.trajectoryLine = new THREE.Line(geometry, material);
        this.trajectoryLine.computeLineDistances(); // Required for dashed lines
        this.scene.add(this.trajectoryLine);
    }
    
    removeTrajectoryLine() {
        if (this.trajectoryLine) {
            this.scene.remove(this.trajectoryLine);
            this.trajectoryLine.geometry.dispose();
            this.trajectoryLine.material.dispose();
            this.trajectoryLine = null;
        }
    }
    
    // Public methods for throw integration
    startThrowTrajectory() {
        this.startTrajectoryTracking();
    }
    
    endThrowTrajectory() {
        this.stopTrajectoryTracking();
        // Keep trajectory visible for a few seconds after throw ends
        setTimeout(() => {
            if (!this.isTrackingTrajectory) {
                this.clearTrajectory();
            }
        }, 5000); // Clear after 5 seconds
    }

    // Download current target position as JSON for server use
    downloadTargetPosition() {
        const targetData = {
            target_position: {
                x: this.targetCenter.x,
                y: this.targetCenter.y,
                z: this.targetCenter.z
            },
            exported_at: new Date().toISOString(),
            coordinate_system: "GERF_world_coordinates",
            notes: "Target center position for linear trajectory - place in server directory"
        };

        const dataStr = JSON.stringify(targetData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = 'target_position.json';
        link.click();
        
        console.log('Target position downloaded:', targetData.target_position);
        console.log('Place target_position.json in server directory to use custom target location');
    }
} 