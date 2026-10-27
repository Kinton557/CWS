/* CWS Multimedia Connect - shared front-end */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

const money = (n) => '$' + Number(n || 0).toFixed(2);
const STATUS_LABEL = { awaiting_confirmation: 'awaiting confirmation', pending: 'pending', paid: 'paid', cancelled: 'cancelled', unpaid: 'unpaid', void: 'void' };
const statusPill = (s) => `<span class="status-pill ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;

/* ---------- Logo (transparent PNG, white for the dark site) ---------- */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.logo').forEach((logo) => {
    if (logo.querySelector('img.site-logo')) return;
    const img = document.createElement('img');
    img.src = 'cws-logo-white.png';
    img.alt = 'CWS Multimedia Connect';
    img.className = 'site-logo';
    logo.prepend(img);
  });
});

/* ---------- Payment config (EcoCash tag etc.) ---------- */
let siteConfig = { ecocash: '0774274544', accountName: 'Chikomborero Walter Sumairi', paynow: false };
const configReady = fetch('/api/config').then((r) => r.json()).then((c) => { if (c && c.success) siteConfig = c; }).catch(() => {});

async function fetchSession() {
  const response = await fetch('/api/session', { credentials: 'same-origin' });
  return response.json();
}

/* ---------- Pricing page order modal ---------- */
let currentService = '';
let currentPrice = 0;

function openOrderModal(serviceName, price) {
  currentService = serviceName;
  currentPrice = price;
  const modal = document.getElementById('orderModal');
  if (!modal) return;
  document.getElementById('modalServiceTitle').innerText = serviceName;
  document.getElementById('custAmount').value = price;
  document.getElementById('paymentStatus').innerText = '';
  modal.classList.add('active');
  handlePaymentMethodChange();
}

function closeOrderModal() {
  const modal = document.getElementById('orderModal');
  if (modal) modal.classList.remove('active');
}

function handlePaymentMethodChange() {
  const method = document.getElementById('paymentMethod');
  const phoneGroup = document.getElementById('phoneGroup');
  const phoneInput = document.getElementById('custPhone');
  const refGroup = document.getElementById('refGroup');
  const refInput = document.getElementById('custRef');
  const manualNote = document.getElementById('manualNote');
  if (!method) return;

  const manual = method.value === 'ecocash_manual';
  const mobile = method.value === 'ecocash' || method.value === 'innbucks';
  if (phoneGroup) phoneGroup.style.display = mobile ? 'block' : 'none';
  if (phoneInput) phoneInput.required = mobile;
  if (refGroup) refGroup.style.display = manual ? 'block' : 'none';
  if (refInput) refInput.required = manual;
  if (manualNote) {
    manualNote.style.display = manual ? 'block' : 'none';
    manualNote.innerHTML = `Send <strong>${money(document.getElementById('custAmount').value)}</strong> by EcoCash to <strong>${esc(siteConfig.ecocash)}</strong> (${esc(siteConfig.accountName)}), then type the transaction reference from the EcoCash confirmation message below.`;
  }
}

/* ---------- Sign in / Sign up ---------- */
function setFormMessage(form, text, isError) {
  const box = form.querySelector('.form-message');
  if (!box) return;
  box.textContent = text;
  box.classList.toggle('error', !!isError);
}

function nextAfterAuth() {
  const next = new URLSearchParams(window.location.search).get('next');
  // Only allow same-site relative pages such as creativeconnect.html
  return next && /^[a-z0-9_-]+\.html$/i.test(next) ? '/' + next : '/dashboard.html';
}

async function submitAuth(form, endpoint, payload, busyText, idleText, okText) {
  const button = form.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = busyText; }
  setFormMessage(form, '', false);
  try {
    const { response, data } = await fetchJson(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    if (!response.ok || !data.success) {
      setFormMessage(form, data.message || 'Something went wrong. Please try again.', true);
      return;
    }
    setFormMessage(form, okText, false);
    window.location.href = nextAfterAuth();
  } catch (error) {
    setFormMessage(form, 'Network error. Please check your connection and try again.', true);
  } finally {
    if (button) { button.disabled = false; button.textContent = idleText; }
  }
}

/* ---------- Dashboard ---------- */
let dashUser = null;
let dashPosts = [];
let dashInvoices = [];

function renderUserSummary(user, orders, invoices) {
  const wrapper = document.getElementById('userSummary');
  if (!wrapper) return;
  const paidTotal = orders.filter((o) => o.status === 'paid').reduce((s, o) => s + Number(o.amount || 0), 0);
  const unpaid = invoices.filter((i) => i.status === 'unpaid').length;
  wrapper.innerHTML = `
    <div class="dashboard-card accent"><span class="dashboard-label">Account</span><h3>${esc(user.name)}</h3><p>${esc(user.email)}</p></div>
    <div class="dashboard-card"><span class="dashboard-label">Role</span><h3>${user.role === 'admin' ? 'Administrator' : 'Customer'}</h3><p>${user.role === 'admin' ? 'Full access' : 'Standard access'}</p></div>
    <div class="dashboard-card"><span class="dashboard-label">Orders</span><h3>${orders.length}</h3><p>${user.role === 'admin' ? 'All customers' : 'Your purchases'}</p></div>
    <div class="dashboard-card"><span class="dashboard-label">${user.role === 'admin' ? 'Revenue (paid)' : 'Total paid'}</span><h3>${money(paidTotal)}</h3><p>${unpaid} unpaid invoice${unpaid === 1 ? '' : 's'}</p></div>`;
}

function renderOrdersTable(orders, isAdmin) {
  const body = document.getElementById('ordersTableBody');
  if (!body) return;
  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="6">No orders yet. Buy a design on CreativeConnect and it will show here.</td></tr>';
    return;
  }
  body.innerHTML = orders.map((o) => {
    const code = o.access_code
      ? `<span class="access-code inline">${esc(o.access_code)}</span>`
      : (o.post_id ? '<small>Issued after payment is confirmed</small>' : '—');
    let actions = '';
    if (isAdmin) {
      actions = `
        ${o.status !== 'paid' && o.status !== 'cancelled' ? `<button type="button" class="mini-btn" data-order-action="paid" data-id="${o.id}">Confirm paid</button>` : ''}
        ${o.status !== 'cancelled' && o.status !== 'paid' ? `<button type="button" class="mini-btn danger" data-order-action="cancelled" data-id="${o.id}">Cancel</button>` : ''}
        <button type="button" class="mini-btn danger" data-order-action="delete" data-id="${o.id}">Delete</button>`;
    } else if (o.access_code) {
      actions = `<button type="button" class="mini-btn" data-use-code="${esc(o.access_code)}">Use code</button>`;
    } else if (o.status === 'awaiting_confirmation' || o.status === 'pending') {
      actions = `<button type="button" class="mini-btn" data-proof-upload="${o.id}">${o.proof_file ? 'Replace proof' : 'Upload proof'}</button>`;
    }
    if (o.proof_file) actions += ` <a class="mini-btn" href="/api/orders/${o.id}/proof" target="_blank" rel="noopener">View proof</a>`;
    return `
      <tr>
        <td>#${o.id}</td>
        <td>${esc(o.item_title ? `${o.item_title} (${o.item_code})` : o.service_name)}${isAdmin ? `<br><small>${esc(o.buyer_name || '')} • ${esc(o.buyer_email || '')}</small>` : ''}</td>
        <td>${money(o.amount)}<br><small>${esc(o.payment_method === 'ecocash_manual' ? 'EcoCash' : (o.payment_method || ''))}${o.payment_ref ? ' • ' + esc(o.payment_ref) : ''}</small></td>
        <td>${statusPill(o.status)}</td>
        <td>${code}</td>
        <td class="row-actions">${actions}</td>
      </tr>`;
  }).join('');
}

function invoiceHtml(inv) {
  const rows = inv.items.map((i) => `<tr><td>${esc(i.desc)}</td><td style="text-align:center">${esc(i.qty)}</td><td style="text-align:right">${money(i.price)}</td><td style="text-align:right">${money(i.qty * i.price)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(inv.invoice_no)}</title>
  <style>body{font-family:Arial,sans-serif;color:#111;max-width:760px;margin:30px auto;padding:0 20px}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border-bottom:1px solid #ddd;padding:10px 6px;text-align:left}th{background:#f3f3f3}.total{text-align:right;font-size:1.3rem;margin-top:18px}.meta{display:flex;justify-content:space-between;margin-top:24px;gap:20px}.badge{display:inline-block;padding:3px 10px;border:1px solid #111;border-radius:99px;text-transform:uppercase;font-size:.75rem}small{color:#555}</style></head>
  <body><img src="cws-logo-dark.png" alt="CWS Multimedia Connect" style="height:60px"><h1>INVOICE ${esc(inv.invoice_no)}</h1>
  <div class="meta"><div><strong>From</strong><br>Chikomborero Walter Sumairi<br>CWS Multimedia Connect<br>Kadoma, Zimbabwe<br>+263 77 427 4544<br>chikomborerowaltersumairi26@gmail.com</div>
  <div><strong>Billed to</strong><br>${esc(inv.client_name)}<br>${esc(inv.client_email)}<br><br>Date: ${esc(String(inv.created_at || '').slice(0, 10))}<br>Due: ${esc(inv.due_date || '')}<br><span class="badge">${esc(inv.status)}</span></div></div>
  <table><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="total"><strong>Total: ${money(inv.total)}</strong></div>
  <p><strong>Payment:</strong> EcoCash ${esc(siteConfig.ecocash)} (Chikomborero Walter Sumairi)</p>${inv.notes ? `<p><small>${esc(inv.notes)}</small></p>` : ''}
  <script>window.onload=function(){window.print()}<\/script></body></html>`;
}

function printInvoice(id) {
  const inv = dashInvoices.find((i) => Number(i.id) === Number(id));
  if (!inv) return;
  const w = window.open('', '_blank');
  if (!w) { window.alert('Please allow pop-ups to print the invoice.'); return; }
  w.document.write(invoiceHtml(inv));
  w.document.close();
}

function renderInvoices(invoices, isAdmin) {
  const body = document.getElementById('invoiceTableBody');
  if (!body) return;
  if (!invoices.length) {
    body.innerHTML = '<tr><td colspan="6">No invoices yet.</td></tr>';
    return;
  }
  body.innerHTML = invoices.map((i) => `
    <tr>
      <td>${esc(i.invoice_no)}</td>
      <td>${esc(i.client_name)}<br><small>${esc(i.client_email)}</small></td>
      <td>${money(i.total)}</td>
      <td>${statusPill(i.status)}</td>
      <td>${esc(i.due_date || '')}</td>
      <td class="row-actions">
        <button type="button" class="mini-btn" data-inv-action="print" data-id="${i.id}">View / Print</button>
        ${isAdmin ? `<button type="button" class="mini-btn" data-inv-action="edit" data-id="${i.id}">Edit</button>
        <button type="button" class="mini-btn danger" data-inv-action="delete" data-id="${i.id}">Delete</button>` : ''}
      </td>
    </tr>`).join('');
}

function addInvoiceLine(item = { desc: '', qty: 1, price: '' }) {
  const wrap = document.getElementById('invLines');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'inv-line';
  row.innerHTML = `
    <input type="text" class="inv-desc" placeholder="Description" value="${esc(item.desc)}" />
    <input type="number" class="inv-qty" min="1" step="1" value="${esc(item.qty)}" />
    <input type="number" class="inv-price" min="0" step="0.01" placeholder="Price" value="${esc(item.price)}" />
    <button type="button" class="mini-btn danger inv-remove" aria-label="Remove line">×</button>`;
  row.querySelector('.inv-remove').addEventListener('click', () => { row.remove(); updateInvoiceTotal(); });
  row.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateInvoiceTotal));
  wrap.appendChild(row);
  updateInvoiceTotal();
}

function readInvoiceLines() {
  return Array.from(document.querySelectorAll('#invLines .inv-line')).map((row) => ({
    desc: row.querySelector('.inv-desc').value.trim(),
    qty: Number(row.querySelector('.inv-qty').value) || 1,
    price: Number(row.querySelector('.inv-price').value) || 0
  })).filter((l) => l.desc);
}

function updateInvoiceTotal() {
  const total = readInvoiceLines().reduce((s, l) => s + l.qty * l.price, 0);
  const el = document.getElementById('invTotal');
  if (el) el.textContent = money(total);
}

function resetInvoiceForm() {
  const form = document.getElementById('invoiceForm');
  if (!form) return;
  form.reset();
  document.getElementById('invId').value = '';
  document.getElementById('invLines').innerHTML = '';
  addInvoiceLine();
  document.getElementById('invSubmit').textContent = 'Create invoice';
  document.getElementById('invCancel').style.display = 'none';
}

async function refreshInvoices() {
  const { data } = await fetchJson('/api/invoices');
  dashInvoices = data.success ? data.invoices : [];
  renderInvoices(dashInvoices, dashUser.role === 'admin');
}

async function refreshOrders() {
  const { data } = await fetchJson('/api/orders');
  const orders = data.success ? data.orders : [];
  renderOrdersTable(orders, dashUser.role === 'admin');
  renderUserSummary(dashUser, orders, dashInvoices);
}

/* Admin: catalog items */
function renderDesignBoard() {
  const list = document.getElementById('designList');
  if (!list) return;
  if (!dashPosts.length) { list.innerHTML = '<p class="muted">No designs yet. Add your first one above.</p>'; return; }
  list.innerHTML = dashPosts.map((d) => `
    <div class="design-item">
      <div class="design-preview" style="background-image:url('${esc(d.image)}')"></div>
      <div class="design-item-copy">
        <div class="access-code">Item code: ${esc(d.item_code)}</div>
        <h4>${esc(d.title)}</h4>
        <p>${esc(d.description || 'Design asset for sale.')}</p>
        <div class="design-item-meta"><span>${esc(d.status)}</span><strong>${esc(d.price)}</strong></div>
        <p class="muted">File to deliver: ${d.file_name ? esc(d.file_name) : '<em>none uploaded yet</em>'}</p>
        <div class="post-actions">
          <button type="button" data-action="edit" data-id="${d.id}">Edit</button>
          <button type="button" class="delete" data-action="delete" data-id="${d.id}">Delete</button>
        </div>
      </div>
    </div>`).join('');
}

async function refreshDesigns() {
  const { data } = await fetchJson('/api/admin/posts');
  dashPosts = data.success ? data.posts : [];
  renderDesignBoard();
}

function resetDesignForm() {
  const form = document.getElementById('designForm');
  form.reset();
  form.dataset.mode = 'create';
  document.getElementById('postId').value = '';
  document.querySelector('.design-submit').textContent = 'Add design';
  const cancel = document.getElementById('designCancel');
  if (cancel) cancel.style.display = 'none';
}

async function uploadAdminFile(input, kind, targetId, statusId) {
  const file = input.files && input.files[0];
  const status = document.getElementById(statusId);
  if (!file) return;
  if (status) status.textContent = 'Uploading…';
  try {
    const res = await fetch(`/api/admin/upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) { if (status) status.textContent = data.message || 'Upload failed.'; return; }
    document.getElementById(targetId).value = data.value;
    if (status) status.textContent = 'Uploaded ✓';
  } catch (e) {
    if (status) status.textContent = 'Upload failed.';
  }
}

async function refreshUsers() {
  const body = document.getElementById('adminUserList');
  if (!body) return;
  const { data } = await fetchJson('/api/admin/users');
  const users = data.success ? data.users : [];
  body.innerHTML = users.map((u) => `
    <tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td>
    <td class="row-actions">${u.role === 'admin' ? '' : `<button type="button" class="mini-btn danger" data-user-delete="${u.id}">Remove</button>`}</td></tr>`).join('');
}

/* Buyer: redeem code */
function setupRedeem() {
  const form = document.getElementById('redeemForm');
  if (!form) return;
  const msg = document.getElementById('redeemMessage');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('redeemCode').value.trim();
    msg.className = 'form-message';
    msg.innerHTML = '';
    const { response, data } = await fetchJson('/api/redeem', { method: 'POST', body: JSON.stringify({ code }) });
    if (!response.ok || !data.success) {
      msg.classList.add('error');
      msg.textContent = data.message || 'That code is not valid.';
      return;
    }
    msg.innerHTML = `Unlocked: <strong>${esc(data.item.title)}</strong> (${esc(data.item.item_code)}) — <a class="download-link" href="${esc(data.downloadUrl)}">Download your file</a>`;
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-use-code]');
    if (!btn) return;
    document.getElementById('redeemCode').value = btn.dataset.useCode;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function loadDashboard() {
  const session = await fetchSession();
  if (!session.authenticated || !session.user) { window.location.href = '/login.html'; return; }
  await configReady;
  dashUser = session.user;
  const isAdmin = dashUser.role === 'admin';

  document.querySelectorAll('[data-admin-only]').forEach((el) => { el.style.display = isAdmin ? '' : 'none'; });
  document.querySelectorAll('[data-user-only]').forEach((el) => { el.style.display = isAdmin ? 'none' : ''; });

  await refreshInvoices();
  await refreshOrders();
  setupRedeem();

  // Order + invoice actions
  document.addEventListener('click', async (e) => {
    const orderBtn = e.target.closest('[data-order-action]');
    if (orderBtn) {
      const id = orderBtn.dataset.id;
      const action = orderBtn.dataset.orderAction;
      if (action === 'delete') {
        if (!window.confirm('Delete this order permanently?')) return;
        await fetchJson(`/api/admin/orders/${id}`, { method: 'DELETE' });
      } else {
        if (action === 'paid' && !window.confirm('Confirm that you received this payment? The buyer will get their access code.')) return;
        await fetchJson(`/api/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: action }) });
      }
      await refreshInvoices();
      await refreshOrders();
      return;
    }

    const invBtn = e.target.closest('[data-inv-action]');
    if (invBtn) {
      const id = Number(invBtn.dataset.id);
      const action = invBtn.dataset.invAction;
      if (action === 'print') return printInvoice(id);
      if (action === 'delete') {
        if (!window.confirm('Delete this invoice?')) return;
        await fetchJson(`/api/invoices/${id}`, { method: 'DELETE' });
        await refreshInvoices();
        await refreshOrders();
        return;
      }
      if (action === 'edit') {
        const inv = dashInvoices.find((i) => Number(i.id) === id);
        if (!inv) return;
        document.getElementById('invId').value = inv.id;
        document.getElementById('invClient').value = inv.client_name;
        document.getElementById('invEmail').value = inv.client_email;
        document.getElementById('invDue').value = inv.due_date || '';
        document.getElementById('invStatus').value = inv.status;
        document.getElementById('invNotes').value = inv.notes || '';
        document.getElementById('invLines').innerHTML = '';
        inv.items.forEach(addInvoiceLine);
        document.getElementById('invSubmit').textContent = 'Save invoice';
        document.getElementById('invCancel').style.display = '';
        document.getElementById('invoiceForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    const userBtn = e.target.closest('[data-user-delete]');
    if (userBtn) {
      if (!window.confirm('Remove this user account?')) return;
      const { data } = await fetchJson(`/api/admin/users/${userBtn.dataset.userDelete}`, { method: 'DELETE' });
      if (!data.success) window.alert(data.message || 'Could not remove user.');
      refreshUsers();
    }
  });

  if (!isAdmin) return;

  /* ----- Admin invoice form ----- */
  const invForm = document.getElementById('invoiceForm');
  document.getElementById('invAddLine').addEventListener('click', () => addInvoiceLine());
  document.getElementById('invCancel').addEventListener('click', resetInvoiceForm);
  resetInvoiceForm();
  invForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('invMessage');
    const id = document.getElementById('invId').value;
    const payload = {
      client_name: document.getElementById('invClient').value,
      client_email: document.getElementById('invEmail').value,
      due_date: document.getElementById('invDue').value,
      status: document.getElementById('invStatus').value,
      notes: document.getElementById('invNotes').value,
      items: readInvoiceLines()
    };
    const { data } = await fetchJson(id ? `/api/invoices/${id}` : '/api/invoices', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    msg.className = 'form-message' + (data.success ? '' : ' error');
    msg.textContent = data.success ? 'Invoice saved.' : (data.message || 'Could not save invoice.');
    if (data.success) { resetInvoiceForm(); await refreshInvoices(); await refreshOrders(); }
  });

  /* ----- Admin design form ----- */
  const designForm = document.getElementById('designForm');
  document.getElementById('previewUpload').addEventListener('change', (e) => uploadAdminFile(e.target, 'preview', 'designImage', 'previewStatus'));
  document.getElementById('fileUpload').addEventListener('change', (e) => uploadAdminFile(e.target, 'file', 'designFile', 'fileStatus'));
  document.getElementById('designCancel').addEventListener('click', resetDesignForm);

  designForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(designForm);
    const postId = fd.get('postId');
    const payload = Object.fromEntries(['item_code', 'title', 'category', 'price', 'status', 'image', 'file_name', 'format', 'delivery', 'description', 'features'].map((k) => [k, fd.get(k)]));
    const map = { Flyer: 'flyers', Poster: 'posters', Branding: 'branding', Event: 'events', Church: 'church', Social: 'social' };
    payload.filter_key = map[payload.category] || 'flyers';
    payload.label = payload.category;
    payload.meta = (payload.description || '').slice(0, 120);
    const { data } = await fetchJson(postId ? `/api/posts/${postId}` : '/api/posts', { method: postId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const msg = document.getElementById('designMessage');
    msg.className = 'form-message' + (data.success ? '' : ' error');
    msg.textContent = data.success ? 'Saved.' : (data.message || 'Could not save.');
    if (data.success) { resetDesignForm(); await refreshDesigns(); }
  });

  document.getElementById('designList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'delete') {
      if (!window.confirm('Delete this design?')) return;
      await fetchJson(`/api/posts/${id}`, { method: 'DELETE' });
      return refreshDesigns();
    }
    const post = dashPosts.find((p) => Number(p.id) === id);
    if (!post) return;
    designForm.dataset.mode = 'edit';
    document.getElementById('postId').value = post.id;
    document.getElementById('designCode').value = post.item_code;
    document.getElementById('designTitle').value = post.title;
    document.getElementById('designCategory').value = post.category;
    document.getElementById('designPrice').value = post.price;
    document.getElementById('designAvailability').value = post.status;
    document.getElementById('designImage').value = post.image;
    document.getElementById('designFile').value = post.file_name || '';
    document.getElementById('designFormat').value = post.format || '';
    document.getElementById('designDelivery').value = post.delivery || '';
    document.getElementById('designDescription').value = post.description || '';
    document.getElementById('designFeatures').value = (post.features || []).join('\n');
    document.querySelector('.design-submit').textContent = 'Save changes';
    document.getElementById('designCancel').style.display = '';
    designForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  await refreshDesigns();
  await refreshUsers();
}

/* ---------- Page wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const paynowForm = document.getElementById('paynowForm');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const logoutBtn = document.getElementById('logoutBtn');

  if (paynowForm) {
    const payBtn = document.getElementById('payBtn');
    const statusMsg = document.getElementById('paymentStatus');
    const methodSelect = document.getElementById('paymentMethod');
    configReady.then(handlePaymentMethodChange);
    if (methodSelect) methodSelect.addEventListener('change', handlePaymentMethodChange);

    paynowForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const refInput = document.getElementById('custRef');
      payBtn.disabled = true;
      payBtn.innerText = 'Processing...';
      statusMsg.style.color = '#a1a1aa';
      statusMsg.innerText = 'Sending your order…';
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceName: currentService,
            paymentMethod: methodSelect.value,
            phone: document.getElementById('custPhone').value,
            paymentRef: refInput ? refInput.value : ''
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          statusMsg.style.color = '#ef4444';
          statusMsg.innerHTML = 'Please <a href="login.html?next=pricing.html" style="text-decoration:underline">sign in</a> or <a href="signup.html" style="text-decoration:underline">create an account</a> first.';
        } else if (data.success) {
          if (data.redirectUrl) { window.location.href = data.redirectUrl; return; }
          statusMsg.style.color = '#10b981';
          statusMsg.innerText = data.message || 'Order received.';
          setTimeout(() => { window.location.href = '/dashboard.html'; }, 2500);
        } else {
          statusMsg.style.color = '#ef4444';
          statusMsg.innerText = data.message || 'Payment failed. Please try again.';
        }
      } catch (err) {
        statusMsg.style.color = '#ef4444';
        statusMsg.innerText = 'Server error. Please check your connection.';
      } finally {
        payBtn.disabled = false;
        payBtn.innerText = 'Place order';
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const fd = new FormData(loginForm);
      submitAuth(loginForm, '/api/login', { email: fd.get('email'), password: fd.get('password') }, 'Signing in...', 'Sign in', 'Welcome back! Redirecting…');
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const fd = new FormData(signupForm);
      if (!document.getElementById('agreeTerms').checked) {
        setFormMessage(signupForm, 'Please accept the Terms and Conditions and Privacy Policy to continue.', true);
        return;
      }
      submitAuth(signupForm, '/api/signup', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') }, 'Creating account...', 'Create account', 'Account created. Redirecting…');
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.href = '/login.html';
    });
  }

  if (document.body.dataset.page === 'dashboard') loadDashboard();
});


/* ===== v2: mobile menu, Google/Apple sign-in, proof upload from dashboard ===== */
(function () {
  // Mobile menu
  const container = document.querySelector('.nav-container');
  const links = document.querySelector('.nav-links');
  if (container && links) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nav-toggle'; btn.setAttribute('aria-label', 'Menu'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    const menu = document.createElement('div');
    menu.className = 'mobile-menu';
    const items = [...links.querySelectorAll('a')].map((a) => `<a href="${a.getAttribute('href')}">${a.textContent}</a>`);
    container.querySelectorAll('.nav-actions a').forEach((a, i, all) => {
      items.push(`<a href="${a.getAttribute('href')}"${i === all.length - 1 ? ' class="menu-cta"' : ''}>${a.textContent}</a>`);
    });
    menu.innerHTML = items.join('');
    container.appendChild(btn); container.appendChild(menu);
    btn.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  }

  // Google / Apple sign-in (buttons only appear when the keys are set in .env)
  const form = document.getElementById('loginForm') || document.getElementById('signupForm');
  if (form) {
    fetch('/api/config').then((r) => r.json()).then((cfg) => {
      if (!cfg.google && !cfg.apple) return;
      const box = document.createElement('div');
      box.className = 'social-auth';
      form.parentNode.insertBefore(box, form);
      const finish = async (url, payload) => {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) { window.location.href = nextAfterAuth(); return; }
        setFormMessage(form, data.message || 'Sign-in failed. Please try again.', true);
      };
      if (cfg.google) {
        const holder = document.createElement('div');
        box.appendChild(holder);
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = () => {
          google.accounts.id.initialize({ client_id: cfg.google, callback: (r) => finish('/api/auth/google', { credential: r.credential }) });
          google.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
        };
        document.head.appendChild(s);
      }
      if (cfg.apple) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'apple-btn';
        b.innerHTML = '&#63743; Continue with Apple';
        box.appendChild(b);
        const s = document.createElement('script');
        s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'; s.async = true;
        s.onload = () => AppleID.auth.init({ clientId: cfg.apple.clientId, scope: 'name email', redirectURI: cfg.apple.redirectURI, usePopup: true });
        document.head.appendChild(s);
        b.addEventListener('click', async () => {
          try {
            const r = await AppleID.auth.signIn();
            const n = r.user && r.user.name ? `${r.user.name.firstName || ''} ${r.user.name.lastName || ''}`.trim() : '';
            await finish('/api/auth/apple', { id_token: r.authorization.id_token, name: n });
          } catch (e) { /* popup closed */ }
        });
      }
      const or = document.createElement('div'); or.className = 'social-or'; or.textContent = 'or use email';
      box.appendChild(or);
    }).catch(() => {});
  }

  // Dashboard: buyer uploads / replaces proof of payment
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-proof-upload]');
    if (!btn) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,.pdf';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      btn.disabled = true; btn.textContent = 'Uploading…';
      const res = await fetch(`/api/orders/${btn.dataset.proofUpload}/proof?name=${encodeURIComponent(file.name)}`, { method: 'POST', credentials: 'same-origin', body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { alert(data.message || 'Upload failed.'); }
      if (typeof refreshOrders === 'function') refreshOrders();
    };
    input.click();
  });
})();
