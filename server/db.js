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
  CREATE TABLE IF NOT EXISTS event_types (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    sub        TEXT DEFAULT '',
    color      TEXT NOT NULL DEFAULT '#8b9a6b',
    signup     INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
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

// --- Valeurs par défaut (uniquement au tout premier lancement) ------------
// ON CONFLICT DO NOTHING : ces valeurs ne servent qu'à amorcer une base
// vierge. Elles ne sont JAMAIS réappliquées si la clé existe déjà.
const ensureSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`
);
ensureSetting.run('admin_password', 'admin');
ensureSetting.run('whatsapp_main', '');
ensureSetting.run('whatsapp_mjc', '');
ensureSetting.run('myludo_profile', 'https://www.myludo.fr/#!/profil/christophe-t-81487');
// Identité du site (réutilisée par les balises OpenGraph et le flux .ics).
ensureSetting.run('site_name', 'Soirées Jeux — MJC Estrablin');
ensureSetting.run(
  'site_description',
  'Calendrier des soirées jeux de société, ludothèque et infos pratiques de la MJC Estrablin.'
);
ensureSetting.run('og_image', '/assets/boardgames.webp');

// --- Configuration par variables d'environnement --------------------------
// Appliquée à CHAQUE démarrage du conteneur :
//   - variable renseignée (non vide) -> écrase la valeur stockée ;
//   - variable absente ou vide       -> la valeur stockée reste inchangée.
// Pour exposer une nouvelle option plus tard, il suffit d'ajouter une ligne
// à ce tableau (la variable d'environnement -> la clé en base).
const ENV_SETTINGS = [
  { env: 'WHATSAPP_MAIN',  key: 'whatsapp_main' },
  { env: 'WHATSAPP_MJC',   key: 'whatsapp_mjc' },
  { env: 'MYLUDO_PROFILE', key: 'myludo_profile' },
];

// Upsert générique : insère la clé si absente, sinon met à jour sa valeur.
const setSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);
for (const { env, key } of ENV_SETTINGS) {
  const value = process.env[env];
  if (value !== undefined && value !== '') {
    setSetting.run(key, value);
    console.log(`[db] réglage « ${key} » défini depuis ${env}`);
  }
}

// --- Sécurité : mot de passe administrateur (Argon2id) --------------------
// Cas particulier car la valeur doit être hachée avant stockage.
//   - ADMIN_PASSWORD renseigné -> (re)définit le mot de passe à CHAQUE
//     démarrage (haché Argon2id) ;
//   - ADMIN_PASSWORD absent/vide -> conserve la valeur déjà stockée, et la
//     hache si elle était encore en clair (migration / valeur par défaut).
{
  const { hashPassword, isHashed } = await import('./password.js');
  const fromEnv = process.env.ADMIN_PASSWORD;

  if (fromEnv !== undefined && fromEnv !== '') {
    const hash = await hashPassword(fromEnv);
    setSetting.run('admin_password', hash);
    console.log('[db] mot de passe administrateur défini depuis ADMIN_PASSWORD');
  } else {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
    const current = row ? row.value : '';
    if (current && !isHashed(current)) {
      const hash = await hashPassword(current);
      setSetting.run('admin_password', hash);
      console.log('[db] mot de passe administrateur haché (Argon2id)');
    }
  }
}

// --- Types de soirées : amorçage au premier lancement ---------------------
// Reprend les deux types historiques (Grande / Petite) avec leur couleur et
// leur comportement. Ensuite, tout est géré depuis l'administration.
{
  const count = db.prepare('SELECT COUNT(*) AS c FROM event_types').get().c;
  if (count === 0) {
    const ins = db.prepare(
      `INSERT INTO event_types (key, label, sub, color, signup, sort_order)
       VALUES (?,?,?,?,?,?)`
    );
    ins.run('grande', 'Grande soirée', 'sans inscription', '#c4704a', 0, 1);
    ins.run('petite', 'Petite soirée', 'sur inscription', '#8b9a6b', 1, 2);
    console.log('[db] types de soirées initialisés (Grande, Petite)');
  }
}

export default db;