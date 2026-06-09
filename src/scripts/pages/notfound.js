// scripts/pages/notfound.js
// Page d'erreur 404 : reprend l'habillage du site (thème clair/sombre, i18n,
// sélecteur de langue, nav). Aucune logique métier — juste l'init partagé.
import '../../styles/notfound.scss';
import { initTheme, toggleTheme } from '../shared/dom.js';
import {
  initI18n,
  applyI18n,
  mountLangSwitchers,
  applySiteDefaultLang,
  onLangChange,
} from '../shared/i18n.js';

document.addEventListener('DOMContentLoaded', () => {
  initI18n();
  applyI18n(document);
  mountLangSwitchers();
  initTheme();

  // Nav : menu mobile + bascule de thème (mêmes interactions que les autres pages).
  document.querySelector('.nav-burger')?.addEventListener('click', () => {
    document.getElementById('navlinks')?.classList.toggle('open');
  });
  document
    .querySelectorAll('.theme-toggle')
    .forEach((b) => b.addEventListener('click', toggleTheme));

  // Réapplique les traductions au changement de langue, et peuple l'identité
  // du site (marque, année du footer) depuis /api/public-settings.
  onLangChange(() => applyI18n(document));
  applySiteDefaultLang();
});
