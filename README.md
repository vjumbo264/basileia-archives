# Basileia Archives — Public Sermon Archive & Listening Site

A free, public, mobile-first sermon archive and listening application for **"The Truth Simply Put — with PAV"**, featuring the messages of **Pastor Alexander Victor ("PAV")**, published by **The Basileia Commission**, built for Victor (**MOTIONSALT**).

- **GitHub Repository (Public)**: [`vjumbo264/basileia-archives`](https://github.com/vjumbo264/basileia-archives)
- **Live Cloudflare Site**: [`https://basileia-archives.vjumbo264.workers.dev`](https://basileia-archives.vjumbo264.workers.dev)

---

## 1. Architecture Overview

```
Podbean RSS ──► GitHub Actions "ingest" (chained, resumable)
                  │  download → ffmpeg convert (mono AAC 64k + embedded art + tags)
                  │  → upload to public GitHub Releases (one release per year: audio-YYYY)
                  │  → covers: generate web-optimised WebP (thumb 320x320 & large 800x800)
                  │  → commit episodes.json (full state) + catalog.json (slim public catalog)
                  └► commits data/last-checked.json (keep-alive, at most once every 25–30 days)

Browser ──► Static Site "Basileia Archives" (Cloudflare Workers Static Assets / Pages)
              ├ fetches catalog.json directly from public repo or CDN (cross-origin, zero proxy)
              ├ <audio controls> streams directly from public GitHub release asset URLs
              ├ Download button → triggers direct download from GitHub release asset URL
              └ (Optional contingency proxy route /api/audio-proxy for strict clients like Safari)
```

---

## 2. Phase A Audit Findings & Reconciled Numbers

During the v2 pipeline audit, all sources and release assets were audited and verified:

| Source / Metric | Count | Details & Notes |
| :--- | :--- | :--- |
| **Podbean Main RSS Feed** | **512 items** | Clean XML feed from 2016 to 2026. All 512 parsed successfully. |
| **Apple Podcasts (iTunes)** | **514 tracks** | Apple caches 2 historical/draft entries; feedUrl points to the same Podbean feed. |
| **Podbean Web Archive** | **512 episodes** | Mirrored across `thetruthsimplyput.podbean.com`. |
| **Second Podbean Page** | **0 / Invalid** | `thebasileiacommission.podbean.com` redirects to Podbean login with "Invalid Podbean Site(2)" error. No extra messages exist there. |
| **Current Episodes State** | **512 total** | 123 completed, 389 pending, 0 failed. |
| **GitHub Release Assets** | **123 assets** | Exactly 123 non-zero audio assets matched across tags `audio-2016` through `audio-2024`. |

### Breakdown by Year (Feed vs Ingested):
- **2016**: 5 in feed (4 completed, 1 pending)
- **2017**: 8 in feed (7 completed, 1 pending)
- **2018**: 33 in feed (12 completed, 21 pending)
- **2019**: 38 in feed (21 completed, 17 pending)
- **2020**: 55 in feed (26 completed, 29 pending)
- **2021**: 53 in feed (14 completed, 39 pending)
- **2022**: 63 in feed (21 completed, 42 pending)
- **2023**: 61 in feed (16 completed, 45 pending)
- **2024**: 66 in feed (2 completed, 64 pending)
- **2025**: 67 in feed (0 completed, 67 pending)
- **2026**: 63 in feed (0 completed, 63 pending)

### Why 2024 (and other years) had pending messages:
1. **Flaky Node HTTPS Downloads**: The v1 pipeline used Node's basic `https.get` without retries, keepalive, or timeouts. When downloading multi-megabyte audio files or repeating downloads of the same cover image, Podbean's CDN closed idle connections with `socket hang up`. The loop caught the error and skipped to the next episode, leaving dozens of episodes in `pending`.
2. **Git Push Race Condition**: The old `git-sync.cjs` failed on `git push` whenever any external or concurrent commit existed because it lacked `git pull --rebase origin main`.
3. **Actions Minute Exhaustion on Private Repo**: The repo was private, consuming GitHub Actions minutes, and every commit triggered the deploy workflow because of missing path filters.
4. **Resolution**: Switched to resilient `curl` with exponential backoff (`--retry 4 --retry-delay 3`), global in-memory cover art deduplication, path filtering on deploy workflow, and transitioned the repository to **PUBLIC** for unlimited standard runner minutes.

---

## 3. Audio Conversion Specification

Every sermon is converted using `ffmpeg` to:
- **Codec**: AAC-LC (`mp4a`)
- **Channels**: 1 (Mono, `-ac 1`)
- **Bitrate**: 64 kbps (`-b:a 64k`)
- **Sample Rate**: 44.1 kHz (`-ar 44100`)
- **Container**: MP4 / M4A with `+faststart` (moov atom placed at front for zero-buffering instant seeking)
- **Embedded Cover Art**: Square 600×600 JPEG attached picture (`disposition:v:0 attached_pic`)
- **ID3 / MP4 Metadata**: Title, artist (The Basileia Commission), album (The Truth Simply Put with PAV), date, track number, genre (Podcast)
- **Size Savings**: Reduces 100–200 MB source MP3s to ~20–35 MB (~0.48 MB/minute) with crisp vocal presence.

---

## 4. Chained Ingest Pipeline & Safety Net

The ingestion workflow (`.github/workflows/ingest.yml`):
1. **RSS Feed Sync**: Runs `node scripts/init-feed.cjs` to fetch `https://feed.podbean.com/thetruthsimplyput/feed.xml`, merges new items into `episodes.json` without modifying completed episodes, and regenerates `catalog.json`.
2. **Resilient Processing**: Encodes pending episodes one by one, validates output using `ffprobe` (1-channel AAC + attached cover art stream), uploads to the appropriate public release tag `audio-YYYY`, updates state, and commits/pushes to git.
3. **Time Budget (4h15m / 255 min)**: Runs gracefully halt starting new episodes before GitHub's 6-hour job cap.
4. **Self-Dispatch Chaining**: When a run finishes and pending episodes remain, it dispatches the next run:
   ```bash
   gh workflow run ingest.yml --repo "${{ github.repository }}"
   ```
5. **Safety Net**: A cron job triggers every 3 hours (`0 */3 * * *`) to check for new episodes and automatically resume any interrupted chain.
6. **Keep-Alive (60-day auto-disable prevention)**: Public GitHub repositories disable scheduled workflows after 60 days of repository inactivity. The ingest script checks `data/last-checked.json` and commits an update at most once every 25–30 days if no new episodes were published, ensuring the scheduled cron remains active forever.

---

## 5. Slim Public `catalog.json`

`catalog.json` contains only what the frontend requires:
- `id`, `number`, `title`, `date`, `year`, `durationSeconds`, `bytes`, `description` (plain text, trimmed to 300 chars)
- `audioUrl`: Full public release download URL (`https://github.com/vjumbo264/basileia-archives/releases/download/<tag>/<asset>`)
- `coverThumbUrl`: Direct URL to WebP 320×320 thumb in GitHub raw storage
- `coverLargeUrl`: Direct URL to WebP 800×800 image in GitHub raw storage

The frontend fetches this file cross-origin at runtime from `https://raw.githubusercontent.com/vjumbo264/basileia-archives/main/catalog.json`, ensuring newly completed sermons appear immediately without redeploying the static site.

---

## 6. Manual Triggers & Maintenance

### Triggering Ingestion Manually
1. Navigate to **Actions** > **Ingest Podcast Episodes** in the GitHub repo.
2. Click **Run workflow**.
3. (Optional) Provide:
   - `force_episode`: Specify an episode ID (e.g. `0005-5ac15abe`) or episode number (e.g. `5`) to reprocess a specific message.
   - `reprocess_failed`: Set to `true` to retry any failed episodes.
   - `limit`: Set a maximum count of episodes to process in that run (e.g. `10`).

---

## 7. Cloudflare Secrets Configuration

Configured under **Settings** > **Secrets and variables** > **Actions** in GitHub:
- `CLOUDFLARE_API_TOKEN`: Cloudflare API Token with Workers & Pages deployment permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier (`1695bfc7422ac8004179e99f3cdd60c1`).

*Note: All v1 passwords, session cookies, and read-token secrets (`SITE_PASSWORD`, `SESSION_SECRET`, `GITHUB_TOKEN_READ`) have been completely deleted and removed.*