require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT) || 3020,
  nodeEnv: process.env.NODE_ENV || 'development',

  api: {
    rateWindowMin: parseInt(process.env.API_RATE_WINDOW) || 15,
    rateLimit: parseInt(process.env.API_RATE_LIMIT) || 100,
    apiKey: process.env.API_KEY || null,
  },

  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads/videos',
    compressedDir: process.env.COMPRESSED_DIR || 'uploads/compressed',
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB) || 500,
  },

  cleanup: {
    maxAgeHours: parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 24,
    intervalHours: parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 6,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
