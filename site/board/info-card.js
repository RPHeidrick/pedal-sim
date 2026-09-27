/**
 * The pop-up card behind the "i" button on each pedal: what the pedal sounds like,
 * what every knob does, and a "Build it yourself" button.
 */
import { hooks } from '../core.js';
import { entryByKey, typeName, knobHelp, niceLabel, sameJob } from './library.js';
import { knobRole } from '../../circuits/index.js';

let infoOpen = null; // { pop, btn } while a card is showing

export function closeInfo() {
  if (!infoOpen) return;
  infoOpen.pop.remove();
  infoOpen.btn.setAttribute('aria-expanded', 'false');
  infoOpen = null;
}

/** Open the card for pedal `p` next to its "i" button, or close it if it is already open. */
export function toggleInfo(p, btn) {
  const same = infoOpen && infoOpen.btn === btn;
  closeInfo();
  if (same) return;
  const entry = entryByKey(p.key);
  const pop = document.createElement('div');
  pop.className = 'info-pop';
  pop.setAttribute('role', 'dialog');
  pop.style.setProperty('--pedal', entry.color);
  pop.innerHTML = '<div class="info-head"><span class="info-swatch"></span><h4></h4><span class="fx-chip"></span><button class="info-close" aria-label="Close">×</button></div><p class="info-sounds"></p><dl></dl>';
  pop.querySelector('h4').textContent = entry.name;
  pop.querySelector('.fx-chip').textContent = typeName(entry.type);
  pop.querySelector('.info-sounds').textContent = entry.sounds || entry.blurb;
  const dl = pop.querySelector('dl');
  for (const c of p.desc.controls) {
    if (c.kind !== 'pot') continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = niceLabel(c.label);
    const role = knobRole(c.label);
    if (role && role.others.length) {
      const chip = document.createElement('span');
      chip.className = 'same-job';
      chip.textContent = `= ${role.others.join(' / ')}`;
      chip.title = sameJob(c.label);
      dt.append(' ', chip);
    }
    dd.textContent = knobHelp(entry, c.label) || 'Turn it and listen.';
    dl.append(dt, dd);
  }
  const tip = document.createElement('p');
  tip.className = 'info-tip';
  tip.textContent = 'Tip: double-click a knob to put it back where it started.';
  pop.append(tip);
  const build = document.createElement('button');
  build.className = 'btn-secondary pedal-build';
  build.textContent = 'Build it yourself';
  build.title = 'Parts list, schematic, wiring, drill template and steps to build this pedal for real';
  build.addEventListener('click', () => { closeInfo(); hooks.openBuild(entry, p.variant); });
  pop.append(build);
  pop.querySelector('.info-close').addEventListener('click', closeInfo);
  document.body.append(pop);
  // beside the pedal, kept on screen
  const r = btn.closest('.pedal').getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, m = 12;
  let x = r.right + m;
  if (x + w > window.innerWidth - m) x = r.left - m - w;
  if (x < m) x = Math.max(m, Math.min(window.innerWidth - w - m, r.left));
  const y = Math.max(m, Math.min(window.innerHeight - h - m, r.top));
  pop.style.left = `${x + window.scrollX}px`;
  pop.style.top = `${y + window.scrollY}px`;
  btn.setAttribute('aria-expanded', 'true');
  infoOpen = { pop, btn };
}

// a click anywhere else, or Escape, closes the card
document.addEventListener('click', (e) => { if (infoOpen && !infoOpen.pop.contains(e.target)) closeInfo(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(); });
