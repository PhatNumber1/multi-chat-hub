(function () {
  'use strict';
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

  // Words must all appear, in any order. "quoted text" is an exact phrase.
  // from:name looks at the username only. Returns null when there is nothing to search.
  function parse(q) {
    if ((q.split('"').length - 1) % 2) q += '"'; // still typing the closing quote
    const terms = [], from = [];
    for (const m of q.matchAll(/(from:)?(?:"([^"]*)"|([^\s"]+))/gi)) {
      let t = (m[2] != null ? m[2] : m[3]).trim();
      if (m[1]) t = t.replace(/^@/, '');
      if (!t || /^from:$/i.test(t)) continue;
      (m[1] ? from : terms).push(t);
    }
    if (!terms.length && !from.length) return null;
    const one = (t) => new RegExp(esc(t), 'iu');
    const all = (list) => (list.length ? new RegExp(list.map(esc).sort((a, b) => b.length - a.length).join('|'), 'giu') : null);
    return { terms: terms.map(one), from: from.map(one), inText: all(terms), inName: all(terms.concat(from)) };
  }

  const textOf = (m) => m.parts.map((p) => p.text).join('');
  const accountKey = (a) => a.platform + ':' + a.name;

  function matches(m, p, filter) {
    if (filter) {
      if (filter.platform && m.account.platform !== filter.platform) return false;
      if (filter.account && accountKey(m.account) !== filter.account) return false;
    }
    const inName = (r) => r.test(m.name) || r.test(m.login);
    if (!p.from.every(inName)) return false;
    if (!p.terms.length) return true;
    const text = textOf(m);
    return p.terms.every((r) => r.test(text) || inName(r));
  }

  // Moves through results; wraps at either end. Starts at the newest going up.
  function step(results, current, dir) {
    if (!results.length) return null;
    const i = results.indexOf(current);
    if (i < 0) return dir < 0 ? results[results.length - 1] : results[0];
    return results[(i + dir + results.length) % results.length];
  }

  MCH.search = { parse, matches, step, accountKey };
})();
