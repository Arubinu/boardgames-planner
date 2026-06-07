// scripts/shared/i18n.js
// Petit moteur de traduction multilingue, sans dépendance externe.
//
// Principes :
//  - les textes vivent dans des dictionnaires par langue (locales/*.js) ;
//  - les éléments HTML statiques portent des attributs `data-i18n*` remplis
//    automatiquement par applyI18n() ;
//  - le code génératif (cartes, tableaux…) appelle t() / tp() ;
//  - la langue est persistée dans localStorage et exposée à <html lang> ;
//  - tout changement de langue notifie les abonnés (onLangChange) afin que
//    chaque page rafraîchisse son contenu dynamique.

import fr from './locales/fr.js';
import en from './locales/en.js';

const DICTS = { fr, en };

// Langues proposées dans le sélecteur (ordre d'affichage).
export const LANGUAGES = [
  { code: 'fr', label: 'Français', short: 'FR', flag: '🇫🇷' },
  { code: 'en', label: 'English', short: 'EN', flag: '🇬🇧' },
];

const DEFAULT_LANG = 'fr';
const STORAGE_KEY = 'lang';
const LOCALES = { fr: 'fr-FR', en: 'en-GB' };

let current = DEFAULT_LANG;
const listeners = new Set();

// Détermine la langue initiale : préférence enregistrée, sinon langue du
// navigateur si elle est supportée, sinon langue par défaut.
function detect() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && DICTS[saved]) return saved;
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return DICTS[nav] ? nav : DEFAULT_LANG;
}

export function initI18n() {
  current = detect();
  document.documentElement.lang = current;
  return current;
}

export function getLang() {
  return current;
}

// Indique si le visiteur a explicitement choisi une langue (sélecteur).
export function hasUserLang() {
  return !!localStorage.getItem(STORAGE_KEY);
}

// Nom du site (réglage admin) : sert de suffixe aux <title>. Le préfixe (nom de
// page) vit dans les locales (meta.*_title) ; pour l'accueil il est vide → le
// titre est uniquement le nom du site.
// Identité du site (réglages admin) : Nom + Détenteur, recombinés en
// « Nom — Détenteur » au besoin. Le détenteur sert de suffixe aux <title> des
// pages internes ; l'accueil (préfixe vide) prend le nom complet.
let siteName = '';
let siteHolder = '';
// Année affichée dans le copyright du pied de page. Vide => année courante.
// Conservée en module pour résister aux ré-applications (changement de langue).
let footerYear = '';
function applyFooterYear(root = document) {
  const y = footerYear || new Date().getFullYear();
  root.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = y;
  });
}
export function setFooterYear(year) {
  footerYear = year ? String(year) : '';
  applyFooterYear();
}
function siteFull() {
  return siteHolder ? (siteName ? `${siteName} — ${siteHolder}` : siteHolder) : siteName;
}
export function setSiteIdentity(name, holder) {
  siteName = name || '';
  siteHolder = holder || '';
  applyDocTitle();
  applySiteBrand();
}
function applyDocTitle() {
  if (!siteName && !siteHolder) return; // sinon on garde le <title> statique
  const el = document.querySelector('title[data-title-key]');
  if (!el) return;
  const prefix = t('meta.' + el.dataset.titleKey) || '';
  document.title = prefix ? `${prefix} — ${siteHolder || siteName}` : siteFull();
}
// Marque (logo) : [data-site-brand] = Nom + <small>Détenteur</small> ;
// [data-site-name] = nom complet en texte simple.
// Par défaut, [data-site-brand] affiche l'identité du site (Nom + Détenteur),
// identique sur toutes les pages publiques (accueil, ludothèque). Une marque
// portant data-site-brand="page" affiche plutôt « titre de la page courante +
// nom du site » — réservé au back-office (administration).
function applySiteBrand() {
  if (!siteName && !siteHolder) return;
  const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Variante « identité du site » (pages publiques).
  const siteBrandHtml = e(siteName) + (siteHolder ? `<small>${e(siteHolder)}</small>` : '');
  // Variante « page » (admin) : titre de la page (meta) + « Nom (Détenteur) ».
  const tk = document.querySelector('title[data-title-key]')?.dataset.titleKey;
  const prefix = tk ? t('meta.' + tk) : '';
  const pageMain = prefix || siteName;
  // Sur une page interne : le nom du site, suivi du détenteur entre parenthèses.
  const pageSub = prefix
    ? siteName + (siteHolder ? ` (${siteHolder})` : '')
    : siteHolder;
  const pageBrandHtml = e(pageMain) + (pageSub ? `<small>${e(pageSub)}</small>` : '');
  document.querySelectorAll('[data-site-brand]').forEach((el) => {
    el.innerHTML = el.dataset.siteBrand === 'page' ? pageBrandHtml : siteBrandHtml;
  });
  const full = siteFull();
  document.querySelectorAll('[data-site-name]').forEach((el) => {
    el.textContent = full;
  });
  // Entité du copyright (pied de page) : le détenteur, sinon le nom du site.
  const holder = siteHolder || siteName;
  document.querySelectorAll('[data-site-holder]').forEach((el) => {
    el.textContent = holder;
  });
}

// Applique la langue par défaut du site (réglage admin) tant que le visiteur
// n'a pas choisi lui-même. Valeur vide / 'auto' ⇒ on garde la détection
// navigateur. À appeler tôt au démarrage de chaque page publique.
// Charge la configuration publique au démarrage : applique le nom du site (pour
// le <title>) et, si le visiteur n'a pas déjà choisi, la langue par défaut.
export async function applySiteDefaultLang() {
  try {
    const r = await fetch('/api/public-settings');
    const s = await r.json();
    if (!s) return;
    setSiteIdentity(s.site_name, s.site_holder);
    setFooterYear(s.footer_year);
    if (!hasUserLang() && s.default_lang && DICTS[s.default_lang]) {
      setLang(s.default_lang, { persist: false });
    }
  } catch {
    /* hors-ligne / erreur réseau : on garde la langue détectée */
  }
}
export function getLocale() {
  return LOCALES[current] || LOCALES[DEFAULT_LANG];
}

// Abonnement aux changements de langue. Renvoie une fonction de désinscription.
export function onLangChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setLang(lang, { persist = true } = {}) {
  if (!DICTS[lang] || lang === current) return;
  current = lang;
  if (persist) localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  applyI18n(document);
  syncLangSwitchers();
  listeners.forEach((cb) => {
    try {
      cb(lang);
    } catch (e) {
      console.error('[i18n] écouteur en erreur :', e);
    }
  });
}

// Résolution d'une clé pointée ("a.b.c") dans la langue donnée.
function lookup(key, lang) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), DICTS[lang]);
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

// Traduction d'une clé. Les valeurs non textuelles (tableaux, objets) sont
// renvoyées brutes — utile pour la FAQ par exemple (voir aussi tRaw).
export function t(key, params) {
  let v = lookup(key, current);
  if (v == null && current !== DEFAULT_LANG) v = lookup(key, DEFAULT_LANG);
  if (typeof v === 'string') return interpolate(v, params);
  if (v == null) {
    console.warn('[i18n] clé manquante :', key);
    return key;
  }
  return v;
}

export function tRaw(key) {
  let v = lookup(key, current);
  if (v == null && current !== DEFAULT_LANG) v = lookup(key, DEFAULT_LANG);
  return v;
}

// Pluralisation via Intl.PluralRules : choisit `${key}_one`, `${key}_other`, …
// selon la catégorie de la langue courante.
export function tp(key, count, params = {}) {
  const cat = new Intl.PluralRules(getLocale()).select(count);
  let v = lookup(`${key}_${cat}`, current) ?? lookup(`${key}_other`, current);
  if (v == null && current !== DEFAULT_LANG) {
    v = lookup(`${key}_${cat}`, DEFAULT_LANG) ?? lookup(`${key}_other`, DEFAULT_LANG);
  }
  return interpolate(typeof v === 'string' ? v : key, { count, ...params });
}

// Applique les traductions à tous les éléments porteurs d'attributs data-i18n*.
//  - data-i18n           → textContent
//  - data-i18n-html      → innerHTML (textes balisés)
//  - data-i18n-ph        → attribut placeholder
//  - data-i18n-aria      → attribut aria-label
//  - data-year           → année du copyright (réglage footer_year, sinon courante)
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPh));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  root.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = footerYear || new Date().getFullYear();
  });
  if (root === document) {
    applyDocTitle();
    applySiteBrand();
  }
}

// --- Sélecteur de langue (dans la barre de navigation) -------------------
// Remplit chaque <select class="lang-select"> avec les langues disponibles et
// branche le changement de langue. À appeler une fois au chargement.
export function mountLangSwitchers() {
  document.querySelectorAll('.lang-select').forEach((sel) => {
    if (!sel.dataset.wired) {
      sel.addEventListener('change', () => setLang(sel.value));
      sel.dataset.wired = '1';
    }
  });
  syncLangSwitchers();
}

function syncLangSwitchers() {
  document.querySelectorAll('.lang-select').forEach((sel) => {
    if (!sel.options.length) {
      sel.innerHTML = LANGUAGES
        .map((l) => `<option value="${l.code}">${l.flag}</option>`)
        .join('');
    }
    sel.value = current;
  });
}

// --- Formatage des dates selon la langue courante ------------------------
export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString(getLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
export function formatMonthYear(date) {
  return date.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' });
}
export function formatMonthShort(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(getLocale(), { month: 'short' });
}
