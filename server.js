const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA = path.join(DATA_DIR, 'orders.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_DIR = path.join(__dirname, 'admin');
const PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOW_DEMO_AUTH = process.env.ALLOW_DEMO_AUTH === 'true';

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const VALID_STATUSES = new Set(['new', 'contacted', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'no_answer', 'wrong_number', 'refused']);
const PRICE = 99;
const SKU = 'back-9054-ksa';

if (!ADMIN_USER || !ADMIN_PASS) {
  if (PRODUCTION || !ALLOW_DEMO_AUTH) {
    throw new Error('ADMIN_USER و ADMIN_PASS مطلوبان قبل تشغيل المتجر. عرّفهما كمتغيرات بيئة.');
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(DATA)) fs.writeFileSync(DATA, '[]', 'utf8');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '32kb' }));

// Simple in-memory rate limiter. For a multi-instance deployment, use a shared edge/database limiter.
const rateBuckets = new Map();
function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let b = rateBuckets.get(key);
    if (!b || now - b.start >= windowMs) b = { start: now, count: 0 };
    b.count += 1;
    rateBuckets.set(key, b);
    if (b.count > max) return res.status(429).json({ error: 'محاولات كثيرة. حاول مرة أخرى بعد قليل.' });
    next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of rateBuckets) if (v.start < cutoff) rateBuckets.delete(k);
}, 5 * 60 * 1000).unref();

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function checkAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : '';
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (ADMIN_USER && ADMIN_PASS && safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASS)) return next();
    } catch (_) {}
  }
  res.set('WWW-Authenticate', 'Basic realm="SuperBack Admin", charset="UTF-8"');
  return res.status(401).send('غير مصرح لك بالدخول');
}

function readOrders() {
  try {
    const raw = fs.readFileSync(DATA, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('تعذرت قراءة orders.json:', e.message);
    return [];
  }
}

let writeQueue = Promise.resolve();
function writeOrders(orders) {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${DATA}.tmp`;
    const json = JSON.stringify(orders, null, 2);
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, DATA);
    // Keep a rolling daily backup. This is a safety net for the JSON fallback only.
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(BACKUP_DIR, `orders-${day}.json`), json, 'utf8');
  });
  return writeQueue;
}

function normalizePhone(phone) {
  let p = String(phone || '').trim().replace(/[\s().-]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('05') && p.length === 10) p = '+966' + p.slice(1);
  if (p.startsWith('5') && p.length === 9) p = '+966' + p;
  return p;
}
function isValidSaudiPhone(phone) {
  const p = normalizePhone(phone);
  return /^\+9665\d{8}$/.test(p);
}
function cleanText(v, max = 500) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
function cleanOrder(body) {
  const quantity = Math.max(1, Math.min(5, Number.parseInt(body.quantity, 10) || 1));
  return {
    sku: SKU,
    name: cleanText(body.name, 100),
    phone: normalizePhone(body.phone),
    city: cleanText(body.city, 60),
    district: cleanText(body.district, 100),
    address: cleanText(body.address, 400),
    quantity,
    total: PRICE * quantity,
    country: 'SA',
    currency: 'SAR',
    payment: 'COD',
    source: cleanText(body.source, 40),
    campaign: cleanText(body.campaign, 120),
    content: cleanText(body.content, 120),
    medium: cleanText(body.medium, 80),
    term: cleanText(body.term, 120),
    landingPage: cleanText(body.landingPage, 300),
    customerNote: cleanText(body.customerNote, 300),
    honeypot: cleanText(body.website, 100),
  };
}
function makeOrderId() {
  return 'SB-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function jsonError(res, status, error) { return res.status(status).json({ ok: false, error }); }

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.post('/api/orders', rateLimit({ windowMs: 10 * 60 * 1000, max: 8, keyFn: req => `order:${req.ip}` }), async (req, res) => {
  const o = cleanOrder(req.body || {});
  if (o.honeypot) return jsonError(res, 400, 'تعذر تسجيل الطلب.');
  if (o.name.length < 2 || !o.city || o.district.length < 2 || o.address.length < 5) return jsonError(res, 400, 'أكمل بيانات الطلب من فضلك.');
  if (!isValidSaudiPhone(o.phone)) return jsonError(res, 400, 'أدخل رقم جوال سعودي صحيح مثل 05xxxxxxxx.');

  const orders = readOrders();
  const recentDuplicate = orders.find(x => x.phone === o.phone && x.status !== 'cancelled' && Date.now() - new Date(x.createdAt).getTime() < 30 * 60 * 1000);
  if (recentDuplicate) return res.status(409).json({ ok: false, error: 'يوجد طلب حديث بهذا الرقم. سنتواصل معك لتأكيده.', id: recentDuplicate.id });

  const order = {
    id: makeOrderId(),
    ...o,
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ipHash: crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 16),
  };
  delete order.honeypot;
  orders.push(order);
  await writeOrders(orders);
  return res.json({ ok: true, id: order.id });
});

app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));
app.get('/api/orders', checkAuth, rateLimit({ windowMs: 60 * 1000, max: 60, keyFn: req => `admin:${req.ip}` }), (req, res) => res.json(readOrders()));

app.patch('/api/orders/:id', checkAuth, async (req, res) => {
  const status = cleanText(req.body?.status, 30);
  if (!VALID_STATUSES.has(status)) return jsonError(res, 400, 'حالة الطلب غير صحيحة.');
  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx < 0) return jsonError(res, 404, 'الطلب غير موجود.');
  orders[idx].status = status;
  orders[idx].adminNote = cleanText(req.body?.adminNote, 500);
  orders[idx].updatedAt = new Date().toISOString();
  if (status === 'confirmed' && !orders[idx].confirmedAt) orders[idx].confirmedAt = orders[idx].updatedAt;
  if (status === 'shipped' && !orders[idx].shippedAt) orders[idx].shippedAt = orders[idx].updatedAt;
  if (status === 'delivered' && !orders[idx].deliveredAt) orders[idx].deliveredAt = orders[idx].updatedAt;
  if (status === 'cancelled' && !orders[idx].cancelledAt) orders[idx].cancelledAt = orders[idx].updatedAt;
  await writeOrders(orders);
  res.json({ ok: true, order: orders[idx] });
});

app.delete('/api/orders/:id', checkAuth, async (req, res) => {
  const orders = readOrders();
  const filtered = orders.filter(o => o.id !== req.params.id);
  if (filtered.length === orders.length) return jsonError(res, 404, 'الطلب غير موجود.');
  await writeOrders(filtered);
  res.json({ ok: true });
});

function exportHeaders() {
  return ['id','createdAt','updatedAt','status','name','phone','city','district','address','quantity','total','currency','payment','sku','source','medium','campaign','content','term','landingPage','customerNote','adminNote','confirmedAt','shippedAt','deliveredAt','cancelledAt'];
}
function toRows(orders) {
  const headers = exportHeaders();
  return orders.map(o => Object.fromEntries(headers.map(h => [h, o[h] ?? ''])));
}
function toCSV(orders) {
  const headers = exportHeaders();
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '\uFEFF' + [headers.join(','), ...orders.map(o => headers.map(h => escape(o[h])).join(','))].join('\r\n');
}
app.get('/api/orders/export.csv', checkAuth, (req, res) => {
  res.type('text/csv').set('Content-Disposition', `attachment; filename="superback-orders-${Date.now()}.csv"`).send(toCSV(readOrders()));
});
app.get('/api/orders/export.xlsx', checkAuth, (req, res) => {
  const headers = exportHeaders();
  const ws = XLSX.utils.json_to_sheet(toRows(readOrders()), { header: headers });
  ws['!cols'] = headers.map(h => ({ wch: Math.min(32, Math.max(12, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="superback-orders-${Date.now()}.xlsx"`);
  res.send(buf);
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'superback', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`SuperBack store running on port ${PORT}`));
