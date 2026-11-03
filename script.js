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
/* Logo is now an inline SVG-masked element in each page header (see style.css .brand-logo). */

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
  const fb = window.cwsFirebase && window.cwsFirebase.enabled ? window.cwsFirebase : null;
  try {
    let result;
    if (fb) {
      // Firebase checks the password; our server then opens the session from the verified token.
      const isSignup = endpoint === '/api/signup';
      let idToken;
      try {
        idToken = isSignup ? await fb.signUp(payload.name, payload.email, payload.password) : await fb.signIn(payload.email, payload.password);
      } catch (err) {
        setFormMessage(form, fb.explain(err), true);
        return;
      }
      result = await fetchJson('/api/auth/firebase', { method: 'POST', body: JSON.stringify({ idToken, name: payload.name }) });
    } else {
      result = await fetchJson(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    }
    const { response, data } = result;
    if (!response.ok || !data.success) {
      if (fb) fb.signOut();
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
    }
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
  const items = inv.items || [];
  const rows = items.map((i, n) => `<tr><td class="c n">${n + 1}</td><td class="d">${esc(i.desc)}</td><td class="c">${esc(i.qty)}</td><td class="r">${money(i.price)}</td><td class="r a">${money(i.qty * i.price)}</td></tr>`).join('');
  const pad = Array.from({ length: Math.max(0, 6 - items.length) }, () => '<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  const subtotal = items.reduce((t, i) => t + Number(i.qty) * Number(i.price), 0);
  const status = String(inv.status || 'unpaid');
  const origin = location.origin;
  const date = esc(String(inv.created_at || '').slice(0, 10));
  const paid = status === 'paid';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(inv.invoice_no)} | CWS Multimedia Connect</title>
<style>
@page{size:A4;margin:0}*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{--ink:#0f1218;--ink2:#1b2330;--g:#c3c9d1;--gd:#4b5563;--soft:#eef0f2;--line:#d9dfe4;--mut:#5b6672}
body{font-family:'Montserrat',Arial,sans-serif;background:#e8ebee;color:var(--ink);font-size:12px;line-height:1.5}
.sheet{position:relative;display:flex;flex-direction:column;width:210mm;min-height:297mm;margin:12px auto;background:#fff;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.15)}
.top{position:relative;background:var(--ink);color:#fff;height:132px;padding:26px 34px;border-bottom-right-radius:0}
.top img.logo{height:44px;display:block;position:relative;z-index:2}
.top .tag{position:relative;z-index:2;margin-top:10px;font-size:9.5px;letter-spacing:.3em;color:var(--g);font-weight:700}
.top .sw{position:absolute;left:0;top:0;width:100%;height:100%}
.top h1{position:absolute;right:34px;top:30px;z-index:2;font-size:46px;letter-spacing:.04em;font-weight:900;line-height:1}
.top .no{position:absolute;right:34px;top:84px;z-index:2;font-size:12px;letter-spacing:.2em;color:var(--g);font-weight:700}
.stripe{height:7px;background:linear-gradient(90deg,var(--g) 0 38%,#fff 38% 40%,var(--ink2) 40% 78%,#fff 78% 80%,var(--g) 80%)}
.pad{padding:22px 34px 0}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.box{border:1.5px solid var(--ink)}
.box h4{background:var(--ink);color:#fff;font-size:10px;letter-spacing:.2em;text-transform:uppercase;padding:6px 12px}
.box div{padding:5px 12px;border-top:1px solid var(--line);font-weight:600}.box div:first-of-type{border-top:0}.box div small{display:inline-block;min-width:54px;color:var(--mut);font-weight:700;font-size:9px;letter-spacing:.1em;text-transform:uppercase}
.meta{margin:20px auto 0;width:88%;background:var(--ink);border-radius:14px;padding:9px;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;box-shadow:0 0 0 3px var(--soft)}
.meta p{display:flex;gap:0;align-items:stretch}.meta b{flex:1;color:#fff;font-size:10.5px;padding:6px 10px;letter-spacing:.04em}.meta span{flex:1.1;background:#fff;color:var(--ink);font-weight:800;text-align:center;padding:6px;font-size:11.5px;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-top:22px}
th{background:var(--ink);color:#fff;font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:9px 8px}
td{padding:8px;border:1px solid var(--line);font-weight:600}
tbody tr:nth-child(even) td{background:#f6f9f8}
td.c,th.c{text-align:center}td.r{text-align:right}td.n{width:34px;color:var(--gd)}td.d{width:44%;text-align:left;font-weight:700}tr.blank td{height:26px}
.lower{display:grid;grid-template-columns:1fr 250px;gap:26px;margin-top:0}
.notes{padding-top:14px;color:var(--mut)}.notes h5{color:var(--ink);font-size:10px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:5px}
.tot div{display:flex;justify-content:space-between;padding:8px 12px;font-weight:700;border:1px solid var(--line);border-top:0}
.tot div.h{background:var(--ink);color:#fff;border-color:var(--ink);letter-spacing:.14em;font-size:10px;text-transform:uppercase}
.tot div.due{background:var(--g);color:var(--ink);font-size:14px;font-weight:900;border-color:var(--g);letter-spacing:.04em}
.pay{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:0;border:1.5px solid var(--ink)}
.pay h4{grid-column:1/-1;background:var(--soft);border-bottom:1.5px solid var(--ink);padding:7px 12px;font-size:10px;letter-spacing:.2em;text-transform:uppercase}
.pay div{padding:7px 12px;font-weight:700}.pay div small{display:block;color:var(--mut);font-size:9px;letter-spacing:.12em;text-transform:uppercase}
.terms{margin-top:14px;font-size:10.5px;color:var(--mut);border-left:3px solid var(--g);padding-left:10px}
.sign{margin:36px 34px 0 auto;width:210px;border-top:1.5px solid var(--ink);text-align:center;padding-top:6px;font-weight:800;font-size:11px;letter-spacing:.06em}
.foot{margin-top:auto;padding-top:26px;text-align:center}
.foot .addr{font-weight:800;font-size:11px;padding:12px 34px;border-top:2px solid var(--ink)}
.foot .ty{background:var(--ink);color:#fff;font-size:10px;letter-spacing:.24em;font-weight:700;padding:9px;border-top:4px solid var(--g)}
.stamp{position:absolute;left:70px;top:612px;transform:rotate(-14deg);border:4px solid var(--gd);color:var(--gd);font-weight:900;font-size:34px;letter-spacing:.14em;padding:2px 16px;border-radius:8px;opacity:.28}
.corner{position:absolute;left:-40px;bottom:96px;width:130px;height:130px;border:2px solid var(--g);border-radius:50%;opacity:.35}
.print-bar{position:fixed;right:14px;top:12px;display:flex;gap:8px}.print-bar button{background:var(--ink);color:#fff;border:0;border-radius:6px;padding:9px 16px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}.print-bar{display:none}}
@media (max-width:820px){.sheet{width:100%}}
</style></head><body>
<div class="print-bar"><button onclick="window.print()">Print / Save PDF</button></div>
<div class="sheet">
 <header class="top">
  <svg class="sw" viewBox="0 0 800 132" preserveAspectRatio="none" aria-hidden="true"><path d="M330 132C420 100 520 40 640 0" fill="none" stroke="#c3c9d1" stroke-width="3"/><path d="M300 132C400 105 500 55 600 0" fill="none" stroke="#fff" stroke-width="1.5" opacity=".6"/><path d="M360 132C450 95 540 30 680 0" fill="none" stroke="#5b6672" stroke-width="1.5"/></svg>
  <img class="logo" src="${origin}/assets/cws-logo-white.svg" alt="CWS Multimedia Connect">
  <div class="tag">CONNECTING THE WORLD AS ONE</div>
  <h1>INVOICE</h1><div class="no">${esc(inv.invoice_no)}</div>
 </header>
 <div class="stripe"></div>
 <div class="pad">
  <section class="parties">
   <div class="box"><h4>Billed to</h4><div>${esc(inv.client_name)}</div><div><small>Email</small> ${esc(inv.client_email || '-')}</div></div>
   <div class="box"><h4>From</h4><div>CWS Multimedia Connect</div><div><small>Owner</small> Chikomborero Walter Sumairi</div><div><small>Phone</small> +263 77 427 4544</div></div>
  </section>
  <section class="meta">
   <p><b>Invoice No.</b><span>${esc(inv.invoice_no)}</span></p><p><b>Status</b><span>${esc(status.replace('_', ' '))}</span></p>
   <p><b>Invoice Date</b><span>${date}</span></p><p><b>Due Date</b><span>${esc(inv.due_date || '-')}</span></p>
  </section>
  <table><thead><tr><th class="c">No.</th><th>Description</th><th class="c">Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}${pad}</tbody></table>
  <section class="lower">
   <div class="notes"><h5>Notes</h5>${inv.notes ? esc(inv.notes) : 'Please include the invoice number in your payment reference.'}</div>
   <div class="tot"><div class="h"><span>Subtotal</span><span>${money(subtotal)}</span></div><div class="due"><span>AMOUNT DUE</span><span>${money(inv.total)}</span></div></div>
  </section>
  <section class="pay"><h4>Make all payments to</h4>
   <div><small>Account name</small>Chikomborero Walter Sumairi</div><div><small>EcoCash</small>${esc((typeof siteConfig !== 'undefined' && siteConfig.ecocash) || '0774274544')}</div>
  </section>
  <p class="terms">Please include the invoice number in your payment reference. Questions? WhatsApp or call +263 77 427 4544.</p>
 </div>
 <div class="sign">Authorized Sign.</div>
 <div class="corner"></div>
 ${paid ? '<div class="stamp">PAID</div>' : ''}
 <footer class="foot"><div class="addr">Kadoma, Zimbabwe &bull; Phone +263 77 427 4544 &bull; chikomborerowaltersumairi26@gmail.com</div><div class="ty">THANK YOU! WE APPRECIATE YOUR BUSINESS</div></footer>
</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},500)})<\/script>
</body></html>`;
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
          statusMsg.style.color = 'var(--accent)';
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
      if (window.cwsFirebase && window.cwsFirebase.enabled) await window.cwsFirebase.signOut();
      window.location.href = '/login.html';
    });
  }

  if (document.body.dataset.page === 'dashboard') loadDashboard();
});
