// server/myludo.js
// Analyse d'un export MyLudo (CSV ou JSON) vers des objets "jeu" normalisés.

// Construit le lien vers la fiche MyLudo à partir de l'ID (SPA en hash-route).
export function detailsUrlFromId(id) {
  if (!id) return '';
  return `https://www.myludo.fr/#!/game/${id}`;
}

// Transforme une valeur (chaîne "a,b" ou tableau) en chaîne "a, b" propre.
function joinList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ');
  }
  if (value == null) return '';
  return String(value).replace(/\s*,\s*/g, ', ').trim();
}

// Normalise une note : accepte 6,6 (virgule FR) ou 6.6 ou nombre.
function toRating(value) {
  if (value == null || value === '') return 0;
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Construit l'objet jeu commun à partir d'un enregistrement brut MyLudo.
function buildGame(rec) {
  const id = parseInt(rec['ID'], 10);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    title: (rec['Titre'] || '').toString().trim(),
    subtitle: (rec['Sous-titre'] || '').toString().trim(),
    type: (rec['Type'] || 'basegame').toString().trim(),
    players: (rec['Joueur(s)'] || '').toString().trim(),
    duration: (rec['Durée'] || '').toString().trim(),
    age: (rec['Age(s)'] || '').toString().trim(),
    categories: joinList(rec['Catégorie(s)']),
    themes: joinList(rec['Thème(s)']),
    mechanisms: joinList(rec['Mécanisme(s)']),
    authors: joinList(rec['Auteur(s)']),
    publishers: joinList(rec['Éditeur(s)']),
    rating: toRating(rec['Note moyenne']),
    details_url: detailsUrlFromId(id),
    owner: (rec['Propriétaire'] || '').toString().trim(),
  };
}

// --- Parsing CSV ----------------------------------------------------------
// MyLudo exporte un CSV séparé par des points-virgules, avec BOM et champs
// éventuellement entre guillemets (qui peuvent contenir des ; et des "").
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }  // guillemet échappé
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ';') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text) {
  // Retire un éventuel BOM puis découpe en lignes (en respectant les \n internes
  // protégés par des guillemets).
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (cur.length) rows.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.length) rows.push(cur);
  if (rows.length === 0) return [];

  // L'en-tête peut commencer par une apostrophe parasite ('ID;...) -> on nettoie.
  let header = parseCsvLine(rows[0]).map((h) => h.replace(/^'/, '').trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = parseCsvLine(rows[r]);
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const rec = {};
    header.forEach((key, idx) => { rec[key] = cells[idx] ?? ''; });
    out.push(rec);
  }
  return out;
}

// --- Point d'entrée -------------------------------------------------------
// Reçoit le contenu texte d'un fichier + nom de fichier. Renvoie un tableau
// d'objets jeu normalisés.
export function parseMyludo(content, filename = '') {
  const trimmed = content.trimStart();
  const looksJson = filename.toLowerCase().endsWith('.json') ||
                    trimmed.startsWith('[') || trimmed.startsWith('{');

  let records;
  if (looksJson) {
    const data = JSON.parse(content);
    records = Array.isArray(data) ? data : (data.games || data.items || [data]);
  } else {
    records = parseCsv(content);
  }

  const games = [];
  const seen = new Set();
  for (const rec of records) {
    const g = buildGame(rec);
    if (g && g.title && !seen.has(g.id)) {
      seen.add(g.id);
      games.push(g);
    }
  }
  return games;
}
