const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const model = vm.runInNewContext(fs.readFileSync(require.resolve('./tournament.js'), 'utf8') + '\nTournament');

test('every supported setup fits the round-robin into the minimum number of rounds', () => {
  for (let players = 2; players <= 24; players++) {
    for (let tables = 1; tables <= 12; tables++) {
      const rounds = model.schedule(players, tables);
      const matchCount = players * (players - 1) / 2;
      const pairs = new Set();
      assert.equal(rounds.length, Math.max(players - 1 + players % 2, Math.ceil(matchCount / tables)));
      for (const round of rounds) {
        const playing = new Set();
        assert.ok(round.length > 0 && round.length <= tables);
        for (const [a, b] of round) {
          assert.ok(a >= 0 && a < b && b < players);
          assert.ok(!playing.has(a) && !playing.has(b));
          playing.add(a).add(b);
          const key = a + '-' + b;
          assert.ok(!pairs.has(key));
          pairs.add(key);
        }
      }
      assert.equal(pairs.size, matchCount);
    }
  }
});

test('the original five-player schedule keeps stored scores in order', () => {
  assert.equal(JSON.stringify(model.schedule(5, 2)), JSON.stringify([
    [[0, 1], [2, 3]], [[0, 2], [1, 4]], [[0, 3], [2, 4]],
    [[0, 4], [1, 3]], [[1, 2], [3, 4]]
  ]));
});

test('the timing plan sums to the requested duration with whole-second match times', () => {
  assert.equal(model.timing(5, 8, null).total, 60 * 60);
  assert.equal(model.timing(5, 12, null).total, 80 * 60);
  const plan = model.timing(7, 8, 63);
  assert.equal(plan.total, 63 * 60);
  assert.equal(plan.games.length, 7);
  assert.equal(plan.warm + plan.final + 7 * plan.change + plan.games.reduce((a, b) => a + b, 0), plan.total);
  assert.ok(Math.max(...plan.games) - Math.min(...plan.games) <= 1);
  assert.equal(model.timing(7, 8, 31).games[0], 60);
  assert.equal(model.timing(7, 8, 30), null);
});

test('personal fixtures include each match in order, with its known table and score index', () => {
  const rounds = model.schedule(5, 2);
  const matches = model.matchesFor(rounds, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(matches)), [
    { round: 1, table: 2, opponent: 1, match: 3 },
    { round: 2, table: 2, opponent: 2, match: 5 },
    { round: 3, table: 1, opponent: 0, match: 6 },
    { round: 4, table: 2, opponent: 3, match: 9 }
  ]);
});

test('a new completed match needs a legal game score or an explicit time-limit finish', () => {
  assert.equal(model.checkScore(['', '8'], 11, false), 'empty');
  assert.equal(model.checkScore(['10', '10'], 11, true), 'tie');
  assert.equal(model.checkScore(['-2', '7'], 11, true), 'number');
  assert.equal(model.checkScore(['9', '8'], 11, false), 'time');
  assert.equal(model.checkScore(['9', '8'], 11, true), null);
  assert.equal(model.checkScore(['12', '10'], 11, false), null);
  assert.equal(model.checkScore(['12', '9'], 11, false), 'time');
  assert.equal(model.checkScore(['21', '19'], 21, false), null);
});

test('the result report includes all tables in schedule order and labels timed and pending games', () => {
  const rounds = [[[0, 1], [2, 3]], [[1, 2]]];
  const entries = [
    { ok: true, a: 11, b: 8, w: 0 },
    { ok: true, a: 4, b: 6, w: 1 },
    { ok: false, empty: true }
  ];
  const summary = model.reportMatches(rounds, entries, [['11', '8'], ['4', '6', true], ['', '']], ['А', 'Б', 'В', 'Г']);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    played: 2,
    rows: [
      [1, 1, 'А', 'Б', '11:8', 'А', ''],
      [1, 2, 'В', 'Г', '4:6', 'Г', 'По лимиту времени'],
      [2, 1, 'Б', 'В', '—', '—', 'Ожидает результата']
    ]
  });
});
