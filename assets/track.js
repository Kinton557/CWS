/* CWS visit counter: anonymous, first-party. No names, emails or IP addresses are stored. Staff and bots are never counted. */
(function () {
  var K = 'cws_track';
  function get(s, k) { try { return s.getItem(k); } catch (e) { return null; } }
  function set(s, k, v) { try { s.setItem(k, v); } catch (e) {} }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cws-optout]'); if (!t) return;
    e.preventDefault();
    var off = get(localStorage, K) === 'off'; set(localStorage, K, off ? 'on' : 'off');
    t.textContent = off ? 'Turn off visit counting on this device' : 'Visit counting is off. Turn it on again';
  });
  document.querySelectorAll('[data-cws-optout]').forEach(function (t) { if (get(localStorage, K) === 'off') t.textContent = 'Visit counting is off. Turn it on again'; });
  if (get(localStorage, K) === 'off' || navigator.doNotTrack === '1') return;
  if (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) || document.body.getAttribute('data-page') === 'dashboard') return;
  function rand(n) { var c = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '', a = new Uint8Array(n); (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 255; }); for (var i = 0; i < n; i++) s += c[a[i] % c.length]; return s; }
  var vid = get(localStorage, 'cws_vid'), isNew = false;
  if (!vid) { vid = rand(16); set(localStorage, 'cws_vid', vid); isNew = true; }
  var sid = get(sessionStorage, 'cws_sid'); if (!sid) { sid = rand(12); set(sessionStorage, 'cws_sid', sid); }
  var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var ref = ''; try { if (document.referrer) { var h = new URL(document.referrer).hostname.replace(/^www\./, ''); if (h && h !== location.hostname.replace(/^www\./, '')) ref = h; } } catch (e) {}
  var path = location.pathname.replace(/\/index\.html$/, '/') || '/';
  function send(type) {
    var body = { type: type, vid: vid, sid: sid, path: path, tz: tz, ref: ref, nv: isNew };
    fetch('/api/track', { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {});
  }
  send('view');
  setInterval(function () { if (document.visibilityState === 'visible') send('beat'); }, 40000);
})();
