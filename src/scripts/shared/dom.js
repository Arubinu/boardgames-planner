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
const prefersDark = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

export function initTheme() {
  // Choix explicite mémorisé ('dark'/'light') sinon on suit le système.
  const stored = localStorage.getItem('theme');
  applyDark(stored ? stored === 'dark' : prefersDark());
  // Tant qu'aucun choix explicite n'a été fait, suivre les changements système.
  if (!stored && typeof window.matchMedia === 'function') {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener?.('change', (e) => {
        if (!localStorage.getItem('theme')) applyDark(e.matches);
      });
  }
}
function applyDark(dark) {
  document.body.classList.toggle('dark', dark);
  updateThemeIcon();
}
export function toggleTheme(event) {
  const dark = !document.body.classList.contains('dark');
  const apply = () => {
    applyDark(dark);
    // Le bouton fige un choix explicite (qui prime sur le thème système).
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  };
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Repli : pas d'API View Transitions, ou animations réduites -> bascule directe.
  if (!document.startViewTransition || reduce) return apply();

  // Origine du cercle : le point cliqué (sinon le centre du bouton, sinon l'écran).
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  if (event && (event.clientX || event.clientY)) {
    x = event.clientX;
    y = event.clientY;
  } else if (event && event.currentTarget && event.currentTarget.getBoundingClientRect) {
    const r = event.currentTarget.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  document.startViewTransition(apply).ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
      },
      { duration: 480, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
    );
  });
}
function updateThemeIcon() {
  const icon = document.getElementById('themeIcon');
  if (icon) {
    const alt = document.body.classList.contains('dark') ? 'Light mode' : 'Dark mode';
    const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
    icon.innerHTML = `<img alt="${alt}" src="/assets/icons/${theme}.webp" />`;
  }
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
