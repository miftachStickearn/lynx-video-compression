const express = require('express');
const router = express.Router();
const { autoCompress, customCompress, percentCompress } = require('../controllers/compressController');

/**
 * POST /compress/auto
 * Upload a video → generate 4 quality variants in parallel → return all download URLs.
 */
router.post('/auto', autoCompress);

/**
 * POST /compress/custom
 * Upload a video → compress with user-supplied resolution, codec, and/or framerate.
 */
router.post('/custom', customCompress);

/**
 * POST /compress/percent
 * Upload a video → generate 4 variants scaled at 100%/75%/50%/25% of original resolution.
 */
router.post('/percent', percentCompress);

module.exports = router;
