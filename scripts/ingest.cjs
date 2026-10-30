const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const cp = require('child_process');

function getPat() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_PAT) return process.env.GH_PAT;
  const credPath = path.resolve(__dirname, '../.local_credentials.json');
  if (fs.existsSync(credPath)) {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return creds.GITHUB_PAT;
  }
  return null;
}

const REPO_OWNER = 'vjumbo264';
const REPO_NAME = 'pav-podcast';

function ghApi(method, endpoint, body = null, extraHeaders = {}) {
  const token = getPat();
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'PAV-Podcast-Builder',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      ...extraHeaders
    };
    let payload = '';
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    } else if (Buffer.isBuffer(body)) {
      headers['Content-Length'] = body.length;
    }

    const req = https.request({
      hostname: 'api.github.com',
      path: endpoint,
      method,
      headers
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
      });
    });
    req.on('error', reject);
    if (Buffer.isBuffer(body)) req.write(body);
    else if (payload) req.write(payload);
    req.end();
  });
}

function uploadReleaseAsset(uploadUrl, assetName, filePath) {
  const token = getPat();
  const cleanUrl = uploadUrl.replace(/\{[^\}]*\}/g, '') + `?name=${encodeURIComponent(assetName)}`;
  const cmd = `curl -s -S -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -H "Content-Type: audio/mp4" --data-binary @"${filePath}" "${cleanUrl}"`;
  const stdout = cp.execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`Invalid JSON response from asset upload: ${stdout}`);
  }
  if (!json || !json.id) {
    throw new Error(`Asset upload failed: ${stdout}`);
  }
  return json;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    function get(currentUrl, redirectCount = 0) {
      if (redirectCount > 8) {
        return reject(new Error('Too many redirects'));
      }
      const req = https.get(currentUrl, {
        headers: { 'User-Agent': 'PAV-Podcast-Builder/1.0 (Mozilla/5.0 compatible)' }
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode} from ${currentUrl}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve());
        });
      });
      req.on('error', err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }
    get(url);
  });
}

async function getOrCreateRelease(year) {
  const tag = `audio-${year}`;
  const existing = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tag}`);
  if (existing.status === 200) {
    return existing.data;
  }
  if (existing.status === 404) {
    console.log(`Creating release for ${tag}...`);
    const created = await ghApi('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
      tag_name: tag,
      name: `PAV Podcast Audio ${year}`,
      body: `Optimized audio assets for PAV Podcast sermons from year ${year} (64 kbps mono AAC with embedded cover art).`,
      draft: false,
      prerelease: false
    });
    if (created.status === 201) {
      return created.data;
    }
    throw new Error(`Failed to create release ${tag}: ${JSON.stringify(created.data)}`);
  }
  throw new Error(`Error checking release ${tag}: status ${existing.status}`);
}

async function prepareCoverImages(imageUrl, workDir) {
  // Download source image to memory or temp file
  const tempSource = path.join(workDir, 'source_cover.img');
  await downloadFile(imageUrl, tempSource);
  const sourceBytes = fs.readFileSync(tempSource);
  const sha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');

  // Destination paths
  const thumbDir = path.resolve(__dirname, '../assets/covers/thumb');
  const largeDir = path.resolve(__dirname, '../assets/covers/large');
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.mkdirSync(largeDir, { recursive: true });

  const thumbPath = path.join(thumbDir, `${sha256}.webp`);
  const largePath = path.join(largeDir, `${sha256}.webp`);
  const embedJpgPath = path.join(workDir, 'cover_600.jpg');

  // Generate 600x600 JPEG for embedded audio art
  cp.execSync(`ffmpeg -y -i "${tempSource}" -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=600:600" -q:v 4 "${embedJpgPath}"`, { stdio: 'ignore' });

  // Generate WebP thumb if not existing
  if (!fs.existsSync(thumbPath)) {
    cp.execSync(`ffmpeg -y -i "${tempSource}" -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=320:320" -c:v libwebp -quality 80 "${thumbPath}"`, { stdio: 'ignore' });
  }

  // Generate WebP large if not existing
  if (!fs.existsSync(largePath)) {
    cp.execSync(`ffmpeg -y -i "${tempSource}" -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=800:800" -c:v libwebp -quality 82 "${largePath}"`, { stdio: 'ignore' });
  }

  return { sha256, embedJpgPath };
}

async function processEpisode(ep, episodesState) {
  const workDir = path.resolve(__dirname, `../work/ep-${ep.number}`);
  fs.mkdirSync(workDir, { recursive: true });

  console.log(`\n========================================`);
  console.log(`Processing #${ep.number}: "${ep.title}" (${ep.year})`);
  console.log(`Source: ${ep.source.enclosureUrl}`);

  try {
    // 1. Release check/creation
    const release = await getOrCreateRelease(ep.year);

    // 2. Cover image preparation
    const coverUrl = ep.source.imageUrl || episodesState.show.artwork;
    console.log(`Preparing covers from ${coverUrl}...`);
    const { sha256, embedJpgPath } = await prepareCoverImages(coverUrl, workDir);

    // 3. Audio download
    const rawAudioPath = path.join(workDir, 'source.audio');
    console.log(`Downloading audio...`);
    await downloadFile(ep.source.enclosureUrl, rawAudioPath);

    // 4. Conversion with ffmpeg
    const outputFileName = ep.suggestedAssetName || `${String(ep.number).padStart(4, '0')}-${ep.pubDate.slice(0, 10)}-episode.m4a`;
    const outAudioPath = path.join(workDir, outputFileName);
    const dateStr = ep.pubDate.slice(0, 10);

    console.log(`Encoding audio to 64k mono AAC + faststart + embedded art...`);
    const cleanTitle = ep.title.replace(/"/g, '\\"');
    const author = (episodesState.show.author || 'The Basileia Commission').replace(/"/g, '\\"');
    const album = 'The Truth Simply Put with PAV';

    const cmd = [
      'ffmpeg', '-y',
      '-i', `"${rawAudioPath}"`,
      '-i', `"${embedJpgPath}"`,
      '-map', '0:a:0',
      '-map', '1:v:0',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-ac', '1',
      '-ar', '44100',
      '-c:v', 'mjpeg',
      '-disposition:v:0', 'attached_pic',
      '-movflags', '+faststart',
      '-metadata', `title="${cleanTitle}"`,
      '-metadata', `artist="${author}"`,
      '-metadata', `album="${album}"`,
      '-metadata', `date="${dateStr}"`,
      '-metadata', `track="${ep.number}"`,
      '-metadata', `genre="Podcast"`,
      `"${outAudioPath}"`
    ].join(' ');

    cp.execSync(cmd, { stdio: 'inherit' });

    // 5. Validation with ffprobe
    console.log(`Validating converted file with ffprobe...`);
    const probeRaw = cp.execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${outAudioPath}"`, { encoding: 'utf8' });
    const probe = JSON.parse(probeRaw);

    const audioStream = probe.streams.find(s => s.codec_type === 'audio');
    const picStream = probe.streams.find(s => s.disposition && s.disposition.attached_pic === 1);

    if (!audioStream || audioStream.codec_name !== 'aac' || audioStream.channels !== 1) {
      throw new Error(`Validation failed: stream is not mono AAC (got ${audioStream?.codec_name}, channels: ${audioStream?.channels})`);
    }
    if (!picStream) {
      throw new Error(`Validation failed: missing attached cover art stream`);
    }

    const outBytes = fs.statSync(outAudioPath).size;
    if (outBytes < 1000000) {
      throw new Error(`Validation failed: output size suspiciously small (${outBytes} bytes)`);
    }

    // 6. Check existing asset in release and delete if duplicate
    const assetsRes = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/releases/${release.id}/assets`);
    if (assetsRes.status === 200 && Array.isArray(assetsRes.data)) {
      const existingAsset = assetsRes.data.find(a => a.name === outputFileName);
      if (existingAsset) {
        console.log(`Deleting existing release asset ID ${existingAsset.id}...`);
        await ghApi('DELETE', `/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingAsset.id}`);
      }
    }

    // 7. Upload to GitHub Release
    console.log(`Uploading asset to release ${release.tag_name} (${(outBytes / (1024 * 1024)).toFixed(2)} MB)...`);
    const fileBuffer = fs.readFileSync(outAudioPath);
    const uploadedAsset = await uploadReleaseAsset(release.upload_url, outputFileName, fileBuffer);
    console.log(`Uploaded successfully! Asset ID: ${uploadedAsset.id}`);

    // 8. Update episode state
    ep.audio = {
      releaseTag: release.tag_name,
      assetName: outputFileName,
      assetId: uploadedAsset.id,
      bytes: outBytes,
      codec: 'aac',
      channels: 1,
      bitrateKbps: 64
    };
    ep.cover = {
      sha256,
      hasOwn: !!ep.source.imageUrl && ep.source.imageUrl !== episodesState.show.artwork
    };
    ep.status = 'done';
    ep.attempts = (ep.attempts || 0) + 1;
    ep.lastError = null;

    console.log(`Done processing #${ep.number}!`);
  } catch (err) {
    console.error(`Error processing #${ep.number}:`, err.message);
    ep.attempts = (ep.attempts || 0) + 1;
    ep.lastError = err.message;
    if (ep.attempts >= 3) {
      ep.status = 'failed';
    }
  } finally {
    // Clean up temporary files for this episode
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function main() {
  const args = process.argv.slice(2);
  let limit = null;
  let forceId = null;
  let reprocessFailed = false;
  let maxMinutes = 255;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pilot') limit = 3;
    else if (args[i] === '--limit' && args[i+1]) limit = parseInt(args[++i], 10);
    else if (args[i] === '--force' && args[i+1]) forceId = args[++i];
    else if (args[i] === '--reprocess-failed') reprocessFailed = true;
    else if (args[i] === '--max-minutes' && args[i+1]) maxMinutes = parseInt(args[++i], 10);
  }

  const episodesPath = path.resolve(__dirname, '../episodes.json');
  if (!fs.existsSync(episodesPath)) {
    console.log('episodes.json not found, running init-feed.cjs first...');
    cp.execSync('node scripts/init-feed.cjs', { stdio: 'inherit' });
  }

  const state = JSON.parse(fs.readFileSync(episodesPath, 'utf8'));
  const startTime = Date.now();
  let processedCount = 0;

  // Filter episodes
  let queue = [];
  if (forceId) {
    queue = state.episodes.filter(e => e.id === forceId || String(e.number) === forceId);
  } else {
    queue = state.episodes.filter(e => {
      if (reprocessFailed && e.status === 'failed') return true;
      return e.status === 'pending';
    });
  }

  console.log(`Total episodes: ${state.episodes.length}, In queue: ${queue.length}, Limit: ${limit || 'None'}`);

  for (const ep of queue) {
    if (limit && processedCount >= limit) {
      console.log(`Reached limit of ${limit} episodes.`);
      break;
    }

    const elapsedMinutes = (Date.now() - startTime) / 60000;
    if (elapsedMinutes >= maxMinutes) {
      console.log(`Reached time budget of ${maxMinutes} minutes (${elapsedMinutes.toFixed(1)}m elapsed). Stopping.`);
      break;
    }

    await processEpisode(ep, state);
    processedCount++;

    // Save episodes.json after each episode
    state.generatedAt = new Date().toISOString();
    fs.writeFileSync(episodesPath, JSON.stringify(state, null, 2), 'utf8');

    // Sync to GitHub after each processed episode
    console.log('Syncing state to GitHub...');
    try {
      cp.execSync(`node scripts/git-sync.cjs "Ingest: process #${ep.number} (${ep.title.slice(0, 30)})"`, { stdio: 'inherit' });
    } catch (err) {
      console.error('Git sync warning:', err.message);
    }
  }

  const doneCount = state.episodes.filter(e => e.status === 'done').length;
  const pendingCount = state.episodes.filter(e => e.status === 'pending').length;
  const failedCount = state.episodes.filter(e => e.status === 'failed').length;

  console.log(`\n========================================`);
  console.log(`Batch finished. Done: ${doneCount}, Pending: ${pendingCount}, Failed: ${failedCount}`);
  console.log(`========================================\n`);
}

main().catch(err => {
  console.error('Fatal ingest error:', err);
  process.exit(1);
});
