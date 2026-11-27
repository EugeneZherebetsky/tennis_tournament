import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleBoards } from './lib/boards.mjs';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./database/boards.sql', import.meta.url), 'utf8'));
  const binding = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => stmt.get(...args) ?? null,
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
