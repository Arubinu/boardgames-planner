// server/index.js
// Serveur unique : sert le site statique + l'API REST (events, locations, games, import).
import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import path from 'path';
import db from './db.js';
import { parseMyludo, detailsUrlFromId } from './myludo.js';
import { hashPassword, verifyPassword } from './password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();

// --- Sécurité : en-têtes HTTP (helmet) ------------------------------------
// CSP adaptée : on autorise les tuiles OpenStreetMap (cartes Leaflet) et les
// polices Google. Leaflet est empaqueté par Vite, donc pas de CDN à autoriser.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:', 'https://*.tile.openstreetmap.org'],
      frameSrc: ["'self'", 'https://www.openstreetmap.org'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null, // ← ne pas forcer le HTTPS sur les sous-ressources
    },
  },
  hsts: false, // ← ne pas envoyer Strict-Transport-Security en HTTP
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '5mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// --- Helpers réglages -----------------------------------------------------
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);
function setting(key) { return getSetting.get(key)?.value ?? ''; }

// --- Limitation des tentatives de connexion échouées ----------------------
// LOGIN_RETRY_DELAY : délai minimal (en secondes) avant de pouvoir réessayer
// APRÈS une tentative échouée, par adresse IP. 0 (défaut) = désactivé.
const LOGIN_RETRY_DELAY = Math.max(
  0,
  parseInt(process.env.LOGIN_RETRY_DELAY || '10', 10) || 0
);
const lastFailedLogin = new Map(); // ip -> timestamp (ms) du dernier échec

// Secondes restantes à patienter (0 = tentative autorisée).
function loginCooldownRemaining(ip) {
  if (!LOGIN_RETRY_DELAY) return 0;
  const last = lastFailedLogin.get(ip);
  if (!last) return 0;
  const remaining = LOGIN_RETRY_DELAY - (Date.now() - last) / 1000;
  if (remaining <= 0) {
    lastFailedLogin.delete(ip); // purge l'entrée expirée
    return 0;
  }
  return Math.ceil(remaining);
}

// Mémorise le résultat : un succès efface le verrou, un échec (re)démarre le délai.
function recordLoginResult(ip, success) {
  if (!LOGIN_RETRY_DELAY) return;
  if (success) lastFailedLogin.delete(ip);
  else lastFailedLogin.set(ip, Date.now());
}

// Refuse la requête si l'IP est en période d'attente. Renvoie true si bloquée.
function blockedByCooldown(req, res) {
  const wait = loginCooldownRemaining(req.ip);
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard', retryAfter: wait });
    return true;
  }
  return false;
}

// --- Authentification admin (par en-tête, mot de passe haché Argon2id) ----
// Le front envoie le mot de passe dans l'en-tête "x-admin-password".
// La valeur stockée en base est un hash Argon2id : on vérifie via argon2.verify.
async function requireAdmin(req, res, next) {
  if (blockedByCooldown(req, res)) return;
  const provided = req.get('x-admin-password') || req.query.pwd || '';
  const ok = !!provided && (await verifyPassword(setting('admin_password'), provided));
  recordLoginResult(req.ip, ok);
  if (ok) return next();
  return res.status(401).json({ error: 'Non autorisé' });
}

// Vérifie un mot de passe admin fourni (helper réutilisable).
function checkAdmin(provided) {
  return verifyPassword(setting('admin_password'), provided || '');
}

// =====================  API PUBLIQUE  =====================================

// Réglages publics utiles au front (liens WhatsApp, profil MyLudo).
app.get('/api/public-settings', (req, res) => {
  res.json({
    whatsapp_main: setting('whatsapp_main'),
    whatsapp_mjc: setting('whatsapp_mjc'),
    myludo_profile: setting('myludo_profile'),
  });
});

// Liste des lieux. Par défaut : seulement les lieux actifs (non archivés).
// Avec ?include_archived=1 (réservé à l'admin) : tous les lieux.
app.get('/api/locations', async (req, res) => {
  const includeArchived = req.query.include_archived === '1' &&
    await checkAdmin(req.get('x-admin-password') || '');
  const sql = includeArchived
    ? 'SELECT * FROM locations ORDER BY archived, name'
    : 'SELECT * FROM locations WHERE archived = 0 ORDER BY name';
  res.json(db.prepare(sql).all());
});

// Types de soirées (publics) : utilisés par l'accueil et l'administration.
app.get('/api/event-types', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM event_types ORDER BY sort_order, id').all()
  );
});

// Sonde de santé (pour Docker / Dockge / supervision).
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Liste des jeux (avec recherche/tri optionnels).
app.get('/api/games', (req, res) => {
  const { q, type, sort } = req.query;
  let sql = 'SELECT * FROM games';
  const where = [];
  const params = [];
  if (q) {
    where.push('(title LIKE ? OR categories LIKE ? OR themes LIKE ? OR mechanisms LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (type && type !== 'all') { where.push('type = ?'); params.push(type); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += sort === 'rating' ? ' ORDER BY rating DESC, title' : ' ORDER BY title COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/games/count', (req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) AS c FROM games').get().c });
});

// Liste des événements (à venir + passés), avec lieu joint et nb de jeux.
app.get('/api/events', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, l.name AS location_name, l.address AS location_address, l.coords AS location_coords,
           (SELECT COUNT(*) FROM event_games eg WHERE eg.event_id = e.id) AS games_count
    FROM events e
    LEFT JOIN locations l ON l.id = e.location_id
    ORDER BY e.date ASC, e.start_time ASC
  `).all();
  res.json(rows);
});

// Détail d'un événement + jeux associés.
app.get('/api/events/:id', (req, res) => {
  const event = db.prepare(`
    SELECT e.*, l.name AS location_name, l.address AS location_address, l.coords AS location_coords
    FROM events e LEFT JOIN locations l ON l.id = e.location_id WHERE e.id = ?
  `).get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  event.games = db.prepare(`
    SELECT g.* FROM games g
    JOIN event_games eg ON eg.game_id = g.id
    WHERE eg.event_id = ? ORDER BY g.title COLLATE NOCASE
  `).all(event.id);
  res.json(event);
});

// =====================  API ADMIN  ========================================

// Vérification du mot de passe (pour le formulaire de connexion admin).
app.post('/api/admin/login', async (req, res) => {
  if (blockedByCooldown(req, res)) return;
  const { password } = req.body || {};
  const ok = !!password && (await verifyPassword(setting('admin_password'), password));
  recordLoginResult(req.ip, ok);
  if (ok) return res.json({ ok: true });
  return res.status(401).json({ error: 'Mot de passe incorrect' });
});

// --- Lieux ---
app.post('/api/admin/locations', requireAdmin, (req, res) => {
  const { name, address = '', coords = '', description = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  try {
    const info = db.prepare(
      'INSERT INTO locations (name, address, coords, description) VALUES (?,?,?,?)'
    ).run(name.trim(), address, coords, description);
    res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'Ce lieu existe déjà ou est invalide.' });
  }
});

app.put('/api/admin/locations/:id', requireAdmin, (req, res) => {
  const { name, address = '', coords = '', description = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  db.prepare('UPDATE locations SET name=?, address=?, coords=?, description=? WHERE id=?')
    .run(name.trim(), address, coords, description, req.params.id);
  res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id));
});

// "Supprimer" un lieu = l'archiver (réversible). Les soirées liées sont conservées.
app.delete('/api/admin/locations/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE locations SET archived = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Désarchiver un lieu.
app.post('/api/admin/locations/:id/unarchive', requireAdmin, (req, res) => {
  db.prepare('UPDATE locations SET archived = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Types de soirées -----------------------------------------------------
// Génère une clé stable (slug) à partir du libellé, en garantissant l'unicité.
// La clé est ce qui est stocké dans events.type ; elle ne change pas lors d'une
// édition du libellé, pour ne pas « casser » les soirées existantes.
function makeTypeKey(label) {
  const base =
    String(label || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'type';
  let key = base;
  let n = 2;
  const exists = db.prepare('SELECT 1 FROM event_types WHERE key = ?');
  while (exists.get(key)) key = `${base}-${n++}`;
  return key;
}

app.post('/api/admin/event-types', requireAdmin, (req, res) => {
  const { label, sub = '', color = '#8b9a6b', signup = 0 } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'Libellé requis' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM event_types').get().m;
  const info = db.prepare(
    `INSERT INTO event_types (key, label, sub, color, signup, sort_order)
     VALUES (?,?,?,?,?,?)`
  ).run(makeTypeKey(label), label.trim(), sub, color, signup ? 1 : 0, max + 1);
  res.json(db.prepare('SELECT * FROM event_types WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/admin/event-types/:id', requireAdmin, (req, res) => {
  const { label, sub = '', color = '#8b9a6b', signup = 0 } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'Libellé requis' });
  // On ne modifie pas la clé (référencée par les soirées existantes).
  db.prepare('UPDATE event_types SET label=?, sub=?, color=?, signup=? WHERE id=?')
    .run(label.trim(), sub, color, signup ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM event_types WHERE id = ?').get(req.params.id));
});

// Suppression refusée si des soirées utilisent encore ce type (sécurité).
app.delete('/api/admin/event-types/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT key FROM event_types WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Type introuvable' });
  const used = db.prepare('SELECT COUNT(*) AS c FROM events WHERE type = ?').get(row.key).c;
  if (used > 0) {
    return res.status(409).json({
      error: `Ce type est utilisé par ${used} soirée(s). Réaffectez-les avant de le supprimer.`,
    });
  }
  db.prepare('DELETE FROM event_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Événements ---
app.post('/api/admin/events', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.date) return res.status(400).json({ error: 'Titre et date requis' });
  const info = db.prepare(`
    INSERT INTO events (title, date, start_time, end_time, type, location_id, description, whatsapp_url)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    b.title.trim(), b.date, b.start_time || '', b.end_time || '',
    b.type || 'petite', b.location_id || null, b.description || '', b.whatsapp_url || ''
  );
  const id = info.lastInsertRowid;
  if (Array.isArray(b.game_ids)) setEventGames(id, b.game_ids);
  res.json({ id });
});

app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.date) return res.status(400).json({ error: 'Titre et date requis' });
  db.prepare(`
    UPDATE events SET title=?, date=?, start_time=?, end_time=?, type=?, location_id=?, description=?, whatsapp_url=?
    WHERE id=?
  `).run(
    b.title.trim(), b.date, b.start_time || '', b.end_time || '',
    b.type || 'petite', b.location_id || null, b.description || '', b.whatsapp_url || '',
    req.params.id
  );
  if (Array.isArray(b.game_ids)) setEventGames(req.params.id, b.game_ids);
  res.json({ ok: true });
});

app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Remplace l'ensemble des jeux associés à un événement (transaction).
const setEventGames = db.transaction((eventId, gameIds) => {
  db.prepare('DELETE FROM event_games WHERE event_id = ?').run(eventId);
  const ins = db.prepare('INSERT OR IGNORE INTO event_games (event_id, game_id) VALUES (?,?)');
  for (const gid of gameIds) ins.run(eventId, gid);
});

// --- Jeux : édition manuelle (image / propriétaire) ---
app.put('/api/admin/games/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Jeu introuvable' });
  db.prepare('UPDATE games SET image_url=?, owner=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(b.image_url ?? existing.image_url, b.owner ?? existing.owner, req.params.id);
  res.json(db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id));
});

app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Import MyLudo (CSV ou JSON) ---
// Conserve les images/propriétaires déjà saisis manuellement (merge sur l'ID).
const importGames = db.transaction((games, mode) => {
  // On mémorise les métadonnées existantes (image, propriétaire, date de
  // création) AVANT toute suppression, pour les préserver entre deux imports.
  const previous = new Map();
  for (const row of db.prepare('SELECT id, image_url, owner, created_at FROM games').all()) {
    previous.set(row.id, row);
  }
  if (mode === 'replace') db.prepare('DELETE FROM games').run();
  const upsert = db.prepare(`
    INSERT INTO games
      (id, title, subtitle, type, players, duration, age, categories, themes,
       mechanisms, authors, publishers, rating, details_url, owner, image_url, created_at, updated_at)
    VALUES
      (@id, @title, @subtitle, @type, @players, @duration, @age, @categories, @themes,
       @mechanisms, @authors, @publishers, @rating, @details_url, @owner, @image_url, @created_at, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, subtitle=excluded.subtitle, type=excluded.type,
      players=excluded.players, duration=excluded.duration, age=excluded.age,
      categories=excluded.categories, themes=excluded.themes, mechanisms=excluded.mechanisms,
      authors=excluded.authors, publishers=excluded.publishers, rating=excluded.rating,
      details_url=excluded.details_url, updated_at=datetime('now')
      -- on NE remplace PAS image_url, owner ni created_at (préservés)
  `);
  let inserted = 0;
  for (const g of games) {
    const old = previous.get(g.id);
    upsert.run({
      ...g,
      image_url: old?.image_url || '',
      owner: g.owner || old?.owner || '',
      created_at: old?.created_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    inserted++;
  }
  return inserted;
});

app.post('/api/admin/import', requireAdmin, upload.single('file'), (req, res) => {
  try {
    let content = '';
    let filename = '';
    if (req.file) {
      content = req.file.buffer.toString('utf8');
      filename = req.file.originalname || '';
    } else if (req.body && req.body.content) {
      content = req.body.content;
      filename = req.body.filename || '';
    } else {
      return res.status(400).json({ error: 'Aucun fichier fourni.' });
    }
    const mode = (req.query.mode || req.body?.mode || 'replace');
    const games = parseMyludo(content, filename);
    if (!games.length) return res.status(400).json({ error: 'Aucun jeu valide trouvé dans le fichier.' });
    const n = importGames(games, mode);
    res.json({ ok: true, imported: n, mode });
  } catch (e) {
    res.status(400).json({ error: 'Fichier illisible : ' + e.message });
  }
});

// --- Réglages admin ---
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) if (r.key !== 'admin_password') obj[r.key] = r.value;
  res.json(obj);
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const allowed = ['whatsapp_main', 'whatsapp_mjc', 'myludo_profile', 'admin_password'];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k) || v === undefined || v === '') continue;
    if (k === 'admin_password') {
      // Ne jamais stocker le mot de passe en clair : on le hache (Argon2id).
      setSetting.run(k, await hashPassword(String(v)));
    } else {
      setSetting.run(k, String(v));
    }
  }
  res.json({ ok: true });
});

// =====================  STATIQUE  =========================================
app.use(express.static(PUBLIC_DIR));

// Démarrage.
app.listen(PORT, () => {
  console.log(`Soirées Jeux — serveur démarré sur http://localhost:${PORT}`);
  console.log(`Base de données : ${path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'boardgames-planner.db')}`);
});
