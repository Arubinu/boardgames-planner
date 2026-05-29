// server/seed.js
// Initialise la base avec les deux lieux officiels, une petite sélection de
// jeux d'exemple (12 jeux dont quelques extensions) et deux soirées de
// démonstration. Idempotent : ne duplique rien.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import db from './db.js';
import { parseMyludo } from './myludo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Lieux par défaut -----------------------------------------------------
// Coordonnées "lat,lon" stockées en base ; le lien Google Maps est dérivé
// de ces coordonnées dans l'interface (plus aucune URL saisie à la main).
const locations = [
  {
    name: 'Salle Festive',
    address: 'Espace Sportif Pierre Lacroix, 38780 Estrablin',
    coords: '45.5150286,4.9563041',
    description: 'Grand espace pour 20+ personnes. Cuisine équipée, parking gratuit, accès handicapé. Utilisée pour les grandes soirées (sans inscription).',
  },
  {
    name: 'Local de la MJC',
    address: 'Impasse du cimetière, 93 Rue de l\'Europe, 38780 Estrablin',
    coords: '45.5171848,4.9652353',
    description: 'Espace intimiste (14 personnes max), ambiance conviviale, parfait pour apprendre les jeux. Utilisé pour les petites soirées (sur inscription).',
  },
];

const insLoc = db.prepare(
  `INSERT INTO locations (name, address, coords, description) VALUES (?,?,?,?)
   ON CONFLICT(name) DO NOTHING`
);
for (const l of locations) insLoc.run(l.name, l.address, l.coords, l.description);
console.log(`Lieux : ${db.prepare('SELECT COUNT(*) c FROM locations').get().c}`);

// --- Sélection de jeux d'exemple (12 jeux, dont quelques extensions) -------
const sampleCsv = path.join(__dirname, '..', 'import-data', 'collection.csv');
if (db.prepare('SELECT COUNT(*) c FROM games').get().c === 0 && fs.existsSync(sampleCsv)) {
  const all = parseMyludo(fs.readFileSync(sampleCsv, 'utf8'), 'collection.csv');

  /* On privilégie les jeux les mieux notés pour une vitrine soignée, puis on
  // compose un panel de 12 : ~9 jeux de base + 3 extensions.
  const byRating = (a, b) => (b.rating || 0) - (a.rating || 0);
  const base = all.filter((g) => g.type !== 'extension').sort(byRating);
  const exts = all.filter((g) => g.type === 'extension').sort(byRating);

  const selection = [...base.slice(0, 9), ...exts.slice(0, 3)];
  */
  const selection = all;

  const ins = db.prepare(`
    INSERT INTO games
      (id,title,subtitle,type,players,duration,age,categories,themes,mechanisms,authors,publishers,rating,details_url,owner)
    VALUES (@id,@title,@subtitle,@type,@players,@duration,@age,@categories,@themes,@mechanisms,@authors,@publishers,@rating,@details_url,@owner)
    ON CONFLICT(id) DO NOTHING
  `);
  const tx = db.transaction((arr) => { for (const g of arr) ins.run(g); });
  tx(selection);
  console.log(`Jeux importés : ${db.prepare('SELECT COUNT(*) c FROM games').get().c}`);
} else {
  console.log(`Jeux : ${db.prepare('SELECT COUNT(*) c FROM games').get().c} (import ignoré)`);
}

// --- Soirées de démonstration ---------------------------------------------
if (db.prepare('SELECT COUNT(*) c FROM events').get().c === 0) {
  const salle = db.prepare('SELECT id FROM locations WHERE name=?').get('Salle Festive')?.id;
  const local = db.prepare('SELECT id FROM locations WHERE name=?').get('Local de la MJC')?.id;

  const today = new Date();
  const d1 = new Date(today); d1.setDate(today.getDate() + 7);
  const d2 = new Date(today); d2.setDate(today.getDate() + 18);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const insEv = db.prepare(`
    INSERT INTO events (title,date,start_time,end_time,type,location_id,description)
    VALUES (?,?,?,?,?,?,?)
  `);
  const e1 = insEv.run('Grande soirée jeux', fmt(d1), '19:00', '23:00', 'grande', salle,
    'Soirée ouverte à tous, sans inscription. Apportez un plat (sucré ou salé) et une boisson à partager !').lastInsertRowid;
  const e2 = insEv.run('Petite soirée jeux', fmt(d2), '20:00', '23:00', 'petite', local,
    'Soirée sur inscription (14 places max). Nourriture facultative. Idéal pour découvrir de nouveaux jeux.').lastInsertRowid;

  const top = db.prepare('SELECT id FROM games ORDER BY rating DESC LIMIT 8').all().map((r) => r.id);
  const link = db.prepare('INSERT OR IGNORE INTO event_games (event_id, game_id) VALUES (?,?)');
  for (const gid of top.slice(0, 6)) link.run(e1, gid);
  for (const gid of top.slice(2, 8)) link.run(e2, gid);
  console.log('Soirées de démonstration créées.');
} else {
  console.log(`Soirées : ${db.prepare('SELECT COUNT(*) c FROM events').get().c} (seed ignoré)`);
}

console.log('Seed terminé.');
