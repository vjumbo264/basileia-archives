const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PAV-Podcast-Builder/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const str = durationStr.trim();
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }
  const parts = str.split(':').map(p => parseInt(p, 10) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'episode';
}

async function main() {
  const feedUrl = 'https://feed.podbean.com/thetruthsimplyput/feed.xml';
  console.log('Fetching feed from', feedUrl);
  const xml = await fetchUrl(feedUrl);

  const titleMatch = xml.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  const showTitle = titleMatch ? stripHtml(titleMatch[1]) : 'The Truth Simply Put — with PAV';

  const authorMatch = xml.match(/<itunes:author>([\s\S]*?)<\/itunes:author>/i) || xml.match(/<author>([\s\S]*?)<\/author>/i);
  const showAuthor = authorMatch ? stripHtml(authorMatch[1]) : 'The Basileia Commission';

  const descMatch = xml.match(/<channel>[\s\S]*?<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
  const showDescription = descMatch ? stripHtml(descMatch[1]) : '';

  const imgMatch = xml.match(/<itunes:image\s+href="([^"]+)"/i) || xml.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i);
  const showArtwork = imgMatch ? imgMatch[1].trim() : 'https://pbcdn1.podbean.com/imglogo/image-logo/3852959/TSP_DPjpg_4mnkqa.jpeg';

  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  const rawEpisodes = [];

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const itemTitle = (itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
    const pubDateStr = (itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    const guidRaw = (itemXml.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || '';
    const descRaw = (itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || [])[1] || '';
    const itunesImg = (itemXml.match(/<itunes:image\s+href="([^"]+)"/i) || [])[1] || '';
    const durationRaw = (itemXml.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/i) || [])[1] || '';

    const encMatch = itemXml.match(/<enclosure\s+([^>]+)>/i);
    let enclosureUrl = '';
    if (encMatch) {
      const u = encMatch[1].match(/url="([^"]+)"/i);
      if (u) enclosureUrl = u[1];
    }

    const pubDate = new Date(pubDateStr.trim());
    const cleanTitle = stripHtml(itemTitle);
    const cleanDesc = stripHtml(descRaw).slice(0, 500);
    const guid = guidRaw.trim() || enclosureUrl;

    rawEpisodes.push({
      guid,
      title: cleanTitle,
      pubDate,
      description: cleanDesc,
      durationSeconds: parseDuration(durationRaw),
      enclosureUrl,
      imageUrl: itunesImg.trim() || showArtwork,
      hasOwnCover: !!itunesImg.trim() && itunesImg.trim() !== showArtwork
    });
  }

  // Sort chronological: oldest first
  rawEpisodes.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());

  // Existing episodes.json if already exists
  let existingMap = new Map();
  const episodesPath = path.resolve(__dirname, '../episodes.json');
  if (fs.existsSync(episodesPath)) {
    try {
      const current = JSON.parse(fs.readFileSync(episodesPath, 'utf8'));
      if (Array.isArray(current.episodes)) {
        for (const ep of current.episodes) {
          existingMap.set(ep.guid, ep);
        }
      }
    } catch (e) {
      console.warn('Could not read existing episodes.json, starting fresh');
    }
  }

  const episodes = rawEpisodes.map((raw, index) => {
    const number = index + 1;
    const numPadded = String(number).padStart(4, '0');
    const guidHash = crypto.createHash('sha256').update(raw.guid).digest('hex').slice(0, 8);
    const id = `${numPadded}-${guidHash}`;
    const pubDateIso = raw.pubDate.toISOString();
    const year = raw.pubDate.getUTCFullYear();
    const slug = slugify(raw.title);
    const dateStr = pubDateIso.slice(0, 10);
    const assetName = `${numPadded}-${dateStr}-${slug}.m4a`;
    const friendlyTitle = `${numPadded} - ${dateStr} - ${raw.title.replace(/[\\/:*?"<>|]/g, '')}.m4a`;

    // Preserve existing status and audio metadata if already completed
    const existing = existingMap.get(raw.guid);
    if (existing && existing.status === 'done' && existing.audio) {
      return {
        ...existing,
        number,
        id,
        year
      };
    }

    return {
      id,
      guid: raw.guid,
      number,
      title: raw.title,
      pubDate: pubDateIso,
      year,
      description: raw.description,
      durationSeconds: raw.durationSeconds,
      source: {
        enclosureUrl: raw.enclosureUrl,
        imageUrl: raw.imageUrl
      },
      audio: null,
      friendlyDownloadName: friendlyTitle,
      suggestedAssetName: assetName,
      cover: {
        sha256: null,
        hasOwn: raw.hasOwnCover
      },
      status: 'pending',
      attempts: 0,
      lastError: null
    };
  });

  const state = {
    show: {
      title: showTitle,
      author: showAuthor,
      description: showDescription,
      artwork: showArtwork
    },
    generatedAt: new Date().toISOString(),
    totalEpisodes: episodes.length,
    episodes
  };

  fs.writeFileSync(episodesPath, JSON.stringify(state, null, 2), 'utf8');
  console.log(`Successfully generated episodes.json with ${episodes.length} episodes!`);
  console.log(`Oldest: #${episodes[0].number} - ${episodes[0].pubDate} - ${episodes[0].title}`);
  console.log(`Newest: #${episodes[episodes.length - 1].number} - ${episodes[episodes.length - 1].pubDate} - ${episodes[episodes.length - 1].title}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
