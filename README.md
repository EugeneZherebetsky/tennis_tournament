# Table tennis mini-tournament

A dependency-free web app for running a 5-player, 2-table round-robin table
tennis tournament (UI in Russian). Enter names and scores; standings update
automatically. Everything is saved in the browser's `localStorage`.

- **Match to 11 or 21 points**: 11 = 8-min matches, 60-min event;
  21 = 12-min matches, 80-min event. Rules text, schedule and timer adapt.
- **Round timer**: sticky panel, warm-up → 5 × (play + changeover) → results;
  beep and vibration 1 min before the end and at each phase change; keeps the
  screen on (Wake Lock); survives page reloads.
- **Works offline** once opened (service worker) and can be added to the home
  screen (installable web app).
- Ranking: wins → head-to-head among tied players → point difference → points scored.

## Files
`index.html` (page) · `styles.css` · `app.js` · `sw.js` (offline cache) ·
`manifest.webmanifest` + icons.

**When you change any file, bump `VERSION` in `sw.js`**, otherwise visitors
keep getting the cached copy. Offline mode only works over http(s), not when
opening the file from disk.

## Hosting on a subdomain (GitHub Pages)

1. Merge this branch into `main`.
2. Repository → **Settings → Pages** → Source: *Deploy from a branch*,
   Branch: `main`, folder `/ (root)`.
3. In the same page set **Custom domain** to e.g. `tennis.example.com`
   (GitHub then commits a `CNAME` file) and tick **Enforce HTTPS** once the
   certificate is issued.
4. At your DNS provider add a record:
   `tennis  CNAME  eugenezherebetsky.github.io.`
5. Optional but recommended: verify the domain under your GitHub account
   (Settings → Pages → Verified domains) to prevent takeover.

Alternatives: Cloudflare Pages / Netlify / Vercel (connect the repo, no build
command, output dir `/`), or copy `index.html` to any static web server.

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the analysis and roadmap.
