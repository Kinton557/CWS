/* CWS: keeps the header in step with the sign-in on EVERY page (Dashboard + Log out when signed in).
   A saved hint paints the header instantly; the server confirms it. A slow or sleeping server never signs you out. */
(function () {
  var HINT = 'cws_user';
  var page = location.pathname.split('/').pop() || 'index.html';
  var box = document.querySelector('.nav-actions');
  var original = box ? box.innerHTML : '';
  var onDash = !!document.getElementById('logoutBtn');
  function read() { try { return JSON.parse(localStorage.getItem(HINT) || 'null'); } catch (e) { return null; } }
  function write(u) { try { if (u) localStorage.setItem(HINT, JSON.stringify({ name: u.name, role: u.role })); else localStorage.removeItem(HINT); } catch (e) {} }
  window.cwsRememberUser = write;
  function paint(u) {
    if (!box || onDash) return;
    if (u) box.innerHTML = '<a href="dashboard.html" class="nav-ghost">Dashboard</a><button type="button" class="nav-solid" data-cws-logout>Log out</button>';
    else box.innerHTML = original;
  }
  function logout() {
    var done = function () { write(null); location.href = 'login.html'; };
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(function () {}).then(function () {
      if (window.cwsFirebase && window.cwsFirebase.enabled) return window.cwsFirebase.signOut();
    }).then(done, done);
  }
  document.addEventListener('click', function (e) { if (e.target.closest('[data-cws-logout]')) { e.preventDefault(); logout(); } });
  var hint = read(); if (hint) paint(hint);
  fetch('/api/session', { credentials: 'include', cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('status'); return r.json(); })
    .then(function (d) {
      if (d && d.authenticated && d.user) {
        write(d.user); paint(d.user);
        if (/^(login|signup)\.html$/.test(page)) location.replace('dashboard.html');
      } else { write(null); paint(null); }
    })
    .catch(function () { /* server asleep or offline: keep what we have, do not sign out */ });
})();
