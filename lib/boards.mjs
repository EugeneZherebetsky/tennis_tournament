const COLLECTION = '/api/boards';
const BOARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const MAX_BODY = 16 * 1024;
const MAX_TIMER_SECONDS = 7 * 24 * 60 * 60;
const PERMANENT = 253402300799;
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
  const { players, tables, minutes, target, names, scores } = snapshot.data;
  const { i, running, end, left, warned, plan } = snapshot.timer;
  return JSON.stringify({ data: { players, tables, minutes, target, names, scores }, timer: { i, running, end, left, warned, plan } });
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

function createCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => CODE_ALPHABET[byte & 31]).join('');
}

function readActive(db, id, code, now) {
  const sql = code
    ? 'SELECT id, join_code, key_hash, snapshot, revision, expires_at FROM boards WHERE join_code = ? AND expires_at > ?'
    : 'SELECT id, join_code, key_hash, snapshot, revision, expires_at FROM boards WHERE id = ? AND expires_at > ?';
  return db.prepare(sql).bind(code || id, now).first();
}

async function create(db, id, keyHash, snapshot, now) {
  // Discard expired legacy rows and bound anonymous tournament creation.
  await db.prepare('DELETE FROM boards WHERE expires_at <= ?').bind(now).run();
  const code = createCode();
  const added = await db.prepare(`
    INSERT INTO boards (id, join_code, key_hash, snapshot, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (SELECT count(*) FROM boards WHERE created_at >= ?) < 30
      AND (SELECT count(*) FROM boards) < 1000
    ON CONFLICT DO NOTHING
  `).bind(id, code, keyHash, snapshot, now, PERMANENT, now - 60).run();
  if (added.meta.changes) return response({ id, code, revision: 1 }, 201, 1);
  const existing = await db.prepare('SELECT join_code, revision FROM boards WHERE id = ? AND key_hash = ?').bind(id, keyHash).first();
  if (existing) return response({ id, code: existing.join_code, revision: existing.revision }, 200, existing.revision);
  return response({ error: 'publish_unavailable' }, 429);
}

async function update(db, id, keyHash, snapshot, revision, now) {
  const result = await db.prepare(`
    UPDATE boards SET snapshot = ?, revision = revision + 1, expires_at = ?
    WHERE id = ? AND key_hash = ? AND revision = ? AND expires_at > ?
  `).bind(snapshot, PERMANENT, id, keyHash, revision, now).run();
  if (result.meta.changes) return response({ revision: revision + 1 }, 200, revision + 1);
  const saved = await db.prepare('SELECT snapshot, revision FROM boards WHERE id = ? AND key_hash = ? AND expires_at > ?')
    .bind(id, keyHash, now).first();
  if (!saved) return response({ error: 'not_found' }, 404);
  if (saved.revision === revision + 1 && saved.snapshot === snapshot) {
    return response({ revision: saved.revision }, 200, saved.revision);
  }
  return response({ error: 'stale_revision' }, 412);
}

export async function handleBoards(request, db) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const collection = path === COLLECTION;
  const id = path.slice(COLLECTION.length + 1);
  const normalized = id.replace(/-/g, '').toUpperCase();
  const code = CODE_PATTERN.test(normalized) ? normalized : null;
  if (!collection && (!path.startsWith(COLLECTION + '/') || !(BOARD_ID.test(id) || (code && request.method === 'GET')))) {
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
      const board = await readActive(db, id, code, now);
      if (!board) return response({ error: 'not_found' }, 404);
      const result = { snapshot: JSON.parse(board.snapshot), revision: board.revision, expiresAt: board.expires_at };
      if (request.headers.has('Authorization')) {
        const key = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization'))?.[1];
        if (!key || await hash(key) !== board.key_hash) return response({ error: 'authorization' }, 403);
        result.id = board.id;
        result.code = board.join_code;
        if (!result.code) {
          // An older client may have created the row while the migration rolled out.
          await db.prepare('UPDATE boards SET join_code = ?, expires_at = ? WHERE id = ? AND join_code IS NULL')
            .bind(createCode(), PERMANENT, board.id).run();
          const updated = await readActive(db, board.id, null, now);
          result.code = updated.join_code;
          result.expiresAt = updated.expires_at;
        }
      }
      return response(result, 200, board.revision);
    }

    if (request.headers.get('Origin') !== url.origin) return response({ error: 'origin' }, 403);
    const key = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!key) return response({ error: 'authorization' }, 401);
    const keyHash = await hash(key);

    if (collection && request.method === 'POST') {
      const body = await readJson(request);
      if (!BOARD_ID.test(body?.id) || !validSnapshot(body?.snapshot)) return response({ error: 'invalid_snapshot' }, 400);
      return await create(db, body.id, keyHash, encode(body.snapshot), now);
    }
    if (!collection && request.method === 'PUT') {
      const revision = /^"([1-9]\d{0,9})"$/.exec(request.headers.get('If-Match') ?? '')?.[1];
      if (!revision) return response({ error: 'revision_required' }, 428);
      const snapshot = await readJson(request);
      if (!validSnapshot(snapshot)) return response({ error: 'invalid_snapshot' }, 400);
      return await update(db, id, keyHash, encode(snapshot), Number(revision), now);
    }
    if (!collection && request.method === 'DELETE') {
      const removed = await db.prepare('DELETE FROM boards WHERE id = ? AND key_hash = ?').bind(id, keyHash).run();
      return removed.meta.changes ? response(null, 204) : response({ error: 'not_found' }, 404);
    }
    return response({ error: 'method' }, 405);
  } catch {
    return response({ error: 'unavailable' }, 503);
  }
}
