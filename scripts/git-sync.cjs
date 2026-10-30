const cp = require('child_process');
const fs = require('fs');
const path = require('path');

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

const msg = process.argv[2] || 'Update project progress';
const pat = getPat();
const repo = process.env.GITHUB_REPOSITORY || 'vjumbo264/basileia-archives';

try {
  // 1. Stage changes
  cp.execSync('git add -A', { stdio: 'inherit' });

  // 2. Commit if there are changes
  try {
    cp.execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'inherit' });
  } catch (e) {
    console.log('No new changes to commit.');
  }

  // 3. Rebase to catch up with any remote changes
  if (pat) {
    const remoteUrl = `https://x-access-token:${pat}@github.com/${repo}.git`;
    try {
      cp.execSync(`git pull --rebase ${remoteUrl} main`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('Rebase notice:', e.message);
    }
    cp.execSync(`git push ${remoteUrl} main`, { stdio: 'ignore' });
  } else {
    try {
      cp.execSync('git pull --rebase origin main', { stdio: 'inherit' });
    } catch (e) {
      console.warn('Rebase notice:', e.message);
    }
    cp.execSync('git push origin main', { stdio: 'inherit' });
  }

  console.log('Sync to GitHub main completed successfully.');
} catch (err) {
  console.error('Sync failed:', err.message);
  process.exit(1);
}
