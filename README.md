# Table tennis mini-tournament

A single-page, dependency-free tool for running a 5-player, 2-table round-robin
table tennis tournament in 60 minutes (UI in Russian). Open `index.html` in any
browser: enter names, type scores, and the standings update automatically.
Data is saved in the browser's `localStorage`.

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
