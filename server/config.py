import os

# Server Configuration
UDP_HOST = 'localhost'
UDP_PORT = 12344
WEBSOCKET_HOST = 'localhost'
WEBSOCKET_PORT = 8765

# Data Configuration
COORDINATE_RANGE_X = (-200, 200)
COORDINATE_RANGE_Y = (-100, 200)
COORDINATE_RANGE_Z = (-200, 200)
STREAM_FREQUENCY = 0.05  # seconds between coordinate updates (20 FPS)

# Connection Configuration
BUFFER_SIZE = 1024  # Note: UDP sockets now use optimized 64KB buffers (see adapter code)
CLIENT_TIMEOUT = 30  # seconds

# Logging Configuration
LOG_LEVEL = 'INFO'  # DEBUG, INFO, WARNING, ERROR, CRITICAL

# Trajectory Configuration
TRAJECTORY_TYPE = 'linear'  # 'orbital' or 'linear'

# Orbital trajectory parameters
ORBITAL_SPEED = 0.02
BASE_RADIUS = 80
RADIUS_VARIATION = 20
ELEVATION_SPEED = 0.8

# Linear trajectory parameters
LINEAR_START_POSITION = (0, 120, 0)  # Starting position for linear trajectory (above origin)
LINEAR_TARGET_POSITION = (-60, 80, 0)  # Dartboard position
LINEAR_DURATION = 5.0  # seconds for complete trajectory (reduced from 15.0 for faster testing)
LINEAR_SPEED_PROFILE = 'decelerating'  # 'linear', 'accelerating', 'decelerating'
LINEAR_LOOP = True  # Whether to loop the trajectory
LINEAR_LOOP_DELAY = 3.5  # seconds between trajectory loops (reduced from 5.0 for faster testing)

# Linear trajectory randomness parameters
LINEAR_TARGET_RANDOMNESS = True  # Enable randomized target positions
LINEAR_RANDOM_RADIUS = 25.0  # Maximum radius around dartboard for random targets
LINEAR_RANDOM_HEIGHT_VARIATION = 15.0  # Maximum height variation from dartboard center
LINEAR_RANDOM_SEED = None  # Set to integer for reproducible randomness, None for true random

# Advanced randomness options
LINEAR_RANDOM_DISTRIBUTION = 'uniform'  # 'uniform' or 'gaussian' distribution within radius
LINEAR_RANDOM_GAUSSIAN_SIGMA = 0.4  # Standard deviation for gaussian (0.0-1.0, where 1.0 = radius)
LINEAR_RANDOM_MIN_DISTANCE = 5.0  # Minimum distance from dartboard center (prevents too-close hits)
LINEAR_RANDOM_BIAS_ANGLE = None  # Bias angle in radians (None for no bias, 0 = positive X direction)
LINEAR_RANDOM_BIAS_STRENGTH = 0.3  # Strength of directional bias (0.0-1.0)