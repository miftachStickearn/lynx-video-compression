const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const logger = require('../utils/logger');
const { success, error } = require('../utils/responseHelper');

ffmpeg.setFfmpegPath(ffmpegStatic);

// ─── Constants ────────────────────────────────────────────────────────────────

const UPLOAD_TMP = path.join(os.tmpdir(), 'uploads');
const OUTPUT_TMP = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.join(os.tmpdir(), 'outputs');

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB) || 500;
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per PRD
// How long output files are kept before deletion (default 5 minutes)
const OUTPUT_TTL_MS = (parseInt(process.env.OUTPUT_TTL_MIN) || 5) * 60 * 1000;

const ALLOWED_CODECS = new Set(['libx264', 'libx265', 'vp9', 'libvpx', 'mpeg4']);

// Codecs that output WebM container instead of MP4
const WEBM_CODECS = new Set(['vp9', 'libvpx']);

const RESOLUTION_RE = /^\d+x\d+$/;

const AUTO_VARIANTS = [
  {
    label: 'master',
    filename: 'video_master.mp4',
    maxWidth: 3840,
    maxHeight: 2160,
    codec: 'libx264',
    profile: 'high',
    level: '5.1',
    useCRF: true,
    crf: 18,
    preset: 'slow',
    audioBitrate: '320k',
  },
  {
    label: 'high',
    filename: 'video_high.mp4',
    maxWidth: 1920,
    maxHeight: 1080,
    codec: 'libx264',
    profile: 'high',
    level: '4.2',
    videoBitrate: '8000k',
    maxRate: '10000k',
    bufSize: '16000k',
    preset: 'medium',
    audioBitrate: '192k',
  },
  {
    label: 'medium',
    filename: 'video_medium.mp4',
    maxWidth: 1280,
    maxHeight: 720,
    codec: 'libx264',
    profile: 'main',
    level: '4.0',
    videoBitrate: '4000k',
    maxRate: '6000k',
    bufSize: '8000k',
    preset: 'medium',
    audioBitrate: '128k',
  },
  {
    label: 'low',
    filename: 'video_low.mp4',
    maxWidth: 854,
    maxHeight: 480,
    codec: 'libx264',
    profile: 'baseline',
    level: '3.0',
    videoBitrate: '2000k',
    maxRate: '2500k',
    bufSize: '4000k',
    preset: 'fast',
    audioBitrate: '96k',
  },
];

/**
 * Percentage-based variants: each profile scales the original dimensions
 * by a fixed percentage (100 / 75 / 50 / 25). Aspect ratio is always preserved.
 */
const PERCENT_VARIANTS = [
  {
    label: 'master',
    scale: 100,
    filename: 'video_master.mp4',
    codec: 'libx264',
    profile: 'high',
    level: '5.1',
    useCRF: true,
    crf: 18,
    preset: 'slow',
    audioBitrate: '320k',
  },
  {
    label: 'high',
    scale: 75,
    filename: 'video_high.mp4',
    codec: 'libx264',
    profile: 'high',
    level: '4.2',
    videoBitrate: '8000k',
    maxRate: '10000k',
    bufSize: '16000k',
    preset: 'medium',
    audioBitrate: '192k',
  },
  {
    label: 'medium',
    scale: 50,
    filename: 'video_medium.mp4',
    codec: 'libx264',
    profile: 'main',
    level: '4.0',
    videoBitrate: '4000k',
    maxRate: '6000k',
    bufSize: '8000k',
    preset: 'medium',
    audioBitrate: '128k',
  },
  {
    label: 'low',
    scale: 25,
    filename: 'video_low.mp4',
    codec: 'libx264',
    profile: 'baseline',
    level: '3.0',
    videoBitrate: '2000k',
    maxRate: '2500k',
    bufSize: '4000k',
    preset: 'fast',
    audioBitrate: '96k',
  },
];

// ─── Multer setup ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.ensureDir(UPLOAD_TMP);
    cb(null, UPLOAD_TMP);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/mpeg',
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// ─── FFmpeg helpers ───────────────────────────────────────────────────────────

/** Parse "HH:MM:SS.ms" timemark to seconds. Returns 0 for N/A. */
const timemarkToSecs = (tm) => {
  if (!tm || tm === 'N/A') return 0;
  const parts = tm.split(':');
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
};

/** Get video duration in seconds by parsing ffmpeg -i stderr. Resolves null on failure. */
const probeDuration = (filePath) =>
  new Promise((resolve) => {
    let stderr = '';
    const proc = spawn(ffmpegStatic, ['-i', filePath]);
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(null);
      const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
      resolve(secs > 0 ? secs : null);
    });
    proc.on('error', () => resolve(null));
  });

/**
 * Encode a single auto-variant profile.
 * 
 */
const encodeVariant = (inputPath, outputPath, variant, durationSecs) =>
  new Promise((resolve, reject) => {
    const scaleFilter = [
      `scale=w=${variant.maxWidth}:h=${variant.maxHeight}:force_original_aspect_ratio=decrease`,
      `scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    ].join(',');

    const cmd = ffmpeg(inputPath)
      .outputFormat('mp4')
      .videoCodec(variant.codec)
      .audioCodec('aac')
      .audioBitrate(variant.audioBitrate)
      .videoFilters(scaleFilter)
      .addOption('-profile:v', variant.profile)
      .addOption('-level:v', variant.level)
      .addOption('-pix_fmt', 'yuv420p')
      .addOption('-movflags', '+faststart');

    if (variant.useCRF) {
      cmd.addOption('-crf', String(variant.crf)).addOption('-preset', variant.preset);
    } else {
      cmd
        .videoBitrate(variant.videoBitrate)
        .addOption('-maxrate', variant.maxRate)
        .addOption('-bufsize', variant.bufSize)
        .addOption('-preset', variant.preset);
    }

    cmd
      .on('progress', (p) => {
        const secs = timemarkToSecs(p.timemark);
        const pct = durationSecs > 0
          ? `${Math.min(100, Math.round((secs / durationSecs) * 100))}%`
          : (p.timemark && p.timemark !== 'N/A' ? p.timemark : `${p.frames} frames`);
        logger.info(`[${variant.label}] ${pct}`);
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });

/**
 * Encode a quality profile variant with optional user overrides.
 *
 * Override priority (highest → lowest):
 *   1. User-supplied resolution / codec / framerate
 *   2. Quality profile defaults
 *
 * When the user supplies a resolution it caps that profile's scale target.
 * When the user supplies a codec the whole profile switches to that codec
 * (profile/level flags are dropped since they are codec-specific).
 */
const encodeVariantWithOverrides = (inputPath, outputPath, variant, overrides, durationSecs) =>
  new Promise((resolve, reject) => {
    const effectiveCodec = overrides.codec || variant.codec;
    const isWebm = WEBM_CODECS.has(effectiveCodec);
    const fmt = isWebm ? 'webm' : 'mp4';

    // Resolution: if user supplied, parse it; otherwise use the profile caps
    let scaleW = variant.maxWidth;
    let scaleH = variant.maxHeight;
    if (overrides.resolution) {
      const [uw, uh] = overrides.resolution.split('x').map(Number);
      // Never scale UP beyond the profile's natural cap
      scaleW = Math.min(uw, variant.maxWidth);
      scaleH = Math.min(uh, variant.maxHeight);
    }

    const scaleFilter = [
      `scale=w=${scaleW}:h=${scaleH}:force_original_aspect_ratio=decrease`,
      `scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    ].join(',');

    const cmd = ffmpeg(inputPath)
      .outputFormat(fmt)
      .videoCodec(effectiveCodec)
      .audioCodec('aac')
      .audioBitrate(variant.audioBitrate)
      .videoFilters(scaleFilter)
      .addOption('-pix_fmt', 'yuv420p')
      .addOption('-movflags', '+faststart');

    // Only apply H.264-specific profile/level when not overridden to a different codec
    if (!overrides.codec || overrides.codec === 'libx264') {
      cmd
        .addOption('-profile:v', variant.profile)
        .addOption('-level:v', variant.level);
    }

    if (variant.useCRF && !overrides.codec) {
      cmd.addOption('-crf', String(variant.crf)).addOption('-preset', variant.preset);
    } else if (!isWebm) {
      cmd
        .videoBitrate(variant.videoBitrate || '4000k')
        .addOption('-maxrate', variant.maxRate || '6000k')
        .addOption('-bufsize', variant.bufSize || '8000k')
        .addOption('-preset', variant.preset || 'medium');
    }

    if (overrides.framerate) {
      cmd.fps(parseInt(overrides.framerate));
    }

    cmd
      .on('progress', (p) => {
        const secs = timemarkToSecs(p.timemark);
        const pct = durationSecs > 0
          ? `${Math.min(100, Math.round((secs / durationSecs) * 100))}%`
          : (p.timemark && p.timemark !== 'N/A' ? p.timemark : `${p.frames} frames`);
        logger.info(`[custom:${variant.label}] ${pct}`);
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });

/**
 * Encode a single percentage-scale variant.
 * Scale filter uses FFmpeg expressions so no dimension probing is needed:
 *   trunc(iw * factor / 2) * 2  ensures the result is always even.
 */
const encodeVariantPercent = (inputPath, outputPath, variant, durationSecs) =>
  new Promise((resolve, reject) => {
    const factor = variant.scale / 100;
    // At 100% just enforce even pixel counts; otherwise scale by factor.
    const scaleFilter = variant.scale === 100
      ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
      : `scale=trunc(iw*${factor}/2)*2:trunc(ih*${factor}/2)*2`;

    const cmd = ffmpeg(inputPath)
      .outputFormat('mp4')
      .videoCodec(variant.codec)
      .audioCodec('aac')
      .audioBitrate(variant.audioBitrate)
      .videoFilters(scaleFilter)
      .addOption('-profile:v', variant.profile)
      .addOption('-level:v', variant.level)
      .addOption('-pix_fmt', 'yuv420p')
      .addOption('-movflags', '+faststart');

    if (variant.useCRF) {
      cmd.addOption('-crf', String(variant.crf)).addOption('-preset', variant.preset);
    } else {
      cmd
        .videoBitrate(variant.videoBitrate)
        .addOption('-maxrate', variant.maxRate)
        .addOption('-bufsize', variant.bufSize)
        .addOption('-preset', variant.preset);
    }

    cmd
      .on('progress', (p) => {
        const secs = timemarkToSecs(p.timemark);
        const pct = durationSecs > 0
          ? `${Math.min(100, Math.round((secs / durationSecs) * 100))}%`
          : (p.timemark && p.timemark !== 'N/A' ? p.timemark : `${p.frames} frames`);
        logger.info(`[percent:${variant.label} @${variant.scale}%] ${pct}`);
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });

/**
 * Wrap any promise with a timeout.
 */
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout exceeded (${ms / 1000}s) for ${label}`)), ms)
    ),
  ]);

/**
 * Delete the uploaded input file immediately after response is flushed.
 */
const cleanupInput = (inputPath) => {
  setImmediate(async () => {
    try {
      if (inputPath && (await fs.pathExists(inputPath))) await fs.remove(inputPath);
    } catch (e) {
      logger.warn(`Cleanup failed for ${inputPath}: ${e.message}`);
    }
  });
};

/**
 * Delete the output directory after OUTPUT_TTL_MS so download URLs remain
 * accessible for the configured window (default 1 hour).
 */
const scheduleOutputCleanup = (outputDir) => {
  setTimeout(async () => {
    try {
      if (outputDir && (await fs.pathExists(outputDir))) {
        await fs.remove(outputDir);
        logger.info(`[cleanup] Removed output dir ${outputDir}`);
      }
    } catch (e) {
      logger.warn(`Output cleanup failed for ${outputDir}: ${e.message}`);
    }
  }, OUTPUT_TTL_MS);
};


// ─── Periodic Output Cleanup (robust, runs on startup) ───────────────────────
/**
 * Periodically scan OUTPUT_TMP for job output directories older than OUTPUT_TTL_MS and delete them.
 * This ensures cleanup even if the process restarts or timers are lost.
 */
function startPeriodicOutputCleanup() {
  const intervalMs = Math.max(60_000, Math.min(OUTPUT_TTL_MS / 2, 5 * 60_000)); // 1-5 min
  async function cleanupOldOutputs() {
    try {
      const now = Date.now();
      const entries = await fs.readdir(OUTPUT_TMP, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(OUTPUT_TMP, entry.name);
        try {
          const stat = await fs.stat(dirPath);
          const age = now - stat.mtimeMs;
          if (age > OUTPUT_TTL_MS) {
            await fs.remove(dirPath);
            logger.info(`[periodic-cleanup] Removed expired output dir ${dirPath}`);
          }
        } catch (e) {
          logger.warn(`[periodic-cleanup] Error checking/removing ${dirPath}: ${e.message}`);
        }
      }
    } catch (e) {
      logger.warn(`[periodic-cleanup] Failed to scan output dir: ${e.message}`);
    }
  }
  setInterval(cleanupOldOutputs, intervalMs);
  // Run once on startup
  cleanupOldOutputs();
}

// Start periodic cleanup on module load
// startPeriodicOutputCleanup();

// ─── Controller: POST /compress/auto ─────────────────────────────────────────

const autoCompress = [
  upload.single('video'),
  async (req, res, next) => {
    if (!req.file) {
      return error(res, 'No video file provided. Send a multipart/form-data request with field "video".', 400);
    }

    const inputPath = req.file.path;
    const jobId = uuidv4();
    const outputDir = path.join(OUTPUT_TMP, jobId);

    try {
      await fs.ensureDir(outputDir);

      const durationSecs = await probeDuration(inputPath);
      logger.info(`[auto] Job ${jobId} — duration=${durationSecs ? durationSecs.toFixed(2) + 's' : 'unknown'}, running ${AUTO_VARIANTS.length} variants in parallel`);

      const encodingJobs = AUTO_VARIANTS.map((variant) => {
        const outputPath = path.join(outputDir, variant.filename);
        return withTimeout(
          encodeVariant(inputPath, outputPath, variant, durationSecs),
          TIMEOUT_MS,
          variant.label
        ).then(() => ({
          variant: variant.label,
          filename: variant.filename,
          outputPath,
        }));
      });

      const results = await withTimeout(
        Promise.all(encodingJobs),
        TIMEOUT_MS,
        'all variants'
      );

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      const variants = results.map(({ variant, filename }) => ({
        variant,
        filename,
        downloadUrl: `${baseUrl}/outputs/${jobId}/${filename}`,
      }));

      // Serve output files statically before cleanup
      // (app.js mounts /outputs → OUTPUT_TMP)
      res.status(200).json({
        success: true,
        message: 'All variants generated successfully.',
        data: { jobId, variants },
      });

      // Delete input immediately; keep outputs for OUTPUT_TTL_MS
      cleanupInput(inputPath);
      scheduleOutputCleanup(outputDir);
    } catch (err) {
      cleanupInput(inputPath);
      scheduleOutputCleanup(outputDir);
      next(err);
    }
  },
];

// ─── Controller: POST /compress/custom ───────────────────────────────────────
//
// Generates all 4 quality variants in parallel (same as /compress/auto) but
// applies user-supplied overrides to every variant:
//   • codec      → replaces each profile's default codec
//   • resolution → caps each profile's scale target (never upscales beyond profile cap)
//   • framerate  → applied to all variants
//
// At least one override is optional — submitting none is valid and behaves
// identically to /compress/auto.

const customCompress = [
  upload.single('video'),
  async (req, res, next) => {
    if (!req.file) {
      return error(res, 'No video file provided. Send a multipart/form-data request with field "video".', 400);
    }

    const { resolution, codec, framerate } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    if (codec && !ALLOWED_CODECS.has(codec)) {
      cleanupInput(req.file.path);
      return error(
        res,
        `Invalid codec "${codec}". Allowed values: ${[...ALLOWED_CODECS].join(', ')}`,
        400
      );
    }

    if (resolution && !RESOLUTION_RE.test(resolution)) {
      cleanupInput(req.file.path);
      return error(
        res,
        `Invalid resolution "${resolution}". Must match pattern \\d+x\\d+ (e.g. 1280x720).`,
        400
      );
    }

    if (framerate && (!Number.isInteger(Number(framerate)) || Number(framerate) <= 0)) {
      cleanupInput(req.file.path);
      return error(res, `Invalid framerate "${framerate}". Must be a positive integer.`, 400);
    }

    const inputPath = req.file.path;
    const jobId = uuidv4();
    const outputDir = path.join(OUTPUT_TMP, jobId);
    const overrides = { codec, resolution, framerate };
    const ext = WEBM_CODECS.has(codec) ? '.webm' : '.mp4';

    try {
      await fs.ensureDir(outputDir);

      const durationSecs = await probeDuration(inputPath);
      logger.info(
        `[custom] Job ${jobId} — duration=${durationSecs ? durationSecs.toFixed(2) + 's' : 'unknown'}, ${AUTO_VARIANTS.length} variants in parallel | ` +
        `codec=${codec || 'profile default'} resolution=${resolution || 'profile default'} framerate=${framerate || 'source'}`
      );

      // Build per-variant filename with ext matching codec
      const variantDefs = AUTO_VARIANTS.map((v) => ({
        ...v,
        filename: `${v.label === 'master' ? 'video_master' : `video_${v.label}`}${ext}`,
      }));

      const encodingJobs = variantDefs.map((variant) => {
        const outputPath = path.join(outputDir, variant.filename);
        return withTimeout(
          encodeVariantWithOverrides(inputPath, outputPath, variant, overrides, durationSecs),
          TIMEOUT_MS,
          `custom:${variant.label}`
        ).then(() => ({
          variant: variant.label,
          filename: variant.filename,
          outputPath,
        }));
      });

      const results = await withTimeout(
        Promise.all(encodingJobs),
        TIMEOUT_MS,
        'all custom variants'
      );

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      const variants = results.map(({ variant, filename }) => ({
        variant,
        filename,
        downloadUrl: `${baseUrl}/outputs/${jobId}/${filename}`,
      }));

      res.status(200).json({
        success: true,
        message: 'All custom variants generated successfully.',
        data: {
          jobId,
          appliedParams: {
            codec: codec || null,
            resolution: resolution || null,
            framerate: framerate ? parseInt(framerate) : null,
          },
          variants,
        },
      });

      cleanupInput(inputPath);
      scheduleOutputCleanup(outputDir);
    } catch (err) {
      cleanupInput(inputPath);
      scheduleOutputCleanup(outputDir);
      next(err);
    }
  },
];

// ─── Controller: POST /compress/percent ──────────────────────────────────────
//
// Like /compress/auto but each variant scales the original resolution by a
// fixed percentage (100% / 75% / 50% / 25%) instead of capping at an absolute
// maxWidth × maxHeight. Aspect ratio is always preserved.

const percentCompress = [
  upload.single('video'),
  async (req, res, next) => {
    if (!req.file) {
      return error(res, 'No video file provided. Send a multipart/form-data request with field "video".', 400);
    }

    const inputPath = req.file.path;
    const jobId = uuidv4();
    const outputDir = path.join(OUTPUT_TMP, jobId);

    try {
      await fs.ensureDir(outputDir);

      const durationSecs = await probeDuration(inputPath);
      logger.info(
        `[percent] Job ${jobId} — duration=${durationSecs ? durationSecs.toFixed(2) + 's' : 'unknown'}, ` +
        `running ${PERCENT_VARIANTS.length} variants (100%/75%/50%/25%) in parallel`
      );

      const encodingJobs = PERCENT_VARIANTS.map((variant) => {
        const outputPath = path.join(outputDir, variant.filename);
        if (variant.label === 'master') {
          // Copy original file for master variant (no re-encode)
          return fs.copy(inputPath, outputPath).then(() => ({
            variant: variant.label,
            scale: variant.scale,
            filename: variant.filename,
            outputPath,
            isOriginalCopy: true,
          }));
        } else {
          return withTimeout(
            encodeVariantPercent(inputPath, outputPath, variant, durationSecs),
            TIMEOUT_MS,
            `percent:${variant.label}`
          ).then(() => ({
            variant: variant.label,
            scale: variant.scale,
            filename: variant.filename,
            outputPath,
            isOriginalCopy: false,
          }));
        }
      });

      const results = await withTimeout(
        Promise.all(encodingJobs),
        TIMEOUT_MS,
        'all percent variants'
      );

      // Probe output info (resolution, bitrate, codec, framerate) for each variant, with retry if needed
      async function getVideoInfo(filePath, retries = 3, delayMs = 200) {
        for (let i = 0; i < retries; i++) {
          try {
            await fs.access(filePath, fs.constants.R_OK);
            return await new Promise((resolve) => {
              ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err || !metadata || !metadata.streams) {
                  logger.warn(`[probe] ffprobe failed for ${filePath}: ${err ? err.message : 'no metadata'}`);
                  return resolve(null);
                }
                const stream = metadata.streams.find(s => s.codec_type === 'video');
                if (stream) {
                  // Bitrate fallback: stream.bit_rate or metadata.format.bit_rate
                  let bitrate = null;
                  if (stream.bit_rate) bitrate = parseInt(stream.bit_rate);
                  else if (metadata.format && metadata.format.bit_rate) bitrate = parseInt(metadata.format.bit_rate);
                  // Framerate: r_frame_rate or avg_frame_rate
                  let framerate = null;
                  if (stream.avg_frame_rate && stream.avg_frame_rate !== '0/0') {
                    const [num, den] = stream.avg_frame_rate.split('/').map(Number);
                    if (den && den !== 0) framerate = +(num / den).toFixed(2);
                  }
                  // Codec
                  const codec = stream.codec_name || null;
                  // Resolution
                  const width = stream.width || null;
                  const height = stream.height || null;
                  resolve({ width, height, bitrate, codec, framerate });
                  return;
                }
                logger.warn(`[probe] No video stream for ${filePath}`);
                resolve(null);
              });
            });
          } catch (e) {
            logger.warn(`[probe] Access error for ${filePath}: ${e.message}`);
          }
          // Wait before retry
          await new Promise(r => setTimeout(r, delayMs));
        }
        logger.error(`[probe] Failed to get video info for ${filePath} after ${retries} attempts`);
        return null;
      }

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      const variants = await Promise.all(results.map(async ({ variant, scale, filename, outputPath }) => {
        const info = await getVideoInfo(outputPath);
        let width = null, height = null, bitrate = null, codec = null, framerate = null, size = null;
        if (info) {
          width = info.width;
          height = info.height;
          bitrate = info.bitrate;
          codec = info.codec;
          framerate = info.framerate;
        }
        // Get file size in bytes
        try {
          const stat = await fs.stat(outputPath);
          size = stat.size;
        } catch (e) {
          size = null;
        }
        return {
          variant,
          scale: `${scale}%`,
          filename,
          resolution: width && height ? `${width}x${height}` : null,
          width,
          height,
          bitrate,
          codec,
          framerate,
          size,
          downloadUrl: `${baseUrl}/outputs/${jobId}/${filename}`,
        };
      }));

      res.status(200).json({
        success: true,
        message: 'All percentage variants generated successfully.',
        data: { jobId, variants },
      });

      cleanupInput(inputPath);
      scheduleOutputCleanup(outputDir);
    } catch (err) {
      cleanupInput(inputPath);
      scheduleOutputCleanup(outputDir);
      next(err);
    }
  },
];

module.exports = { autoCompress, customCompress, percentCompress, UPLOAD_TMP, OUTPUT_TMP };
