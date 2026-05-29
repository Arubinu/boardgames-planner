// scripts/shared/gameThumb.js
// Génère la vignette d'un jeu et gère :
//  - le chargement de l'image en `cover` centré (CSS) ;
//  - la détection d'échec de chargement → repli « AUCUN / APERÇU » ;
//  - le badge « extension » sous forme d'icône addon.webp, posé dans le coin
//    supérieur droit de l'image.
import { esc } from './dom.js';
import { t } from './i18n.js';

// Repli affiché quand il n'y a pas d'URL d'image OU qu'elle ne charge pas.
// Les deux mots (traduits) sont empilés (retour à la ligne explicite).
function noPreviewMarkup() {
  return `<span class="game-thumb__noimg"><span>${esc(t('game.no_preview_1'))}</span><span>${esc(
    t('game.no_preview_2')
  )}</span></span>`;
}

// Badge extension (icône) dans le coin supérieur droit.
function extBadge(game) {
  if (game.type !== 'extension') return '';
  return `<span class="game-thumb__ext" title="${esc(t('game.ext'))}"><img src="/assets/addon.webp" alt="${esc(
    t('game.ext')
  )}"></span>`;
}

// Génère le HTML de la vignette. `opts.ratio` permet de surcharger le ratio
// (ex. '16/9' pour les modales).
export function gameThumb(game, opts = {}) {
  const style = opts.ratio ? ` style="aspect-ratio:${opts.ratio}"` : '';
  const inner = game.image_url
    ? `<img src="${esc(game.image_url)}" alt="${esc(game.title)}" loading="lazy" data-fallback>`
    : noPreviewMarkup();
  return `<div class="game-thumb"${style}>${inner}${extBadge(game)}</div>`;
}

// Branche la détection d'erreur de chargement sur toutes les images de
// vignette présentes dans `root` (par défaut : document). En cas d'échec,
// l'image est remplacée par le repli « AUCUN / APERÇU ».
export function wireThumbFallbacks(root = document) {
  root.querySelectorAll('img[data-fallback]').forEach((img) => {
    if (img.dataset.wired) return;
    img.dataset.wired = '1';
    const replace = () => {
      const holder = img.closest('.game-thumb');
      if (holder) {
        // On conserve le badge extension s'il existe.
        const badge = holder.querySelector('.game-thumb__ext');
        img.remove();
        holder.insertAdjacentHTML('afterbegin', noPreviewMarkup());
        if (badge) holder.appendChild(badge);
      }
    };
    img.addEventListener('error', replace);
    // Image déjà chargée mais cassée (cache) : largeur naturelle nulle.
    if (img.complete && img.naturalWidth === 0) replace();
  });
}
