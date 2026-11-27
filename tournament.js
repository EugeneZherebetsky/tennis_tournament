var Tournament = (function () {
  'use strict';

  function schedule(players, tables) {
    // Keep the original match order so existing browser saves still line up.
    if (players === 5 && tables === 2) {
      return [[[0, 1], [2, 3]], [[0, 2], [1, 4]], [[0, 3], [2, 4]], [[0, 4], [1, 3]], [[1, 2], [3, 4]]];
    }

    var size = players + players % 2;
    var rotation = Array.from({ length: size }, function (_, i) { return i; });
    var rounds = [];
    for (var r = 0; r < size - 1; r++) {
      var round = [];
      for (var i = 0; i < size / 2; i++) {
        var a = rotation[i], b = rotation[size - 1 - i];
        if (a < players && b < players) round.push([Math.min(a, b), Math.max(a, b)]);
      }
      rounds.push(round);
      rotation.splice(1, 0, rotation.pop());
    }

    var required = Math.ceil(players * (players - 1) / (2 * tables));
    while (rounds.length < required) rounds.push([]);
    while (true) {
      var over = rounds.findIndex(function (round) { return round.length > tables; });
      if (over === -1) return rounds;
      var under = rounds.findIndex(function (round) { return round.length < tables; });
      balance(rounds, over, under);
    }
  }

  function balance(rounds, over, under) {
    // Two rounds form disjoint alternating paths and cycles. Swapping one path
    // with an extra match in the larger round moves one match without conflicts.
    var larger = rounds[over], smaller = rounds[under];
    var edges = new Map();
    smaller.forEach(function (pair) { pair.forEach(function (player) { edges.set(player, pair); }); });
    var other = new Map();
    larger.forEach(function (pair) { pair.forEach(function (player) { other.set(player, pair); }); });

    for (var player of other.keys()) {
      if (edges.has(player)) continue;
      var fromLarger = [], fromSmaller = [];
      while (other.has(player)) {
        var pair = other.get(player);
        fromLarger.push(pair);
        player = pair[0] === player ? pair[1] : pair[0];
        if (!edges.has(player)) break;
        pair = edges.get(player);
        fromSmaller.push(pair);
        player = pair[0] === player ? pair[1] : pair[0];
      }
      if (fromLarger.length > fromSmaller.length) {
        rounds[over] = larger.filter(function (pair) { return !fromLarger.includes(pair); }).concat(fromSmaller);
        rounds[under] = smaller.filter(function (pair) { return !fromSmaller.includes(pair); }).concat(fromLarger);
        return;
      }
    }
  }

  var warm = 5 * 60, change = 2 * 60, final = 5 * 60;

  function minimumMinutes(rounds) {
    return (warm + final + rounds * (change + 60)) / 60;
  }

  function timing(rounds, defaultPlay, minutes) {
    var overhead = warm + final + rounds * change;
    var total = minutes === null ? overhead + rounds * defaultPlay * 60 : minutes * 60;
    if (total < minimumMinutes(rounds) * 60) return null;
    var play = Math.floor((total - overhead) / rounds);
    var remainder = (total - overhead) % rounds;
    return {
      warm: warm, change: change, final: final, total: total,
      games: Array.from({ length: rounds }, function (_, i) { return play + (i < remainder ? 1 : 0); })
    };
  }

  function matchesFor(rounds, player) {
    var matches = [], match = 0;
    rounds.forEach(function (pairs, round) {
      pairs.forEach(function (pair, table) {
        var side = pair.indexOf(player);
        if (side !== -1) matches.push({ round: round, table: table + 1, opponent: pair[1 - side], match: match });
        match++;
      });
    });
    return matches;
  }

  function checkScore(scores, target, timed) {
    if (scores.some(function (score) { return score === ''; })) return 'empty';
    if (scores.some(function (score) { return !/^\d{1,2}$/.test(score); })) return 'number';
    var hi = Math.max(scores[0], scores[1]), lo = Math.min(scores[0], scores[1]);
    if (hi === lo) return 'tie';
    if (!timed && !((hi === target && lo <= target - 2) || (hi > target && hi - lo === 2))) return 'time';
    return null;
  }

  return { schedule: schedule, timing: timing, minimumMinutes: minimumMinutes, matchesFor: matchesFor, checkScore: checkScore };
})();
