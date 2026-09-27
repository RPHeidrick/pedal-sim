/**
 * Paint shop: restyle a pedal on the board. Pick an enclosure finish and write your own
 * name on the box. Saved with the board. Figma: "Pedal / Workshop" (Finish = ...).
 */
import { openMenu, closeMenu } from './theme.js';

export const FINISHES = [
  { id: 'painted', name: 'Painted', chip: (c) => `linear-gradient(180deg, color-mix(in srgb, ${c} 92%, white), color-mix(in srgb, ${c} 76%, black))` },
  { id: 'brushed', name: 'Brushed', chip: () => 'linear-gradient(100deg, #d9d4cd, #a59e95 30%, #ebe6df 55%, #9a938a 80%, #c8c2ba)' },
  { id: 'candy', name: 'Candy', chip: () => 'linear-gradient(180deg, #ffb067, #ff7a1a 45%, #c24e00)' },
  { id: 'hammertone', name: 'Hammertone', chip: () => 'radial-gradient(circle at 30% 30%, rgba(255,255,255,.2) 0 12%, transparent 13%), linear-gradient(180deg, #c98a52, #8f5a31 55%, #b77a45)' },
  { id: 'matte', name: 'Matte black', chip: () => 'linear-gradient(180deg, #2a2420, #141110)' },
  { id: 'relic', name: 'Relic', chip: () => 'radial-gradient(140% 90% at 50% 45%, transparent 55%, rgba(60,45,30,.45)), linear-gradient(180deg, #efe5d1, #cdbfa6)' },
];

/**
 * @param {HTMLElement} anchor  the Paint button
 * @param {{finish?:string, label?:string}} p  the board pedal (changed in place)
 * @param {{color:string, name:string}} entry  library entry (default colour and name)
 * @param {() => void} onChange  apply and save
 */
export function openPaintShop(anchor, p, entry, onChange) {
  openMenu(anchor, (pop) => {
    pop.classList.add('paint-pop');
    pop.setAttribute('aria-label', `Paint shop: ${entry.name}`);
    pop.innerHTML = `<h4>Paint shop</h4><div class="finish-grid" role="radiogroup" aria-label="Finish"></div>
      <label>Name on the box<input type="text" maxlength="22" spellcheck="false"></label>
      <div class="paint-actions"><button class="text-btn" data-act="reset">Back to stock</button><button class="text-btn" data-act="done">Done</button></div>`;
    const grid = pop.querySelector('.finish-grid');
    const paint = () => grid.querySelectorAll('.finish-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === (p.finish || 'painted'))));
    for (const f of FINISHES) {
      const b = document.createElement('button');
      b.className = 'finish-opt';
      b.dataset.id = f.id;
      b.setAttribute('role', 'radio');
      b.innerHTML = `<span class="finish-chip" style="background:${f.chip(entry.color)}"></span><span></span>`;
      b.lastChild.textContent = f.name;
      b.addEventListener('click', () => { p.finish = f.id === 'painted' ? undefined : f.id; paint(); onChange(); });
      grid.append(b);
    }
    paint();
    const input = pop.querySelector('input');
    input.value = p.label || '';
    input.placeholder = entry.name;
    input.addEventListener('input', () => { p.label = input.value.trim() || undefined; onChange(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') closeMenu(); });
    pop.querySelector('[data-act=reset]').addEventListener('click', () => { p.finish = undefined; p.label = undefined; input.value = ''; paint(); onChange(); });
    pop.querySelector('[data-act=done]').addEventListener('click', () => closeMenu());
  });
}
