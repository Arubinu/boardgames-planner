// scripts/shared/gameModal.js
// Modale de détail d'un jeu, partagée par la page d'accueil et la ludothèque.
import { esc, openModal } from './dom.js';
import { t } from './i18n.js';
import { gameThumb, wireThumbFallbacks } from './gameThumb.js';

function row(label, val) {
  return val ? `<p style="margin:.3rem 0"><strong>${esc(label)} :</strong> ${esc(val)}</p>` : '';
}

export function openGameModal(game) {
  if (!game) return;
  openModal('game-modal');
  document.getElementById('gm-title').textContent = game.title;
  const body = document.getElementById('gm-body');
  body.innerHTML = `
    ${gameThumb(game, { ratio: '16/9' })}
    <div style="margin-top:1rem">
      ${game.subtitle ? `<p class="muted">${esc(game.subtitle)}</p>` : ''}
      ${
        game.rating > 0
          ? `<p class="rating" style="font-size:1rem">${esc(
              t('game.rating_out_of', { rating: game.rating.toFixed(1) })
            )}</p>`
          : ''
      }
      ${row(t('game.players'), game.players)}
      ${row(t('game.duration'), game.duration ? game.duration + ' ' + t('game.min') : '')}
      ${row(t('game.age'), game.age)}
      ${row(t('game.categories'), game.categories)}
      ${row(t('game.themes'), game.themes)}
      ${row(t('game.mechanisms'), game.mechanisms)}
      ${row(t('game.authors'), game.authors)}
      ${row(t('game.publishers'), game.publishers)}
      ${game.owner ? row(t('game.owner'), game.owner) : ''}
      <a class="btn btn-primary" style="margin-top:1rem" href="${esc(
        game.details_url
      )}" target="_blank" rel="noopener">${esc(t('game.see_full'))}</a>
    </div>`;
  wireThumbFallbacks(body);
}
