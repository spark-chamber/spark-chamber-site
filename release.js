// Keeps the version line and "What's new" in step with the latest release.
// The app's CI publishes https://app.sparkchamber.app/release.json with each
// release: {"version", "date", "highlights": [...], "notes_url"}. The HTML
// always carries the current values, so the page reads correctly when the
// fetch fails, times out, or JavaScript is off. This script only ever moves
// the page forward to a newer version, and writes text, never markup.
(function () {
  var SOURCE = 'https://app.sparkchamber.app/release.json';
  var TIMEOUT_MS = 4000;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function parseVersion(text) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(text || '').trim());
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function newer(a, b) {
    for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  // Release notes may live on the site, the browser version, or the app's
  // GitHub organization; anything else is ignored.
  function safeNotesUrl(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== 'https:') return null;
      if (u.hostname === 'sparkchamber.app' || u.hostname === 'app.sparkchamber.app') return u.href;
      if (u.hostname === 'github.com' && u.pathname.indexOf('/spark-chamber/') === 0) return u.href;
    } catch (e) {}
    return null;
  }
  function clean(data) {
    if (!data || typeof data !== 'object') return null;
    var version = parseVersion(data.version);
    var date = formatDate(data.date);
    if (!version || !date || !Array.isArray(data.highlights)) return null;
    var highlights = data.highlights
      .filter(function (h) { return typeof h === 'string' && h.trim(); })
      .map(function (h) { return h.trim().slice(0, 240); })
      .slice(0, 6);
    if (!highlights.length) return null;
    return { version: version, text: version.join('.'), date: date, highlights: highlights, notes: safeNotesUrl(data.notes_url) };
  }

  function apply(release) {
    var shown = parseVersion((document.querySelector('[data-release="version"]') || {}).textContent);
    if (!shown || !newer(release.version, shown)) return;

    document.querySelectorAll('[data-release="version"]').forEach(function (el) { el.textContent = release.text; });
    document.querySelectorAll('[data-release="date"]').forEach(function (el) {
      el.textContent = el.hasAttribute('data-upper') ? release.date.toUpperCase() : release.date;
    });
    document.querySelectorAll('[data-release="highlights"]').forEach(function (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      release.highlights.forEach(function (h) {
        var li = document.createElement('li');
        li.textContent = h;
        list.appendChild(li);
      });
    });
    if (release.notes) {
      document.querySelectorAll('[data-release="notes-link"]').forEach(function (a) { a.href = release.notes; });
    }
    // The download page's release notes: add a panel for the new version
    // above the newest one written into the page.
    var notes = document.querySelector('[data-release="notes"]');
    var first = notes && notes.querySelector('.panel');
    if (first) {
      var panel = document.createElement('div');
      panel.className = 'panel';
      var head = document.createElement('div');
      head.className = 'panel-head wrap mono';
      [release.text, release.date].forEach(function (t) {
        var span = document.createElement('span');
        span.textContent = t;
        head.appendChild(span);
      });
      var list = document.createElement('ul');
      list.className = 'list gap-6';
      release.highlights.forEach(function (h) {
        var li = document.createElement('li');
        li.textContent = h;
        list.appendChild(li);
      });
      panel.appendChild(head);
      panel.appendChild(list);
      if (release.notes) {
        var p = document.createElement('p');
        p.className = 'fine';
        var a = document.createElement('a');
        a.href = release.notes;
        a.textContent = 'Full release notes';
        p.appendChild(a);
        panel.appendChild(p);
      }
      first.parentNode.insertBefore(panel, first);
    }
  }

  if (!window.fetch || !document.querySelector('[data-release="version"]')) return;
  var controller = window.AbortController ? new AbortController() : null;
  var timer = controller && setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  fetch(SOURCE, { credentials: 'omit', signal: controller ? controller.signal : undefined })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      var release = clean(data);
      if (release) apply(release);
    })
    .catch(function () {})
    .then(function () { if (timer) clearTimeout(timer); });
})();
