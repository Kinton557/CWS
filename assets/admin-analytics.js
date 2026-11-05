/* CWS dashboard: visitor analytics (admin + developer). Numbers are added up on the server, so this stays fast. */
(function () {
  var root = document.getElementById('analyticsBody'); if (!root) return;
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var n = function (v) { return Number(v || 0).toLocaleString('en-GB'); };
  var range = 'today', timer = null, d = null;
  function tile(l, v, sub, live) { return '<div class="ai-stat' + (live ? ' an-live' : '') + '"><strong>' + E(v) + '</strong><span>' + E(l) + '</span>' + (sub ? '<small class="muted" style="display:block">' + E(sub) + '</small>' : '') + '</div>'; }
  function list(title, rows, total) {
    var max = rows.length ? rows[0][1] : 1;
    return '<div class="an-card"><h4>' + E(title) + '</h4>' + (rows.length ? '<ul class="an-list">' + rows.map(function (r) {
      return '<li><span class="an-name">' + E(r[0]) + '</span><span class="an-num">' + n(r[1]) + ' <small>' + (total ? Math.round(r[1] / total * 100) : 0) + '%</small></span><i style="width:' + Math.max(3, Math.round(r[1] / max * 100)) + '%"></i></li>';
    }).join('') + '</ul>' : '<p class="muted">No data yet.</p>') + '</div>';
  }
  function bars(vals, labels, every, unit) {
    var W = 600, H = 170, pad = 30, max = Math.max.apply(null, vals.concat([1])), bw = (W - pad) / vals.length;
    var o = '<svg class="an-chart" viewBox="0 0 ' + W + ' ' + (H + 28) + '" role="img" aria-label="Visits over time">';
    [0.5, 1].forEach(function (f) { var y = H - f * (H - 10); o += '<line x1="' + pad + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" class="an-grid"/><text x="0" y="' + (y + 4) + '" class="an-axis">' + Math.round(max * f) + '</text>'; });
    vals.forEach(function (v, i) {
      var h = Math.round(v / max * (H - 10)), x = pad + i * bw;
      o += '<rect x="' + (x + 1.5) + '" y="' + (H - h) + '" width="' + Math.max(2, bw - 3) + '" height="' + Math.max(h, v ? 2 : 0) + '" rx="2" class="an-bar"><title>' + E(labels[i] + ': ' + v + ' ' + unit) + '</title></rect>';
      if (i % every === 0) o += '<text x="' + (x + bw / 2) + '" y="' + (H + 20) + '" text-anchor="middle" class="an-axis">' + E(labels[i].short) + '</text>';
    });
    return o + '</svg>';
  }
  function draw() {
    if (!d) return;
    var t = d.totals, i, labels = [], mlabels = [];
    for (i = 0; i < d.buckets.length; i++) {
      var dt = new Date(d.from + i * d.unit), s = d.unit === 3600000 ? ('0' + dt.getHours()).slice(-2) : dt.getDate() + '/' + (dt.getMonth() + 1);
      var l = new String(d.unit === 3600000 ? s + ':00' : dt.toLocaleDateString('en-GB', { dateStyle: 'medium' })); l.short = s; labels.push(l);
    }
    for (i = 0; i < 30; i++) { var m = new String((29 - i) + ' min ago'); m.short = i === 29 ? 'now' : '-' + (29 - i) + 'm'; mlabels.push(m); }
    var chips = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(function (r) { return '<button type="button" class="mini-btn" data-range="' + r[0] + '" aria-pressed="' + (range === r[0]) + '"' + (range === r[0] ? ' style="background:var(--text);color:var(--bg)"' : '') + '>' + r[1] + '</button>'; }).join(' ');
    var rows = d.live.rows;
    root.innerHTML =
      '<div class="admin-stats">' + tile('Active right now', n(d.live.active), 'updates every 30 seconds', true) + tile('Last 5 minutes', n(d.last5), 'visitors') + tile('Last 30 minutes', n(d.last30), 'visitors') + tile('Today', n(d.today.visitors), n(d.today.views) + ' page views') + '</div>' +
      '<div class="an-card"><h4>Live visitors</h4>' + (rows.length ? '<div style="overflow-x:auto"><table class="an-table"><thead><tr><th>Page</th><th>Device</th><th>Browser</th><th>Country</th><th>Seen</th></tr></thead><tbody>' + rows.map(function (x) { return '<tr><td>' + E(x.path) + '</td><td>' + E(x.dev) + '</td><td>' + E(x.br) + '</td><td>' + E(x.country) + '</td><td>' + x.ago + 's ago</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">Nobody is on the site this second.</p>') + '</div>' +
      '<div class="an-card"><h4>Last 30 minutes</h4><p class="muted">Page views per minute.</p>' + bars(d.minutes, mlabels, 5, 'views') + '</div>' +
      '<div class="an-range"><h4>Traffic</h4><div>' + chips + '</div></div>' +
      '<div class="admin-stats">' + tile('Visitors', n(t.visitors), 'unique people') + tile('Page views', n(t.views), t.pagesPerVisit ? t.pagesPerVisit + ' pages per visit' : '') + tile('Visits', n(t.sessions), t.bounce + '% left after one page') + tile('New visitors', n(t.newVisitors), 'first time on the site') + '</div>' +
      '<div class="an-card"><h4>' + (range === 'today' ? 'Views by hour' : 'Views by day') + '</h4>' + bars(d.buckets, labels, range === '30d' ? 4 : (range === 'today' ? 3 : 1), 'views') + '</div>' +
      '<div class="an-grid">' + list('Top pages', d.top.pages, t.views) + list('Where visitors come from', d.top.referrers, t.views) + list('Countries', d.top.countries, t.views) + list('Devices', d.top.devices, t.views) + list('Browsers', d.top.browsers, t.views) + list('Operating systems', d.top.os, t.views) + '</div>' +
      '<p class="muted">Anonymous: no names, emails or IP addresses. Staff and bots are not counted. Country is estimated from the visitor\'s time zone. Visits are kept for 90 days (' + n(d.stored) + ' stored).</p>';
  }
  function load() {
    return fetch('/api/staff/analytics?range=' + range + '&tz=' + new Date().getTimezoneOffset(), { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (r.status === 401 || r.status === 403) { stop(); return null; } return r.json(); })
      .then(function (j) { if (j && j.success) { d = j; draw(); } })
      .catch(function () { if (!d) root.innerHTML = '<p class="muted">Could not load statistics. Is the server awake? Retrying...</p>'; });
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  root.addEventListener('click', function (e) { var b = e.target.closest('[data-range]'); if (b) { range = b.dataset.range; load(); } });
  root.innerHTML = '<p class="muted">Loading visitor statistics...</p>';
  load(); timer = setInterval(function () { if (document.visibilityState === 'visible') load(); }, 30000);
})();
