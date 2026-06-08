// server/index.js
// Serveur unique : sert le site statique + l'API REST (events, locations, games, import).
import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'node:fs';
import db from './db.js';
import { parseMyludo, detailsUrlFromId } from './myludo.js';
import { hashPassword, verifyPassword } from './password.js';
import { zipSync } from './zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

// Stockage persistant des téléversements (volume « data »), à l'écart de
// `public/` qui est reconstruit à chaque build du front.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MEMBERSHIP_DIR = path.join(DATA_DIR, 'uploads', 'membership');
fs.mkdirSync(MEMBERSHIP_DIR, { recursive: true });

// Formats acceptés pour le(s) document(s) d'adhésion (extension → type MIME).
const MEMBERSHIP_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const app = express();

// Derrière un reverse proxy (HTTPS terminé par le proxy → conteneur en HTTP),
// on fait confiance aux en-têtes X-Forwarded-* pour que req.protocol/req.ip
// reflètent la requête d'origine (URL absolues OpenGraph en https, throttle de
// connexion par IP réelle). En local sans proxy, ces en-têtes sont absents.
// TRUST_PROXY : nombre de proxies (défaut 1), 'true'/'false', ou une valeur
// Express (ex. 'loopback', '10.0.0.0/8').
function parseTrustProxy(v) {
  if (v === undefined) return 1;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

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
// Import de base : le fichier JSON peut être volumineux (documents en base64).
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });

// --- Helpers réglages -----------------------------------------------------
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);
function setting(key) { return getSetting.get(key)?.value ?? ''; }

// Nom complet = « Nom — Détenteur » (recombinaison des deux réglages).
function siteFullName() {
  const n = setting('site_name');
  const h = setting('site_holder');
  return h ? (n ? `${n} — ${h}` : h) : n;
}

// --- Limitation des tentatives de connexion échouées ----------------------
// LOGIN_RETRY_DELAY : délai minimal (en secondes) avant de pouvoir réessayer
// APRÈS une tentative échouée, par adresse IP. 0 (défaut) = désactivé.
const LOGIN_RETRY_DELAY = Math.max(
  0,
  parseInt(process.env.LOGIN_RETRY_DELAY || '0', 10) || 0
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

// Réglages publics utiles au front (profil MyLudo, identité, textes…).
app.get('/api/public-settings', (req, res) => {
  res.json({
    myludo_profile: setting('myludo_profile'),
    default_lang: setting('default_lang'),
    site_name: setting('site_name'),
    site_holder: setting('site_holder'),
    site_title: setting('site_title'),
    footer_text: setting('footer_text'),
    footer_year: setting('footer_year'),
    infos_title: setting('infos_title'),
    infos_sub: setting('infos_sub'),
    calendar_enabled: setting('calendar_enabled') !== '0',
    ics_filename: icsFilename(),
    join_title: setting('join_title'),
    join_text: setting('join_text'),
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

// --- Flux iCalendar (.ics) ------------------------------------------------
// Permet d'ajouter les soirées à un agenda (Google/Apple/Outlook), en
// téléchargement ponctuel ou en abonnement (URL en webcal://).

// Nom de fichier proposé au téléchargement du .ics (réglage admin).
// On normalise pour éviter tout caractère problématique dans l'en-tête
// Content-Disposition et on garantit l'extension « .ics ».
function icsFilename() {
  let name = setting('ics_filename') || 'soirees-jeux.ics';
  name = name.replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/^\.+/, '').trim();
  if (!name) name = 'soirees-jeux.ics';
  if (!/\.ics$/i.test(name)) name += '.ics';
  return name;
}
function icsStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsNextDay(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
// Pliage des lignes à 75 caractères (RFC 5545) : continuation par CRLF + espace.
function icsFold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let i = 75;
  while (i < line.length) {
    out += '\r\n ' + line.slice(i, i + 74);
    i += 74;
  }
  return out;
}

app.get('/events.ics', (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.*, l.name AS location_name, l.address AS location_address,
              t.label AS type_label
       FROM events e
       LEFT JOIN locations l ON l.id = e.location_id
       LEFT JOIN event_types t ON t.key = e.type
       ORDER BY e.date`
    )
    .all();

  const stamp = icsStamp(new Date());
  const calName = siteFullName() || 'Boardgames Planner';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    icsFold(`PRODID:-//${icsEscape(calName)}//Boardgames Planner//FR`),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    icsFold(`X-WR-CALNAME:${icsEscape(calName)}`),
  ];
  for (const e of rows) {
    const ymd = e.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:event-${e.id}@boardgames-planner`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.start_time) {
      // Heure « flottante » (interprétée comme heure locale par l'agenda).
      lines.push(`DTSTART:${ymd}T${e.start_time.replace(':', '')}00`);
      if (e.end_time) lines.push(`DTEND:${ymd}T${e.end_time.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      lines.push(`DTEND;VALUE=DATE:${icsNextDay(e.date)}`);
    }
    const summary = e.type_label ? `${e.title} (${e.type_label})` : e.title;
    lines.push(icsFold(`SUMMARY:${icsEscape(summary)}`));
    const loc = [e.location_name, e.location_address].filter(Boolean).join(', ');
    if (loc) lines.push(icsFold(`LOCATION:${icsEscape(loc)}`));
    if (e.description) lines.push(icsFold(`DESCRIPTION:${icsEscape(e.description)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `inline; filename="${icsFilename()}"`);
  res.send(lines.join('\r\n') + '\r\n');
});

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

// --- Blocs « Infos pratiques » (public) -----------------------------------
app.get('/api/info-blocks', (req, res) => {
  res.json(db.prepare('SELECT * FROM info_blocks ORDER BY sort_order, id').all());
});

// --- Questions fréquentes (public) ----------------------------------------
app.get('/api/faq', (req, res) => {
  res.json(db.prepare('SELECT * FROM faq ORDER BY sort_order, id').all());
});

// --- Document(s) d'adhésion -----------------------------------------------
function membershipFiles() {
  return db.prepare('SELECT * FROM membership_files ORDER BY sort_order, id').all();
}
// Mention de format affichée sur l'accueil : « PDF » (un seul fichier, selon
// son extension) ou « ZIP » (plusieurs fichiers regroupés en archive).
function membershipFormat(files) {
  if (files.length === 0) return '';
  if (files.length > 1) return 'ZIP';
  const ext = path.extname(files[0].original_name).replace('.', '').toUpperCase();
  return ext || 'PDF';
}

// Résumé public : sert à l'accueil pour afficher/masquer la section « Adhérer »
// et choisir la mention de format du bouton.
app.get('/api/membership', (req, res) => {
  const files = membershipFiles();
  res.json({ count: files.length, format: membershipFormat(files) });
});

// Téléchargement public : un seul fichier (tel quel) ou une archive ZIP si
// plusieurs documents sont fournis.
app.get('/membership-download', (req, res) => {
  const files = membershipFiles();
  if (files.length === 0) return res.status(404).send('Aucun document disponible.');

  if (files.length === 1) {
    const f = files[0];
    const full = path.join(MEMBERSHIP_DIR, f.filename);
    if (!fs.existsSync(full)) return res.status(404).send('Fichier introuvable.');
    res.set('Content-Type', f.mime || 'application/octet-stream');
    res.set(
      'Content-Disposition',
      `attachment; filename="${f.original_name.replace(/[\\/:*?"<>|\r\n]+/g, '-')}"`
    );
    return fs.createReadStream(full).pipe(res);
  }

  // Plusieurs fichiers → archive ZIP générée à la volée.
  try {
    const entries = files
      .map((f) => ({
        name: f.original_name,
        data: fs.readFileSync(path.join(MEMBERSHIP_DIR, f.filename)),
      }))
      .filter((e) => e.data);
    const buf = zipSync(entries);
    const base = (setting('join_title') || 'adhesion')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'adhesion';
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${base}.zip"`);
    return res.send(buf);
  } catch (e) {
    return res.status(500).send('Impossible de générer l\'archive.');
  }
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
    INSERT INTO events (title, date, start_time, end_time, type, location_id, description)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    b.title.trim(), b.date, b.start_time || '', b.end_time || '',
    b.type || 'petite', b.location_id || null, b.description || ''
  );
  const id = info.lastInsertRowid;
  if (Array.isArray(b.game_ids)) setEventGames(id, b.game_ids);
  res.json({ id });
});

app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.date) return res.status(400).json({ error: 'Titre et date requis' });
  db.prepare(`
    UPDATE events SET title=?, date=?, start_time=?, end_time=?, type=?, location_id=?, description=?
    WHERE id=?
  `).run(
    b.title.trim(), b.date, b.start_time || '', b.end_time || '',
    b.type || 'petite', b.location_id || null, b.description || '',
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

// --- Réordonnancement générique (sort_order = position dans la liste) ------
function reorderRows(table, ids) {
  if (!Array.isArray(ids)) return;
  const upd = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  const tx = db.transaction((list) => {
    list.forEach((id, i) => upd.run(i + 1, id));
  });
  tx(ids.map((n) => Number(n)).filter(Number.isFinite));
}

// --- Blocs « Infos pratiques » (admin) ------------------------------------
app.post('/api/admin/info-blocks', requireAdmin, (req, res) => {
  const { icon = '📌', title = '', body = '' } = req.body || {};
  if (!String(title).trim()) return res.status(400).json({ error: 'Titre requis' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM info_blocks').get().m;
  const info = db
    .prepare(
      `INSERT INTO info_blocks (kind, icon, title, body, sort_order) VALUES ('text',?,?,?,?)`
    )
    .run(String(icon).slice(0, 16) || '📌', String(title).trim(), String(body), max + 1);
  res.json(db.prepare('SELECT * FROM info_blocks WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/admin/info-blocks/reorder', requireAdmin, (req, res) => {
  reorderRows('info_blocks', req.body?.ids);
  res.json({ ok: true });
});

app.put('/api/admin/info-blocks/:id', requireAdmin, (req, res) => {
  const { icon = '📌', title = '', body = '' } = req.body || {};
  if (!String(title).trim()) return res.status(400).json({ error: 'Titre requis' });
  // On ne modifie jamais le « kind » (un bloc spécial le reste).
  db.prepare('UPDATE info_blocks SET icon=?, title=?, body=? WHERE id=?').run(
    String(icon).slice(0, 16) || '📌',
    String(title).trim(),
    String(body),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM info_blocks WHERE id = ?').get(req.params.id));
});

// Suppression d'un bloc d'information (tous les blocs sont supprimables).
app.delete('/api/admin/info-blocks/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id FROM info_blocks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bloc introuvable' });
  db.prepare('DELETE FROM info_blocks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Questions fréquentes (admin) -----------------------------------------
app.post('/api/admin/faq', requireAdmin, (req, res) => {
  const { question = '', answer = '' } = req.body || {};
  if (!String(question).trim()) return res.status(400).json({ error: 'Question requise' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM faq').get().m;
  const info = db
    .prepare('INSERT INTO faq (question, answer, sort_order) VALUES (?,?,?)')
    .run(String(question).trim(), String(answer), max + 1);
  res.json(db.prepare('SELECT * FROM faq WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/admin/faq/reorder', requireAdmin, (req, res) => {
  reorderRows('faq', req.body?.ids);
  res.json({ ok: true });
});

app.put('/api/admin/faq/:id', requireAdmin, (req, res) => {
  const { question = '', answer = '' } = req.body || {};
  if (!String(question).trim()) return res.status(400).json({ error: 'Question requise' });
  db.prepare('UPDATE faq SET question=?, answer=? WHERE id=?').run(
    String(question).trim(),
    String(answer),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM faq WHERE id = ?').get(req.params.id));
});

app.delete('/api/admin/faq/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM faq WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Document(s) d'adhésion (admin) ---------------------------------------
app.get('/api/admin/membership', requireAdmin, (req, res) => {
  res.json(membershipFiles());
});

app.post('/api/admin/membership', requireAdmin, upload.array('files', 20), (req, res) => {
  const incoming = req.files || [];
  if (!incoming.length) return res.status(400).json({ error: 'Aucun fichier fourni.' });
  let max = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM membership_files').get().m;
  const ins = db.prepare(
    `INSERT INTO membership_files (filename, original_name, mime, size, sort_order)
     VALUES (?,?,?,?,?)`
  );
  const saved = [];
  for (const file of incoming) {
    const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
    if (!MEMBERSHIP_TYPES[ext]) {
      return res.status(400).json({
        error: `Format non accepté : « ${file.originalname} ». Formats autorisés : PDF, JPG, JPEG, PNG.`,
      });
    }
    const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(MEMBERSHIP_DIR, stored), file.buffer);
    const info = ins.run(stored, file.originalname, MEMBERSHIP_TYPES[ext], file.size, ++max);
    saved.push(info.lastInsertRowid);
  }
  res.json({ ok: true, added: saved.length });
});

app.delete('/api/admin/membership/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM membership_files WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Document introuvable' });
  try {
    fs.unlinkSync(path.join(MEMBERSHIP_DIR, row.filename));
  } catch {
    /* fichier déjà absent : on supprime quand même la métadonnée */
  }
  db.prepare('DELETE FROM membership_files WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/admin/membership/reorder', requireAdmin, (req, res) => {
  reorderRows('membership_files', req.body?.ids);
  res.json({ ok: true });
});

// --- Export / Import de la base -------------------------------------------
// Export : un instantané JSON de toutes les tables (le mot de passe admin est
// exclu ; les documents d'adhésion sont joints en base64). Import : remplace
// uniquement les catégories choisies (réglages, jeux, lieux, etc.).
const TABLE_COLUMNS = {
  settings: ['key', 'value'],
  event_types: ['id', 'key', 'label', 'sub', 'color', 'signup', 'sort_order'],
  locations: ['id', 'name', 'address', 'coords', 'maps_url', 'description', 'archived', 'created_at'],
  games: ['id', 'title', 'subtitle', 'type', 'players', 'duration', 'age', 'categories', 'themes', 'mechanisms', 'authors', 'publishers', 'rating', 'image_url', 'details_url', 'owner', 'created_at', 'updated_at'],
  events: ['id', 'title', 'date', 'start_time', 'end_time', 'type', 'location_id', 'description', 'created_at'],
  event_games: ['event_id', 'game_id'],
  info_blocks: ['id', 'kind', 'icon', 'title', 'body', 'sort_order'],
  faq: ['id', 'question', 'answer', 'sort_order'],
  membership_files: ['id', 'filename', 'original_name', 'mime', 'size', 'sort_order', 'created_at'],
};
const EXPORT_TABLES = Object.keys(TABLE_COLUMNS);
// Catégorie d'import → table(s) remplacée(s).
const IMPORT_CATEGORIES = {
  settings: ['settings'],
  event_types: ['event_types'],
  locations: ['locations'],
  games: ['games'],
  events: ['events', 'event_games'],
  info_blocks: ['info_blocks'],
  faq: ['faq'],
  membership: ['membership_files'],
};

app.get('/api/admin/db-export', requireAdmin, (req, res) => {
  const data = {};
  for (const tbl of EXPORT_TABLES) {
    let rows = db.prepare(`SELECT * FROM ${tbl}`).all();
    if (tbl === 'settings') rows = rows.filter((r) => r.key !== 'admin_password');
    if (tbl === 'membership_files') {
      rows = rows.map((r) => {
        let content = '';
        try { content = fs.readFileSync(path.join(MEMBERSHIP_DIR, r.filename)).toString('base64'); }
        catch { /* fichier manquant : métadonnée seule */ }
        return { ...r, _content: content };
      });
    }
    data[tbl] = rows;
  }
  const payload = JSON.stringify(
    { type: 'boardgames-planner-export', version: 1, exported_at: new Date().toISOString(), data },
    null,
    2
  );
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="boardgames-planner-${stamp}.json"`);
  res.send(payload);
});

function importRows(table, rows) {
  if (!Array.isArray(rows)) return;
  const cols = TABLE_COLUMNS[table];
  db.prepare(`DELETE FROM ${table}`).run();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const keys = cols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!keys.length) continue;
    db.prepare(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    ).run(...keys.map((k) => row[k]));
  }
}

function importSettings(rows) {
  if (!Array.isArray(rows)) return;
  // On préserve le mot de passe admin courant.
  db.prepare("DELETE FROM settings WHERE key <> 'admin_password'").run();
  const ins = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  for (const r of rows) {
    if (!r || typeof r.key !== 'string' || r.key === 'admin_password') continue;
    ins.run(r.key, r.value == null ? '' : String(r.value));
  }
}

function importMembership(rows) {
  const existing = db.prepare('SELECT filename FROM membership_files').all();
  db.prepare('DELETE FROM membership_files').run();
  for (const r of existing) {
    try { fs.unlinkSync(path.join(MEMBERSHIP_DIR, r.filename)); } catch { /* déjà absent */ }
  }
  if (!Array.isArray(rows)) return;
  const cols = TABLE_COLUMNS.membership_files;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const safe = path.basename(String(row.filename || '')); // anti-traversal
    if (!safe) continue;
    if (row._content) {
      try { fs.writeFileSync(path.join(MEMBERSHIP_DIR, safe), Buffer.from(row._content, 'base64')); }
      catch { /* contenu illisible : on garde la métadonnée */ }
    }
    const merged = { ...row, filename: safe };
    const keys = cols.filter((c) => Object.prototype.hasOwnProperty.call(merged, c));
    db.prepare(
      `INSERT INTO membership_files (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    ).run(...keys.map((k) => merged[k]));
  }
}

app.post('/api/admin/db-import', requireAdmin, importUpload.single('backup'), (req, res) => {
  let parsed;
  try {
    parsed = JSON.parse(req.file ? req.file.buffer.toString('utf8') : req.body.data || '');
  } catch {
    return res.status(400).json({ error: 'Fichier invalide (JSON illisible).' });
  }
  if (!parsed || parsed.type !== 'boardgames-planner-export' || !parsed.data) {
    return res.status(400).json({ error: "Ce fichier n'est pas un export valide." });
  }
  let cats = [];
  try { cats = JSON.parse(req.body.categories || '[]'); } catch { /* ignore */ }
  cats = (Array.isArray(cats) ? cats : []).filter((c) => IMPORT_CATEGORIES[c]);
  if (!cats.length) return res.status(400).json({ error: 'Aucun élément sélectionné.' });

  const data = parsed.data;
  // Les clés étrangères ne peuvent être basculées que hors transaction.
  db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      for (const cat of cats) {
        if (cat === 'settings') importSettings(data.settings);
        else if (cat === 'membership') importMembership(data.membership_files);
        else if (cat === 'events') {
          importRows('events', data.events);
          importRows('event_games', data.event_games);
        } else importRows(cat, data[cat]);
      }
      // Sanitation finale : retire les références devenues orphelines, quelle
      // que soit la combinaison de catégories importées.
      db.prepare(
        'UPDATE events SET location_id = NULL WHERE location_id IS NOT NULL AND location_id NOT IN (SELECT id FROM locations)'
      ).run();
      db.prepare(
        'DELETE FROM event_games WHERE event_id NOT IN (SELECT id FROM events) OR game_id NOT IN (SELECT id FROM games)'
      ).run();
    });
    run();
  } catch (e) {
    return res.status(500).json({ error: "Échec de l'import : " + e.message });
  } finally {
    db.pragma('foreign_keys = ON');
  }
  res.json({ ok: true, imported: cats });
});

// --- Réglages admin ---
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) if (r.key !== 'admin_password') obj[r.key] = r.value;
  res.json(obj);
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const allowed = [
    'myludo_profile',
    'site_name',
    'site_holder',
    'site_description',
    'og_image',
    'site_title',
    'footer_text',
    'footer_year',
    'default_lang',
    'infos_title',
    'infos_sub',
    'calendar_enabled',
    'ics_filename',
    'join_title',
    'join_text',
    'admin_password',
  ];
  // Clés où une valeur vide est significative (réinitialisation / choix
  // explicite) et ne doit donc PAS être ignorée comme « préserver l'existant ».
  const allowEmpty = new Set([
    'default_lang',
    'footer_year',
    'infos_title',
    'infos_sub',
    'ics_filename',
    'join_title',
    'join_text',
  ]);
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k) || v === undefined) continue;
    if (v === '' && !allowEmpty.has(k)) continue;
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
// --- OpenGraph / Twitter : injection des balises depuis les réglages -------
// Les pages publiques sont servies en injectant les balises de partage à la
// volée (les robots de WhatsApp/Facebook ne lisent que le HTML brut, pas le JS).
function htmlEscapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function injectOpenGraph(html, req) {
  const name = siteFullName();
  const desc = setting('site_description');
  let image = setting('og_image');
  const host = req.get('x-forwarded-host') || req.get('host');
  const origin = `${req.protocol}://${host}`;
  if (image && image.startsWith('/')) image = origin + image; // chemin → URL absolue
  const url = origin + req.originalUrl;
  const e = htmlEscapeAttr;
  const tags = [
    desc && `<meta name="description" content="${e(desc)}" />`,
    '<meta property="og:type" content="website" />',
    name && `<meta property="og:site_name" content="${e(name)}" />`,
    name && `<meta property="og:title" content="${e(name)}" />`,
    desc && `<meta property="og:description" content="${e(desc)}" />`,
    `<meta property="og:url" content="${e(url)}" />`,
    image && `<meta property="og:image" content="${e(image)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    name && `<meta name="twitter:title" content="${e(name)}" />`,
    desc && `<meta name="twitter:description" content="${e(desc)}" />`,
    image && `<meta name="twitter:image" content="${e(image)}" />`,
  ]
    .filter(Boolean)
    .join('\n    ');
  return html.replace('</head>', `    ${tags}\n  </head>`);
}
function servePublicHtml(file) {
  return (req, res, next) => {
    try {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(injectOpenGraph(html, req));
    } catch {
      next(); // en dev (pas de build), on laisse passer
    }
  };
}
app.get(['/', '/index.html'], servePublicHtml('index.html'));
app.get('/games.html', servePublicHtml('games.html'));

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res) {
      // Autorise le chargement cross-origin des fichiers publics (image
      // OpenGraph, favicons, images…). Sinon CORP:same-origin (posé par
      // helmet) bloque les aperçus de partage et les tests OpenGraph
      // chargés depuis une autre origine dans le navigateur.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);

// Démarrage.
app.listen(PORT, () => {
  console.log(`Soirées Jeux — serveur démarré sur http://localhost:${PORT}`);
  console.log(`Base de données : ${path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'boardgames-planner.db')}`);
});
