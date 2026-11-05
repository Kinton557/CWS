/* CWS About: public rendering (about.html) + admin editor (dashboard.html). */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var src = function (p) { return /^uploads\//.test(p || '') ? (window.CWS_API || '') + '/' + p : p; };
  var initials = function (n) {
    return String(n || 'CWS').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || 'CWS';
  };
  function api(url, method, body) {
    return fetch(url, {
      method: method || 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); });
  }
  function upload(file) {
    return fetch('/api/admin/upload?kind=preview&name=' + encodeURIComponent(file.name), {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file
    }).then(function (r) { return r.json(); });
  }
  function logoOrInitials(b) {
    return b.logo ? '<img src="' + esc(src(b.logo)) + '" alt="" loading="lazy" />' : '<span>' + esc(initials(b.name)) + '</span>';
  }

  /* ---- brand pictures + details pop-up ---- */
  var brandList = [], lastFocus = null, modal = null;
  function mediaHtml(b) {
    return '<span class="brand-media" data-bm="' + b.id + '">' + (b.logo ? '<img src="' + esc(src(b.logo)) + '" alt="' + esc(b.name) + '" loading="lazy" />' : '<span class="brand-initials">' + esc(initials(b.name)) + '</span>') + '</span>';
  }
  function paintMedia(scope, list) { // blurred copy of the picture fills the frame, the full picture sits on top, so any shape looks good
    list.forEach(function (b) { if (!b.logo) return; var el = scope.querySelector('[data-bm="' + b.id + '"]'); if (el) el.style.setProperty('--img', 'url("' + encodeURI(src(b.logo)) + '")'); });
  }
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal brand-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'bmTitle');
    modal.innerHTML = '<div class="modal-backdrop" data-close></div><div class="modal-card brand-dialog"><button type="button" class="modal-close" data-close aria-label="Close">&times;</button><div id="bmBody"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeBrand(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('active')) closeBrand(); });
    return modal;
  }
  function openBrand(id, trigger) {
    var b = brandList.filter(function (x) { return String(x.id) === String(id); })[0]; if (!b) return;
    ensureModal(); lastFocus = trigger || null;
    var paras = String(b.description || '').split(/\n{2,}|\r\n\r\n/).filter(Boolean).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
    $('bmBody').innerHTML = mediaHtml(b).replace('brand-media', 'brand-media large') +
      '<div class="brand-dialog-text"><h3 id="bmTitle">' + esc(b.name) + '</h3>' + (b.tagline ? '<p class="role">' + esc(b.tagline) + '</p>' : '') +
      (paras || (b.tagline ? '' : '<p class="muted">More details are coming soon.</p>')) +
      '<div class="brand-actions">' + (b.url ? '<a class="btn-primary" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">Visit ' + esc(b.name) + ' &rarr;</a>' : '') + '<button type="button" class="btn-secondary" data-close>Close</button></div></div>';
    paintMedia($('bmBody'), [b]);
    modal.classList.add('active'); document.body.style.overflow = 'hidden';
    var c = modal.querySelector('.btn-primary, .btn-secondary'); if (c) c.focus();
  }
  function closeBrand() {
    if (!modal) return; modal.classList.remove('active'); document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------------- Public About page ---------------- */
  if ($('ownerSection') || $('brandsSection')) {
    fetch('/api/about').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.success) return;
      var p = d.profile;
      if (p && (p.name || p.bio || p.photo) && $('ownerSection')) {
        $('ownerSection').hidden = false;
        $('ownerCard').innerHTML =
          '<div class="owner-photo">' + (p.photo ? '<img src="' + esc(p.photo) + '" alt="' + esc(p.name || 'Owner') + '" />' : '<span>' + esc(initials(p.name)) + '</span>') + '</div>' +
          '<div class="owner-text"><span class="subheading">MEET THE OWNER</span>' +
          '<h2>' + esc(p.name) + '</h2>' +
          (p.role ? '<p class="role">' + esc(p.role) + (p.location ? ' &bull; ' + esc(p.location) : '') + '</p>' : (p.location ? '<p class="role">' + esc(p.location) + '</p>' : '')) +
          String(p.bio || '').split(/\n{2,}|\r\n\r\n/).filter(Boolean).map(function (para) { return '<p>' + esc(para).replace(/\n/g, '<br>') + '</p>'; }).join('') +
          '</div>';
      }
      if (d.brands && d.brands.length && $('brandsSection')) {
        $('brandsSection').hidden = false;
        brandList = d.brands;
        $('brandGrid').innerHTML = d.brands.map(function (b) {
          return '<button type="button" class="brand-tile" data-brand="' + b.id + '" aria-haspopup="dialog" aria-label="' + esc(b.name) + ': view details">' +
            mediaHtml(b) + '<span class="brand-meta"><strong>' + esc(b.name) + '</strong>' + (b.tagline ? '<small>' + esc(b.tagline) + '</small>' : '') + '<em>View details &rarr;</em></span></button>';
        }).join('');
        paintMedia($('brandGrid'), d.brands);
        $('brandGrid').addEventListener('click', function (e) {
          var t = e.target.closest('[data-brand]'); if (!t) return;
          openBrand(t.getAttribute('data-brand'), t);
        });
      }
    }).catch(function () {});
  }

  /* ---------------- Admin editor (dashboard.html) ---------------- */
  if (!$('aboutForm')) return;
  var msg = function (id, text, bad) { var el = $(id); if (!el) return; el.textContent = text; el.style.color = bad ? 'var(--danger)' : 'var(--accent)'; };
  var brands = [];

  function paintPhoto(path) {
    $('abPhoto').value = path || '';
    $('abPhotoPreview').innerHTML = path ? '<img src="' + esc(src(path)) + '" alt="Photo preview" />' : '<span>' + esc(initials($('abName').value)) + '</span>';
  }
  function paintBrandLogo(path) {
    $('brLogo').value = path || '';
    $('brLogoStatus').textContent = path ? 'Picture ready: ' + path.replace(/^uploads\/[a-z0-9]+-/i, '') : '';
  }
  function resetBrandForm() {
    $('brId').value = ''; $('brName').value = ''; $('brTagline').value = ''; $('brDescription').value = ''; $('brUrl').value = '';
    paintBrandLogo(''); $('brSubmit').textContent = 'Add brand'; $('brCancel').style.display = 'none';
  }
  function renderBrands() {
    var list = $('brandAdminList');
    if (!brands.length) { list.innerHTML = '<p class="muted">No brands yet. Add your first one above.</p>'; return; }
    list.innerHTML = brands.map(function (b) {
      return '<div class="design-item brand-admin-item" data-id="' + b.id + '">' +
        '<div class="brand-logo-box small">' + logoOrInitials(b) + '</div>' +
        '<div class="brand-admin-text"><strong>' + esc(b.name) + '</strong><small class="muted">' + esc(b.tagline || '') + '</small>' +
        (b.url ? '<small class="muted">' + esc(b.url) + '</small>' : '') + '</div>' +
        '<div class="post-actions"><button type="button" data-edit="' + b.id + '">Edit</button><button type="button" class="delete" data-del="' + b.id + '">Delete</button></div></div>';
    }).join('');
  }
  function load() {
    fetch('/api/about', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      var p = d.profile || {};
      $('abName').value = p.name || ''; $('abRole').value = p.role || ''; $('abLocation').value = p.location || ''; $('abBio').value = p.bio || '';
      paintPhoto(p.photo || '');
      brands = d.brands || []; renderBrands();
    }).catch(function () {});
  }

  $('abPhotoUpload').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    msg('abPhotoStatus', 'Uploading…');
    upload(f).then(function (d) {
      if (d && d.success) { paintPhoto(d.value); msg('abPhotoStatus', 'Photo uploaded. Press Save to publish.'); }
      else msg('abPhotoStatus', (d && d.message) || 'Upload failed.', true);
    }).catch(function () { msg('abPhotoStatus', 'Upload failed.', true); });
  });
  $('abPhotoClear').addEventListener('click', function () { paintPhoto(''); msg('abPhotoStatus', 'Photo removed. Press Save to publish.'); });

  $('aboutForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/admin/about', 'PUT', {
      name: $('abName').value, role: $('abRole').value, location: $('abLocation').value, bio: $('abBio').value, photo: $('abPhoto').value
    }).then(function (r) { msg('abMessage', r.ok ? 'Saved. The About page is updated.' : (r.data.message || 'Could not save.'), !r.ok); });
  });

  $('brLogoUpload').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    $('brLogoStatus').textContent = 'Uploading…';
    upload(f).then(function (d) {
      if (d && d.success) paintBrandLogo(d.value); else $('brLogoStatus').textContent = (d && d.message) || 'Upload failed.';
    }).catch(function () { $('brLogoStatus').textContent = 'Upload failed.'; });
  });

  $('brandForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('brId').value;
    var body = { name: $('brName').value, tagline: $('brTagline').value, description: $('brDescription').value, url: $('brUrl').value, logo: $('brLogo').value };
    api(id ? '/api/admin/brands/' + id : '/api/admin/brands', id ? 'PUT' : 'POST', body).then(function (r) {
      if (!r.ok) return msg('brMessage', r.data.message || 'Could not save brand.', true);
      msg('brMessage', id ? 'Brand updated.' : 'Brand added.'); resetBrandForm(); load();
    });
  });
  $('brCancel').addEventListener('click', function () { resetBrandForm(); msg('brMessage', ''); });

  $('brandAdminList').addEventListener('click', function (e) {
    var ed = e.target.getAttribute('data-edit'), del = e.target.getAttribute('data-del');
    if (ed) {
      var b = brands.filter(function (x) { return String(x.id) === ed; })[0]; if (!b) return;
      $('brId').value = b.id; $('brName').value = b.name; $('brTagline').value = b.tagline || ''; $('brDescription').value = b.description || ''; $('brUrl').value = b.url || '';
      paintBrandLogo(b.logo || ''); $('brSubmit').textContent = 'Save brand'; $('brCancel').style.display = '';
      $('brandForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (del && window.confirm('Delete this brand from the About page?')) {
      api('/api/admin/brands/' + del, 'DELETE').then(function () { load(); });
    }
  });

  load();
})();
