# Video Compression Service - PRD

## Document Info

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Created By | Rifqi Fadh |
| Last Updated | 08 September 2025 |
| Target Release | Q3 2025 |
| Status | Grooming |

## Team

**Backend:** [Miftach Hidayatullah](mailto:miftach.hidayatullah@stickearn.com), [Herdian Adi Winarno](mailto:herdian.winarno@stickearn.com)

**QA:** [Muhammad Anwar Sanusi](mailto:anwar.sanusi@stickearn.com), [Agung Dewa Pratama](mailto:agung.pratama@stickearn.com)

**Related:** [BRD - Screen App Revamp/Improvement](https://docs.google.com/document/u/0/d/1ZAmmdF-P_sjknSG_sjATsu-ulWg118tH2h_Nl9OS444/edit)

## The Problem

59 screens use our CMS with different hardware capabilities but receive the same video quality, causing playback failures on weaker devices.

## 2-Week Experiment Plan

### Week 1: Backend Changes

**Goal:** Auto-create 3 video variants on upload

**Tasks:**
- Modify FFmpeg pipeline at `/api/.../media`
- Generate: High (1080p/8Mbps), Medium (720p/4Mbps), Low (480p/2Mbps)
- Name: `video_high.mp4`, `video_medium.mp4`, `video_low.mp4`

### Video Quality Variants

| Quality | Resolution | Codec | Bitrate | Use Case |
|---------|-----------|-------|---------|----------|
| **Master** | 3840×2160 (4K) | H.264/HEVC | 30-60 Mbps | Premium LED, high-end controllers |
| **High (1080p)** | 1920×1080 | H.264 High 4.2 | 8 Mbps | Most digital billboards |
| **Medium (720p)** | 1280×720 | H.264 Main 3.2-4.0 | 2-6 Mbps | Legacy PCs, basic decoders |
| **Low (480p)** | 854×480 | H.264 Baseline | 2 Mbps | Weak hardware, guaranteed compatibility |

### Week 2: UI + Testing

**Goal:** Enable quality selection and validate improvements

**Tasks:**
- Add quality dropdown in playlist creation
- Test with 3-5 publishers with known hardware issues
- Measure playback performance on problem screens

## Success Criteria

✅ Auto-generate 3 variants per upload  
✅ Publishers can select quality level  
✅ ≥1 publisher reports improved performance  
✅ Conversion completes within 10 minutes  

## Failure Criteria

❌ Storage costs increase >4x  
❌ Publishers confused by options  
❌ No measurable performance improvement  

## Technical Requirements

**Backend:**
- Modify FFmpeg to output 3 files
- Implement naming convention
- API returns all variants

**Frontend:**
- Quality dropdown (default: Medium)
- Simple, no preview needed

**No Changes:**
- Screen App download logic
- Database schema

## Resource Requirements

- **Storage:** 3x current space (temporary)
- **Testing:** Rifqi + 3-5 volunteer publishers

## Post-Experiment Decisions

**Success → Scale:**
- Rollout to all publishers
- Add automatic quality recommendation
- Optimize storage/speed

**Failure → Pivot:**
- Try different bitrates/formats
- Focus on specific publishers
- Explore alternative approaches

**Mixed → Iterate:**
- Adjust quality settings
- Simplify selection
- Test different content types

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Storage concerns | Start with 10 test videos |
| Performance issues | Process async; use original while generating |
| Publisher confusion | Clear labels: "Best", "Good", "Compatible" |
| No improvement | Validate what doesn't work |

## Core Question

**Can manually selecting lower quality variants improve playback on problem screens?**

Everything else is secondary.

