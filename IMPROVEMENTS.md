# Improvements

## Done
- Round timer, offline mode, 11/21-point matches, head-to-head tiebreak, strict score input.
- Configurable players, tables and duration; server tournaments with player codes,
  organizer keys, archives, PDF/CSV reports, English/Russian interface.
- Usability pass (November 2026):
  - Tabs: Game / Standings / Settings instead of one long page.
  - Compact timer bar when scrolling; next-stage button beside Start.
  - Header metrics hide once the tournament starts.
  - Tappable match cards and one-tap winner buttons in the score dialog.
  - Match length is applied together with the other settings.
  - Landing page leads with "Create tournament"; plain wording for offline play.
  - Organizer-key card after creation, with copy and share.
  - Player view: estimated start time of the next match.
  - Note explaining "=" ties; 44px touch targets; dark mode.
- Reliability: per-client creation limit instead of a global cap; unfinished
  tournaments expire after 180 idle days; CI tests and an offline-cache version check.

## Next
- Translation keys: replace Russian-sentence keys and string concatenation with
  named messages and `Intl.PluralRules`.
- Split `app.js` and `shared.js` into ES modules.
- Keep Cloudflare settings and D1 migrations in the repository (`wrangler.toml`,
  `migrations/`). This needs the production database ID, and once the file exists
  Cloudflare uses it instead of the dashboard settings.
