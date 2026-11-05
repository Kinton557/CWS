/* Adds a Show / Hide button to every password box. */
(function () {
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c6.5 0 10.5 7 10.5 7a17 17 0 01-3.2 3.9M6.6 6.7A17 17 0 001.5 12S5.5 19 12 19a9.6 9.6 0 004.2-1M9.9 9.9a3 3 0 004.2 4.2"/></svg>';
  document.querySelectorAll('input[type="password"]').forEach(function (inp) {
    var wrap = document.createElement('span'); wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pw-toggle';
    b.setAttribute('aria-label', 'Show password'); b.setAttribute('aria-pressed', 'false'); b.innerHTML = EYE + '<span>Show</span>';
    wrap.appendChild(b);
    b.addEventListener('click', function () {
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.innerHTML = (show ? OFF : EYE) + '<span>' + (show ? 'Hide' : 'Show') + '</span>';
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
      inp.focus();
    });
  });
})();
