const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    service: 'video-compression-service',
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
