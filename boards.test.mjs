import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleBoards } from './lib/boards.mjs';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./database/boards.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('./database/tournament-codes.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('./database/tournament-lifecycle.sql', import.meta.url), 'utf8'));
  const binding = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => stmt.get(...args) ?? null,
            all: async () => ({ results: stmt.all(...args) }),
            run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } })
          };
        }
      };
    }
  };
  return {
    db,
    async call(method, path, body, key, etag, origin = 'https://tennis.test') {
      const headers = { Origin: origin };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (key) headers.Authorization = 'Bearer ' + key;
      if (etag) headers['If-Match'] = etag;
      return handleBoards(new Request('https://tennis.test/api/boards' + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
      }), binding);
    }
  };
}

const id = 'be862260-b071-4559-be69-f8e7c5ec8bac';
const secret = 'a'.repeat(64), wrongSecret = 'b'.repeat(64);
const snapshot = {
  data: { players: 2, tables: 1, minutes: null, target: 11, names: ['А', 'Б'], scores: [['', '']] },
  timer: { i: 0, running: false, end: 0, left: 300000, warned: -1, plan: '2/1/1200' }
};

test('a viewer can read an official result, while editing and stopping require the scorekeeper key', async () => {
  const { call } = setup();
  const created = await call('POST', '', { id, snapshot }, secret);
  assert.equal(created.status, 201);
  const read = await call('GET', '/' + id);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await read.json()).snapshot, snapshot);
  assert.equal((await call('PUT', '/' + id, snapshot, wrongSecret, '"1"')).status, 404);
  assert.equal((await call('DELETE', '/' + id)).status, 401);
  assert.equal((await call('DELETE', '/' + id, undefined, secret)).status, 204);
  assert.equal((await call('GET', '/' + id)).status, 404);
});

test('a stale write cannot overwrite results and retrying a successful write is safe', async () => {
  const { call } = setup();
  await call('POST', '', { id, snapshot }, secret);
  const newer = structuredClone(snapshot);
  newer.data.scores[0] = ['9', '7', true];
  assert.equal((await call('PUT', '/' + id, newer, secret, '"1"')).headers.get('ETag'), '"2"');
  assert.equal((await call('PUT', '/' + id, newer, secret, '"1"')).status, 200);
  assert.equal((await call('PUT', '/' + id, snapshot, secret, '"1"')).status, 412);
  assert.deepEqual((await (await call('GET', '/' + id)).json()).snapshot, newer);
});

test('invalid snapshots and cross-origin writes are rejected, and expired boards disappear', async () => {
  const { call, db } = setup();
  assert.equal((await call('POST', '', { id, snapshot }, secret, null, 'https://elsewhere.test')).status, 403);
  const invalid = structuredClone(snapshot);
  invalid.data.names.push('Лишний игрок');
  assert.equal((await call('POST', '', { id, snapshot: invalid }, secret)).status, 400);
  assert.equal((await call('POST', '', { id, snapshot }, secret)).status, 201);
  db.prepare('UPDATE boards SET expires_at = 0 WHERE id = ?').run(id);
  assert.equal((await call('GET', '/' + id)).status, 404);
});

test('a player code reads the tournament and the organizer key resumes edits from another client', async () => {
  const { call, db } = setup();
  const created = await call('POST', '', { id, snapshot }, secret);
  const { code } = await created.json();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  const share = '/' + code.match(/.{4}/g).join('-').toLowerCase();

  const player = await call('GET', share);
  assert.equal(player.status, 200);
  const playerBody = await player.json();
  assert.deepEqual(playerBody.snapshot, snapshot);
  assert.equal(playerBody.id, undefined);
  assert.equal(playerBody.key, undefined);

  assert.equal((await call('GET', share, undefined, wrongSecret)).status, 403);
  const organizer = await call('GET', share, undefined, secret);
  assert.equal(organizer.status, 200);
  const resumed = await organizer.json();
  assert.equal(resumed.id, id);
  assert.equal(resumed.code, code);

  const next = structuredClone(resumed.snapshot);
  next.data.scores[0] = ['11', '9'];
  const saved = await call('PUT', '/' + resumed.id, next, secret, organizer.headers.get('ETag'));
  assert.equal(saved.status, 200);
  assert.deepEqual((await (await call('GET', share)).json()).snapshot, next);
  assert.ok(db.prepare('SELECT expires_at FROM boards WHERE id = ?').get(id).expires_at > 2147483647);
});

test('an older tournament link still works and the scorekeeper can recover a player code', async () => {
  const { call, db } = setup();
  await call('POST', '', { id, snapshot }, secret);
  db.prepare('UPDATE boards SET join_code = NULL WHERE id = ?').run(id);
  assert.equal((await call('GET', '/' + id)).status, 200);
  const resumed = await call('GET', '/' + id, undefined, secret);
  const { code } = await resumed.json();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal((await call('GET', '/' + code)).status, 200);
});

test('separate match edits can both succeed, retries stay idempotent, and conflicting scores are rejected', async () => {
  const { call } = setup();
  const event = structuredClone(snapshot);
  Object.assign(event.data, { players: 3, names: ['А', 'Б', 'В'], scores: [['', ''], ['', ''], ['', '']] });
  await call('POST', '', { id, snapshot: event }, secret);
  const operation = { id: '11111111-1111-4111-8111-111111111111', match: 0, layout: 1, version: 0, score: ['11', '5'] };
  assert.equal((await call('PATCH', '/' + id, operation, secret)).status, 200);
  assert.equal((await call('PATCH', '/' + id, operation, secret)).status, 200);
  const independent = { ...operation, id: '22222222-2222-4222-8222-222222222222', match: 1, score: ['11', '9'] };
  assert.equal((await call('PATCH', '/' + id, independent, secret)).status, 200);
  assert.equal((await call('PATCH', '/' + id, { ...independent, match: 0 }, secret)).status, 409);
  const board = await (await call('GET', '/' + id)).json();
  assert.deepEqual(board.snapshot.data.scores.slice(0, 2), [['11', '5'], ['11', '9']]);
  assert.equal((await call('GET', '/' + id + '?since=' + board.revision)).status, 204);
});

test('finalize locks edits, reopen preserves the archived snapshot, and organizer key rotation only affects edits', async () => {
  const { call } = setup();
  const created = await (await call('POST', '', { id, snapshot }, secret)).json();
  assert.equal((await call('POST', '/' + id + '/finalize', undefined, secret, '"1"')).status, 409);
  const completed = structuredClone(snapshot);
  completed.data.title = 'Club final';
  completed.data.scores[0] = ['11', '7'];
  assert.equal((await call('PUT', '/' + id, completed, secret, '"1"')).status, 200);
  assert.equal((await call('POST', '/' + id + '/finalize', undefined, secret, '"2"')).status, 200);
  assert.equal((await call('PUT', '/' + id, snapshot, secret, '"3"')).status, 423);
  assert.equal((await call('POST', '/' + id + '/reopen', undefined, secret, '"3"')).status, 200);
  const archive = await (await call('GET', '/' + created.code + '/archives?revision=3')).json();
  assert.equal(archive.snapshot.data.title, 'Club final');
  assert.deepEqual(archive.snapshot.data.scores[0], ['11', '7']);
  assert.equal((await call('POST', '/' + id + '/key', { key: wrongSecret }, secret)).status, 204);
  assert.equal((await call('GET', '/' + created.code, undefined, secret)).status, 403);
  assert.equal((await call('GET', '/' + created.code, undefined, wrongSecret)).status, 200);
});
