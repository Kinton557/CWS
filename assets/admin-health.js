/* CWS dashboard: website health (admin + developer). Server report plus live checks run from this browser. */
(function () {
  var root = document.getElementById('healthBody'); if (!root) return;
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var PAGES = ['index.html', 'about.html', 'creativeconnect.html', 'work.html', 'pricing.html', 'contact.html', 'login.html', 'signup.html'];
  var APIS = ['/api/health', '/api/config', '/api/session', '/api/posts', '/api/about'];
  var rep = null, live = null, timer = null;
  function dur(s) { var dd = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (dd ? dd + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; }
  function size(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
  function when(t) { return t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown'; }
  var LABEL = { healthy: 'Healthy', attention: 'Needs attention', problem: 'Problem' };
  function pill(st) { return '<span class="hl-dot hl-' + st + '"></span>'; }
  function kv(rows) { return '<dl class="hl-kv">' + rows.map(function (r) { return '<div><dt>' + E(r[0]) + '</dt><dd>' + E(r[1]) + '</dd></div>'; }).join('') + '</dl>'; }
  function draw() {
    if (!rep) return;
    var s = rep.server, db = rep.database, rq = rep.requests;
    var liveHtml = live ? '<div class="an-card"><h4>Live checks from your browser</h4><ul class="hl-list">' + live.map(function (c) {
      return '<li>' + pill(c.ok ? (c.ms > 2500 ? 'warn' : 'ok') : 'bad') + '<span>' + E(c.name) + '</span><small>' + (c.ok ? c.ms + ' ms' : 'failed (' + E(c.status) + ')') + '</small></li>'; }).join('') + '</ul></div>' : '';
    root.innerHTML =
      '<div class="hl-banner hl-b-' + rep.status + '">' + pill(rep.status === 'healthy' ? 'ok' : rep.status === 'attention' ? 'warn' : 'bad') + '<strong>' + LABEL[rep.status] + '</strong><span>Checked ' + when(rep.now) + '</span><button type="button" class="mini-btn" id="hlRun">Run checks now</button></div>' +
      '<div class="an-card"><h4>Checks</h4><ul class="hl-list">' + rep.checks.map(function (c) { return '<li>' + pill(c.status) + '<span>' + E(c.label) + '</span><small>' + E(c.detail) + '</small></li>'; }).join('') + '</ul></div>' + liveHtml +
      '<div class="an-grid">' +
      '<div class="an-card"><h4>Server</h4>' + kv([['Uptime', dur(s.uptime)], ['Started', when(s.startedAt)], ['Node', s.node], ['Platform', s.platform], ['Mode', s.env], ['Memory', s.rssMB + ' MB (heap ' + s.heapMB + ' MB)'], ['Cookie SameSite', s.cookieSameSite]]) + '</div>' +
      '<div class="an-card"><h4>Requests since start</h4>' + kv([['Total', rq.total], ['Successful', rq.ok], ['Client errors (4xx)', rq.clientErrors], ['Server errors (5xx)', rq.serverErrors], ['Average time', rq.avgMs + ' ms'], ['Slowest 5%', rq.p95Ms + ' ms']]) + '</div>' +
      '<div class="an-card"><h4>Database and files</h4>' + kv([['Database size', size(db.bytes)], ['Users', db.counts.users], ['Orders', db.counts.orders], ['Designs', db.counts.designs], ['Invoices', db.counts.invoices], ['Stored visits', db.counts.visits], ['Uploads', rep.storage.uploads.files + ' files, ' + size(rep.storage.uploads.bytes)], ['Data first created', when(rep.storage.firstCreated)]]) + '</div></div>' +
      '<div class="an-card"><h4>Recent server errors</h4>' + (rep.errors.length ? '<div style="overflow-x:auto"><table class="an-table"><thead><tr><th>When</th><th>Type</th><th>Detail</th></tr></thead><tbody>' + rep.errors.map(function (e) { return '<tr><td>' + E(when(e.t)) + '</td><td>' + E(e.kind) + '</td><td>' + E(e.detail) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No errors recorded since the server started.</p>') + '</div>';
    var b = document.getElementById('hlRun'); if (b) b.onclick = function () { b.disabled = true; runLive().then(function () { return load(); }); };
  }
  function probe(url, name) {
    var t0 = performance.now();
    return fetch(url, { cache: 'no-store', credentials: 'include' }).then(function (r) { return { name: name, ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0) }; })
      .catch(function () { return { name: name, ok: false, status: 'no response', ms: 0 }; });
  }
  function runLive() {
    return Promise.all(PAGES.map(function (p) { return probe(p, 'Page: ' + p); }).concat(APIS.map(function (a) { return probe(a, 'API: ' + a); }))).then(function (r) { live = r; draw(); });
  }
  function load() {
    return fetch('/api/staff/health', { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (r.status === 401 || r.status === 403) { if (timer) clearInterval(timer); return null; } return r.json(); })
      .then(function (j) { if (j && j.success) { rep = j; draw(); } })
      .catch(function () { if (!rep) root.innerHTML = '<div class="hl-banner hl-b-problem"><span class="hl-dot hl-bad"></span><strong>Server not responding</strong><span>It may be asleep or down. Retrying...</span></div>'; });
  }
  root.innerHTML = '<p class="muted">Loading health report...</p>';
  load().then(runLive); timer = setInterval(function () { if (document.visibilityState === 'visible') load(); }, 30000);
})();
