require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const { ensureDirectories, cleanOldFiles } = require('./utils/fileHelper');
const mediaRoutes = require('./routes/mediaRoutes');
const healthRoutes = require('./routes/healthRoutes');
const compressRoutes = require('./routes/compressRoutes');
const { OUTPUT_TMP } = require('./controllers/compressController');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(compression());

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.api.rateWindowMin * 60 * 1000,
  max: config.api.rateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static file serving ──────────────────────────────────────────────────────
// Serve original uploads and async compressed variants
app.use('/uploads', express.static(path.resolve('uploads')));
// Serve synchronous compress outputs (auto/custom) from tmp dir
app.use('/outputs', express.static(OUTPUT_TMP));

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/health', healthRoutes);
app.use('/api/media', mediaRoutes);
app.use('/compress', compressRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
    availableRoutes: [
      'GET  /api/health',
      'POST /api/media/upload',
      'GET  /api/media/status/:jobId',
      'GET  /api/media/profiles',
      'POST /compress/auto',
      'POST /compress/custom',
      'POST /compress/percent',
    ],
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────
const start = async () => {
  // Ensure upload directories exist
  await ensureDirectories(
    path.resolve(config.upload.dir),
    path.resolve(config.upload.compressedDir),
    'logs'
  );

  // Schedule periodic cleanup of old files
  const runCleanup = async () => {
    const [v, c] = await Promise.all([
      cleanOldFiles(config.upload.dir, config.cleanup.maxAgeHours),
      cleanOldFiles(config.upload.compressedDir, config.cleanup.maxAgeHours),
    ]);
    if (v + c > 0) logger.info(`Cleanup: removed ${v} original(s) and ${c} compressed file(s)`);
  };

  setInterval(runCleanup, config.cleanup.intervalHours * 60 * 60 * 1000);
  logger.info(`Scheduled cleanup every ${config.cleanup.intervalHours}h (max age: ${config.cleanup.maxAgeHours}h)`);

  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Video compression service running on port ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`Upload dir:  ${path.resolve(config.upload.dir)}`);
    logger.info(`Output dir:  ${path.resolve(config.upload.compressedDir)}`);
  });
};

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error(`Failed to start service: ${err.message}`, err);
  process.exit(1);
});

module.exports = app;
