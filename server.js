'use strict';

/**
 * PU WebGIS - Production-ready API
 * -------------------------------------------------------------------------
 * Security model:
 *   - All secrets come from environment variables (nothing hardcoded).
 *   - Session JWT lives in an httpOnly + SameSite=Strict cookie (XSS-proof).
 *   - Double-submit CSRF token guards every state-changing request.
 *   - Helmet supplies CSP / HSTS / anti-clickjacking headers.
 *   - Rate limiting protects the login + register endpoints.
 *   - Production error messages are generic (no DB internals leaked).
 */

require('dotenv').config({ quiet: true });

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Configuration (everything comes from env)
// ---------------------------------------------------------------------------
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? '' : 'dev-insecure-secret-change-me');
const JWT_TTL = process.env.JWT_TTL || '7d';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
const JOIN_CODE = process.env.JOIN_CODE || '';
const MIN_PASSWORD_LENGTH = Number(process.env.MIN_PASSWORD_LENGTH) || 8;
const SESSION_MAX_AGE = (Number(process.env.SESSION_DAYS) || 7) * 24 * 60 * 60 * 1000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const SESSION_COOKIE = 'pu_sid';
const CSRF_COOKIE = 'pu_csrf';
const CSRF_HEADER = 'x-csrf-token';

if (IS_PROD && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  console.error('FATAL: JWT_SECRET must be set and >= 32 characters in production. Exiting.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Database - cloud (DATABASE_URL + SSL) or local fallback
// ---------------------------------------------------------------------------
function buildDbConfig() {
  const wantSsl = process.env.DB_SSL
    ? !/^(false|0|no|off)$/i.test(process.env.DB_SSL.trim())
    : Boolean(process.env.DATABASE_URL);

  const base = {
    ssl: wantSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: Number(process.env.DB_IDLE_MS) || 30000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000,
    application_name: 'pu-webgis'
  };

  if (process.env.DATABASE_URL) {
    return Object.assign(base, { connectionString: process.env.DATABASE_URL });
  }
  return Object.assign(base, {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'Project 1',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || ''
  });
}

const pool = new Pool(buildDbConfig());
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

// ---------------------------------------------------------------------------
// App + security middleware
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
// Render is behind a proxy: trust exactly one hop so req.ip and req.secure are real.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:',
        'https://*.tile.openstreetmap.org',
        'https://server.arcgisonline.com',
        'https://*.arcgisonline.com'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      mediaSrc: ["'self'"],
      upgradeInsecureRequests: IS_PROD ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: IS_PROD
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Permissions-Policy: geolocation sirf isi origin ke liye.
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  next();
});

// Production: HTTP -> HTTPS. Geolocation API sirf secure context mein chalta hai.
if (IS_PROD) {
  app.use((req, res, next) => {
    if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
    if (req.path === '/api/health') return next();
    return res.redirect(301, 'https://' + req.get('host') + req.originalUrl);
  });
}

app.use(compression({ threshold: 1024 }));

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);            // same-origin / curl / native app
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);                          // blocked - no CORS headers sent
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', CSRF_HEADER],
  maxAge: 600
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_API_MAX) || 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Bohat zyada requests. Thori der baad try karein.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,      // sirf failed logins count hote hain
  message: { error: 'Bohat zyada koshishen. 15 minute baad try karein.' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_REGISTER_MAX) || 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Bohat zyada registration requests. 1 ghanta baad try karein.' }
});

// ---------------------------------------------------------------------------
// Session + CSRF helpers
// ---------------------------------------------------------------------------
const cookieOpts = {
  secure: IS_PROD,            // local dev http par hai to false, cloud par true
  sameSite: 'strict',         // cross-site request cookie ke saath nahi jayega
  path: '/'
};

function issueCsrfToken(res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, Object.assign({}, cookieOpts, {
    httpOnly: false,          // JS ko padhna hai (double-submit pattern)
    maxAge: SESSION_MAX_AGE
  }));
  return token;
}

function setSession(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_TTL });
  res.cookie(SESSION_COOKIE, token, Object.assign({}, cookieOpts, {
    httpOnly: true,           // XSS se token chhu nahi sakta
    maxAge: SESSION_MAX_AGE
  }));
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, cookieOpts);
  res.clearCookie(CSRF_COOKIE, cookieOpts);
}

// Double-submit CSRF: cookie aur header ka value match hona chahiye.
function csrfProtect(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const cookieVal = req.cookies[CSRF_COOKIE];
  const headerVal = req.get(CSRF_HEADER);
  if (!cookieVal || !headerVal) {
    return res.status(403).json({ error: 'CSRF token missing. Page refresh karein.' });
  }
  const a = Buffer.from(String(cookieVal));
  const b = Buffer.from(String(headerVal));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF check fail. Page refresh karein.' });
  }
  next();
}

// Login zaroori wale routes
async function auth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Pehle login karein' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const r = await pool.query(
      'SELECT id, username, role FROM public.users WHERE id = $1',
      [p.id]
    );
    if (!r.rows.length) {
      clearSession(res);
      return res.status(401).json({ error: 'User nahi mila' });
    }
    req.user = r.rows[0];
    next();
  } catch (e) {
    clearSession(res);
    res.status(401).json({ error: 'Session khatam, dobara login karein' });
  }
}

// Production mein DB ka asli error client ko nahi bhejte.
function fail(res, err, status) {
  console.error('[error]', err && err.stack ? err.stack : err);
  if (IS_PROD) return res.status(status || 500).json({ error: 'Server error. Baad mein try karein.' });
  return res.status(status || 500).json({ error: (err && err.message) || 'Server error' });
}

// ---------------------------------------------------------------------------
// Static files (PWA shell) + health check
// ---------------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  maxAge: IS_PROD ? '7d' : 0,
  etag: true,
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    if (name === 'sw.js') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (name.endsWith('.html') || name.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Render / load balancer isko use karta hai - auth ke baghair
app.get('/api/health', async (req, res) => {
  let db = 'down';
  try { await pool.query('SELECT 1'); db = 'up'; } catch (e) { /* noop */ }
  res.status(db === 'up' ? 200 : 503).json({
    status: db === 'up' ? 'ok' : 'degraded',
    db,
    uptime: Math.round(process.uptime()),
    version: pkg.version,
    env: NODE_ENV,
    time: new Date().toISOString()
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
const LAYERS = {
  places: 'public.places',
  lines: 'public.lines',
  polygons: 'public.polygons'
};

// Valid bcrypt hash (compare chalta hai taaki user enumeration na ho sake)
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

app.get('/api/csrf', (req, res) => {
  res.json({ csrfToken: issueCsrfToken(res) });
});

// ---------- Naya account ----------
app.post('/api/register', registerLimiter, csrfProtect, async (req, res) => {
  const { username, password, joinCode } = req.body || {};
  if (JOIN_CODE && joinCode !== JOIN_CODE) {
    return res.status(403).json({ error: 'Join code galat hai' });
  }
  if (!username || !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username 3 se 30 harf/number/_ ka hona chahiye' });
  }
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: 'Password kam az kam ' + MIN_PASSWORD_LENGTH + ' characters ka ho'
    });
  }
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const r = await pool.query(
      'INSERT INTO public.users (username, password_hash) VALUES ($1, $2) RETURNING id, username, role',
      [String(username).toLowerCase(), hash]
    );
    const user = r.rows[0];
    setSession(res, user);
    issueCsrfToken(res);            // naya CSRF token (session fixation se bachao)
    res.json({ username: user.username, role: user.role });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ye username pehle se majood hai' });
    }
    fail(res, err, 500);
  }
});

// ---------- Login ----------
app.post('/api/login', loginLimiter, csrfProtect, async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const r = await pool.query(
      'SELECT id, username, role, password_hash FROM public.users WHERE username = $1',
      [String(username || '').toLowerCase()]
    );
    const user = r.rows[0];
    // User na ho to bhi bcrypt chalao - timing same rahe, user pata na chale
    const hash = user ? user.password_hash : DUMMY_HASH;
    const ok = await bcrypt.compare(String(password || ''), hash);
    if (!user || !ok) {
      return res.status(401).json({ error: 'Username ya password galat hai' });
    }
    setSession(res, user);
    issueCsrfToken(res);
    res.json({ username: user.username, role: user.role });
  } catch (err) {
    fail(res, err, 500);
  }
});

// ---------- Logout ----------
app.post('/api/logout', csrfProtect, (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// ---------- Current user ----------
app.get('/api/me', apiLimiter, auth, (req, res) => res.json(req.user));

// ---------- Layer ka data dena ----------
app.get('/api/features/:layer', apiLimiter, auth, async (req, res) => {
  const table = LAYERS[req.params.layer];
  if (!table) return res.status(404).json({ error: 'Galat layer' });
  try {
    const result = await pool.query(`
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', COALESCE(json_agg(json_build_object(
          'type','Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', json_build_object(
            'id', id, 'name', name, 'category', category,
            'description', description, 'created_at', created_at)
        )), '[]'::json)
      ) AS geojson FROM ${table}
    `);
    res.json(result.rows[0].geojson);
  } catch (err) {
    fail(res, err, 500);
  }
});

// ---------- Naya feature save karna ----------
app.post('/api/features/:layer', apiLimiter, auth, csrfProtect, async (req, res) => {
  const table = LAYERS[req.params.layer];
  if (!table) return res.status(404).json({ error: 'Galat layer' });
  const { name, category, description, geometry } = req.body || {};
  if (!geometry) return res.status(400).json({ error: 'geometry chahiye' });
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Naam likhna zaroori hai' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO ${table} (name, category, description, geom, created_by)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5)
       RETURNING id`,
      [String(name).trim(), category || 'Other', description || '',
        JSON.stringify(geometry), req.user.id]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    fail(res, err, 500);
  }
});

// ---------- Edit: sirf apna banaya hua ya admin ----------
app.put('/api/features/:layer/:id', apiLimiter, auth, csrfProtect, async (req, res) => {
  const table = LAYERS[req.params.layer];
  if (!table) return res.status(404).json({ error: 'Galat layer' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Galat id' });
  const { name, category, description } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Naam likhna zaroori hai' });
  }
  try {
    const r = await pool.query(
      `UPDATE ${table} SET name = $1, category = $2, description = $3
       WHERE id = $4 AND ($5 OR created_by = $6)`,
      [String(name).trim(), category || 'Other', description || '',
        id, req.user.role === 'admin', req.user.id]
    );
    if (r.rowCount === 0) {
      return res.status(403).json({ error: 'Aap sirf apna banaya hua feature badal sakte hain' });
    }
    res.json({ updated: true });
  } catch (err) {
    fail(res, err, 500);
  }
});

// ---------- Delete: sirf apna banaya hua ya admin ----------
app.delete('/api/features/:layer/:id', apiLimiter, auth, csrfProtect, async (req, res) => {
  const table = LAYERS[req.params.layer];
  if (!table) return res.status(404).json({ error: 'Galat layer' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Galat id' });
  try {
    const r = await pool.query(
      `DELETE FROM ${table} WHERE id = $1 AND ($2 OR created_by = $3)`,
      [id, req.user.role === 'admin', req.user.id]
    );
    if (r.rowCount === 0) {
      return res.status(403).json({ error: 'Aap sirf apna banaya hua feature delete kar sakte hain' });
    }
    res.json({ deleted: true });
  } catch (err) {
    fail(res, err, 500);
  }
});

// ---------- Geofence ----------
app.get('/api/boundary', apiLimiter, auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', COALESCE(json_agg(json_build_object(
          'type','Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', json_build_object('id',id,'name',name)
        )), '[]'::json)
      ) AS geojson FROM public.campus_boundary
    `);
    res.json(result.rows[0].geojson);
  } catch (err) {
    fail(res, err, 500);
  }
});

app.get('/api/check', apiLimiter, auth, async (req, res) => {
  const lon = Number(req.query.lon);
  const lat = Number(req.query.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) ||
      lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'lon aur lat chahiye' });
  }
  try {
    const result = await pool.query(
      `SELECT EXISTS(
         SELECT 1 FROM public.campus_boundary
         WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       ) AS inside`,
      [lon, lat]
    );
    res.json({ inside: result.rows[0].inside === true });
  } catch (err) {
    fail(res, err, 500);
  }
});

// ---------- draw.html ke liye ----------
app.get('/api/places', apiLimiter, auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', COALESCE(json_agg(json_build_object(
          'type','Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', json_build_object('id',id,'name',name,'category',category)
        )), '[]'::json)
      ) AS geojson FROM public.places
    `);
    res.json(result.rows[0].geojson);
  } catch (err) {
    fail(res, err, 500);
  }
});

// ---------------------------------------------------------------------------
// 404 + error handler
// ---------------------------------------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route nahi mila' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON theek nahi hai' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Data bohat bada hai' });
  }
  console.error('[unhandled]', err && err.stack ? err.stack : err);
  res.status(500).json({
    error: IS_PROD ? 'Server error. Baad mein try karein.' : (err && err.message) || 'Server error'
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, HOST, () => {
  console.log('[server] PU WebGIS chal raha hai -> http://' + HOST + ':' + PORT);
  console.log('[server] env=' + NODE_ENV + ' db=' + (process.env.DATABASE_URL ? 'DATABASE_URL' : 'local'));
  if (!IS_PROD) {
    console.log('[server] dev mode: https chahiye to ngrok ya localtunnel use karein (geolocation ke liye)');
  }
});

// Graceful shutdown - Render deploy/restart par connections cleanly band hon
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[server] ' + signal + ' mila, band ho raha hai...');
  server.close(() => {
    pool.end().catch(() => {}).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection:', reason);
});

