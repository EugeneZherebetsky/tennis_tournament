const COLLECTION = '/api/boards';
const BOARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const MAX_BODY = 16 * 1024;
const MAX_TIMER_SECONDS = 7 * 24 * 60 * 60;
const PERMANENT = 253402300799;
// Unfinished tournaments are removed after this long without changes; finished ones are kept.
const IDLE_SECONDS = 180 * 24 * 60 * 60;
// New tournaments per client (hashed IP address) per hour, and for everyone per minute.
const CLIENT_LIMIT = 10;
const GLOBAL_LIMIT = 60;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };

function response(body, status = 200, revision) {
  const options = { status, headers: { ...headers } };
  if (revision) options.headers.ETag = '"' + revision + '"';
  return body === null ? new Response(null, options) : Response.json(body, options);
}

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validSnapshot(snapshot) {
  const { data, timer } = snapshot ?? {};
  if (!data || !timer || !integer(data.players, 2, 24) || !integer(data.tables, 1, 12) ||
      ![11, 21].includes(data.target) || !(data.minutes === null || integer(data.minutes, 1, 10080))) return false;
  if (data.title !== undefined && (typeof data.title !== 'string' || data.title.length > 80)) return false;
  if (!Array.isArray(data.names) || data.names.length !== data.players ||
      !data.names.every(name => typeof name === 'string' && name.length <= 40)) return false;
  if (!Array.isArray(data.scores) || data.scores.length !== data.players * (data.players - 1) / 2 ||
      !data.scores.every(score => Array.isArray(score) && (score.length === 2 || (score.length === 3 && score[2] === true)) &&
        score.slice(0, 2).every(value => typeof value === 'string' && /^\d{0,2}$/.test(value)))) return false;
  return integer(timer.i, 0, 553) && typeof timer.running === 'boolean' &&
    integer(timer.end, 0, Date.now() + MAX_TIMER_SECONDS * 1000) &&
    integer(timer.left, 0, MAX_TIMER_SECONDS * 1000) && integer(timer.warned, -1, 553) &&
    typeof timer.plan === 'string' && /^\d{1,2}\/\d{1,2}\/\d{1,7}$/.test(timer.plan);
}

function encode(snapshot) {
  const { players, tables, minutes, target, names, scores, title = '' } = snapshot.data;
  const { i, running, end, left, warned, plan } = snapshot.timer;
  const data = { players, tables, minutes, target, names, scores };
  if (title.trim()) data.title = title.trim();
  return JSON.stringify({ data, timer: { i, running, end, left, warned, plan } });
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return null;
  if (Number(request.headers.get('Content-Length')) > MAX_BODY || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function hash(key) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

// A hash of the client's address, so the limit works without storing raw IP addresses.
async function clientId(request) {
  const address = request.headers.get('CF-Connecting-IP');
  return address ? (await hash('client:' + address)).slice(0, 32) : 'unknown';
}

function createCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => CODE_ALPHABET[byte & 31]).join('');
}

function readActive(db, id, code, now, since = 0) {
  const column = code ? 'join_code' : 'id';
  return db.prepare(`
    SELECT id, join_code, key_hash, revision, expires_at, layout_revision, match_versions, finalized_at,
      CASE WHEN revision = ? AND join_code IS NOT NULL THEN NULL ELSE snapshot END AS snapshot
    FROM boards WHERE ${column} = ? AND expires_at > ?
  `).bind(since, code || id, now).first();
}

async function create(db, id, keyHash, snapshot, now, creator) {
  // Discard expired rows, then limit anonymous creation per client so one
  // client cannot use up the capacity for everyone.
  await db.prepare('DELETE FROM boards WHERE expires_at <= ?').bind(now).run();
  const code = createCode();
  const added = await db.prepare(`
    INSERT INTO boards (id, join_code, key_hash, snapshot, created_at, expires_at, creator)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT count(*) FROM boards WHERE creator = ? AND created_at >= ?) < ?
      AND (SELECT count(*) FROM boards WHERE created_at >= ?) < ?
    ON CONFLICT DO NOTHING
  `).bind(id, code, keyHash, snapshot, now, now + IDLE_SECONDS, creator,
    creator, now - 3600, CLIENT_LIMIT, now - 60, GLOBAL_LIMIT).run();
  if (added.meta.changes) return response({ id, code, revision: 1 }, 201, 1);
  const existing = await db.prepare('SELECT join_code, revision FROM boards WHERE id = ? AND key_hash = ?').bind(id, keyHash).first();
  if (existing) return response({ id, code: existing.join_code, revision: existing.revision }, 200, existing.revision);
  return response({ error: 'publish_unavailable' }, 429);
}

async function update(db, id, keyHash, snapshot, revision, now) {
  const result = await db.prepare(`
    WITH incoming(value) AS (SELECT ?)
    UPDATE boards SET snapshot = incoming.value, revision = revision + 1, expires_at = ?,
      layout_revision = layout_revision + (
        json_extract(snapshot, '$.data.players', '$.data.tables', '$.data.target', '$.data.scores')
        IS NOT json_extract(incoming.value, '$.data.players', '$.data.tables', '$.data.target', '$.data.scores')
      ),
      match_versions = CASE WHEN
        json_extract(snapshot, '$.data.players', '$.data.tables', '$.data.target', '$.data.scores')
        IS NOT json_extract(incoming.value, '$.data.players', '$.data.tables', '$.data.target', '$.data.scores')
        THEN '{}' ELSE match_versions END
    FROM incoming
    WHERE id = ? AND key_hash = ? AND revision = ? AND expires_at > ? AND finalized_at IS NULL
  `).bind(snapshot, now + IDLE_SECONDS, id, keyHash, revision, now).run();
  if (result.meta.changes) return response({ revision: revision + 1 }, 200, revision + 1);
  const saved = await db.prepare('SELECT snapshot, revision, finalized_at FROM boards WHERE id = ? AND key_hash = ? AND expires_at > ?')
    .bind(id, keyHash, now).first();
  if (!saved) return response({ error: 'not_found' }, 404);
  if (saved.finalized_at !== null) return response({ error: 'finalized' }, 423);
  if (saved.revision === revision + 1 && saved.snapshot === snapshot) {
    return response({ revision: saved.revision }, 200, saved.revision);
  }
  return response({ error: 'stale_revision' }, 412);
}

function validScore(score, target) {
  if (!Array.isArray(score) || !(score.length === 2 || (score.length === 3 && score[2] === true))) return false;
  if (score.length === 2 && score[0] === '' && score[1] === '') return true;
  if (!score.slice(0, 2).every(value => typeof value === 'string' && /^\d{1,2}$/.test(value))) return false;
  const hi = Math.max(score[0], score[1]), lo = Math.min(score[0], score[1]);
  return hi > lo && (score[2] || (hi === target && lo <= target - 2) || (hi > target && hi - lo === 2));
}

async function patchMatch(db, id, keyHash, operation, now) {
  if (!operation || !BOARD_ID.test(operation.id) || !integer(operation.match, 0, 275) ||
      !integer(operation.layout, 1, 2147483647) || !integer(operation.version, 0, 2147483647)) {
    return response({ error: 'invalid_match' }, 400);
  }
  const board = await readActive(db, id, null, now);
  if (!board || board.key_hash !== keyHash) return response({ error: 'not_found' }, 404);
  const data = JSON.parse(board.snapshot).data;
  const { match, layout, version, score } = operation;
  if (board.layout_revision !== layout) return response({ error: 'schedule_changed' }, 409);
  const recorded = JSON.parse(board.match_versions)[match];
  if (recorded?.operation === operation.id) return response({ revision: board.revision });
  if (board.finalized_at !== null) return response({ error: 'finalized' }, 423);
  if (match >= data.scores.length || !validScore(score, data.target)) return response({ error: 'invalid_match' }, 400);
  const scorePath = '$.data.scores[' + match + ']';
  const matchPath = '$."' + match + '"';
  const record = JSON.stringify({ version: version + 1, operation: operation.id });
  const changed = await db.prepare(`
    UPDATE boards SET snapshot = json_set(snapshot, ?, json(?)), match_versions = json_set(match_versions, ?, json(?)),
      revision = revision + 1, expires_at = ?
    WHERE id = ? AND key_hash = ? AND expires_at > ? AND finalized_at IS NULL AND layout_revision = ?
      AND COALESCE(json_extract(match_versions, ?), 0) = ?
  `).bind(scorePath, JSON.stringify(score), matchPath, record, now + IDLE_SECONDS, id, keyHash, now, layout,
    matchPath + '.version', version).run();
  if (changed.meta.changes) return response({ version: version + 1 });
  const latest = await readActive(db, id, null, now);
  if (latest?.layout_revision === layout && JSON.parse(latest.match_versions)[match]?.operation === operation.id) {
    return response({ version: version + 1 });
  }
  return response({ error: 'match_changed' }, 409);
}

async function changeFinal(db, id, keyHash, revision, finalizing, now) {
  const sql = finalizing ? `
    UPDATE boards SET finalized_at = ?, revision = revision + 1, expires_at = ?,
      snapshot = json_set(snapshot, '$.timer.running', json('false'), '$.timer.end', 0,
        '$.timer.left', CASE WHEN json_extract(snapshot, '$.timer.running')
          THEN MAX(0, json_extract(snapshot, '$.timer.end') - ? * 1000)
          ELSE json_extract(snapshot, '$.timer.left') END)
    WHERE id = ? AND key_hash = ? AND revision = ? AND expires_at > ? AND finalized_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM json_each(snapshot, '$.data.scores')
        WHERE json_extract(value, '$[0]') = '' OR json_extract(value, '$[1]') = ''
          OR CAST(json_extract(value, '$[0]') AS INTEGER) = CAST(json_extract(value, '$[1]') AS INTEGER)
      )
  ` : `
    UPDATE boards SET finalized_at = ?, revision = revision + 1, expires_at = ?
    WHERE id = ? AND key_hash = ? AND revision = ? AND expires_at > ? AND finalized_at IS NOT NULL
  `;
  const parameters = finalizing ? [now, PERMANENT, now, id, keyHash, revision, now]
    : [null, now + IDLE_SECONDS, id, keyHash, revision, now];
  const changed = await db.prepare(sql).bind(...parameters).run();
  if (changed.meta.changes) return response({ revision: revision + 1 });
  return response({ error: 'finalize_conflict' }, 409);
}

async function archives(db, board, revision) {
  if (revision) {
    const item = await db.prepare('SELECT revision, finalized_at AS finalizedAt, snapshot FROM board_archives WHERE board_id = ? AND revision = ?')
      .bind(board.id, revision).first();
    return item ? response({ ...item, snapshot: JSON.parse(item.snapshot), code: board.join_code }) : response({ error: 'not_found' }, 404);
  }
  const list = await db.prepare(`
    SELECT revision, finalized_at AS finalizedAt, json_extract(snapshot, '$.data.title') AS title
    FROM board_archives WHERE board_id = ? ORDER BY revision DESC LIMIT 20
  `).bind(board.id).all();
  return response({ archives: list.results });
}

export async function handleBoards(request, db) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const collection = path === COLLECTION;
  const [id, action, extra] = path.slice(COLLECTION.length + 1).split('/');
  const normalized = id.replace(/-/g, '').toUpperCase();
  const code = CODE_PATTERN.test(normalized) ? normalized : null;
  if (!collection && (!path.startsWith(COLLECTION + '/') || extra !== undefined ||
      (action && !['finalize', 'reopen', 'key', 'archives'].includes(action)) ||
      !(BOARD_ID.test(id) || (code && request.method === 'GET')))) {
    return response({ error: 'not_found' }, 404);
  }
  if (!db) return response({ error: 'unavailable' }, 503);
  const now = Math.floor(Date.now() / 1000);
  try {
    if (request.method === 'GET') {
      if (collection) {
        await db.prepare('SELECT join_code FROM boards LIMIT 1').bind().first();
        return response({ available: true });
      }
      const since = action ? 0 : Number(url.searchParams.get('since'));
      const board = await readActive(db, id, code, now, integer(since, 0, 2147483647) ? since : 0);
      if (!board) return response({ error: 'not_found' }, 404);
      if (action === 'archives') return await archives(db, board, url.searchParams.get('revision'));
      if (action) return response({ error: 'method' }, 405);
      const result = {
        snapshot: JSON.parse(board.snapshot), revision: board.revision, expiresAt: board.expires_at, code: board.join_code,
        finalizedAt: board.finalized_at
      };
      if (request.headers.has('Authorization')) {
        const key = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization'))?.[1];
        if (!key || await hash(key) !== board.key_hash) return response({ error: 'authorization' }, 403);
        result.id = board.id;
        result.code = board.join_code;
        result.layout = board.layout_revision;
        result.matchVersions = Object.fromEntries(Object.entries(JSON.parse(board.match_versions)).map(([match, entry]) => [match, entry.version]));
        if (!result.code) {
          // An older client may have created the row while the migration rolled out.
          await db.prepare('UPDATE boards SET join_code = ?, expires_at = ? WHERE id = ? AND join_code IS NULL')
            .bind(createCode(), board.finalized_at === null ? now + IDLE_SECONDS : PERMANENT, board.id).run();
          const updated = await readActive(db, board.id, null, now);
          result.code = updated.join_code;
          result.expiresAt = updated.expires_at;
        }
      }
      if (board.snapshot === null) return response(null, 204);
      return response(result, 200, board.revision);
    }

    if (request.headers.get('Origin') !== url.origin) return response({ error: 'origin' }, 403);
    const key = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!key) return response({ error: 'authorization' }, 401);
    const keyHash = await hash(key);
    const revision = /^"([1-9]\d{0,9})"$/.exec(request.headers.get('If-Match') ?? '')?.[1];

    if (collection && request.method === 'POST') {
      const body = await readJson(request);
      if (!BOARD_ID.test(body?.id) || !validSnapshot(body?.snapshot)) return response({ error: 'invalid_snapshot' }, 400);
      return await create(db, body.id, keyHash, encode(body.snapshot), now, await clientId(request));
    }
    if (!collection && !action && request.method === 'PATCH') {
      return await patchMatch(db, id, keyHash, await readJson(request), now);
    }
    if (!collection && !action && request.method === 'PUT') {
      if (!revision) return response({ error: 'revision_required' }, 428);
      const snapshot = await readJson(request);
      if (!validSnapshot(snapshot)) return response({ error: 'invalid_snapshot' }, 400);
      return await update(db, id, keyHash, encode(snapshot), Number(revision), now);
    }
    if (!collection && request.method === 'POST' && ['finalize', 'reopen'].includes(action)) {
      if (!revision) return response({ error: 'revision_required' }, 428);
      return await changeFinal(db, id, keyHash, Number(revision), action === 'finalize', now);
    }
    if (!collection && request.method === 'POST' && action === 'key') {
      const body = await readJson(request);
      if (!/^[0-9a-f]{64}$/.test(body?.key ?? '') || body.key === key) return response({ error: 'invalid_key' }, 400);
      const rotated = await db.prepare('UPDATE boards SET key_hash = ? WHERE id = ? AND key_hash = ? AND expires_at > ?')
        .bind(await hash(body.key), id, keyHash, now).run();
      return rotated.meta.changes ? response(null, 204) : response({ error: 'not_found' }, 404);
    }
    if (!collection && !action && request.method === 'DELETE') {
      const removed = await db.prepare('DELETE FROM boards WHERE id = ? AND key_hash = ?').bind(id, keyHash).run();
      return removed.meta.changes ? response(null, 204) : response({ error: 'not_found' }, 404);
    }
    return response({ error: 'method' }, 405);
  } catch {
    return response({ error: 'unavailable' }, 503);
  }
}
