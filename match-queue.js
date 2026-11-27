var MatchQueue = (function () {
  'use strict';
  var root = 'tt-score-op:';

  function open(storage, board) {
    var prefix = root + board + ':';
    function list() {
      var result = [];
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        try {
          var entry = JSON.parse(storage.getItem(key));
          if (entry && prefix + entry.id === key && Array.isArray(entry.score)) result.push(entry);
        } catch { /* Ignore malformed or removed entries. */ }
      }
      return result.sort(function (a, b) { return a.queued - b.queued || a.id.localeCompare(b.id); });
    }
    return {
      list: list,
      put: function (operation) { storage.setItem(prefix + operation.id, JSON.stringify(operation)); },
      remove: function (operation) { storage.removeItem(prefix + operation.id); },
      matches: function (key) { return typeof key === 'string' && key.startsWith(prefix); }
    };
  }

  return { open: open };
})();
