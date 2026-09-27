/**
 * Page layout bits: folding the side panels, and the "Local preview" badge.
 */
import { $, savePrefs, prefs } from './core.js';

// --- fold the side racks (the ‹ › buttons on the Input and Output panels) ------------------------
function setRack(which, collapsed) {
  const rack = $(`rack-${which}`), btn = rack.querySelector('.rack-toggle');
  rack.classList.toggle('collapsed', collapsed);
  $('board').classList.toggle(`${which}-collapsed`, collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
  const out = which === 'out';
  btn.textContent = collapsed === out ? '‹' : '›';
  btn.title = collapsed ? `Show the ${out ? 'output' : 'input'} panel` : `Fold the ${out ? 'output' : 'input'} panel to give the chain more room`;
  savePrefs({ [`${which}Collapsed`]: collapsed });
}
/** Unfold a panel if it is folded (the guided tour points at things inside them). */
export const ensureRack = (which) => { if ($(`rack-${which}`).classList.contains('collapsed')) setRack(which, false); };

document.querySelectorAll('.rack-toggle').forEach((b) => b.addEventListener('click', () => {
  setRack(b.dataset.rack, !$(`rack-${b.dataset.rack}`).classList.contains('collapsed'));
}));
setRack('in', !!prefs.inCollapsed);
setRack('out', !!prefs.outCollapsed);

// --- local preview badge (only when served by tools/serve.js on your computer) ---------------------
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  fetch('/__local.json').then((r) => (r.ok ? r.json() : null)).then((info) => {
    if (!info) return;
    const b = document.createElement('span');
    b.className = 'local-badge';
    b.textContent = info.branch ? `Local preview · ${info.branch}` : 'Local preview';
    b.title = 'Running from your computer. The public site only changes when main is pushed to GitHub.';
    document.querySelector('.brand').after(b);
  }).catch(() => {});
}
