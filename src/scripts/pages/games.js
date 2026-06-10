// scripts/pages/games.js
// Ludothèque complète : recherche, filtres, tri, et CHARGEMENT INFINI
// (les jeux s'ajoutent au fil du défilement plutôt que tous d'un coup).
// Tous les libellés passent par l'i18n ; un changement de langue ré-applique
// les traductions déclaratives puis relance le filtrage pour reconstruire les
// cartes générées dynamiquement.
import '../../styles/games.scss';
import { API } from '../shared/api.js';
import { esc, initTheme, toggleTheme } from '../shared/dom.js';
import {
  initI18n,
  applyI18n,
  mountLangSwitchers,
  applySiteDefaultLang,
  onLangChange,
  t,
  tp,
} from '../shared/i18n.js';
import { gameThumb, wireThumbFallbacks } from '../shared/gameThumb.js';
import { openGameModal } from '../shared/gameModal.js';

let ALL = [];
let filtered = [];
let curType = 'all';
let rendered = 0;
let searchTimer;
let observer;

const PAGE_SIZE = 24; // nombre de jeux ajoutés à chaque palier de défilement

// "2 — 4" / "1+" / "3" -> { min, max } (max = Infinity pour "N+"). null si inconnu.
function parsePlayers(str) {
  if (!str) return null;
  const nums = (String(str).match(/\d+/g) || []).map(Number);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: /\+/.test(str) ? Infinity : Math.max(...nums) };
}

// "30 — 60" / "42" -> { min, max } en minutes. null si inconnu.
function parseDuration(str) {
  if (!str) return null;
  const nums = (String(str).match(/\d+/g) || []).map(Number);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// Remplit le sélecteur « nombre de joueurs » (libellés i18n, sélection conservée).
function fillPlayers() {
  const sel = document.getElementById('filter-players');
  const cur = sel.value;
  sel.querySelectorAll('option[data-dyn]').forEach((o) => o.remove());
  const frag = document.createDocumentFragment();
  for (let n = 1; n <= 7; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    o.dataset.dyn = '1';
    o.textContent = tp('gamesPage.players_n', n);
    frag.appendChild(o);
  }
  const o8 = document.createElement('option');
  o8.value = '8';
  o8.dataset.dyn = '1';
  o8.textContent = t('gamesPage.players_max', { count: 8 });
  frag.appendChild(o8);
  sel.appendChild(frag);
  sel.value = cur;
}

// Remplit le sélecteur « catégorie » à partir des catégories de la collection.
function fillCategories() {
  const sel = document.getElementById('filter-category');
  const map = new Map();
  ALL.forEach((g) =>
    (g.categories || '').split(',').forEach((c) => {
      const v = c.trim();
      if (v && !map.has(v.toLowerCase())) map.set(v.toLowerCase(), v);
    })
  );
  // Affiche la catégorie avec seulement la première lettre en majuscule
  const pretty = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const frag = document.createDocumentFragment();
  [...map.values()]
    .sort((a, b) => pretty(a).localeCompare(pretty(b), 'fr'))
    .forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = pretty(c);
      frag.appendChild(o);
    });
  sel.appendChild(frag);
}

function cardHtml(g) {
  const cats = (g.categories || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
  return `<div class="card game-card" data-game="${g.id}">
    ${gameThumb(g)}
    <div class="info">
      <h3>${esc(g.title)}</h3>
      <div class="sub">${esc(g.players || '?')} ${t('game.players_label')} · ${esc(
    g.duration || '?'
  )} ${t('game.min')} · ${esc(g.age || '')}</div>
      <div class="tags">
        ${g.rating > 0 ? `<span class="rating">★ ${g.rating.toFixed(1)}</span>` : ''}
        ${cats.map((c) => `<span class="pill">${esc(c)}</span>`).join('')}
      </div>
    </div>
  </div>`;
}

// Recalcule la liste filtrée/triée et repart du début de l'affichage.
function applyFilters() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const sort = document.getElementById('sort').value;
  filtered = ALL.filter((g) => curType === 'all' || g.type === curType);
  if (q)
    filtered = filtered.filter((g) =>
      (g.title + ' ' + g.categories + ' ' + g.themes + ' ' + g.mechanisms + ' ' + g.authors)
        .toLowerCase()
        .includes(q)
    );

  const playersSel = document.getElementById('filter-players').value;
  if (playersSel) {
    const n = Number(playersSel);
    filtered = filtered.filter((g) => {
      const pl = parsePlayers(g.players);
      if (!pl) return false;
      return playersSel === '8' ? pl.max >= 8 : pl.min <= n && n <= pl.max;
    });
  }

  const durSel = document.getElementById('filter-duration').value;
  if (durSel) {
    filtered = filtered.filter((g) => {
      const dr = parseDuration(g.duration);
      if (!dr) return false;
      const m = dr.max; // estimation haute de la durée
      if (durSel === 'short') return m <= 30;
      if (durSel === 'medium') return m > 30 && m <= 60;
      return m > 60; // long
    });
  }

  const catSel = document.getElementById('filter-category').value;
  if (catSel) {
    const cl = catSel.toLowerCase();
    filtered = filtered.filter((g) =>
      (g.categories || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .includes(cl)
    );
  }

  filtered.sort((a, b) =>
    sort === 'rating'
      ? b.rating - a.rating || a.title.localeCompare(b.title)
      : a.title.localeCompare(b.title, 'fr')
  );

  document.getElementById('count').textContent = tp('gamesPage.count', filtered.length);

  const grid = document.getElementById('games');
  grid.innerHTML = '';
  rendered = 0;
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty">${t('gamesPage.none')}</div>`;
    setStatus('');
    return;
  }
  renderNextPage();
}

// Ajoute le palier suivant de jeux à la grille.
function renderNextPage() {
  const grid = document.getElementById('games');
  const slice = filtered.slice(rendered, rendered + PAGE_SIZE);
  if (!slice.length) return;
  grid.insertAdjacentHTML('beforeend', slice.map(cardHtml).join(''));
  wireThumbFallbacks(grid);
  rendered += slice.length;

  if (rendered >= filtered.length) {
    setStatus(t('gamesPage.all_shown', { count: filtered.length }));
  } else {
    setStatus(t('gamesPage.load_more'));
  }
}

function setStatus(text) {
  document.getElementById('infinite-status').textContent = text;
}

function setType(type, el) {
  curType = type;
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');
  applyFilters();
}

// Observe la sentinelle : dès qu'elle entre dans le viewport et qu'il reste
// des jeux à montrer, on charge le palier suivant.
function initInfiniteScroll() {
  const sentinel = document.getElementById('infinite-sentinel');
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && rendered < filtered.length) renderNextPage();
    },
    { rootMargin: '600px 0px' }
  );
  observer.observe(sentinel);
}

function wireHandlers() {
  document.querySelector('.nav-burger')?.addEventListener('click', () =>
    document.getElementById('navlinks')?.classList.toggle('open')
  );
  document.querySelectorAll('.theme-toggle').forEach((b) => b.addEventListener('click', toggleTheme));
  document.getElementById('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 180);
  });
  document.getElementById('sort').addEventListener('change', applyFilters);
  ['filter-players', 'filter-duration', 'filter-category'].forEach((id) =>
    document.getElementById(id).addEventListener('change', applyFilters)
  );
  document.querySelectorAll('.chip').forEach((chip) =>
    chip.addEventListener('click', () => setType(chip.dataset.type, chip))
  );
  document.querySelectorAll('[data-close-modal]').forEach((b) =>
    b.addEventListener('click', () => document.getElementById(b.dataset.closeModal)?.classList.remove('open'))
  );
  document.getElementById('games').addEventListener('click', (e) => {
    const card = e.target.closest('[data-game]');
    if (card) openGameModal(ALL.find((g) => g.id === Number(card.dataset.game)));
  });
}

// Met à jour l'intro (nombre de jeux) dans la langue courante.
function renderIntro() {
  const el = document.getElementById('intro');
  if (!el) return;
  el.textContent = ALL.length
    ? t('gamesPage.intro_count', { count: ALL.length })
    : t('gamesPage.intro_default');
}

// Rafraîchit tout le contenu lors d'un changement de langue.
function onLanguageChanged() {
  renderIntro();
  fillPlayers();
  applyFilters();
}

document.addEventListener('DOMContentLoaded', async () => {
  initI18n();
  applyI18n(document);
  mountLangSwitchers();
  initTheme();
  wireHandlers();
  fillPlayers();
  onLangChange(onLanguageChanged);
  applySiteDefaultLang();
  try {
    ALL = await API.get('/api/games');
    renderIntro();
    fillCategories();
    applyFilters();
    initInfiniteScroll();
  } catch (e) {
    document.getElementById('games').innerHTML = `<div class="empty">${t('gamesPage.load_error', {
      error: esc(e.message),
    })}</div>`;
  }
});
