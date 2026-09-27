/**
 * Looks (themes). Every phase of the site's design stays available here, so an earlier
 * style is one click away. The styles live in styles/themes.css; Figma has one page per look.
 * The chosen look is applied before the page paints by a small script in index.html.
 */
export const LOOKS = [
  { id: 'arcade', name: 'Arcade', phase: 11, note: 'An 80s arcade cabinet: neon, scanlines, chunky buttons and a few pinball lights.',
    preview: ['#07060a', '#ff6a00', '#29e7ff', '#ff2e88'] },
  { id: 'tube', name: 'Tube amp', phase: 10, note: 'A vintage amp. Black tolex, cream piping, grille cloth and glowing tubes.',
    preview: ['#0d0c0b', '#ff8c2a', '#d8c59c', '#4a3a28'] },
  { id: 'workshop', name: 'Workshop', phase: 9, note: 'A hand built pedal shop after dark. Black bench, orange glow, brushed metal.',
    preview: ['#0b0908', '#ff7a1a', '#b0a89e', '#efe6d6'] },
  { id: 'classic', name: 'Classic', phase: 8, note: 'The original clean look.',
    preview: ['#0f1113', '#f0a64a', '#6fa8dc', '#e7e4dd'] },
];
export const DEFAULT_LOOK = 'arcade'; // the newest look; the index.html snippet uses the same default
export const lookById = (id) => LOOKS.find((l) => l.id === id) || LOOKS.find((l) => l.id === DEFAULT_LOOK);

export function applyLook(id) {
  const look = lookById(id);
  document.documentElement.dataset.theme = look.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = look.preview[0];
  return look;
}

/**
 * A small anchored menu. Closes on an outside click or Esc. When the page scrolls (the
 * visitor, or the page itself gliding to the board) it follows its button, and closes
 * only if the button scrolls out of sight.
 */
export function openMenu(anchor, build, { className = '' } = {}) {
  closeMenu();
  const pop = document.createElement('div');
  pop.className = `menu-pop ${className}`.trim();
  pop.setAttribute('role', 'dialog');
  build(pop);
  document.body.append(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { closeMenu(); return; } // button out of sight
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  place();
  anchor.setAttribute('aria-expanded', 'true');
  const onDoc = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { closeMenu(); anchor.focus(); } };
  const onScroll = (e) => { if (!pop.contains(e.target)) place(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
  });
  current = { pop, anchor, off: () => {
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', place);
  } };
  const first = pop.querySelector('button, input');
  if (first) first.focus({ preventScroll: true });
  return pop;
}
let current = null;
export function closeMenu() {
  if (!current) return;
  current.off();
  current.anchor.setAttribute('aria-expanded', 'false');
  current.pop.remove();
  current = null;
}

/** The "Look" button in the header. */
export function mountLookPicker(btn, getId, onPick) {
  const paint = () => {
    const look = lookById(getId());
    btn.innerHTML = `<span class="dots" aria-hidden="true">${look.preview.slice(0, 3).map((c) => `<i style="background:${c}"></i>`).join('')}</span><span>Look: ${look.name}</span>`;
  };
  paint();
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
    openMenu(btn, (pop) => {
      pop.setAttribute('aria-label', 'Choose a look');
      pop.innerHTML = '<h4>Choose a look</h4>';
      for (const look of LOOKS) {
        const o = document.createElement('button');
        o.className = 'look-opt';
        o.setAttribute('role', 'radio');
        o.setAttribute('aria-checked', String(look.id === getId()));
        o.innerHTML = `<span class="look-prev" style="background:${look.preview[0]}">${look.preview.slice(1).map((c) => `<i style="background:${c};height:${10 + Math.random() * 14}px"></i>`).join('')}</span><span><b></b><small></small></span>`;
        o.querySelector('b').textContent = `${look.name} · Phase ${look.phase}`;
        o.querySelector('small').textContent = look.note;
        o.addEventListener('click', () => { onPick(look.id); paint(); closeMenu(); });
        pop.append(o);
      }
    });
  });
  return { refresh: paint };
}
