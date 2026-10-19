/*
 * CWS Multimedia Connect - server
 * Owner: Chikomborero Walter Sumairi, Kadoma, Zimbabwe
 * EcoCash: 0774274544
 */
const express = require('express');
const session = require('express-session');
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
const ECOCASH_NUMBER = process.env.ECOCASH_NUMBER || '0774274544';
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
['payment_ref TEXT', 'paid_at TEXT'].forEach((def) => addColumnIfMissing('orders', def.split(' ')[0], def.split(' ').slice(1).join(' ')));
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
    price: p.price, image: p.image, format: p.format, delivery: p.delivery, meta: p.meta,
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

const adminEmail = String(process.env.ADMIN_EMAIL || 'chikomborerowaltersumairi26@gmail.com').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  console.warn('WARNING: ADMIN_PASSWORD is not set in .env, so no admin account will be created.');
} else if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    'Chikomborero Walter Sumairi', adminEmail, bcrypt.hashSync(adminPassword, 12), 'admin'
  );
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */
if (IS_PROD) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'cws_sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: IS_PROD, httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait 15 minutes and try again.' }
});

const paynowReady = Boolean(Paynow && process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY);
function newPaynow() {
  const p = new Paynow(process.env.PAYNOW_INTEGRATION_ID, process.env.PAYNOW_INTEGRATION_KEY);
  p.resultUrl = `${BASE_URL}/api/paynow/update`;
  p.returnUrl = `${BASE_URL}/thank-you.html`;
  return p;
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

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
app.get('/api/config', (req, res) => {
  res.json({ success: true, ecocash: ECOCASH_NUMBER, accountName: 'Chikomborero Walter Sumairi', paynow: paynowReady });
});

app.get('/api/session', (req, res) => {
  const user = req.session.user || null;
  res.json({ authenticated: !!user, user });
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
    image: clean(body.image || existing.image || 'church-service.jpg', 200),
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
    if (!manual && !paynowReady) {
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

app.listen(PORT, () => {
  console.log(`CWS Multimedia Connect running at ${BASE_URL}`);
  console.log(`Admin sign-in email: ${adminEmail}`);
  console.log(paynowReady ? 'Paynow: enabled' : `Paynow: not configured (buyers pay by EcoCash to ${ECOCASH_NUMBER} and the admin confirms)`);
});
