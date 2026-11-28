// Fails when a file cached for offline use changed but sw.js VERSION did not.
// Usage: node scripts/check-sw-version.mjs <base-ref>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const version = source => /var VERSION = '([^']+)'/.exec(source)?.[1];

const current = readFileSync('sw.js', 'utf8');
const assets = JSON.parse('[' + /var ASSETS = \[([^\]]*)\]/.exec(current)[1].replace(/'/g, '"') + ']')
  .map(path => (path === './' ? 'index.html' : path));
const changed = git('diff', '--name-only', base + '...HEAD').split('\n').filter(Boolean);
const cached = changed.filter(path => assets.includes(path));

let previous;
try { previous = version(git('show', base + ':sw.js')); } catch { previous = undefined; }

if (cached.length && version(current) === previous) {
  console.error('These offline-cached files changed: ' + cached.join(', '));
  console.error('Bump VERSION in sw.js (currently ' + previous + '), or visitors keep the old copy.');
  process.exit(1);
}
console.log(cached.length ? 'sw.js VERSION bumped: ' + previous + ' -> ' + version(current) : 'No cached files changed.');
