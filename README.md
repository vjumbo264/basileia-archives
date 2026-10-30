# PAV Podcast — Private Sermon Archive & Listening Site

A private sermon archive and mobile-first streaming application for **"The Truth Simply Put — with PAV"** (publisher: The Basileia Commission), built for Victor (**MOTIONSALT**).

- **GitHub Repository (Private)**: [`vjumbo264/pav-podcast`](https://github.com/vjumbo264/pav-podcast)
- **Live Cloudflare Worker Site**: [`https://pav-podcast.vjumbo264.workers.dev`](https://pav-podcast.vjumbo264.workers.dev)

---

## 1. Architecture Overview

```
Podbean RSS ──► GitHub Actions "ingest" (chained, resumable)
                  │  download → ffmpeg convert (mono AAC 64k + embedded art + tags)
                  │  → upload to GitHub Release (one release per year: audio-YYYY)
                  │  → covers: generate web-optimised WebP (thumb 320x320 & large 800x800)
                  └► commit episodes.json (state + metadata) to repo

Browser ──► Cloudflare Worker (password gate)
              ├ serves the mobile-first web app
              ├ /api/episodes   (episodes.json, edge-cached)
              ├ /cover/:id/:size (WebP covers)
              └ /audio/:id      (Range-capable streaming proxy for private release assets; ?download=1 for downloads)
```

---

## 2. Audio Conversion Specification

Every sermon in the 512-episode catalog is converted using `ffmpeg` to:
- **Codec**: AAC-LC (`mp4a`)
- **Channels**: 1 (Mono, `-ac 1`)
- **Bitrate**: 64 kbps (`-b:a 64k`)
- **Sample Rate**: 44.1 kHz (`-ar 44100`)
- **Optimization**: `+faststart` (moov atom placed at front for zero-buffer instant seeking)
- **Embedded Cover Art**: Square 600×600 JPEG attached picture (`disposition:v:0 attached_pic`)
- **ID3 / MP4 Metadata**: Title, artist (The Basileia Commission), album (The Truth Simply Put with PAV), date, track number, genre (Podcast)
- **Compression Efficiency**: Reduces ~150–200 MB source files to ~25–40 MB (~0.48 MB/minute), maintaining speech clarity while drastically saving bandwidth on mobile networks.

---

## 3. Chained Ingest Pipeline & Safety Net

The ingestion workflow (`.github/workflows/ingest.yml`):
1. **Pulls & Merges Feed**: Fetches `https://feed.podbean.com/thetruthsimplyput/feed.xml`, merges new items into `episodes.json` without dropping existing records, ordered chronologically (oldest first).
2. **Batch Processing**: Encodes pending episodes one by one, validates output using `ffprobe` (duration within 2s, 1-channel AAC, attached picture stream), uploads to the appropriate `audio-YYYY` GitHub release, and commits/pushes state to git after each episode.
3. **Time Budget (4h15m / 255 min)**: Runs gracefully halt starting new episodes before reaching GitHub's 6-hour job cap.
4. **Self-Dispatch Chaining**: When a run finishes and pending episodes remain, it automatically calls `gh workflow run ingest.yml` to trigger the next execution chain.
5. **Safety Net**: A cron job triggers every 3 hours (`0 */3 * * *`) to check for new episodes and automatically resume any broken chain.
6. **Actions-Minutes Calculation**: Encoding operates at ~170×–185× real-time speed (~15–20 seconds CPU per episode). The entire 512-episode catalog takes approximately 300–350 total Actions runner minutes, comfortably inside GitHub's free 2,000 minutes/month tier.

---

## 4. Manual Triggers & Maintenance

### Triggering Ingestion Manually
1. Navigate to **Actions** > **Ingest Podcast Episodes** in the GitHub repo.
2. Click **Run workflow**.
3. (Optional) Provide:
   - `force_episode`: Specify an episode ID (e.g. `0003-f465df4b`) or episode number (e.g. `3`) to reprocess a specific message.
   - `reprocess_failed`: Set to `true` to retry episodes marked as failed.
   - `limit`: Set a maximum count of episodes to process in that run (e.g. `10`).

---

## 5. Cloudflare Worker & Streaming Audio Proxy

### Zero-Storage Streaming Proxy (`/audio/:id`)
1. Looks up the episode in `episodes.json` and retrieves the private GitHub Release `asset_id`.
2. Calls the GitHub Release Asset API with `Authorization: Bearer <GITHUB_TOKEN_READ>` and `redirect: manual`.
3. GitHub returns a `302 Found` with an Amazon S3 signed URL.
4. The Worker fetches the signed S3 URL **without Authorization headers**, forwarding the client's `Range` header.
5. Streams the response back with `206 Partial Content`, `Content-Range`, `Accept-Ranges: bytes`, and `Content-Type: audio/mp4`.
6. Adding `?download=1` sets `Content-Disposition: attachment; filename="<Friendly Title>.m4a"`.

### Password Gate & Cookie Authentication
- Every endpoint (`/`, `/api/*`, `/cover/*`, `/audio/*`) is protected behind constant-time password comparison.
- On successful login, the Worker issues a signed `pav_session` cookie containing an HMAC-SHA256 signature over an expiry timestamp using `SESSION_SECRET` (valid for 30 days).
- **Rate-limit / Brute-force Delay**: Incorrect attempts incur an artificial 1200ms delay.
- **Bypassing the Gate**: Set the environment variable `PASSWORD_ENABLED = "false"` in `wrangler.toml` (or Cloudflare dashboard) to disable the gate entirely.
- **Password Change**: Change `SITE_PASSWORD` in Cloudflare Worker secrets.
- **Session Logout for All Users**: Rotate `SESSION_SECRET` in Cloudflare Worker secrets.

---

## 6. Secrets & Hygiene

No secrets or tokens are stored in the git repository or code.

### GitHub Actions Secrets
(Configured under **Settings** > **Secrets and variables** > **Actions**):
- `CLOUDFLARE_API_TOKEN`: Cloudflare token with Workers deployment permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier.

### Cloudflare Worker Secrets
(Configured on the Worker `pav-podcast` via Cloudflare API / Dashboard):
- `GITHUB_TOKEN_READ`: Personal Access Token with read access to repository contents and release assets.
- `SITE_PASSWORD`: Access password for the site (configured secret).
- `SESSION_SECRET`: 32+ byte random hex string for HMAC-SHA256 cookie signing.

---

## 7. Current Project Status

- **Phase 1 (Pipeline)**: **COMPLETE**. Feed verified (512 episodes), `episodes.json` catalog generated, audio transcode pipeline tested, release assets created, chained workflow committed, pilot episodes verified.
- **Phase 2 (Worker)**: **COMPLETE**. Cloudflare Worker deployed to `https://pav-podcast.vjumbo264.workers.dev`, secrets provisioned, password gate tested, Range audio proxy verified with 206 Partial Content.
- **Phase 3 (Website)**: **COMPLETE**. Mobile-first listening UI implemented with search, year chips, featured card, sticky mini-player with speed controls, MediaSession API, and position memory.
- **Phase 4 (UI Refinement)**: **RESERVED FOR A FRESH SESSION** (per specification; not started).