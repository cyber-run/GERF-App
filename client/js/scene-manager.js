// 3D Scene Management
class SceneManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.plane = null;
        this.dartboard = null;
        this.starfield = null;
        
        // Plane movement tracking
        this.previousPlanePosition = null;
        
        // Dartboard center calibration
        this.dartboardBaseCenter = { x: -60, y: 80, z: 0 }; // From server config
        this.dartboardOffset = { x: 0.5, y: -12, z: 0.0 }; // Calibrated offset for current model scale
        this.dartboardCenterMarker = null;
        this.showCenterMarker = true;
        
        // Load saved calibration if available
        this.loadDartboardCalibration();
        
        // Mouse controls
        this.mouseX = 0;
        this.mouseY = 0;
        this.isMouseDown = false;
        this.cameraDistance = 200;
        this.cameraHeight = 100;
        this.cameraAngle = 0;
        this.cameraVerticalAngle = 0;
        this.showStarfield = true;
        
        // Mouse control sensitivity
        this.mouseSensitivity = 0.005;
        this.zoomSensitivity = 10;
        
        this.init();
    }
    
    init() {
        // Scene
        this.scene = new THREE.Scene();
        
        // Create starfield background
        this.createStarfield();

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.updateCameraPosition();

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

        // Load models
        this.loadModels();

        // Add coordinate system helper
        const axesHelper = new THREE.AxesHelper(50);
        this.scene.add(axesHelper);

        // Add grid
        const gridHelper = new THREE.GridHelper(200, 20, 0x888888, 0x444444);
        this.scene.add(gridHelper);

        // Initialize mouse controls
        this.initializeMouseControls();

        // Initialize keyboard controls
        this.initializeKeyboardControls();

        // Create dartboard center marker by default
        this.createDartboardCenterMarker();

        // Start render loop
        this.animate();
    }
    
    createStarfield() {
        const starGeometry = new THREE.BufferGeometry();
        const starCount = 2000;
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
    
    initializeMouseControls() {
        const canvas = this.renderer.domElement;
        
        // Mouse move for camera rotation
        canvas.addEventListener('mousemove', (event) => {
            if (this.isMouseDown) {
                const deltaX = event.clientX - this.mouseX;
                const deltaY = event.clientY - this.mouseY;
                
                this.cameraAngle -= deltaX * this.mouseSensitivity;
                this.cameraVerticalAngle -= deltaY * this.mouseSensitivity;
                
                // Clamp vertical angle
                this.cameraVerticalAngle = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, this.cameraVerticalAngle));
                
                this.updateCameraPosition();
            }
            
            this.mouseX = event.clientX;
            this.mouseY = event.clientY;
        });
        
        // Mouse down/up for drag control
        canvas.addEventListener('mousedown', (event) => {
            this.isMouseDown = true;
            this.mouseX = event.clientX;
            this.mouseY = event.clientY;
            canvas.style.cursor = 'grabbing';
        });
        
        canvas.addEventListener('mouseup', () => {
            this.isMouseDown = false;
            canvas.style.cursor = 'grab';
        });
        
        canvas.addEventListener('mouseleave', () => {
            this.isMouseDown = false;
            canvas.style.cursor = 'grab';
        });
        
        // Mouse wheel for zoom
        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            this.cameraDistance += event.deltaY * this.zoomSensitivity * 0.1;
            this.cameraDistance = Math.max(50, Math.min(500, this.cameraDistance));
            this.updateCameraPosition();
        });
        
        // Set initial cursor
        canvas.style.cursor = 'grab';
    }
    
    updateCameraPosition() {
        if (this.camera) {
            const x = Math.cos(this.cameraAngle) * Math.cos(this.cameraVerticalAngle) * this.cameraDistance;
            const y = this.cameraHeight + Math.sin(this.cameraVerticalAngle) * this.cameraDistance;
            const z = Math.sin(this.cameraAngle) * Math.cos(this.cameraVerticalAngle) * this.cameraDistance;
            
            this.camera.position.set(x, y, z);
            this.camera.lookAt(0, 0, 0);
        }
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

        // Load dartboard
        loader.load('models/Dartboard.glb', (gltf) => {
            this.dartboard = gltf.scene;
            this.dartboard.scale.set(15, 15, 15);
            this.dartboard.position.set(-60, 80, 0);
            this.dartboard.castShadow = true;
            this.dartboard.receiveShadow = true;
            this.scene.add(this.dartboard);
            console.log('Dartboard loaded successfully');
        }, undefined, (error) => {
            console.error('Error loading dartboard:', error);
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
            
            // Store current position as previous for next update
            this.previousPlanePosition = newPosition.clone();
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Rotate starfield slowly
        if (this.starfield && this.showStarfield) {
            this.starfield.rotation.y += 0.0005;
            this.starfield.rotation.x += 0.0002;
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
        
        // Create a sphere to mark the closest point
        const geometry = new THREE.SphereGeometry(2, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: scoringZone.color,
            transparent: true,
            opacity: 0.8
        });
        
        this.closestPointMarker = new THREE.Mesh(geometry, material);
        this.closestPointMarker.position.set(point.x, point.y, point.z);
        this.scene.add(this.closestPointMarker);
        
        // Add pulsing animation
        this.animateClosestPointMarker();
        
        // Create a line from the closest point to the dartboard center
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
                // Pulsing scale effect
                const scale = 1 + Math.sin(progress * Math.PI * 6) * 0.3;
                this.closestPointMarker.scale.setScalar(scale);
                
                // Fade out over time
                const opacity = 0.8 * (1 - progress);
                this.closestPointMarker.material.opacity = opacity;
                
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    createDistanceLine(point) {
        const dartboardCenter = new THREE.Vector3();
        const center = this.getDartboardCenter();
        dartboardCenter.set(center.x, center.y, center.z);
        const closestPoint = new THREE.Vector3(point.x, point.y, point.z);
        
        const geometry = new THREE.BufferGeometry().setFromPoints([closestPoint, dartboardCenter]);
        const material = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.6,
            linewidth: 2
        });
        
        this.distanceLine = new THREE.Line(geometry, material);
        this.scene.add(this.distanceLine);
    }
    
    createScoringZoneIndicators() {
        // Remove existing indicators
        this.removeScoringZoneIndicators();
        
        const center = this.getDartboardCenter();
        const dartboardCenter = new THREE.Vector3(center.x, center.y, center.z);
        const scoringZones = [
            { name: 'Bullseye', radius: 2, color: 0xFFD700, opacity: 0.3 },
            { name: 'Inner Ring', radius: 5, color: 0xFF6B6B, opacity: 0.2 },
            { name: 'Outer Ring', radius: 10, color: 0x4ECDC4, opacity: 0.15 }
        ];
        
        this.scoringZoneIndicators = [];
        
        scoringZones.forEach((zone, index) => {
            // Create ring geometry
            const geometry = new THREE.RingGeometry(
                index === 0 ? 0 : scoringZones[index - 1].radius,
                zone.radius,
                32
            );
            
            const material = new THREE.MeshBasicMaterial({
                color: zone.color,
                transparent: true,
                opacity: zone.opacity,
                side: THREE.DoubleSide
            });
            
            const ring = new THREE.Mesh(geometry, material);
            ring.position.copy(dartboardCenter);
            // Orient the ring to face the dartboard (vertical, facing forward)
            // Rotate 90 degrees around Y-axis (vertical up axis) to align with dartboard
            ring.rotateY(Math.PI / 2);
            
            this.scene.add(ring);
            this.scoringZoneIndicators.push(ring);
        });
        
        console.log('Scoring zone indicators created');
    }
    
    removeScoringZoneIndicators() {
        if (this.scoringZoneIndicators) {
            this.scoringZoneIndicators.forEach(indicator => {
                this.scene.remove(indicator);
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
            switch(event.key.toLowerCase()) {
                case 'r':
                    if (!event.ctrlKey && !event.metaKey) {
                        // Reset camera position
                        this.cameraAngle = 0;
                        this.cameraVerticalAngle = 0;
                        this.cameraDistance = 200;
                        this.updateCameraPosition();
                        console.log('Camera position reset');
                    }
                    break;
                case 's':
                    if (!event.ctrlKey && !event.metaKey) {
                        // Toggle starfield
                        this.showStarfield = !this.showStarfield;
                        this.starfield.visible = this.showStarfield;
                        console.log(`Starfield ${this.showStarfield ? 'enabled' : 'disabled'}`);
                    }
                    break;
                case 'z':
                    // Toggle scoring zone indicators
                    this.toggleScoringZoneIndicators();
                    break;
                case 'x':
                    // Clear all visual indicators
                    this.removeClosestPointHighlight();
                    this.removeScoringZoneIndicators();
                    console.log('Visual indicators cleared');
                    break;
                case 'm':
                    // Toggle dartboard center marker
                    this.toggleDartboardCenterMarker();
                    break;
                case 'arrowup':
                    // Adjust Y offset up
                    this.adjustDartboardOffset('y', 0.5);
                    break;
                case 'arrowdown':
                    // Adjust Y offset down
                    this.adjustDartboardOffset('y', -0.5);
                    break;
                case 'arrowleft':
                    // Adjust X offset left
                    this.adjustDartboardOffset('x', -0.5);
                    break;
                case 'arrowright':
                    // Adjust X offset right
                    this.adjustDartboardOffset('x', 0.5);
                    break;
                case ',':
                    // Adjust Z offset backward
                    this.adjustDartboardOffset('z', -0.5);
                    break;
                case '.':
                    // Adjust Z offset forward
                    this.adjustDartboardOffset('z', 0.5);
                    break;
                case '0':
                    // Reset dartboard offset
                    this.resetDartboardOffset();
                    break;
                case 'enter':
                    // Save current calibration
                    this.saveDartboardCalibration();
                    break;
                case 'backspace':
                    // Clear saved calibration and reset to default
                    this.clearDartboardCalibration();
                    this.resetDartboardOffset();
                    break;
            }
        });
    }
    
    // Dartboard center calibration methods
    getDartboardCenter() {
        return {
            x: this.dartboardBaseCenter.x + this.dartboardOffset.x,
            y: this.dartboardBaseCenter.y + this.dartboardOffset.y,
            z: this.dartboardBaseCenter.z + this.dartboardOffset.z
        };
    }
    
    createDartboardCenterMarker() {
        // Remove existing marker
        this.removeDartboardCenterMarker();
        
        const center = this.getDartboardCenter();
        
        // Create a distinctive marker - red sphere with wireframe
        const geometry = new THREE.SphereGeometry(1, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.8
        });
        
        this.dartboardCenterMarker = new THREE.Mesh(geometry, material);
        this.dartboardCenterMarker.position.set(center.x, center.y, center.z);
        
        // Add wireframe overlay
        const wireframeGeometry = new THREE.SphereGeometry(1.2, 16, 16);
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.6
        });
        
        const wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
        wireframe.position.set(center.x, center.y, center.z);
        
        // Group them together
        const markerGroup = new THREE.Group();
        markerGroup.add(this.dartboardCenterMarker);
        markerGroup.add(wireframe);
        
        this.scene.add(markerGroup);
        this.dartboardCenterMarker = markerGroup; // Store the group
        
        console.log(`Dartboard center marker created at (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
    }
    
    removeDartboardCenterMarker() {
        if (this.dartboardCenterMarker) {
            this.scene.remove(this.dartboardCenterMarker);
            this.dartboardCenterMarker = null;
        }
    }
    
    toggleDartboardCenterMarker() {
        this.showCenterMarker = !this.showCenterMarker;
        
        if (this.showCenterMarker) {
            this.createDartboardCenterMarker();
            console.log('Dartboard center marker enabled');
        } else {
            this.removeDartboardCenterMarker();
            console.log('Dartboard center marker disabled');
        }
    }
    
    adjustDartboardOffset(axis, amount) {
        this.dartboardOffset[axis] += amount;
        
        // Update marker position if visible
        if (this.showCenterMarker && this.dartboardCenterMarker) {
            const center = this.getDartboardCenter();
            this.dartboardCenterMarker.position.set(center.x, center.y, center.z);
        }
        
        // Update scoring zone indicators if visible
        if (this.scoringZoneIndicators && this.scoringZoneIndicators.length > 0) {
            this.createScoringZoneIndicators();
        }
        
        console.log(`Dartboard offset adjusted: ${axis} ${amount > 0 ? '+' : ''}${amount.toFixed(1)}`);
        console.log(`Current offset: (${this.dartboardOffset.x.toFixed(1)}, ${this.dartboardOffset.y.toFixed(1)}, ${this.dartboardOffset.z.toFixed(1)})`);
        console.log(`Effective center: (${this.getDartboardCenter().x.toFixed(2)}, ${this.getDartboardCenter().y.toFixed(2)}, ${this.getDartboardCenter().z.toFixed(2)})`);
    }
    
    resetDartboardOffset() {
        this.dartboardOffset = { x: -0.5, y: -0.5, z: 0.0 };
        
        // Update marker position if visible
        if (this.showCenterMarker && this.dartboardCenterMarker) {
            const center = this.getDartboardCenter();
            this.dartboardCenterMarker.position.set(center.x, center.y, center.z);
        }
        
        // Update scoring zone indicators if visible
        if (this.scoringZoneIndicators && this.scoringZoneIndicators.length > 0) {
            this.createScoringZoneIndicators();
        }
        
        console.log('Dartboard offset reset to (-0.5, -0.5, 0.0)');
        console.log(`Base center: (${this.dartboardBaseCenter.x}, ${this.dartboardBaseCenter.y}, ${this.dartboardBaseCenter.z})`);
    }
    
    // Method to get current offset values for external use
    getDartboardOffsetValues() {
        return {
            offset: { ...this.dartboardOffset },
            effectiveCenter: this.getDartboardCenter(),
            baseCenter: { ...this.dartboardBaseCenter }
        };
    }
    
    // Calibration persistence methods
    saveDartboardCalibration() {
        try {
            const calibrationData = {
                offset: { ...this.dartboardOffset },
                baseCenter: { ...this.dartboardBaseCenter },
                savedAt: new Date().toISOString(),
                version: '1.0'
            };
            
            localStorage.setItem('gerf-dartboard-calibration', JSON.stringify(calibrationData));
            console.log('Dartboard calibration saved to localStorage');
            console.log(`Saved offset: (${this.dartboardOffset.x}, ${this.dartboardOffset.y}, ${this.dartboardOffset.z})`);
            
            // Show temporary notification
            this.showCalibrationNotification('Calibration Saved!', '#4CAF50');
            
        } catch (error) {
            console.error('Error saving dartboard calibration:', error);
            this.showCalibrationNotification('Save Failed!', '#f44336');
        }
    }
    
    loadDartboardCalibration() {
        try {
            const savedCalibration = localStorage.getItem('gerf-dartboard-calibration');
            if (savedCalibration) {
                const calibrationData = JSON.parse(savedCalibration);
                
                // Validate the data structure
                if (calibrationData.offset && typeof calibrationData.offset === 'object') {
                    this.dartboardOffset = { ...calibrationData.offset };
                    console.log('Dartboard calibration loaded from localStorage');
                    console.log(`Loaded offset: (${this.dartboardOffset.x}, ${this.dartboardOffset.y}, ${this.dartboardOffset.z})`);
                    console.log(`Effective center: (${this.getDartboardCenter().x.toFixed(2)}, ${this.getDartboardCenter().y.toFixed(2)}, ${this.getDartboardCenter().z.toFixed(2)})`);
                } else {
                    console.log('Invalid calibration data found, using default values');
                }
            } else {
                console.log('No saved calibration found, using default calibrated values');
            }
        } catch (error) {
            console.error('Error loading dartboard calibration:', error);
            console.log('Using default calibrated values');
        }
    }
    
    clearDartboardCalibration() {
        try {
            localStorage.removeItem('gerf-dartboard-calibration');
            console.log('Saved dartboard calibration cleared');
            this.showCalibrationNotification('Calibration Cleared!', '#FF9800');
        } catch (error) {
            console.error('Error clearing dartboard calibration:', error);
        }
    }
    
    showCalibrationNotification(message, color) {
        // Create temporary notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 50%;
            transform: translateX(50%);
            background: rgba(0, 0, 0, 0.9);
            color: ${color};
            padding: 10px 20px;
            border-radius: 5px;
            font-size: 14px;
            font-weight: bold;
            z-index: 1001;
            border: 1px solid ${color};
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
} 