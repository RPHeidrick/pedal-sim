/**
 * Physical feedback for the pedalboard: sparks and a puff when a pedal is removed,
 * FLIP slides when pedals change places, and drag to reorder.
 * Everything is skipped when the visitor prefers reduced motion.
 */
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Orange sparks and a warm puff at the centre of an element. */
export function burst(el, n = 14) {
  if (reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const puff = document.createElement('div');
  puff.className = 'puff';
  puff.style.left = `${cx}px`; puff.style.top = `${cy}px`;
  document.body.append(puff);
  setTimeout(() => puff.remove(), 600);
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 50 + Math.random() * 70;
    s.style.left = `${cx}px`; s.style.top = `${cy}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d - 20}px`);
    s.style.animationDelay = `${Math.random() * 60}ms`;
    document.body.append(s);
    setTimeout(() => s.remove(), 760);
  }
}

/** Record where keyed elements are, then after `change()` slide them from there to their new place. */
export function flip(root, selector, change, { scale = 1, duration = 280 } = {}) {
  const before = new Map();
  for (const el of root.querySelectorAll(selector)) before.set(el.dataset.key, el.getBoundingClientRect());
  change();
  if (reducedMotion()) return;
  for (const el of root.querySelectorAll(selector)) {
    const b = before.get(el.dataset.key);
    if (!b) continue;
    const a = el.getBoundingClientRect();
    const dx = (b.left - a.left) / scale, dy = (b.top - a.top) / scale;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' });
  }
}

/**
 * Drag pedals sideways to reorder them. The pedal lifts and follows the pointer; the
 * others slide aside. `onDrop(uids)` gets the new order. Knobs, sliders and buttons keep
 * working as before: a drag only starts on the pedal's body and after a few pixels.
 */
export function enableDrag(root, { getScale, onDrop, onStart }) {
  const INTERACTIVE = 'button, input, select, a, .knob, .pedal-variant, .pedal-tools';
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.pedal');
    if (!el || e.target.closest(INTERACTIVE)) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let originLeft = 0;
    const pedals = () => [...root.querySelectorAll('.pedal')];
    // Follow the pointer on the whole window, not just the pedal: moving the pedal to a new
    // slot takes it out of the page for a moment, which cancels pointer capture, and the
    // drop would then never arrive (the pedal stayed lifted and the sound order unchanged).
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 6) return;
        dragging = true;
        el.classList.add('dragging');
        root.closest('.chain')?.classList.add('drag-active');
        originLeft = el.previousElementSibling.getBoundingClientRect().right;
        onStart && onStart();
      }
      const s = getScale();
      // where the pedal's slot is now (it moves when the others reorder); the cable in
      // front of it is never transformed, so its right edge marks the slot
      const layoutLeft = el.previousElementSibling.getBoundingClientRect().right;
      const tx = (ev.clientX - startX - (layoutLeft - originLeft)) / s;
      const ty = Math.max(-40, Math.min(40, dy / s)) * 0.35;
      el.style.transform = `translate(${tx}px, ${ty - 14}px) rotate(${Math.max(-4, Math.min(4, tx / 40))}deg) scale(1.04)`;
      // new slot: how many other pedals have their centre left of the pointer
      const others = pedals().filter((p) => p !== el);
      let idx = 0;
      for (const p of others) { const r = p.getBoundingClientRect(); if (ev.clientX > r.left + r.width / 2) idx++; }
      const cur = pedals().indexOf(el);
      if (idx !== cur) {
        flip(root, '.pedal:not(.dragging), .jack', () => {
          const cable = el.previousElementSibling;
          const list = others;
          if (idx >= list.length) list[list.length - 1].after(cable, el);
          else list[idx].previousElementSibling.before(cable, el);
        }, { scale: s, duration: 220 });
      }
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!dragging) return;
      root.closest('.chain')?.classList.remove('drag-active');
      el.classList.remove('dragging');
      el.classList.add('drop-home');
      el.style.transform = '';
      setTimeout(() => el.classList.remove('drop-home'), 260);
      onDrop(pedals().map((p) => Number(p.dataset.key)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
