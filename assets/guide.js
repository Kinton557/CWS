/* CWS Guide — persistent website assistant.
   - Navigation assistant using ONLY verified site facts (guide-kb.js). If the server reports an AI backend (/api/config guideAi), messages go to /api/guide; otherwise this local engine answers. It never claims to be AI when it is not.
   - ON/OFF + minimised + voice preferences persist in localStorage; the conversation persists per tab in sessionStorage across pages.
   - The microphone is only ever started by a deliberate click on the mic button. */
(function () {
  var KB = window.CWS_KB; if (!KB) return;
  var K = 'cws-guide', C = 'cws-guide-chat', I = 'cws-guide-invited';
  var st = { on: false, min: false, voice: false };
  var chat = [], aiMode = false, busy = false, listening = false, speaking = false, rec = null, pendingNote = null;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, TTS = 'speechSynthesis' in window;
  var el = {};
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function save() { ls(K, JSON.stringify(st)); }
  function saveChat() { ss(C, JSON.stringify(chat.slice(-40))); }
  function $(t, c, h) { var n = document.createElement(t); if (c) n.className = c; if (h) n.innerHTML = h; return n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function here() { return (location.pathname.split('/').pop() || 'index.html'); }

  /* ---------- UI ---------- */
  function build() {
    el.launch = $('button', 'cg-launch', '<span class="cg-dot" aria-hidden="true"></span><span class="cg-launch-text">CWS Guide</span>');
    el.launch.type = 'button'; el.launch.setAttribute('aria-label', 'Open CWS Guide');
    el.invite = $('div', 'cg-invite', '<p>Need help exploring CWS? <strong>Talk to CWS Guide.</strong></p><div><button type="button" class="cg-yes">Open Guide</button><button type="button" class="cg-no" aria-label="Dismiss invitation">&times;</button></div>');
    el.invite.hidden = true; el.invite.setAttribute('role', 'status');
    el.panel = $('section', 'cg-panel');
    el.panel.setAttribute('role', 'dialog'); el.panel.setAttribute('aria-label', 'CWS Guide assistant'); el.panel.hidden = true;
    el.panel.innerHTML =
      '<header class="cg-head"><div class="cg-title"><span class="cg-avatar" aria-hidden="true">CG</span><div><strong>CWS Guide</strong><small class="cg-sub" aria-live="polite"></small></div></div>' +
      '<div class="cg-ctrl"><button type="button" class="cg-voice" aria-pressed="false" title="Spoken replies"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7"/></svg><span class="sr-only">Spoken replies</span></button>' +
      '<button type="button" class="cg-min" aria-label="Minimise CWS Guide (keeps it on)" title="Minimise"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>' +
      '<button type="button" class="cg-power" role="switch" aria-checked="true" aria-label="CWS Guide is ON. Press to turn off"><span class="cg-power-label">ON</span><span class="cg-knob" aria-hidden="true"></span></button></div></header>' +
      '<div class="cg-log" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<div class="cg-chips"></div>' +
      '<form class="cg-form" autocomplete="off"><button type="button" class="cg-mic" aria-pressed="false" aria-label="Start voice input"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button>' +
      '<input class="cg-input" type="text" placeholder="Ask about CWS…" aria-label="Message to CWS Guide" maxlength="400"><button type="submit" class="cg-send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7-7-1z"/></svg></button></form>' +
      '<div class="cg-status" aria-live="polite"></div><button type="button" class="cg-stop" hidden>Stop speaking</button>';
    document.body.appendChild(el.launch); document.body.appendChild(el.invite); document.body.appendChild(el.panel);
    ['head', 'log', 'chips', 'form', 'input', 'mic', 'status', 'stop', 'sub', 'voice', 'min', 'power'].forEach(function (k) { el[k] = el.panel.querySelector('.cg-' + k); });
    el.powerLabel = el.panel.querySelector('.cg-power-label');
    ['Take me to the services', 'Show me your portfolio', 'How can I contact you?', 'I want to request a design', 'Where can I make a payment?'].forEach(function (q) {
      var b = $('button', '', esc(q)); b.type = 'button'; b.addEventListener('click', function () { send(q, false); }); el.chips.appendChild(b);
    });
    if (!SR) { el.mic.disabled = true; el.mic.title = 'Voice input is not supported in this browser. Please type instead.'; el.mic.setAttribute('aria-label', 'Voice input not supported in this browser'); }
    if (!TTS) { el.voice.disabled = true; el.voice.title = 'Spoken replies are not supported in this browser'; }
    el.launch.addEventListener('click', function () { if (!st.on) { st.on = true; st.min = false; hello(); } else st.min = false; save(); render(); focusInput(); });
    el.invite.querySelector('.cg-yes').addEventListener('click', function () { ls(I, '1'); st.on = true; st.min = false; hello(); save(); render(); focusInput(); });
    el.invite.querySelector('.cg-no').addEventListener('click', function () { ls(I, '1'); el.invite.hidden = true; });
    el.min.addEventListener('click', function () { st.min = true; stopAll(); save(); render(); el.launch.focus(); });
    el.power.addEventListener('click', function () { st.on = false; st.min = false; stopAll(); save(); render(); el.launch.focus(); });
    el.voice.addEventListener('click', function () { st.voice = !st.voice; if (!st.voice) stopSpeak(); save(); render(); });
    el.stop.addEventListener('click', stopSpeak);
    el.mic.addEventListener('click', toggleMic);
    el.form.addEventListener('submit', function (e) { e.preventDefault(); var v = el.input.value.trim(); if (v) { el.input.value = ''; send(v, false); } });
    el.panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { st.min = true; stopAll(); save(); render(); el.launch.focus(); } });
  }
  function focusInput() { if (st.on && !st.min) setTimeout(function () { el.input && el.input.focus({ preventScroll: true }); }, 60); }
  function setStatus(s) { el.status.textContent = s || ''; el.panel.setAttribute('data-state', listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' : 'idle'); updateSub(); }
  function updateSub() {
    el.sub.textContent = listening ? 'Listening… speak now' : busy ? 'Thinking…' : speaking ? 'Speaking…' : (aiMode ? 'Active · AI-powered' : 'Active · site navigation assistant');
  }
  function render() {
    var open = st.on && !st.min;
    el.panel.hidden = !open;
    el.launch.hidden = open;
    el.launch.classList.toggle('on', st.on);
    el.launch.querySelector('.cg-launch-text').textContent = st.on ? 'CWS Guide · active' : 'CWS Guide';
    el.launch.setAttribute('aria-label', st.on ? 'Open CWS Guide (active)' : 'Turn on CWS Guide');
    el.power.setAttribute('aria-checked', 'true');
    el.voice.setAttribute('aria-pressed', st.voice); el.voice.classList.toggle('active', st.voice);
    if (open) el.invite.hidden = true;
    updateSub();
  }
  function addMsg(role, text, links, noSave) {
    var m = $('div', 'cg-msg cg-' + role); m.innerHTML = '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>';
    if (links && links.length) {
      var w = $('div', 'cg-links');
      links.forEach(function (k) { var d = KB.dest[k]; if (!d) return; var a = $('a', '', esc(d.label) + ' →'); a.href = d.url; w.appendChild(a); });
      if (w.children.length) m.appendChild(w);
    }
    el.log.appendChild(m); el.log.scrollTop = el.log.scrollHeight;
    if (!noSave) { chat.push({ r: role, t: text, l: links || [] }); saveChat(); }
  }
  function restoreChat() { try { chat = JSON.parse(ss(C) || '[]'); } catch (e) { chat = []; } var c = chat; chat = []; c.forEach(function (m) { addMsg(m.r, m.t, m.l, true); }); chat = c; }
  function hello() {
    if (chat.length) return;
    addMsg('bot', 'Hi, I\'m CWS Guide. I can explain what CWS Multimedia Connect does, show you the services, portfolio and prices, and take you to the right page. Type below' + (SR ? ', or press the microphone and speak.' : '.'));
  }

  /* ---------- navigation ---------- */
  function go(key) {
    var d = KB.dest[key]; if (!d) return false;
    var parts = d.url.split('#'), page = parts[0], hash = parts[1];
    if (page === here() || (page === 'index.html' && here() === '')) {
      if (hash) { var t = document.getElementById(hash); if (t) { t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); return true; } }
      window.scrollTo({ top: 0, behavior: 'smooth' }); return true;
    }
    ss('cws-guide-note', 'You are now on ' + d.label + '. I\'m still here if you need anything else.');
    setTimeout(function () { location.href = d.url; }, 650);
    return true;
  }

  /* ---------- local engine (no AI) ---------- */
  function has(q, arr) { return arr.some(function (w) { return q.indexOf(w) > -1; }); }
  function findDest(q) {
    var best = null, len = 0;
    Object.keys(KB.dest).forEach(function (k) { KB.dest[k].words.forEach(function (w) { if (q.indexOf(w) > -1 && w.length > len) { best = k; len = w.length; } }); });
    return best;
  }
  function local(q) {
    q = ' ' + q.toLowerCase().replace(/[^a-z0-9$%+ \-]/g, ' ').replace(/\s+/g, ' ') + ' ';
    var navWords = has(q, [' take me', ' go to', ' show me', ' open ', ' navigate', ' bring me', ' where is', ' where can i find', ' find ']);
    var d = findDest(q), c = KB.contact, P = KB.payment || KB.payment;
    if (has(q, [' dark mode', ' dark theme', ' night mode'])) return { text: 'Switching to the dark theme.', theme: 'dark' };
    if (has(q, [' light mode', ' light theme', ' day mode', ' bright theme'])) return { text: 'Switching to the light theme.', theme: 'light' };
    if (has(q, [' turn off', ' switch off', ' close guide', ' stop guide', ' goodbye', ' bye '])) return { text: 'Okay. Use the ON/OFF switch at the top if you want me fully off, or minimise me and I\'ll stay available.' };
    if (/\b(hi|hello|hey|good (morning|afternoon|evening))\b/.test(q) && q.length < 30) return { text: 'Hello! What would you like to explore: services, portfolio, prices, payment or contact details?' };
    if (has(q, [' pay', ' payment', ' ecocash', ' paynow', ' innbucks', ' zimswitch', ' paygo', ' checkout'])) {
      var r = 'Payment options listed on the site: ' + KB.payment.methods + '\n' + KB.payment.steps + '\n' + KB.payment.creativeconnect;
      return { text: r, links: ['pricing', 'dashboard'], go: navWords ? 'pricing' : null };
    }
    if (has(q, [' price', ' prices', ' pricing', ' cost', ' how much', ' rates', ' package', ' packages'])) {
      return { text: 'Our three packages: ' + KB.packages.map(function (p) { return p.name + ' at ' + p.price; }).join('; ') + '.', links: ['pricing'], go: navWords ? 'pricing' : null };
    }
    if (has(q, [' request', ' i want', ' i need', ' commission', ' order a', ' get a design', ' hire', ' make me', ' design for']) && !navWords) {
      return { text: 'To request a design: choose a package on the Pricing page (sign in first), or message us on WhatsApp ' + c.phone + ' to discuss the brief. Flyers and posters are delivered in 24 to 48 hours.', links: ['pricing', 'contact'] };
    }
    if (has(q, [' contact', ' reach you', ' call you', ' phone', ' email', ' whatsapp', ' hours', ' open ', ' location', ' where are you', ' address']) && !(navWords && d && d !== 'contact')) {
      return { text: 'Phone / WhatsApp: ' + c.phone + '\nEmail: ' + c.email + '\nHours: ' + c.hours + '\nBased in ' + KB.company.location + '.', links: ['contact'], go: navWords ? 'contact' : null };
    }
    if (has(q, [' how do i buy', ' how to buy', ' how does it work', ' how it works', ' work with you', ' work with cws', ' process'])) {
      return { text: KB.payment.creativeconnect + '\nFor custom work, choose a package on the Pricing page or chat with us on WhatsApp to confirm the brief.', links: ['how', 'pricing'] };
    }
    if (has(q, [' what does cws', ' what do you do', ' what is cws', ' tell me about', ' who are you', ' about your company', ' about the company', ' about cws', ' your company'])) {
      return { text: KB.company.about + ' Owner: ' + KB.company.owner + '.', links: ['about', 'services'] };
    }
    if (d && navWords) {
      var okd = go(d); return okd ? { text: 'Taking you to ' + KB.dest[d].label + '.', links: [] } : { text: 'I couldn\'t find that page.' };
    }
    if (has(q, [' service', ' services', ' offer', ' flyer', ' logo', ' brand'])) {
      return { text: 'CWS designs event flyers and posters, brand identities (logo, colour palette, fonts, mockups), apparel and merchandise mockups, and social media and campaign packages. There are also ready-made designs in CreativeConnect.', links: ['services', 'pricing', 'creativeconnect'], go: navWords ? 'services' : null };
    }
    if (has(q, [' portfolio', ' work ', ' projects', ' examples', ' gallery'])) {
      return { text: 'Recent work includes: ' + KB.portfolio.join('; ') + '.', links: ['portfolio'], go: navWords ? 'portfolio' : null };
    }
    if (has(q, [' creativeconnect', ' creative connect', ' template', ' ready made', ' ready-made', ' shop', ' catalog'])) {
      return { text: KB.creativeconnect, links: ['creativeconnect'], go: navWords ? 'creativeconnect' : null };
    }
    if (has(q, [' sign in', ' log in', ' login', ' sign up', ' register', ' account'])) {
      return { text: 'You can create an account or sign in to place orders and see your invoices and access codes in the dashboard.', links: ['signup', 'login', 'dashboard'] };
    }
    if (d) { var ok = go(d); return { text: ok ? 'Taking you to ' + KB.dest[d].label + '.' : 'I couldn\'t find that page.' }; }
    return { text: 'I\'m not sure I have that information on this website. I can help with services, portfolio, prices, payment, how to order, and contact details, or take you to any page. For anything else, contact us on WhatsApp ' + c.phone + '.', links: ['contact'] };
  }

  /* ---------- send / reply ---------- */
  function send(text, fromMic) {
    if (busy) return;
    stopSpeak(); addMsg('user', text);
    busy = true; setStatus('Thinking…');
    var done = function (res) {
      busy = false; setStatus('');
      if (res.theme) window.dispatchEvent(new CustomEvent('cws-set-theme', { detail: res.theme }));
      addMsg('bot', res.text, res.links);
      if (res.go) go(res.go);
      if ((st.voice || fromMic) && TTS) speak(res.text);
    };
    if (aiMode) {
      fetch('/api/guide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, page: here(), history: chat.slice(-8).map(function (m) { return { role: m.r === 'user' ? 'user' : 'assistant', content: m.t }; }) }) })
        .then(function (r) { if (!r.ok) throw new Error('ai'); return r.json(); })
        .then(function (j) { var nav = j.nav && KB.dest[j.nav] ? j.nav : null; done({ text: String(j.reply || '').slice(0, 1200) || local(text).text, links: nav ? [nav] : [], go: nav }); })
        .catch(function () { aiMode = false; done(local(text)); });
    } else setTimeout(function () { done(local(text)); }, 250);
  }

  /* ---------- voice out ---------- */
  function speak(text) {
    if (!TTS) return; stopSpeak();
    var u = new SpeechSynthesisUtterance(text.replace(/[→\n]+/g, '. '));
    var vs = speechSynthesis.getVoices(), lang = (navigator.language || 'en-US').slice(0, 2);
    var v = vs.filter(function (x) { return x.lang.slice(0, 2) === 'en' && /natural|online|google|samantha|aria|jenny/i.test(x.name); })[0] || vs.filter(function (x) { return x.lang.slice(0, 2) === lang; })[0] || vs.filter(function (x) { return x.lang.slice(0, 2) === 'en'; })[0];
    if (v) { u.voice = v; u.lang = v.lang; } u.rate = 1;
    u.onstart = function () { speaking = true; el.stop.hidden = false; setStatus('Speaking…'); };
    u.onend = u.onerror = function () { speaking = false; el.stop.hidden = true; setStatus(''); };
    speechSynthesis.speak(u);
  }
  function stopSpeak() { if (TTS) speechSynthesis.cancel(); speaking = false; if (el.stop) el.stop.hidden = true; }

  /* ---------- voice in (only on explicit click) ---------- */
  function toggleMic() {
    if (!SR) return;
    if (listening) { try { rec.stop(); } catch (e) {} return; }
    stopSpeak();
    rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    var finalText = '';
    rec.onstart = function () { listening = true; el.mic.setAttribute('aria-pressed', 'true'); el.mic.setAttribute('aria-label', 'Stop listening'); el.panel.classList.add('is-listening'); setStatus('Microphone on. Listening…'); };
    rec.onresult = function (e) { var t = ''; for (var i = e.resultIndex; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = t; } el.input.value = t; };
    rec.onerror = function (e) {
      var m = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was denied. You can allow it in your browser settings, or just type your question.' : e.error === 'no-speech' ? 'I didn\'t hear anything. Press the microphone and try again.' : e.error === 'audio-capture' ? 'No microphone was found on this device.' : e.error === 'network' ? 'Voice recognition needs an internet connection here. Please type instead.' : e.error === 'aborted' ? '' : 'Voice input had a problem. Please type instead.';
      if (m) addMsg('bot', m, [], true);
    };
    rec.onend = function () {
      listening = false; el.mic.setAttribute('aria-pressed', 'false'); el.mic.setAttribute('aria-label', 'Start voice input'); el.panel.classList.remove('is-listening'); setStatus('');
      var v = (finalText || el.input.value || '').trim(); el.input.value = '';
      if (v) send(v, true);
    };
    try { rec.start(); } catch (e) { addMsg('bot', 'Voice input could not start. Please type instead.', [], true); }
  }
  function stopAll() { stopSpeak(); if (listening && rec) { try { rec.abort(); } catch (e) {} } }

  /* ---------- init ---------- */
  function init() {
    try { var s = JSON.parse(ls(K) || '{}'); st.on = !!s.on; st.min = !!s.min; st.voice = !!s.voice; } catch (e) {}
    build(); restoreChat(); render();
    window.addEventListener('pagehide', stopAll);
    window.addEventListener('cws-set-theme', function (e) { var b = document.querySelector('.theme-toggle'); var cur = document.documentElement.getAttribute('data-theme'); if (b && cur !== e.detail) b.click(); });
    if (TTS && speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = function () {};
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) { aiMode = !!(c && c.guideAi); updateSub(); }).catch(function () {});
    var note = ss('cws-guide-note');
    if (note && st.on) { ss('cws-guide-note', ''); addMsg('bot', note); }
    if (st.on && !st.min) { hello(); }
    if (!st.on && !ls(I)) { setTimeout(function () { if (!st.on) { el.invite.hidden = false; ls(I, '1'); setTimeout(function () { el.invite.hidden = true; }, 14000); } }, 2500); }
    if (location.hash) setTimeout(function () { var t = document.getElementById(location.hash.slice(1)); if (t && ss('cws-guide-note') === null) {} }, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
