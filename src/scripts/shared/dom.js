// scripts/shared/dom.js
// Utilitaires partagés : échappement HTML, formatage des dates, thème,
// petites aides DOM.

// Échappe le HTML pour éviter toute injection lors de l'affichage de texte.
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Le formatage des dates dépend de la langue : voir formatDate() dans i18n.js.

// Renvoie true si la date est aujourd'hui ou dans le futur.
export function isUpcoming(iso) {
  const today = new Date().toISOString().slice(0, 10);
  return iso >= today;
}

// Initiale d'un jeu (pour la pastille quand il n'y a pas d'image).
export function gameInitial(title) {
  return (title || '?').trim().charAt(0).toUpperCase();
}

// --- Thème clair / sombre, persisté dans localStorage --------------------
export function initTheme() {
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
  updateThemeIcon();
}
export function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  updateThemeIcon();
}
function updateThemeIcon() {
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
}

// --- Petites aides DOM ----------------------------------------------------
export function toast(msg, isErr) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' error' : '');
  setTimeout(() => (t.className = 'toast'), 2800);
}
export function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}
export function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}
