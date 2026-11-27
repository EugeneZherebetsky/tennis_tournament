# Table tennis mini-tournament

A dependency-free web app for running a round-robin table
tennis tournament (UI in Russian). Confirm match results to update the rankings.
The organizer's tournament is saved in the browser's `localStorage`.

- **Tournament setup**: 2–24 players and 1–12 tables. The schedule assigns each
  pair one match and keeps rounds within the table limit.
- **Duration**: enter a total in minutes or leave it blank for automatic timing.
  The automatic match limit is 8 minutes for 11-point games and 12 minutes for
  21-point games. Both modes include a 5-minute warm-up, 2 minutes after play in
  each round, and 5 minutes for results. Custom totals allow at least one minute
  of play per round.
- **Round timer**: sticky panel, warm-up → rounds (play + changeover) → results;
  beep and vibration 1 min before the end and at each phase change; keeps the
  screen on (Wake Lock); survives page reloads.
- **Works offline** once opened (service worker) and can be added to the home
  screen (installable web app).
- Ranking: wins → head-to-head among tied players → point difference → points scored.
- **Player view**: choose a name to see the current assignment, next opponent,
  and personal schedule. The round, personal matches, and standings have quick links.
- **Shared standings**: opt in under **Настройки, участники и публикация**. The
  link shows the event, scores, and timer with automatic updates. The scorekeeper
  browser retains the edit key. Its **Остановить публикацию** button closes the
  shared link. A link expires after seven days without updates.

## Files
`index.html` (page) · `styles.css` · `tournament.js` (schedule and timing) · `app.js` · `sw.js` (offline cache) ·
`manifest.webmanifest` + icons.

**When you change any file, bump `VERSION` in `sw.js`**, otherwise visitors
keep getting the cached copy. Offline mode only works over http(s), not when
opening the file from disk.

## Deployment

Cloudflare Pages deploys `main` to `tennis.ezherebetskii.com`. The project
uses the repository root as its output directory and runs `exit 0` for its build.
Deployments with sharing need the `TENNIS_DB` D1 binding to the database created
with `database/boards.sql`. The `/api/boards` endpoint reports whether the
scoreboard database is available. Static hosting, including GitHub Pages,
supports local tournaments without shared standings.

Run the scheduling, scoring, and scoreboard API checks with Node 22+
using `node --test tournament.test.cjs boards.test.mjs`.

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the analysis and roadmap.
