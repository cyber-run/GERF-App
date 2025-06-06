// One Euro Filter for 3D Coordinate Data
// Based on the paper "1 € Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
// by Géry Casiez and Nicolas Roussel

class OneEuroFilter {
    constructor(frequency = 60, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
        // Filter parameters
        this.frequency = frequency;      // Sampling frequency in Hz
        this.minCutoff = minCutoff;      // Minimum cutoff frequency
        this.beta = beta;                // Beta parameter for derivative calculation
        this.dCutoff = dCutoff;          // Cutoff frequency for derivative
        
        // Filter state
        this.x = null;                   // Previous filtered value
        this.dx = null;                  // Previous derivative
        this.lastTime = null;            // Last timestamp
        
        // Low-pass filter helper
        this.lowPassFilter = new LowPassFilter();
        this.derivativeFilter = new LowPassFilter();
    }
    
    filter(value, timestamp = null) {
        // Use current time if no timestamp provided
        if (timestamp === null) {
            timestamp = Date.now() / 1000.0; // Convert to seconds
        }
        
        // Initialize on first call
        if (this.x === null) {
            this.x = value;
            this.dx = 0.0;
            this.lastTime = timestamp;
            return value;
        }
        
        // Calculate time elapsed and frequency
        const dt = timestamp - this.lastTime;
        if (dt <= 0) {
            return this.x; // Return previous value if no time elapsed
        }
        
        const frequency = 1.0 / dt;
        
        // Calculate derivative (speed)
        const derivative = (value - this.x) * frequency;
        
        // Filter the derivative
        const smoothedDerivative = this.derivativeFilter.filter(
            derivative, 
            this.alpha(frequency, this.dCutoff)
        );
        
        // Calculate adaptive cutoff frequency
        const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
        
        // Filter the value
        const filteredValue = this.lowPassFilter.filter(
            value, 
            this.alpha(frequency, cutoff)
        );
        
        // Update state
        this.x = filteredValue;
        this.dx = smoothedDerivative;
        this.lastTime = timestamp;
        
        return filteredValue;
    }
    
    // Calculate alpha for low-pass filter
    alpha(frequency, cutoff) {
        const tau = 1.0 / (2.0 * Math.PI * cutoff);
        const te = 1.0 / frequency;
        return 1.0 / (1.0 + tau / te);
    }
    
    // Reset filter state
    reset() {
        this.x = null;
        this.dx = null;
        this.lastTime = null;
        this.lowPassFilter.reset();
        this.derivativeFilter.reset();
    }
}

// Low-pass filter helper class
class LowPassFilter {
    constructor() {
        this.y = null;  // Previous output
    }
    
    filter(x, alpha) {
        if (this.y === null) {
            this.y = x;
        } else {
            this.y = alpha * x + (1.0 - alpha) * this.y;
        }
        return this.y;
    }
    
    reset() {
        this.y = null;
    }
}

// 3D One Euro Filter for coordinate data
class OneEuroFilter3D {
    constructor(frequency = 60, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
        this.xFilter = new OneEuroFilter(frequency, minCutoff, beta, dCutoff);
        this.yFilter = new OneEuroFilter(frequency, minCutoff, beta, dCutoff);
        this.zFilter = new OneEuroFilter(frequency, minCutoff, beta, dCutoff);
    }
    
    filter(coordinates, timestamp = null) {
        if (!coordinates || coordinates.x === undefined || coordinates.y === undefined || coordinates.z === undefined) {
            console.warn('OneEuroFilter3D: Invalid coordinates provided');
            return coordinates;
        }
        
        return {
            x: this.xFilter.filter(coordinates.x, timestamp),
            y: this.yFilter.filter(coordinates.y, timestamp),
            z: this.zFilter.filter(coordinates.z, timestamp),
            // Preserve any additional properties
            ...coordinates
        };
    }
    
    reset() {
        this.xFilter.reset();
        this.yFilter.reset();
        this.zFilter.reset();
    }
} 