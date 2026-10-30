const cp = require('child_process');
const fs = require('fs');
const path = require('path');

function getPat() {
  if (process.env.GH_PAT) return process.env.GH_PAT;
  const credPath = path.resolve(__dirname, '../.local_credentials.json');
  if (fs.existsSync(credPath)) {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return creds.GITHUB_PAT;
  }
  return null;
}

const msg = process.argv[2] || 'Update project progress';
const pat = getPat();

if (!pat) {
  console.error('No GH_PAT available');
  process.exit(1);
}

try {
  cp.execSync('git add -A', { stdio: 'inherit' });
  try {
    cp.execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'inherit' });
  } catch (e) {
    console.log('No new changes to commit.');
  }
  const remoteUrl = `https://vjumbo264:${pat}@github.com/vjumbo264/pav-podcast.git`;
  cp.execSync(`git push ${remoteUrl} main`, { stdio: 'ignore' });
  console.log('Sync to GitHub main completed successfully.');
} catch (err) {
  console.error('Sync failed:', err.message);
  process.exit(1);
}
