# Video Compression Service

Multi-quality video variant generator. Accepts a single video upload and produces 4 quality variants in parallel using FFmpeg.

Three compression modes are supported:

- **`POST /compress/auto`** — generates 4 variants (Master 4K, High 1080p, Medium 720p, Low 480p) with preset absolute-resolution profiles
- **`POST /compress/custom`** — same 4-variant output with optional `codec`, `resolution`, and/or `framerate` overrides applied to every profile
- **`POST /compress/percent`** — generates 4 variants scaled at **100% / 75% / 50% / 25%** of the original video's resolution, preserving aspect ratio

---

## Project Structure

```
video-compression-service/
└── src/
    ├── app.js                          ← Express entry point
    ├── controllers/
    │   └── compressController.js       ← POST /compress/auto + /compress/custom + /compress/percent
    └── routes/
        └── compressRoutes.js           ← Route definitions
```

> **Note:** `src/app.js` references several supporting modules (`config`, `utils/logger`, `utils/fileHelper`, `routes/mediaRoutes`, `routes/healthRoutes`, `middleware/errorHandler`) that are not yet created. These need to be added before the app will run.

---

## Getting Started

### 1. Environment variables

```bash
cp .env.example .env
# Edit .env if you need non-default values
```

`.env.example` (copy as-is for local defaults):

```env
PORT=3020
NODE_ENV=production
MAX_FILE_SIZE_MB=500
LOG_LEVEL=info

# Optional overrides (commented out = use built-in defaults)
# OUTPUT_DIR=/tmp/outputs
# BASE_URL=http://localhost:3020
```

---

### 2a. Docker Compose (recommended)

Builds the image and starts the container in one command.

```bash
docker compose up --build
```

Detached (background):

```bash
docker compose up --build -d
```

View logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

---

### 2b. Docker build + run (manual)

```bash
# Build
docker build -t video-compression-service .

# Run
docker run --rm \
  -p 3020:3020 \
  --env-file .env \
  video-compression-service
```

Override a single variable at runtime:

```bash
docker run --rm \
  -p 3020:3020 \
  --env-file .env \
  -e LOG_LEVEL=debug \
  video-compression-service
```

---

### 2c. Without Docker (local Node.js)

Requires **Node.js ≥ 18** installed locally. FFmpeg does **not** need to be installed — it is bundled via the `ffmpeg-static` package.

```bash
# Install dependencies
npm install

# Start (production)
npm start

# Start with auto-reload (development)
npm run dev
```

The service will be available at `http://localhost:3020`.

---

## Dependencies

The controller requires the following npm packages:

| Package | Purpose |
|---------|---------|
| `express` | HTTP framework |
| `fluent-ffmpeg` | FFmpeg Node.js wrapper |
| `ffmpeg-static` | Bundled FFmpeg binary |
| `multer` | Multipart file upload handling |
| `fs-extra` | File system utilities |
| `uuid` | Job ID generation |

---

## API Reference

### POST /compress/auto

Upload a single video. Generates **4 quality variants in parallel** and returns all download URLs in one response. Blocks until all variants are ready (max 10 minutes).

**Request** — `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| `video` | file | ✅ |

**Accepted MIME types:** `video/mp4`, `video/quicktime`, `video/x-msvideo`, `video/x-matroska`, `video/webm`, `video/mpeg`

**Response 200**
```json
{
  "success": true,
  "message": "All variants generated successfully.",
  "data": {
    "jobId": "a1b2c3d4-...",
    "variants": [
      { "variant": "master", "filename": "video_master.mp4", "downloadUrl": "http://localhost:3020/outputs/a1b2c3d4-.../video_master.mp4" },
      { "variant": "high",   "filename": "video_high.mp4",   "downloadUrl": "http://localhost:3020/outputs/a1b2c3d4-.../video_high.mp4" },
      { "variant": "medium", "filename": "video_medium.mp4", "downloadUrl": "http://localhost:3020/outputs/a1b2c3d4-.../video_medium.mp4" },
      { "variant": "low",    "filename": "video_low.mp4",    "downloadUrl": "http://localhost:3020/outputs/a1b2c3d4-.../video_low.mp4" }
    ]
  }
}
```

**Example**
```bash
curl -X POST http://localhost:3020/compress/auto \
  -F "video=@/path/to/my-ad.mp4"
```

---

### POST /compress/custom

Upload a video with optional overrides. Generates the same **4 quality variants in parallel** as `/compress/auto`, with the supplied parameters applied on top of each profile's defaults.

**Override behaviour:**
- `codec` — replaces `libx264` for all variants; `vp9` outputs `.webm`
- `resolution` — caps each variant's scale target (never upscales beyond the profile's natural cap)
- `framerate` — applied to all 4 variants

All override parameters are optional. Submitting none produces the same result as `/compress/auto`.

**Request** — `multipart/form-data`

| Field | Type | Required | Validation |
|-------|------|----------|-----------|
| `video` | file | ✅ | see MIME types above |
| `codec` | string | ✗ | One of: `libx264`, `libx265`, `vp9`, `libvpx`, `mpeg4` |
| `resolution` | string | ✗ | Pattern `^\d+x\d+$` e.g. `1920x1080` |
| `framerate` | integer | ✗ | Positive integer e.g. `24`, `30`, `60` |

#### Codec Options

| Value | Standard | Container | Compatibility | Compression | Best For |
|-------|----------|-----------|---------------|-------------|----------|
| `libx264` | H.264 / AVC | `.mp4` | ⭐⭐⭐⭐⭐ Universal | Good | Default — broadest device support (TV, mobile, browser, CDN) |
| `libx265` | H.265 / HEVC | `.mp4` | ⭐⭐⭐ Modern devices | ~2× better than H.264 | Same quality at half the file size; requires modern hardware decoder |
| `vp9` | VP9 | `.webm` | ⭐⭐⭐⭐ Browsers | ~1.5× better than H.264 | Web streaming, YouTube, Chrome/Firefox; royalty-free |
| `libvpx` | VP8 | `.webm` | ⭐⭐⭐⭐ Browsers | Similar to H.264 | Older WebM targets; broader browser support than VP9 on legacy browsers |
| `mpeg4` | MPEG-4 Part 2 | `.mp4` | ⭐⭐⭐⭐ Wide | Moderate | Legacy compatibility, older media players, lower CPU overhead |

> **Note:** `vp9` and `libvpx` output `.webm` files instead of `.mp4`. The filename and `downloadUrl` in the response will reflect the correct extension automatically.

**Response 200**
```json
{
  "success": true,
  "message": "All custom variants generated successfully.",
  "data": {
    "jobId": "f9e8d7c6-...",
    "appliedParams": {
      "codec": "libx265",
      "resolution": "1920x1080",
      "framerate": 30
    },
    "variants": [
      { "variant": "master", "filename": "video_master.mp4", "downloadUrl": "http://localhost:3020/outputs/f9e8d7c6-.../video_master.mp4" },
      { "variant": "high",   "filename": "video_high.mp4",   "downloadUrl": "http://localhost:3020/outputs/f9e8d7c6-.../video_high.mp4" },
      { "variant": "medium", "filename": "video_medium.mp4", "downloadUrl": "http://localhost:3020/outputs/f9e8d7c6-.../video_medium.mp4" },
      { "variant": "low",    "filename": "video_low.mp4",    "downloadUrl": "http://localhost:3020/outputs/f9e8d7c6-.../video_low.mp4" }
    ]
  }
}
```

**Example — codec only**
```bash
curl -X POST http://localhost:3020/compress/custom \
  -F "video=@/path/to/my-ad.mp4" \
  -F "codec=libx265"
```

**Example — resolution + framerate**
```bash
curl -X POST http://localhost:3020/compress/custom \
  -F "video=@/path/to/my-ad.mp4" \
  -F "resolution=1280x720" \
  -F "framerate=30"
```

**Example — all parameters**
```bash
curl -X POST http://localhost:3020/compress/custom \
  -F "video=@/path/to/my-ad.mp4" \
  -F "codec=libx264" \
  -F "resolution=1920x1080" \
  -F "framerate=25"
```

**Error Responses**

| Scenario | Status | Message |
|----------|--------|--------|
| No file uploaded | 400 | `No video file provided` |
| Unsupported file type | 400 | `Unsupported file type: video/x-flv` |
| Invalid codec | 400 | `Invalid codec "h264". Allowed values: libx264, libx265, vp9, libvpx, mpeg4` |
| Invalid resolution | 400 | `Invalid resolution "1920x". Must match pattern \d+x\d+` |
| Invalid framerate | 400 | `Invalid framerate "abc". Must be a positive integer` |
| FFmpeg failure | 500 | `FFmpeg process exited with code 1` |
| Timeout | 500 | `Timeout exceeded (600s) for all custom variants` |

---

### POST /compress/percent

Upload a single video. Generates **4 variants scaled at fixed percentages of the original resolution** in parallel. Aspect ratio is always preserved — no upscaling, no cropping.

This is useful when you need outputs that are proportionally smaller than the source (e.g. a 9:16 portrait video stays 9:16 at every scale level), without being constrained by any absolute resolution cap.

**Request** — `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| `video` | file | ✅ |

**Accepted MIME types:** `video/mp4`, `video/quicktime`, `video/x-msvideo`, `video/x-matroska`, `video/webm`, `video/mpeg`

**Response 200**
```json
{
  "success": true,
  "message": "All percentage variants generated successfully.",
  "data": {
    "jobId": "b3c4d5e6-...",
    "variants": [
      { "variant": "master", "scale": "100%", "filename": "video_master.mp4", "downloadUrl": "http://localhost:3020/outputs/b3c4d5e6-.../video_master.mp4" },
      { "variant": "high",   "scale": "75%",  "filename": "video_high.mp4",   "downloadUrl": "http://localhost:3020/outputs/b3c4d5e6-.../video_high.mp4" },
      { "variant": "medium", "scale": "50%",  "filename": "video_medium.mp4", "downloadUrl": "http://localhost:3020/outputs/b3c4d5e6-.../video_medium.mp4" },
      { "variant": "low",    "scale": "25%",  "filename": "video_low.mp4",    "downloadUrl": "http://localhost:3020/outputs/b3c4d5e6-.../video_low.mp4" }
    ]
  }
}
```

**Example**
```bash
curl -X POST http://localhost:3020/compress/percent \
  -F "video=@/path/to/my-ad.mp4"
```

#### Scale Profiles

| Variant | Scale | Example output (from 1920×1080 source) | Codec | Bitrate |
|---------|-------|-----------------------------------------|-------|--------|
| master  | 100%  | 1920×1080 | H.264 High 5.1 | CRF 18 |
| high    | 75%   | 1440×810  | H.264 High 4.2 | 8 Mbps |
| medium  | 50%   | 960×540   | H.264 Main 4.0 | 4 Mbps |
| low     | 25%   | 480×270   | H.264 Baseline 3.0 | 2 Mbps |

#### How the scale filter works

FFmpeg scale expression used per variant:

```
# master (100%) — just enforce even pixel counts
scale=trunc(iw/2)*2:trunc(ih/2)*2

# high (75%)
scale=trunc(iw*0.75/2)*2:trunc(ih*0.75/2)*2

# medium (50%)
scale=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2

# low (25%)
scale=trunc(iw*0.25/2)*2:trunc(ih*0.25/2)*2
```

- `trunc(.../ 2) * 2` ensures both dimensions are always even integers — a hard requirement for H.264
- No `force_original_aspect_ratio` flag needed — the factor is applied equally to width and height, so ratio is mathematically preserved
- Does **not** probe source dimensions at runtime; the FFmpeg expression is evaluated during encoding

#### Comparison with `/compress/auto`

| | `/compress/auto` | `/compress/percent` |
|---|---|---|
| Scale target | Absolute `maxWidth × maxHeight` cap | % of original resolution |
| master | ≤ 3840×2160 | 100% of source |
| high | ≤ 1920×1080 | 75% of source |
| medium | ≤ 1280×720 | 50% of source |
| low | ≤ 854×480 | 25% of source |
| Best for | Normalising mixed-res content to standard delivery sizes | Proportional downsizing of a known-good source |
| Portrait / vertical video | Fits within the bounding box | Scales uniformly in both axes |

**Error Responses**

| Scenario | Status | Message |
|----------|--------|--------|
| No file uploaded | 400 | `No video file provided` |
| Unsupported file type | 400 | `Unsupported file type: video/x-flv` |
| FFmpeg failure | 500 | `FFmpeg process exited with code 1` |
| Timeout | 500 | `Timeout exceeded (600s) for all percent variants` |

---

## Quality Profiles

### `/compress/auto` and `/compress/custom`

Both endpoints produce the same 4 output files using absolute resolution caps. `/compress/custom` overrides are applied on top of these defaults.

| Variant | Output File | Max Resolution | Codec | Bitrate |
|---------|-------------|----------------|-------|---------|
| master | `video_master.mp4` | 3840×2160 (4K) | H.264 High 5.1 | CRF 18 |
| high | `video_high.mp4` | 1920×1080 | H.264 High 4.2 | 8 Mbps |
| medium | `video_medium.mp4` | 1280×720 | H.264 Main 4.0 | 4 Mbps |
| low | `video_low.mp4` | 854×480 | H.264 Baseline 3.0 | 2 Mbps |

### `/compress/percent`

Outputs are proportionally scaled from the original source resolution.

| Variant | Output File | Scale | Codec | Bitrate |
|---------|-------------|-------|-------|---------|
| master | `video_master.mp4` | 100% of source | H.264 High 5.1 | CRF 18 |
| high | `video_high.mp4` | 75% of source | H.264 High 4.2 | 8 Mbps |
| medium | `video_medium.mp4` | 50% of source | H.264 Main 4.0 | 4 Mbps |
| low | `video_low.mp4` | 25% of source | H.264 Baseline 3.0 | 2 Mbps |

**Notes (all endpoints):**
- `/compress/auto` and `/compress/percent` preserve aspect ratio — no stretch or crop ever occurs
- All outputs use `-movflags +faststart` for HTTP progressive streaming
- `vp9` codec (custom mode only) outputs `.webm` instead of `.mp4`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3020` | HTTP listen port |
| `MAX_FILE_SIZE_MB` | `500` | Max upload size |
| `OUTPUT_DIR` | `os.tmpdir()/outputs` | Directory for compressed output files |
| `BASE_URL` | auto-detected from request | Base URL prepended to `downloadUrl` values |

---

## How It Works

1. Uploaded file is saved to `os.tmpdir()/uploads/<uuid><ext>` via multer
2. A unique `jobId` (UUID v4) is generated; output files go to `os.tmpdir()/outputs/<jobId>/`
3. Source duration is probed by running `ffmpeg -i` and parsing the `Duration:` line from stderr
4. All 4 FFmpeg encode jobs are launched simultaneously with `Promise.all`
5. Progress is reported as a real percentage (`timemark / duration × 100`) instead of relying on `p.percent`
6. A 10-minute timeout is enforced across all jobs
7. On success the response is sent with all 4 download URLs pointing to `/outputs/<jobId>/`
8. Input file is deleted immediately after the response is flushed; output directory is deleted after `OUTPUT_TTL_MIN` (default 60 minutes)

---

## H.264 Level Reference Table

The `level` parameter in each variant (see `profile` and `level` in the quality table) is chosen to match the target resolution and bitrate, ensuring compatibility and efficient playback on various devices. If the level is set too high, older devices may not be able to play the video; if too low, FFmpeg may fail or reduce quality.

| Level | Max Resolution (fps)   | Max Bitrate (kbps) | Typical Use Case           |
|-------|------------------------|--------------------|---------------------------|
| 1     | QCIF (176x144@15)      | 64                 | Very low-res, mobile old  |
| 1.1   | QCIF (176x144@30)      | 192                | Very low-res, mobile old  |
| 1.2   | CIF (352x288@15)       | 384                | Very low-res, mobile old  |
| 1.3   | CIF (352x288@30)       | 768                | Very low-res, mobile old  |
| 2     | CIF (352x288@30)       | 2000               | SD low                    |
| 2.1   | 352x576@30             | 4000               | SD                        |
| 2.2   | 720x576@15             | 4000               | SD                        |
| 3     | 720x576@30             | 10000              | SD, DVD                   |
| 3.1   | 1280x720@30            | 14000              | HD Ready                  |
| 3.2   | 1280x720@60            | 20000              | HD Ready 60fps            |
| 4     | 1920x1080@30           | 20000              | Full HD                   |
| 4.1   | 1920x1080@60           | 50000              | Full HD 60fps             |
| 4.2   | 2048x1024@60           | 50000              | 2K                        |
| 5     | 3840x2160@30           | 135000             | 4K UHD                    |
| 5.1   | 4096x2304@30           | 240000             | 4K UHD                    |
| 5.2   | 4096x2304@60           | 240000             | 4K UHD 60fps              |

**Tips:**
- Choose the lowest level that supports your target resolution and bitrate for maximum compatibility.
- See [Wikipedia: H.264/MPEG-4 AVC Levels](https://en.wikipedia.org/wiki/H.264/MPEG-4_AVC#Levels) for more details.
