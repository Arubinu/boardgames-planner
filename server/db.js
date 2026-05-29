// server/db.js
// Couche base de données SQLite, sans serveur externe.
//
// Adaptateur : utilise "better-sqlite3" s'il est installé (recommandé, stable),
// sinon bascule automatiquement sur le module natif "node:sqlite" (Node >= 22).
// L'API exposée est la même dans les deux cas : prepare().run/get/all, exec, pragma.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'boardgames-planner.db');

let db;
try {
  const { default: Database } = await import('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log('[db] moteur : better-sqlite3');
} catch (err) {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(DB_PATH);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  db = {
    exec: (sql) => raw.exec(sql),
    pragma: (p) => raw.exec('PRAGMA ' + p),
    prepare: (sql) => {
      const stmt = raw.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    },
    transaction: (fn) => (...args) => {
      raw.exec('BEGIN');
      try { const r = fn(...args); raw.exec('COMMIT'); return r; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  console.log('[db] moteur : node:sqlite (repli)');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    address     TEXT DEFAULT '',
    coords      TEXT DEFAULT '',
    maps_url    TEXT DEFAULT '',
    description TEXT DEFAULT '',
    archived    INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS games (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    subtitle     TEXT DEFAULT '',
    type         TEXT DEFAULT 'basegame',
    players      TEXT DEFAULT '',
    duration     TEXT DEFAULT '',
    age          TEXT DEFAULT '',
    categories   TEXT DEFAULT '',
    themes       TEXT DEFAULT '',
    mechanisms   TEXT DEFAULT '',
    authors      TEXT DEFAULT '',
    publishers   TEXT DEFAULT '',
    rating       REAL DEFAULT 0,
    image_url    TEXT DEFAULT '',
    details_url  TEXT DEFAULT '',
    owner        TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    date         TEXT NOT NULL,
    start_time   TEXT DEFAULT '',
    end_time     TEXT DEFAULT '',
    type         TEXT DEFAULT 'petite',
    location_id  INTEGER,
    description  TEXT DEFAULT '',
    whatsapp_url TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS event_games (
    event_id INTEGER NOT NULL,
    game_id  INTEGER NOT NULL,
    PRIMARY KEY (event_id, game_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id)  REFERENCES games(id)  ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
`);

// --- Migrations légères (idempotentes) ------------------------------------
// Ajoute les colonnes manquantes sur une base déjà créée par une version
// précédente, sans rien casser. SQLite renvoie une erreur si la colonne
// existe déjà : on l'ignore simplement.
function addColumnIfMissing(table, column, definition) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
  catch (e) { /* colonne déjà présente */ }
}
addColumnIfMissing('locations', 'archived', 'INTEGER DEFAULT 0');
addColumnIfMissing('locations', 'coords', "TEXT DEFAULT ''");
addColumnIfMissing('games', 'created_at', "TEXT DEFAULT ''");
// Pour les jeux existants sans date de création, on initialise avec updated_at.
try { db.exec("UPDATE games SET created_at = updated_at WHERE created_at IS NULL OR created_at = ''"); } catch (e) {}

// Migration : extraire les coordonnées depuis un ancien lien Google Maps
// (maps_url) lorsque la colonne coords est vide. On reconnaît les formats
// usuels "@lat,lon" et "q=lat,lon" / "query=lat,lon".
function coordsFromMapsUrl(url) {
  if (!url) return '';
  const m =
    url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ||
    url.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  return m ? `${m[1]},${m[2]}` : '';
}
try {
  const rows = db.prepare(
    "SELECT id, maps_url FROM locations WHERE (coords IS NULL OR coords = '') AND maps_url <> ''"
  ).all();
  const upd = db.prepare('UPDATE locations SET coords = ? WHERE id = ?');
  for (const r of rows) {
    const c = coordsFromMapsUrl(r.maps_url);
    if (c) upd.run(c, r.id);
  }
} catch (e) { /* table vide ou colonne absente */ }

const ensureSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`
);
// Le mot de passe est inséré ici en clair la première fois, puis haché
// immédiatement ci-dessous (et migré s'il était déjà stocké en clair).
ensureSetting.run('admin_password', process.env.ADMIN_PASSWORD || 'admin');
ensureSetting.run('whatsapp_main', '');
ensureSetting.run('whatsapp_mjc', '');
ensureSetting.run('myludo_profile', 'https://www.myludo.fr/#!/profil/christophe-t-81487');

// --- Sécurité : hachage du mot de passe administrateur (Argon2id) ----------
// Au premier démarrage (ou après une mise à jour depuis une version qui
// stockait le mot de passe en clair), on remplace la valeur stockée par un
// hash Argon2id. Idempotent : si la valeur commence déjà par "$argon2", on
// n'y touche pas.
{
  const { hashPassword, isHashed } = await import('./password.js');
  const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  const current = row ? row.value : '';
  if (current && !isHashed(current)) {
    const hash = await hashPassword(current);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password'").run(hash);
    console.log('[db] mot de passe administrateur haché (Argon2id)');
  }
}

export default db;
