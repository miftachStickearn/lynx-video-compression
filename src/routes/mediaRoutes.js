const express = require('express');
const router = express.Router();

// Async upload pipeline (requires Redis/Bull).
// These routes return 503 until a full queue integration is wired up.
const unavailable = (req, res) =>
  res.status(503).json({ success: false, message: 'Async upload pipeline not available in this deployment.' });

router.post('/upload', unavailable);
router.get('/status/:jobId', unavailable);
router.get('/profiles', unavailable);

module.exports = router;
