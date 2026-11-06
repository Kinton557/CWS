/*
 * CWS Multimedia Connect - server
 * Owner: Chikomborero Walter Sumairi, Kadoma, Zimbabwe
 * EcoCash: 0774274544
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
require('dotenv').config();

let Paynow = null;
try { ({ Paynow } = require('paynow')); } catch (e) { /* paynow optional */ }

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Split hosting: pages on GitHub Pages (SITE_URL), this server on its own address (API_URL, BASE_URL by default).
const SITE_URL = (process.env.SITE_URL || BASE_URL).replace(/\/$/, '');
const API_URL = (process.env.API_URL || BASE_URL).replace(/\/$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://cwsmultimediaconnect.co.zw,https://www.cwsmultimediaconnect.co.zw')
  .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
// Uploaded images live on this server; send the pages an absolute address, store the relative one.
const assetUrl = (v) => (/^uploads\//.test(String(v || '')) ? `${API_URL}/${v}` : v);
const relAsset = (v) => (String(v || '').startsWith(`${API_URL}/uploads/`) ? String(v).slice(API_URL.length + 1) : v);
const ECOCASH_NUMBER = process.env.ECOCASH_NUMBER || '0774274544';
// Direct EcoCash (EcoCash Instant Payments): the PIN prompt appears on the buyer's phone.
// Switched on by setting EIP_USERNAME and EIP_PASSWORD (plus the merchant values below) in the environment.
const EIP_BASE = (process.env.EIP_BASE_URL || 'https://developers.ecocash.co.zw/sandbox/payment/v1').replace(/\/+$/, '');
const EIP_SANDBOX = EIP_BASE.includes('/sandbox/');
const EIP_CURRENCY = process.env.EIP_CURRENCY || 'USD';
const eipReady = ['EIP_USERNAME', 'EIP_PASSWORD', 'EIP_MERCHANT_CODE', 'EIP_MERCHANT_PIN', 'EIP_MERCHANT_NUMBER', 'EIP_TERMINAL_ID', 'EIP_MERCHANT_NAME']
  .every((name) => Boolean(process.env[name]));
const IS_PROD = process.env.NODE_ENV === 'production';

const dataDir = path.join(__dirname, 'data');
const deliverablesDir = path.join(__dirname, 'deliverables'); // private: only served through /api/download
const uploadsDir = path.join(__dirname, 'uploads');           // public preview images
[dataDir, deliverablesDir, uploadsDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS about_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT DEFAULT '',
    role TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    location TEXT DEFAULT '',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tagline TEXT DEFAULT '',
    url TEXT DEFAULT '',
    logo TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    t INTEGER NOT NULL, vid TEXT NOT NULL, sid TEXT NOT NULL, path TEXT NOT NULL,
    ref TEXT DEFAULT '', dev TEXT DEFAULT '', br TEXT DEFAULT '', os TEXT DEFAULT '', tz TEXT DEFAULT '', nv INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_hits_t ON hits(t);
  CREATE TABLE IF NOT EXISTS live (
    vid TEXT PRIMARY KEY, t INTEGER NOT NULL, sid TEXT, path TEXT, dev TEXT, br TEXT, tz TEXT
  );

  CREATE TABLE IF NOT EXISTS design_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Flyer',
    label TEXT DEFAULT '',
    filter_key TEXT DEFAULT 'flyers',
    price TEXT NOT NULL DEFAULT '$0',
    image TEXT NOT NULL DEFAULT 'church-service.jpg',
    file_name TEXT DEFAULT '',
    format TEXT DEFAULT 'Digital',
    delivery TEXT DEFAULT 'Instant after payment',
    meta TEXT DEFAULT '',
    description TEXT DEFAULT '',
    features TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'available',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    post_id INTEGER,
    service_name TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT,
    payment_ref TEXT,
    access_code TEXT,
    proof_note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES design_posts(id)
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL UNIQUE,
    order_id INTEGER,
    user_id INTEGER,
    client_name TEXT NOT NULL,
    client_email TEXT DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'unpaid',
    due_date TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe upgrades for databases created by older versions of the site.
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
['label TEXT DEFAULT \'\'', 'filter_key TEXT DEFAULT \'flyers\'', 'file_name TEXT DEFAULT \'\'', 'format TEXT DEFAULT \'Digital\'',
  'delivery TEXT DEFAULT \'Instant after payment\'', 'meta TEXT DEFAULT \'\'', 'features TEXT DEFAULT \'[]\'', 'item_code TEXT']
  .forEach((def) => addColumnIfMissing('design_posts', def.split(' ')[0], def.split(' ').slice(1).join(' ')));
['payment_ref TEXT', 'paid_at TEXT', 'eip_msisdn TEXT'].forEach((def) => addColumnIfMissing('orders', def.split(' ')[0], def.split(' ').slice(1).join(' ')));
const legacyCols = db.prepare('PRAGMA table_info(design_posts)').all().map((c) => c.name);
if (legacyCols.includes('access_code')) {
  db.exec("UPDATE design_posts SET item_code = access_code WHERE item_code IS NULL OR item_code = ''");
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const SERVICE_PRICES = {
  'Flyer / Poster Design': 15,
  'Full Brand Identity': 35,
  'Full Media Package': 70
};

const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const priceToNumber = (price) => Number(String(price || '0').replace(/[^0-9.]/g, '')) || 0;
const clean = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const safeFileName = (name) => path.basename(String(name || '')).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);

function nextItemCode() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM design_posts").get();
  let n = row.c + 1;
  let code;
  do {
    code = 'CC-' + String(n).padStart(4, '0');
    n += 1;
  } while (db.prepare('SELECT id FROM design_posts WHERE item_code = ?').get(code));
  return code;
}

function randomChunk(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// Unlock code a buyer receives AFTER payment is confirmed. e.g. CWS-7KQ2-M9XA
function generateAccessCode() {
  let code;
  do {
    code = `CWS-${randomChunk(4)}-${randomChunk(4)}`;
  } while (db.prepare('SELECT id FROM orders WHERE access_code = ?').get(code));
  return code;
}

function nextInvoiceNo() {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT COUNT(*) AS c FROM invoices').get();
  let n = row.c + 1;
  let no;
  do {
    no = `INV-${year}-${String(n).padStart(4, '0')}`;
    n += 1;
  } while (db.prepare('SELECT id FROM invoices WHERE invoice_no = ?').get(no));
  return no;
}

function publicPost(p) {
  let features = [];
  try { features = JSON.parse(p.features || '[]'); } catch (e) { features = []; }
  return {
    id: p.id, item_code: p.item_code, title: p.title, category: p.category, label: p.label, filter_key: p.filter_key,
    price: p.price, image: assetUrl(p.image), format: p.format, delivery: p.delivery, meta: p.meta,
    description: p.description, features, status: p.status
  };
}

function adminPost(p) {
  return { ...publicPost(p), file_name: p.file_name || '' };
}

function createInvoiceForOrder(order, user) {
  const items = [{ desc: order.service_name, qty: 1, price: order.amount }];
  const result = db.prepare(`
    INSERT INTO invoices (invoice_no, order_id, user_id, client_name, client_email, items, total, status, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nextInvoiceNo(), order.id, user.id, user.name, user.email, JSON.stringify(items), order.amount,
    order.status === 'paid' ? 'paid' : 'unpaid', nowIso().slice(0, 10),
    `Order #${order.id}. Pay via EcoCash to ${ECOCASH_NUMBER} (Chikomborero Walter Sumairi).`
  );
  return result.lastInsertRowid;
}

function markOrderPaid(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const code = order.access_code || (order.post_id ? generateAccessCode() : null);
  db.prepare("UPDATE orders SET status = 'paid', access_code = ?, paid_at = ? WHERE id = ?").run(code, nowIso(), orderId);
  db.prepare("UPDATE invoices SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status != 'void'").run(orderId);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function seedCatalog() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM design_posts').get().c;
  if (count > 0) return;
  const seed = [
    ['Abnormal Manifestation', 'Church', 'Church design', 'church', '$20', 'Abnormal-Manifestation-Sunday.png', 'Poster • Digital', '2-3 days',
      'Event poster design with vibrant stage-ready energy.',
      'An energetic church poster built to attract attention and communicate a powerful gathering clearly.',
      ['High-contrast graphic style', 'Great for event promotion', 'Optimized for WhatsApp and print']],
    ['Sunday Service Promo', 'Flyer', 'Flyer', 'flyers', '$15', 'Sunday-service-11.jpg', 'Flyer • A4', '1-2 days',
      'Clean, warm and conversion-focused service artwork.',
      'A warm and welcoming weekend flyer designed to simplify the event message and boost attendance.',
      ['Clean layout and easy reading', 'Ideal for church outreach', 'Ready for print and social sharing']],
    ['The Dew of Heaven', 'Branding', 'Branding', 'branding', '$25', 'The-Dew-of-Heaven-Sunday-service.jpg', 'Brand kit • Digital', '3-5 days',
      'Premium event identity with a refined editorial look.',
      'A refined event identity with premium styling for campaigns, stage branding, and digital promotion.',
      ['Premium visual identity', 'Built for event branding', 'Works across print and digital media']],
    ['Family Deliverance', 'Event', 'Event poster', 'events', '$18', 'family-deliverance--service-11.jpg', 'Poster • A3', '2-3 days',
      'Impactful layout designed for church outreach campaigns.',
      'A bold event poster made for outreach campaigns, community gatherings, and personal invitation sharing.',
      ['Strong visual hierarchy', 'Created for community events', 'Easy to share in groups and on social channels']],
    ['Holy Gathering', 'Social', 'Social graphic', 'social', '$12', 'holy-10.jpg', 'Social • Square', '1-2 days',
      'Modern social media creative built for deeper engagement.',
      'A sharp social media design that helps your event message feel modern, clear, and highly shareable.',
      ['Square optimized layout', 'Instagram-ready composition', 'Perfect for posting and boosting reach']],
    ['Candid Candy', 'Poster', 'Marketing', 'posters', '$22', 'candid-candy.jpg', 'Poster • Digital', '2-4 days',
      'Bright promotional artwork for product launches and promos.',
      'A bright and modern promotional poster made for campaigns, product launches, and seasonal marketing.',
      ['Vibrant promotional energy', 'Built for audience attention', 'Suitable for digital and print use']]
  ];
  const insert = db.prepare(`
    INSERT INTO design_posts (item_code, title, category, label, filter_key, price, image, file_name, format, delivery, meta, description, features, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')
  `);
  seed.forEach((s) => {
    const [title, category, label, filter, price, image, format, delivery, meta, description, features] = s;
    // Placeholder deliverable = the preview image. Replace with the real source file from the dashboard.
    const src = path.join(__dirname, image);
    const dest = path.join(deliverablesDir, image);
    if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest);
    insert.run(nextItemCode(), title, category, label, filter, price, image, image, format, delivery, meta, description, JSON.stringify(features));
  });
}
seedCatalog();

// Give any item that has no code one (covers items from older databases).
db.prepare("SELECT id FROM design_posts WHERE item_code IS NULL OR item_code = ''").all()
  .forEach((row) => db.prepare('UPDATE design_posts SET item_code = ? WHERE id = ?').run(nextItemCode(), row.id));

try { db.exec("ALTER TABLE brands ADD COLUMN description TEXT DEFAULT ''"); } catch (e) { /* column already exists */ }

const adminEmail = String(process.env.ADMIN_EMAIL || 'chikomborerowaltersumairi26@gmail.com').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  console.warn('WARNING: ADMIN_PASSWORD is not set in .env, so no admin account will be created.');
} else if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    'Chikomborero Walter Sumairi', adminEmail, bcrypt.hashSync(adminPassword, 12), 'admin'
  );
}

// Developer accounts (Kinton Technologies): list their emails in DEV_EMAILS. Optional DEV_PASSWORD creates the first one.
const devEmails = String(process.env.DEV_EMAILS || process.env.DEV_EMAIL || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
if (devEmails.length) {
  db.prepare(`UPDATE users SET role = 'developer' WHERE role = 'user' AND email IN (${devEmails.map(() => '?').join(',')})`).run(...devEmails);
  if (process.env.DEV_PASSWORD && !db.prepare('SELECT id FROM users WHERE email = ?').get(devEmails[0])) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('Kinton Technologies', devEmails[0], bcrypt.hashSync(process.env.DEV_PASSWORD, 12), 'developer');
  }
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */
if (IS_PROD) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
/* ---- Sign-in that survives restarts -------------------------------- */
/* The login lives in a signed cookie (30 days, renewed while you use the site), so it does not
   depend on server memory. Render restarts or sleeps the server often; the old in-memory
   session was lost every time and everyone had to sign in again. Set SESSION_SECRET in .env. */
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_MS = 6 * 60 * 60 * 1000;
const SESSION_SECRET_FROM_ENV = Boolean(process.env.SESSION_SECRET);
const SESSION_SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(dataDir, '.session-secret');
  try { if (fs.existsSync(f)) { const v = fs.readFileSync(f, 'utf8').trim(); if (v.length >= 32) return v; } } catch (e) { /* fall through */ }
  const v = crypto.randomBytes(48).toString('hex');
  try { fs.writeFileSync(f, v, { mode: 0o600 }); } catch (e) { /* read-only disk */ }
  console.warn('WARNING: SESSION_SECRET is not set. Using a generated secret saved in data/. Set SESSION_SECRET in .env so logins survive a new deploy.');
  return v;
})();
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };
const sameSiteHosts = (a, b) => !a || !b || a === b || a.split('.').slice(1).join('.') === b || b.split('.').slice(1).join('.') === a;
const COOKIE_SAMESITE = String(process.env.COOKIE_SAMESITE || (IS_PROD && !sameSiteHosts(hostOf(SITE_URL), hostOf(API_URL)) ? 'none' : 'lax')).toLowerCase();
const signToken = (u, iat) => {
  const body = Buffer.from(JSON.stringify({ u: { id: u.id, email: u.email }, iat, exp: iat + SESSION_MS })).toString('base64url');
  return `v1.${body}.${crypto.createHmac('sha256', SESSION_SECRET).update(`v1.${body}`).digest('base64url')}`;
};
function readToken(req) {
  const m = /(?:^|;\s*)cws_auth=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const want = crypto.createHmac('sha256', SESSION_SECRET).update(`v1.${parts[1]}`).digest();
  let got; try { got = Buffer.from(parts[2], 'base64url'); } catch (e) { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return d && d.u && d.exp > Date.now() ? d : null;
  } catch (e) { return null; }
}
function cookieAttrs(maxAgeSec) {
  let c = `; Path=/; HttpOnly; Max-Age=${maxAgeSec}; SameSite=${COOKIE_SAMESITE.charAt(0).toUpperCase()}${COOKIE_SAMESITE.slice(1)}`;
  if (IS_PROD || COOKIE_SAMESITE === 'none') c += '; Secure';
  if (process.env.COOKIE_DOMAIN) c += `; Domain=${process.env.COOKIE_DOMAIN}`;
  return c;
}
app.use((req, res, next) => {
  const tok = readToken(req);
  let user = null;
  if (tok) {
    const row = db.prepare('SELECT id, name, email, role FROM users WHERE email = ?').get(String(tok.u.email || '').toLowerCase());
    if (row && row.id === tok.u.id) user = row; // role changes made by the admin apply straight away
  }
  const setCookie = (u) => res.append('Set-Cookie', `cws_auth=${signToken(u, Date.now())}${cookieAttrs(SESSION_MS / 1000)}`);
  const clearCookie = () => { res.append('Set-Cookie', `cws_auth=${cookieAttrs(0)}`); res.append('Set-Cookie', `cws_sid=${cookieAttrs(0)}`); };
  const sess = {
    regenerate(cb) { if (cb) cb(); },
    destroy(cb) { user = null; clearCookie(); if (cb) cb(); }
  };
  Object.defineProperty(sess, 'user', { enumerable: true, get: () => user, set: (u) => { user = u || null; if (u) setCookie(u); else clearCookie(); } });
  req.session = sess;
  if (user && Date.now() - tok.iat > RENEW_MS) setCookie(user); // keep active people signed in
  next();
});

/* ---- Health bookkeeping (shown to staff in Dashboard > Site health) ---- */
const startedAt = Date.now();
const reqStats = { total: 0, s2: 0, s3: 0, s4: 0, s5: 0, lat: [] };
const recentErrors = [];
function pushError(kind, detail, extra) {
  recentErrors.unshift(Object.assign({ t: Date.now(), kind, detail: String(detail || '').slice(0, 300) }, extra || {}));
  if (recentErrors.length > 50) recentErrors.pop();
}
process.on('unhandledRejection', (e) => { pushError('unhandledRejection', e && e.message ? e.message : e); console.error('unhandledRejection', e); });
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    reqStats.total++;
    const c = res.statusCode;
    if (c >= 500) { reqStats.s5++; pushError('http ' + c, `${req.method} ${req.path}`, { status: c }); }
    else if (c >= 400) reqStats.s4++; else if (c >= 300) reqStats.s3++; else reqStats.s2++;
    reqStats.lat.push(ms); if (reqStats.lat.length > 500) reqStats.lat.shift();
  });
  next();
});

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, skip: (req) => req.path === '/track' || req.path === '/health' }));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait 15 minutes and try again.' }
});

const paynowReady = Boolean(Paynow && process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY);
function newPaynow() {
  const p = new Paynow(process.env.PAYNOW_INTEGRATION_ID, process.env.PAYNOW_INTEGRATION_KEY);
  p.resultUrl = `${API_URL}/api/paynow/update`;
  p.returnUrl = `${SITE_URL}/thank-you.html`;
  return p;
}

// One call to the EcoCash API. The caller reads httpStatus and body; only network trouble throws.
async function eipRequest(method, apiPath, payload) {
  const login = Buffer.from(`${process.env.EIP_USERNAME}:${process.env.EIP_PASSWORD}`).toString('base64');
  const response = await fetch(EIP_BASE + apiPath, {
    method,
    headers: { Authorization: `Basic ${login}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  return { httpStatus: response.status, body };
}

function eipChargeBody(correlator, msisdn, amount, description) {
  return {
    clientCorrelator: correlator,
    notifyUrl: '',
    referenceCode: correlator,
    tranType: 'MER',
    endUserId: msisdn,
    remarks: description,
    transactionOperationStatus: 'Charged',
    paymentAmount: {
      charginginformation: { amount: Number(amount).toFixed(2), currency: EIP_CURRENCY, description },
      chargeMetaData: { channel: process.env.EIP_CHANNEL || 'WEB' }
    },
    merchantCode: process.env.EIP_MERCHANT_CODE,
    merchantPin: process.env.EIP_MERCHANT_PIN,
    merchantNumber: process.env.EIP_MERCHANT_NUMBER,
    countryCode: 'ZW',
    terminalID: process.env.EIP_TERMINAL_ID,
    location: process.env.EIP_LOCATION || 'Harare',
    superMerchantName: process.env.EIP_SUPER_MERCHANT_NAME || 'ECOCASH',
    merchantName: process.env.EIP_MERCHANT_NAME
  };
}

// Asks EcoCash how a charge went (PENDING, SUCCESS or FAILED) and updates the order to match.
async function eipRefreshOrder(order) {
  const lookup = `/${encodeURIComponent(order.eip_msisdn)}/transactions/amount/${encodeURIComponent(order.payment_ref)}`;
  const r = await eipRequest('GET', lookup);
  if (r.httpStatus !== 200) return { message: '' }; // not registered yet, keep waiting
  const code = String(r.body.status || '').toUpperCase();
  if (code === 'SUCCESS') {
    const sameAmount = r.body.amount === undefined || Math.round(Number(r.body.amount) * 100) === Math.round(Number(order.amount) * 100);
    if (sameAmount) markOrderPaid(order.id);
    return { message: sameAmount ? '' : 'The amount EcoCash received does not match this order. Please contact us.' };
  }
  if (code === 'FAILED') {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(order.id);
    db.prepare("UPDATE invoices SET status = 'void', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?").run(order.id);
    return { message: clean(r.body.statusMessage, 120) || 'EcoCash did not approve the payment.' };
  }
  return { message: '' };
}

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: 'Please sign in first.' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
};

const requireStaff = (req, res, next) => {
  const u = req.session.user;
  if (!u || (u.role !== 'admin' && u.role !== 'developer')) return res.status(403).json({ success: false, message: 'Staff access required.' });
  next();
};

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
app.get('/api/config', (req, res) => {
  res.json({ success: true, firebase: Boolean(process.env.FIREBASE_PROJECT_ID), ecocash: ECOCASH_NUMBER, accountName: 'Chikomborero Walter Sumairi', paynow: paynowReady, ecocashPrompt: eipReady, eipSandbox: eipReady && EIP_SANDBOX, guideAi: GUIDE_AI_READY });
});

app.get('/api/session', (req, res) => {
  const user = req.session.user || null;
  res.json({ authenticated: !!user, user });
});

/* ------------------------------------------------------------------ */
/* CWS Guide (optional AI). Without ANTHROPIC_API_KEY the website uses */
/* its built-in navigation assistant and never claims to be AI.        */
/* The key lives ONLY in .env on the server - never in browser code.   */
/* ------------------------------------------------------------------ */
const GUIDE_KB = require('./assets/guide-kb.js');
const GUIDE_AI_READY = Boolean(process.env.ANTHROPIC_API_KEY);
const GUIDE_MODEL = process.env.GUIDE_MODEL || 'claude-haiku-5-5';
const guideLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many questions, please wait a few minutes.' } });
function guideSystemPrompt() {
  const dest = Object.keys(GUIDE_KB.dest).map((k) => `${k}: ${GUIDE_KB.dest[k].label} (${GUIDE_KB.dest[k].url})`).join('\n');
  return 'You are CWS Guide, the assistant on the CWS Multimedia Connect website. Answer ONLY from the verified facts below; if something is not covered, say you do not have that information and suggest contacting CWS. Never invent prices, clients, awards, URLs or policies. Keep replies under 90 words, friendly and plain. If the visitor wants to be taken somewhere, end your reply with a line exactly like NAV:<key> using one key from the destinations list.\n\nFACTS:\n' + JSON.stringify({ company: GUIDE_KB.company, contact: GUIDE_KB.contact, packages: GUIDE_KB.packages, portfolio: GUIDE_KB.portfolio, payment: GUIDE_KB.payment, creativeconnect: GUIDE_KB.creativeconnect }) + '\n\nDESTINATIONS:\n' + dest;
}
app.post('/api/guide', guideLimiter, async (req, res) => {
  if (!GUIDE_AI_READY) return res.status(503).json({ success: false, message: 'AI is not configured.' });
  try {
    const message = String((req.body && req.body.message) || '').slice(0, 400).trim();
    if (!message) return res.status(400).json({ success: false, message: 'Empty message.' });
    const history = (Array.isArray(req.body.history) ? req.body.history : []).slice(-8)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
    while (history.length && history[0].role !== 'user') history.shift();
    if (history.length && history[history.length - 1].role === 'user' && history[history.length - 1].content === message) history.pop();
    const messages = history.concat([{ role: 'user', content: message }]);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: GUIDE_MODEL, max_tokens: 300, system: guideSystemPrompt(), messages })
    });
    if (!r.ok) throw new Error('AI status ' + r.status);
    const data = await r.json();
    let text = ((data.content || []).find((c) => c.type === 'text') || {}).text || '';
    let nav = null;
    const m = text.match(/NAV:([a-z]+)\s*$/i);
    if (m) { text = text.replace(/\s*NAV:[a-z]+\s*$/i, '').trim(); if (GUIDE_KB.dest[m[1].toLowerCase()]) nav = m[1].toLowerCase(); }
    res.json({ success: true, reply: text, nav });
  } catch (error) {
    console.error('Guide AI error:', error.message);
    res.status(502).json({ success: false, message: 'The assistant is unavailable right now.' });
  }
});

/* ------------------------------------------------------------------ */
/* Firebase sign-in: the browser signs in with Firebase, the server    */
/* verifies the ID token and opens its own session (orders, invoices,  */
/* admin rights stay in SQLite). Needs FIREBASE_PROJECT_ID in .env.    */
/* ------------------------------------------------------------------ */
let fbAdmin = null;
if (process.env.FIREBASE_PROJECT_ID) {
  try {
    fbAdmin = require('firebase-admin');
    fbAdmin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  } catch (e) { console.warn('Firebase disabled (run npm install):', e.message); fbAdmin = null; }
}

app.post('/api/auth/firebase', authLimiter, async (req, res) => {
  if (!fbAdmin) return res.status(503).json({ success: false, message: 'Firebase sign-in is not set up on the server.' });
  try {
    const decoded = await fbAdmin.auth().verifyIdToken(String((req.body && req.body.idToken) || ''));
    const email = String(decoded.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: 'This account has no email address.' });
    // The admin account is only released to a verified email, so nobody can claim it by signing up first.
    if (email === adminEmail && !decoded.email_verified) {
      return res.status(403).json({ success: false, message: 'Please verify your email first (check your inbox for the Firebase link), then log in again.' });
    }
    let user = db.prepare('SELECT id, name, email, role FROM users WHERE email = ?').get(email);
    if (!user) {
      const name = clean((req.body && req.body.name) || decoded.name || email.split('@')[0], 80) || 'Customer';
      const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name, email, bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10), email === adminEmail ? 'admin' : 'user');
      user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(r.lastInsertRowid);
    }
    if (devEmails.includes(email) && user.role === 'user') {
      if (!decoded.email_verified) return res.status(403).json({ success: false, message: 'Please verify your email first, then log in again.' });
      db.prepare("UPDATE users SET role = 'developer' WHERE id = ?").run(user.id);
      user.role = 'developer';
    }
    req.session.regenerate(() => {
      req.session.user = user;
      res.json({ success: true, user });
    });
  } catch (e) {
    res.status(401).json({ success: false, message: 'Sign-in could not be verified. Please try again.' });
  }
});

app.post('/api/signup', authLimiter, (req, res) => {
  const name = clean(req.body && req.body.name, 80);
  const email = clean(req.body && req.body.email, 120).toLowerCase();
  const password = String((req.body && req.body.password) || '');

  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
  if (name.length < 2) return res.status(400).json({ success: false, message: 'Name must be at least 2 characters long.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
  }

  const result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 12), 'user');
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  req.session.regenerate(() => {
    req.session.user = user;
    res.status(201).json({ success: true, user });
  });
});

app.post('/api/login', authLimiter, (req, res) => {
  const email = clean(req.body && req.body.email, 120).toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });

  const row = db.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?').get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  req.session.regenerate(() => {
    req.session.user = user;
    res.json({ success: true, user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('cws_sid');
    res.json({ success: true });
  });
});

/* ------------------------------------------------------------------ */
/* About page: owner profile + other brands (editable by admin)        */
/* ------------------------------------------------------------------ */
const cleanText = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const cleanImage = (v) => {
  const x = relAsset(String(v || '').trim());
  return /^(uploads\/[A-Za-z0-9._ -]+|https:\/\/[^\s"'<>]+)$/.test(x) ? x : '';
};
const cleanUrl = (v) => {
  const x = String(v || '').trim();
  if (!x) return '';
  return /^https?:\/\/[^\s"'<>]+$/i.test(x) ? x : null; // null = invalid
};

app.get('/api/about', (req, res) => {
  const profile = db.prepare('SELECT name, role, bio, photo, location FROM about_profile WHERE id = 1').get() || null;
  const brands = db.prepare('SELECT id, name, tagline, description, url, logo FROM brands ORDER BY sort_order ASC, id ASC').all()
    .map((b) => ({ ...b, logo: assetUrl(b.logo) }));
  if (profile) profile.photo = assetUrl(profile.photo);
  res.json({ success: true, profile, brands });
});

app.put('/api/admin/about', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  const photo = b.photo ? cleanImage(b.photo) : '';
  if (b.photo && !photo) return res.status(400).json({ success: false, message: 'Photo must be an uploaded image.' });
  db.prepare(`
    INSERT INTO about_profile (id, name, role, bio, photo, location, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, bio = excluded.bio,
      photo = excluded.photo, location = excluded.location, updated_at = CURRENT_TIMESTAMP
  `).run(cleanText(b.name, 120), cleanText(b.role, 160), cleanText(b.bio, 4000), photo, cleanText(b.location, 120));
  res.json({ success: true });
});

function readBrand(body) {
  const b = body || {};
  const name = cleanText(b.name, 120);
  if (!name) return { error: 'Brand name is required.' };
  const url = cleanUrl(b.url);
  if (url === null) return { error: 'Website link must start with http:// or https://' };
  const logo = b.logo ? cleanImage(b.logo) : '';
  if (b.logo && !logo) return { error: 'Logo must be an uploaded image.' };
  return { name, tagline: cleanText(b.tagline, 240), description: cleanText(b.description, 2000), url, logo };
}

app.post('/api/admin/brands', requireAuth, requireAdmin, (req, res) => {
  const v = readBrand(req.body);
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM brands').get().m;
  const r = db.prepare('INSERT INTO brands (name, tagline, description, url, logo, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(v.name, v.tagline, v.description, v.url, v.logo, max + 1);
  res.status(201).json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/admin/brands/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM brands WHERE id = ?').get(id)) return res.status(404).json({ success: false, message: 'Brand not found.' });
  const v = readBrand(req.body);
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  db.prepare('UPDATE brands SET name = ?, tagline = ?, description = ?, url = ?, logo = ? WHERE id = ?').run(v.name, v.tagline, v.description, v.url, v.logo, id);
  res.json({ success: true });
});

app.delete('/api/admin/brands/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM brands WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

/* ------------------------------------------------------------------ */
/* Catalog (CreativeConnect) - every item has an item code             */
/* ------------------------------------------------------------------ */
app.get('/api/posts', (req, res) => {
  const posts = db.prepare('SELECT * FROM design_posts ORDER BY id DESC').all().map(publicPost);
  res.json({ success: true, posts });
});

app.get('/api/admin/posts', requireAuth, requireAdmin, (req, res) => {
  const posts = db.prepare('SELECT * FROM design_posts ORDER BY id DESC').all().map(adminPost);
  res.json({ success: true, posts });
});

function readPostBody(body, existing = {}) {
  const features = Array.isArray(body.features)
    ? body.features
    : String(body.features != null ? body.features : (existing.features ? JSON.parse(existing.features || '[]').join('\n') : '')).split('\n');
  return {
    title: clean(body.title || existing.title, 120),
    category: clean(body.category || existing.category || 'Flyer', 40),
    label: clean(body.label || existing.label || body.category || existing.category || '', 40),
    filter_key: clean(body.filter_key || existing.filter_key || 'flyers', 20),
    price: clean(body.price || existing.price, 20),
    image: relAsset(clean(body.image || existing.image || 'church-service.jpg', 200)),
    file_name: clean(body.file_name != null ? body.file_name : (existing.file_name || ''), 200),
    format: clean(body.format || existing.format || 'Digital', 60),
    delivery: clean(body.delivery || existing.delivery || 'Instant after payment', 60),
    meta: clean(body.meta != null ? body.meta : (existing.meta || ''), 200),
    description: clean(body.description != null ? body.description : (existing.description || ''), 1000),
    features: JSON.stringify(features.map((f) => clean(f, 120)).filter(Boolean).slice(0, 8)),
    status: clean(body.status || existing.status || 'available', 20)
  };
}

app.post('/api/posts', requireAuth, requireAdmin, (req, res) => {
  const p = readPostBody(req.body || {});
  if (!p.title || !p.price) return res.status(400).json({ success: false, message: 'Title and price are required.' });

  let code = clean(req.body.item_code, 30).toUpperCase();
  if (!code) code = nextItemCode();
  if (db.prepare('SELECT id FROM design_posts WHERE item_code = ?').get(code)) {
    return res.status(409).json({ success: false, message: `Item code ${code} is already used.` });
  }

  const result = db.prepare(`
    INSERT INTO design_posts (item_code, title, category, label, filter_key, price, image, file_name, format, delivery, meta, description, features, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, p.title, p.category, p.label, p.filter_key, p.price, p.image, p.file_name, p.format, p.delivery, p.meta, p.description, p.features, p.status);
  res.status(201).json({ success: true, post: adminPost(db.prepare('SELECT * FROM design_posts WHERE id = ?').get(result.lastInsertRowid)) });
});

app.put('/api/posts/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM design_posts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Item not found.' });

  const p = readPostBody(req.body || {}, existing);
  let code = clean(req.body && req.body.item_code, 30).toUpperCase() || existing.item_code;
  const clash = db.prepare('SELECT id FROM design_posts WHERE item_code = ? AND id != ?').get(code, id);
  if (clash) return res.status(409).json({ success: false, message: `Item code ${code} is already used.` });

  db.prepare(`
    UPDATE design_posts SET item_code = ?, title = ?, category = ?, label = ?, filter_key = ?, price = ?, image = ?, file_name = ?,
      format = ?, delivery = ?, meta = ?, description = ?, features = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(code, p.title, p.category, p.label, p.filter_key, p.price, p.image, p.file_name, p.format, p.delivery, p.meta, p.description, p.features, p.status, id);
  res.json({ success: true, post: adminPost(db.prepare('SELECT * FROM design_posts WHERE id = ?').get(id)) });
});

app.delete('/api/posts/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM design_posts WHERE id = ?').get(id)) return res.status(404).json({ success: false, message: 'Item not found.' });
  db.prepare('DELETE FROM design_posts WHERE id = ?').run(id);
  res.json({ success: true, message: 'Item removed.' });
});

// Admin uploads: ?kind=preview (public image) or ?kind=file (private deliverable). Raw body, no extra packages needed.
const uploadParser = express.raw({ type: () => true, limit: '60mb' });
app.post('/api/admin/upload', requireAuth, requireAdmin, uploadParser, (req, res) => {
  const kind = req.query.kind === 'file' ? 'file' : 'preview';
  const name = safeFileName(req.query.name);
  if (!name || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ success: false, message: 'No file received.' });
  const ext = path.extname(name).toLowerCase();
  if (kind === 'preview' && !['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return res.status(400).json({ success: false, message: 'Preview must be a JPG, PNG or WEBP image.' });
  }
  if (kind === 'file' && ['.exe', '.bat', '.cmd', '.sh', '.js', '.html', '.htm', '.php'].includes(ext)) {
    return res.status(400).json({ success: false, message: 'That file type is not allowed.' });
  }
  const unique = `${Date.now().toString(36)}-${name}`;
  const dest = path.join(kind === 'file' ? deliverablesDir : uploadsDir, unique);
  fs.writeFileSync(dest, req.body);
  res.json({ success: true, value: kind === 'file' ? unique : `uploads/${unique}` });
});

/* ------------------------------------------------------------------ */
/* Orders, payment and redeem codes                                    */
/* ------------------------------------------------------------------ */
app.get('/api/orders', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const sql = `
    SELECT o.*, p.item_code, p.title AS item_title, u.name AS buyer_name, u.email AS buyer_email
    FROM orders o
    LEFT JOIN design_posts p ON p.id = o.post_id
    LEFT JOIN users u ON u.id = o.user_id
    ${isAdmin ? '' : 'WHERE o.user_id = ?'}
    ORDER BY o.id DESC`;
  const orders = isAdmin ? db.prepare(sql).all() : db.prepare(sql).all(req.session.user.id);
  res.json({ success: true, orders });
});

// Create an order for a catalog item (postId) or a priced service (serviceName). Amounts are always set by the server.
async function createOrderHandler(req, res) {
  try {
    const { postId, serviceName, paymentMethod, phone, paymentRef } = req.body || {};
    const method = ['ecocash_manual', 'ecocash', 'innbucks', 'zimswitch', 'paygo'].includes(paymentMethod) ? paymentMethod : 'ecocash_manual';

    let title; let amount; let resolvedPostId = null;
    if (postId) {
      const post = db.prepare('SELECT * FROM design_posts WHERE id = ?').get(Number(postId));
      if (!post) return res.status(404).json({ success: false, message: 'That design no longer exists.' });
      if (post.status === 'booked') return res.status(400).json({ success: false, message: 'This design is not available right now.' });
      title = `${post.title} (${post.item_code})`;
      amount = priceToNumber(post.price);
      resolvedPostId = post.id;
    } else if (serviceName && SERVICE_PRICES[serviceName]) {
      title = serviceName;
      amount = SERVICE_PRICES[serviceName];
    } else {
      return res.status(400).json({ success: false, message: 'Please choose a valid design or service.' });
    }
    if (!amount) return res.status(400).json({ success: false, message: 'This item has no price set yet.' });

    const manual = method === 'ecocash_manual';
    if (manual && !clean(paymentRef, 60)) {
      return res.status(400).json({ success: false, message: 'Enter the EcoCash transaction reference from your payment message.' });
    }
    const useEip = method === 'ecocash' && eipReady;
    const localNumber = clean(phone, 20).replace(/\D/g, '').replace(/^263/, '0');
    if (useEip && !/^07[78]\d{7}$/.test(localNumber)) {
      return res.status(400).json({ success: false, message: 'Enter your EcoCash number, for example 0771234567.' });
    }
    if (!manual && !paynowReady && !useEip) {
      return res.status(503).json({ success: false, message: `Online card/wallet checkout is not switched on yet. Pay by EcoCash to ${ECOCASH_NUMBER} and enter the reference instead.` });
    }
    if ((method === 'ecocash' || method === 'innbucks') && !clean(phone, 20)) {
      return res.status(400).json({ success: false, message: 'Mobile number is required for mobile money.' });
    }

    const user = req.session.user;
    const info = db.prepare(`
      INSERT INTO orders (user_id, post_id, service_name, amount, status, payment_method, payment_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, resolvedPostId, title, amount, manual ? 'awaiting_confirmation' : 'pending', method, manual ? clean(paymentRef, 60) : '');
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
    createInvoiceForOrder(order, user);

    if (manual) {
      return res.status(201).json({
        success: true, orderId: order.id,
        message: 'Order received. Once Chikomborero confirms your EcoCash payment, your access code will appear in your dashboard.'
      });
    }

    if (useEip) {
      // The reference is saved before EcoCash is called, so a slow answer can be looked up later and never charged twice.
      const correlator = `CWS-${order.id}-${Date.now().toString(36).toUpperCase()}`;
      const msisdn = `263${localNumber.slice(1)}`;
      db.prepare('UPDATE orders SET payment_ref = ?, eip_msisdn = ? WHERE id = ?').run(correlator, msisdn, order.id);
      let result;
      try {
        result = await eipRequest('POST', '/transactions/amount/', eipChargeBody(correlator, msisdn, amount, title));
      } catch (err) {
        console.error('EcoCash charge got no answer for order', order.id, err.message);
        return res.status(201).json({ success: true, orderId: order.id, eip: true, message: 'Payment sent. Approve it on your phone with your EcoCash PIN.' });
      }
      if (result.httpStatus !== 200) {
        console.error('EcoCash refused order', order.id, result.httpStatus, result.body.statusMessage || '');
        db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
        db.prepare("UPDATE invoices SET status = 'void' WHERE order_id = ?").run(order.id);
        const why = result.httpStatus === 422 && result.body.statusMessage ? clean(result.body.statusMessage, 120) : 'EcoCash could not start this payment. Please check the number and try again.';
        return res.status(400).json({ success: false, message: why });
      }
      return res.status(201).json({ success: true, orderId: order.id, eip: true, message: 'Check your phone and enter your EcoCash PIN to approve the payment.' });
    }

    const paynow = newPaynow();
    const payment = paynow.createPayment(`CWS-${order.id}`, user.email);
    payment.add(title, amount);
    const response = (method === 'ecocash' || method === 'innbucks')
      ? await paynow.sendMobile(payment, clean(phone, 20), method)
      : await paynow.send(payment);

    if (!response.success) {
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
      db.prepare("UPDATE invoices SET status = 'void' WHERE order_id = ?").run(order.id);
      return res.status(400).json({ success: false, message: response.error || 'Failed to start the payment.' });
    }
    res.status(201).json({
      success: true, orderId: order.id, redirectUrl: response.redirectUrl || null,
      message: response.instructions || 'Payment started. Approve it on your phone, then check your dashboard.'
    });
  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ success: false, message: 'Could not process the order. Please try again.' });
  }
}
app.post('/api/orders', requireAuth, createOrderHandler);
app.post('/api/checkout', requireAuth, createOrderHandler); // used by the pricing page

// The pricing page asks this while the buyer is entering their PIN. Only the buyer (or admin) can ask.
app.get('/api/orders/:id/status', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
    if (!order || (user.role !== 'admin' && order.user_id !== user.id)) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    let message = '';
    if (order.status === 'pending' && order.eip_msisdn && eipReady) {
      ({ message } = await eipRefreshOrder(order));
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    }
    res.json({ success: true, status: order.status, message });
  } catch (error) {
    console.error('Order status error:', error);
    res.status(500).json({ success: false, message: 'Could not check the payment.' });
  }
});

app.patch('/api/admin/orders/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body && req.body.status, 30);
  if (!['paid', 'pending', 'awaiting_confirmation', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  }
  if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(id)) return res.status(404).json({ success: false, message: 'Order not found.' });

  if (status === 'paid') {
    return res.json({ success: true, order: markOrderPaid(id) });
  }
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  if (status === 'cancelled') db.prepare("UPDATE invoices SET status = 'void', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?").run(id);
  res.json({ success: true, order: db.prepare('SELECT * FROM orders WHERE id = ?').get(id) });
});

app.delete('/api/admin/orders/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  db.prepare('UPDATE invoices SET order_id = NULL WHERE order_id = ?').run(id);
  res.json({ success: true });
});

// Buyer enters the code they were given after paying; returns what they unlocked.
function findPaidOrderByCode(code, user) {
  const normalized = clean(code, 30).toUpperCase();
  if (!normalized) return null;
  const order = db.prepare("SELECT * FROM orders WHERE access_code = ? AND status = 'paid'").get(normalized);
  if (!order) return null;
  if (user.role !== 'admin' && order.user_id !== user.id) return null;
  return order;
}

app.post('/api/redeem', requireAuth, (req, res) => {
  const order = findPaidOrderByCode(req.body && req.body.code, req.session.user);
  if (!order) return res.status(404).json({ success: false, message: 'That code is not valid for your account. Check it and try again.' });
  const post = db.prepare('SELECT * FROM design_posts WHERE id = ?').get(order.post_id);
  if (!post || !post.file_name) return res.status(404).json({ success: false, message: 'The file for this design is not available yet. Please contact us on WhatsApp.' });
  res.json({
    success: true,
    item: { title: post.title, item_code: post.item_code, format: post.format },
    downloadUrl: `/api/download/${encodeURIComponent(order.access_code)}`
  });
});

app.get('/api/download/:code', requireAuth, (req, res) => {
  const order = findPaidOrderByCode(req.params.code, req.session.user);
  if (!order) return res.status(404).send('Invalid code.');
  const post = db.prepare('SELECT * FROM design_posts WHERE id = ?').get(order.post_id);
  if (!post || !post.file_name) return res.status(404).send('File not available.');
  const filePath = path.join(deliverablesDir, path.basename(post.file_name));
  if (!fs.existsSync(filePath)) return res.status(404).send('File not available.');
  res.download(filePath, safeFileName(`${post.item_code}-${post.title}${path.extname(filePath)}`));
});

// Paynow calls this when a payment changes status. We verify the hash before trusting it.
app.post('/api/paynow/update', (req, res) => {
  try {
    if (!paynowReady) return res.status(200).send('OK');
    const body = req.body || {};
    const received = String(body.hash || '').toUpperCase();
    const joined = Object.keys(body).filter((k) => k.toLowerCase() !== 'hash').map((k) => body[k]).join('');
    const expected = crypto.createHash('sha512').update(joined + process.env.PAYNOW_INTEGRATION_KEY).digest('hex').toUpperCase();
    if (!received || received !== expected) return res.status(400).send('Invalid hash');

    const match = /^CWS-(\d+)$/.exec(String(body.reference || ''));
    if (match && String(body.status || '').toLowerCase() === 'paid') markOrderPaid(Number(match[1]));
    res.status(200).send('OK');
  } catch (error) {
    console.error('Paynow update error:', error);
    res.status(500).send('Error');
  }
});

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */
function parseInvoice(row) {
  let items = [];
  try { items = JSON.parse(row.items || '[]'); } catch (e) { items = []; }
  return { ...row, items };
}

function readInvoiceBody(body) {
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => ({ desc: clean(i.desc, 200), qty: Math.max(1, Number(i.qty) || 1), price: Math.max(0, Number(i.price) || 0) }))
    .filter((i) => i.desc);
  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  return {
    client_name: clean(body.client_name, 100),
    client_email: clean(body.client_email, 120).toLowerCase(),
    items, total,
    status: ['unpaid', 'paid', 'void'].includes(body.status) ? body.status : 'unpaid',
    due_date: clean(body.due_date, 10) || nowIso().slice(0, 10),
    notes: clean(body.notes, 500)
  };
}

app.get('/api/invoices', requireAuth, (req, res) => {
  const user = req.session.user;
  const rows = user.role === 'admin'
    ? db.prepare('SELECT * FROM invoices ORDER BY id DESC').all()
    : db.prepare('SELECT * FROM invoices WHERE user_id = ? OR (client_email != \'\' AND client_email = ?) ORDER BY id DESC').all(user.id, user.email);
  res.json({ success: true, invoices: rows.map(parseInvoice) });
});

app.post('/api/invoices', requireAuth, requireAdmin, (req, res) => {
  const inv = readInvoiceBody(req.body || {});
  if (!inv.client_name || !inv.items.length) return res.status(400).json({ success: false, message: 'Client name and at least one line item are required.' });
  const client = inv.client_email ? db.prepare('SELECT id FROM users WHERE email = ?').get(inv.client_email) : null;
  const info = db.prepare(`
    INSERT INTO invoices (invoice_no, user_id, client_name, client_email, items, total, status, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nextInvoiceNo(), client ? client.id : null, inv.client_name, inv.client_email, JSON.stringify(inv.items), inv.total, inv.status, inv.due_date, inv.notes);
  res.status(201).json({ success: true, invoice: parseInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid)) });
});

app.put('/api/invoices/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM invoices WHERE id = ?').get(id)) return res.status(404).json({ success: false, message: 'Invoice not found.' });
  const inv = readInvoiceBody(req.body || {});
  if (!inv.client_name || !inv.items.length) return res.status(400).json({ success: false, message: 'Client name and at least one line item are required.' });
  const client = inv.client_email ? db.prepare('SELECT id FROM users WHERE email = ?').get(inv.client_email) : null;
  db.prepare(`
    UPDATE invoices SET user_id = COALESCE(?, user_id), client_name = ?, client_email = ?, items = ?, total = ?, status = ?, due_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(client ? client.id : null, inv.client_name, inv.client_email, JSON.stringify(inv.items), inv.total, inv.status, inv.due_date, inv.notes, id);
  res.json({ success: true, invoice: parseInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)) });
});

app.delete('/api/invoices/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM invoices WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

/* ------------------------------------------------------------------ */
/* Users (admin)                                                       */
/* ------------------------------------------------------------------ */
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, users: db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id DESC').all() });
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
  if (target.role === 'admin') return res.status(400).json({ success: false, message: 'Admin accounts cannot be deleted here.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

/* ------------------------------------------------------------------ */
/* Users: developer access (admin only)                                */
/* ------------------------------------------------------------------ */
app.patch('/api/admin/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = String((req.body && req.body.role) || '');
  if (!['developer', 'user'].includes(role)) return res.status(400).json({ success: false, message: 'Role must be developer or user.' });
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
  if (target.role === 'admin' || id === req.session.user.id) return res.status(400).json({ success: false, message: 'The admin role cannot be changed here.' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ success: true });
});

/* ------------------------------------------------------------------ */
/* Visitor analytics: anonymous, first-party, stored in this database  */
/* ------------------------------------------------------------------ */
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|curl|wget|python|httpclient|monitor|scanner|gtmetrix|axios|node-fetch/i;
const TZ_COUNTRY = { 'Africa/Harare': 'Zimbabwe', 'Africa/Johannesburg': 'South Africa', 'Africa/Maputo': 'Mozambique', 'Africa/Lusaka': 'Zambia', 'Africa/Gaborone': 'Botswana', 'Africa/Windhoek': 'Namibia', 'Africa/Blantyre': 'Malawi', 'Africa/Nairobi': 'Kenya', 'Africa/Lagos': 'Nigeria', 'Africa/Accra': 'Ghana', 'Africa/Cairo': 'Egypt', 'Africa/Kampala': 'Uganda', 'Africa/Dar_es_Salaam': 'Tanzania', 'Africa/Addis_Ababa': 'Ethiopia', 'Africa/Kinshasa': 'DR Congo', 'Africa/Lubumbashi': 'DR Congo', 'Africa/Luanda': 'Angola', 'Africa/Casablanca': 'Morocco', 'Europe/London': 'United Kingdom', 'Europe/Dublin': 'Ireland', 'Europe/Paris': 'France', 'Europe/Berlin': 'Germany', 'Europe/Madrid': 'Spain', 'Europe/Rome': 'Italy', 'Europe/Amsterdam': 'Netherlands', 'Europe/Lisbon': 'Portugal', 'America/New_York': 'United States', 'America/Chicago': 'United States', 'America/Denver': 'United States', 'America/Los_Angeles': 'United States', 'America/Toronto': 'Canada', 'America/Sao_Paulo': 'Brazil', 'Asia/Dubai': 'UAE', 'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India', 'Asia/Karachi': 'Pakistan', 'Asia/Shanghai': 'China', 'Asia/Singapore': 'Singapore', 'Asia/Tokyo': 'Japan', 'Australia/Sydney': 'Australia', 'Pacific/Auckland': 'New Zealand' };
const countryOf = (tz) => TZ_COUNTRY[tz] || (tz ? String(tz).split('/')[0] : 'Unknown');
const clipStr = (v, n) => String(v == null ? '' : v).slice(0, n);
function parseUA(ua) {
  const dev = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return { dev, br, os };
}
const trackLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, standardHeaders: true, legacyHeaders: false, message: { success: false } });
const insHit = db.prepare('INSERT INTO hits (t, vid, sid, path, ref, dev, br, os, tz, nv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const upLive = db.prepare(`INSERT INTO live (vid, t, sid, path, dev, br, tz) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(vid) DO UPDATE SET t = excluded.t, sid = excluded.sid, path = excluded.path, dev = excluded.dev, br = excluded.br, tz = excluded.tz`);

app.post('/api/track', trackLimiter, (req, res) => {
  try {
    const ua = String(req.get('user-agent') || '');
    const u = req.session.user;
    if (!ua || BOT_RE.test(ua) || (u && (u.role === 'admin' || u.role === 'developer'))) return res.status(204).end(); // never count bots or staff
    const b = req.body || {};
    const vid = clipStr(b.vid, 40), sid = clipStr(b.sid, 24);
    if (!/^[a-z0-9]{8,40}$/i.test(vid) || !/^[a-z0-9]{6,24}$/i.test(sid)) return res.status(400).end();
    const pth = clipStr(b.path, 200).split('?')[0].split('#')[0];
    if (!pth.startsWith('/')) return res.status(400).end();
    const d = parseUA(ua), tz = clipStr(b.tz, 40).replace(/[^A-Za-z0-9_\/+-]/g, ''), now = Date.now();
    if (b.type === 'view') {
      const ref = clipStr(b.ref, 80).replace(/[^A-Za-z0-9.\-]/g, '');
      insHit.run(now, vid, sid, pth, ref, d.dev, d.br, d.os, tz, b.nv ? 1 : 0);
    }
    upLive.run(vid, now, sid, pth, d.dev, d.br, tz);
    res.status(204).end();
  } catch (e) { res.status(204).end(); }
});

function purgeOld() {
  try {
    db.prepare('DELETE FROM hits WHERE t < ?').run(Date.now() - 90 * DAY);
    db.prepare('DELETE FROM live WHERE t < ?').run(Date.now() - HOUR);
  } catch (e) { pushError('purge', e.message); }
}
purgeOld();
setInterval(purgeOld, 10 * MIN).unref();

app.get('/api/staff/analytics', requireAuth, requireStaff, (req, res) => {
  const range = ['today', '7d', '30d'].includes(req.query.range) ? req.query.range : 'today';
  const tzMin = Math.max(-840, Math.min(840, Number(req.query.tz) || 0)); // browser's getTimezoneOffset()
  const now = Date.now();
  const startToday = Math.floor((now - tzMin * MIN) / DAY) * DAY + tzMin * MIN;
  const days = range === '7d' ? 7 : 30;
  const from = range === 'today' ? startToday : startToday - (days - 1) * DAY;
  const unit = range === 'today' ? HOUR : DAY;
  const nBuckets = range === 'today' ? 24 : days;
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const top = (col, label) => db.prepare(`SELECT ${col} AS k, COUNT(*) AS c FROM hits WHERE t >= ? AND ${col} != '' GROUP BY ${col} ORDER BY c DESC LIMIT 8`).all(from).map((r) => [r.k, r.c]);

  const tot = one('SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors, COUNT(DISTINCT sid) AS sessions, COALESCE(SUM(nv), 0) AS newv FROM hits WHERE t >= ?', from);
  const single = one('SELECT COUNT(*) AS c FROM (SELECT sid FROM hits WHERE t >= ? GROUP BY sid HAVING COUNT(*) = 1)', from).c;
  const today = one('SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE t >= ?', startToday);

  const counts = new Array(nBuckets).fill(0);
  db.prepare('SELECT CAST((t - ?) / ? AS INTEGER) AS b, COUNT(*) AS c FROM hits WHERE t >= ? GROUP BY b').all(from, unit, from)
    .forEach((r) => { if (r.b >= 0 && r.b < nBuckets) counts[r.b] = r.c; });
  const mins = new Array(30).fill(0), m0 = now - 30 * MIN;
  db.prepare('SELECT CAST((t - ?) / ? AS INTEGER) AS b, COUNT(*) AS c FROM hits WHERE t >= ? GROUP BY b').all(m0, MIN, m0)
    .forEach((r) => { if (r.b >= 0 && r.b < 30) mins[r.b] = r.c; });

  const countries = {};
  db.prepare('SELECT tz, COUNT(*) AS c FROM hits WHERE t >= ? GROUP BY tz').all(from).forEach((r) => { const k = countryOf(r.tz); countries[k] = (countries[k] || 0) + r.c; });
  const live = db.prepare('SELECT path, dev, br, tz, t FROM live WHERE t >= ? ORDER BY t DESC LIMIT 25').all(now - 90000)
    .map((r) => ({ path: r.path, dev: r.dev, br: r.br, country: countryOf(r.tz), ago: Math.round((now - r.t) / 1000) }));
  const activeNow = one('SELECT COUNT(*) AS c FROM live WHERE t >= ?', now - 90000).c;
  const vis = (since) => Math.max(one('SELECT COUNT(DISTINCT vid) AS c FROM hits WHERE t >= ?', since).c, one('SELECT COUNT(*) AS c FROM live WHERE t >= ?', since).c);

  res.json({
    success: true, range, now, from, unit, tz: tzMin,
    live: { active: activeNow, rows: live }, last5: vis(now - 5 * MIN), last30: vis(now - 30 * MIN),
    today, totals: { views: tot.views, visitors: tot.visitors, sessions: tot.sessions, newVisitors: tot.newv,
      pagesPerVisit: tot.sessions ? Math.round(tot.views / tot.sessions * 10) / 10 : 0, bounce: tot.sessions ? Math.round(single / tot.sessions * 100) : 0 },
    buckets: counts, minutes: mins,
    top: { pages: top('path'), referrers: db.prepare(`SELECT CASE WHEN ref = '' THEN 'Direct or unknown' ELSE ref END AS k, COUNT(*) AS c FROM hits WHERE t >= ? GROUP BY k ORDER BY c DESC LIMIT 8`).all(from).map((r) => [r.k, r.c]),
      countries: Object.keys(countries).map((k) => [k, countries[k]]).sort((a, b) => b[1] - a[1]).slice(0, 8),
      devices: top('dev'), browsers: top('br'), os: top('os') },
    stored: one('SELECT COUNT(*) AS c FROM hits').c
  });
});

/* ------------------------------------------------------------------ */
/* Site health (admin and developer accounts)                          */
/* ------------------------------------------------------------------ */
const storageMarker = path.join(dataDir, '.first-boot');
try { if (!fs.existsSync(storageMarker)) fs.writeFileSync(storageMarker, String(Date.now())); } catch (e) { /* read-only */ }
const dirInfo = (dir) => {
  let files = 0, bytes = 0, writable = true;
  try { fs.readdirSync(dir).forEach((f) => { try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) { files++; bytes += st.size; } } catch (e) { /* skip */ } }); } catch (e) { /* missing */ }
  try { fs.accessSync(dir, fs.constants.W_OK); } catch (e) { writable = false; }
  return { files, bytes, writable };
};

app.get('/api/health', (req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true, uptime: Math.round(process.uptime()), time: new Date().toISOString() }); }
  catch (e) { res.status(503).json({ ok: false }); }
});

app.get('/api/staff/health', requireAuth, requireStaff, (req, res) => {
  const now = Date.now(), mem = process.memoryUsage();
  const n = (t) => { try { return db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; } catch (e) { return null; } };
  let integrity = 'unknown'; try { integrity = db.prepare('PRAGMA quick_check').get().quick_check; } catch (e) { integrity = 'error: ' + e.message; }
  let dbBytes = 0; try { dbBytes = fs.statSync(path.join(dataDir, 'app.db')).size; } catch (e) { /* none */ }
  let firstBoot = null; try { firstBoot = Number(fs.readFileSync(storageMarker, 'utf8')) || null; } catch (e) { /* none */ }
  const lat = reqStats.lat.slice().sort((a, b) => a - b);
  const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0;
  const uploads = dirInfo(uploadsDir), deliver = dirInfo(deliverablesDir);
  const adminRow = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  const errLastHour = recentErrors.filter((e) => now - e.t < HOUR).length;
  const uptimeMs = now - startedAt;
  const storageLikelyWiped = firstBoot && (now - firstBoot) < uptimeMs + 30000 && uptimeMs < 6 * HOUR;
  const secure = req.secure || String(req.get('x-forwarded-proto') || '') === 'https';

  const checks = [];
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail });
  add('db', 'Database integrity', integrity === 'ok' ? 'ok' : 'bad', integrity === 'ok' ? 'Quick check passed.' : 'Database reports: ' + integrity);
  add('admin', 'Admin account', adminRow ? 'ok' : 'bad', adminRow ? 'Present.' : 'No admin account exists. Set ADMIN_PASSWORD and restart.');
  add('secret', 'Session secret', SESSION_SECRET_FROM_ENV ? 'ok' : 'warn', SESSION_SECRET_FROM_ENV ? 'Set in environment, so logins survive restarts.' : 'SESSION_SECRET is not set. A generated one is used, but a new deploy may sign everyone out.');
  add('prod', 'Production mode', IS_PROD ? 'ok' : 'warn', IS_PROD ? 'NODE_ENV=production.' : 'NODE_ENV is not production (secure cookies are off).');
  add('https', 'HTTPS', secure ? 'ok' : (IS_PROD ? 'bad' : 'warn'), secure ? 'This request arrived over HTTPS.' : 'This request was not HTTPS.');
  add('firebase', 'Firebase sign-in', fbAdmin ? 'ok' : 'warn', fbAdmin ? 'Verified on the server.' : 'FIREBASE_PROJECT_ID is not set; the older email login is used.');
  add('pay', 'Payments', paynowReady || eipReady ? 'ok' : 'warn', eipReady ? (EIP_SANDBOX ? 'EcoCash PIN prompt is on (sandbox test mode).' : 'EcoCash PIN prompt is on.') : (paynowReady ? 'Paynow is configured.' : 'No online payment is configured; buyers pay by EcoCash and the admin confirms.'));
  add('storage', 'Storage persistence', storageLikelyWiped ? 'warn' : 'ok', storageLikelyWiped ? 'Storage was created at the last start. If you did not just set up the site, the disk is not persistent and data is lost on restart. Attach a persistent disk.' : 'Data folder is older than this start, so it survives restarts.');
  add('uploads', 'Uploads folder', uploads.writable && deliver.writable ? 'ok' : 'bad', uploads.writable && deliver.writable ? 'Writable.' : 'Cannot write to uploads or deliverables.');
  add('errors', 'Server errors (last hour)', errLastHour === 0 ? 'ok' : (errLastHour > 10 ? 'bad' : 'warn'), errLastHour === 0 ? 'No 5xx errors.' : `${errLastHour} error${errLastHour === 1 ? '' : 's'}. See the list below.`);
  add('memory', 'Memory', mem.rss > 450 * 1024 * 1024 ? 'warn' : 'ok', `${Math.round(mem.rss / 1048576)} MB in use.`);
  const status = checks.some((c) => c.status === 'bad') ? 'problem' : checks.some((c) => c.status === 'warn') ? 'attention' : 'healthy';

  res.json({
    success: true, status, checks, now,
    server: { startedAt, uptime: Math.round(uptimeMs / 1000), node: process.version, platform: `${process.platform} ${process.arch}`, env: process.env.NODE_ENV || 'development', rssMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576), baseUrl: BASE_URL, siteUrl: SITE_URL, cookieSameSite: COOKIE_SAMESITE },
    database: { bytes: dbBytes, integrity, counts: { users: n('users'), orders: n('orders'), designs: n('design_posts'), invoices: n('invoices'), brands: n('brands'), visits: n('hits') } },
    storage: { uploads, deliverables: deliver, firstCreated: firstBoot },
    requests: { total: reqStats.total, ok: reqStats.s2 + reqStats.s3, clientErrors: reqStats.s4, serverErrors: reqStats.s5, avgMs: Math.round(avg), p95Ms: Math.round(p95) },
    errors: recentErrors.slice(0, 20)
  });
});

/* ------------------------------------------------------------------ */
/* Pages and static files (only public file types are served)          */
/* ------------------------------------------------------------------ */
app.get('/dashboard.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});
app.get('/login.html', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard.html');
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/signup.html', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard.html');
  res.sendFile(path.join(__dirname, 'signup.html'));
});

const PUBLIC_EXT = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.gif']);
const PRIVATE_FILES = new Set(['server.js']); // server.js must never be downloadable
app.use((req, res, next) => {
  const requested = decodeURIComponent(req.path);
  const first = requested.split('/')[1] || '';
  if (requested === '/' || requested.startsWith('/api/')) return next();
  if (requested.split('/').some((seg) => seg.startsWith('.'))) return res.status(404).send('Not found');
  if (['data', 'deliverables', 'node_modules'].includes(first)) return res.status(404).send('Not found');
  if (PRIVATE_FILES.has(path.basename(requested))) return res.status(404).send('Not found');
  if (!PUBLIC_EXT.has(path.extname(requested).toLowerCase())) return res.status(404).send('Not found');
  next();
});
app.use(express.static(__dirname, { dotfiles: 'deny', index: false }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('*', (req, res) => res.redirect('/'));

app.use((err, req, res, next) => {
  pushError('exception', err && err.message ? err.message : err, { status: 500 });
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`CWS Multimedia Connect running at ${BASE_URL}`);
  console.log(`Admin sign-in email: ${adminEmail}`);
  console.log(paynowReady ? 'Paynow: enabled' : `Paynow: not configured (buyers pay by EcoCash to ${ECOCASH_NUMBER} and the admin confirms)`);
});
