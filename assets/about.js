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
        $('brandGrid').innerHTML = d.brands.map(function (b) {
          var inner = '<div class="brand-logo-box">' + logoOrInitials(b) + '</div><h3>' + esc(b.name) + '</h3>' +
            (b.tagline ? '<p>' + esc(b.tagline) + '</p>' : '') + (b.url ? '<span class="brand-visit">Visit &rarr;</span>' : '');
          return b.url
            ? '<a class="brand-card" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
            : '<div class="brand-card">' + inner + '</div>';
        }).join('');
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
    $('brLogoStatus').textContent = path ? 'Logo ready: ' + path.replace(/^uploads\/[a-z0-9]+-/i, '') : '';
  }
  function resetBrandForm() {
    $('brId').value = ''; $('brName').value = ''; $('brTagline').value = ''; $('brUrl').value = '';
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
    var body = { name: $('brName').value, tagline: $('brTagline').value, url: $('brUrl').value, logo: $('brLogo').value };
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
      $('brId').value = b.id; $('brName').value = b.name; $('brTagline').value = b.tagline || ''; $('brUrl').value = b.url || '';
      paintBrandLogo(b.logo || ''); $('brSubmit').textContent = 'Save brand'; $('brCancel').style.display = '';
      $('brandForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (del && window.confirm('Delete this brand from the About page?')) {
      api('/api/admin/brands/' + del, 'DELETE').then(function () { load(); });
    }
  });

  load();
})();
