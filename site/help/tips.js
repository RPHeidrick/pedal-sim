/**
 * Small help bubbles. attachTip(el, text) shows `text` near `el`:
 *   mouse: on hover (after a short pause), keyboard: on focus,
 *   touch: when the control is touched, fading a moment after the finger lifts.
 * One shared bubble (#tip) is reused, so any number of controls cost nothing.
 *
 * attachTip(el, text, { outside }) keeps the bubble clear of a whole box (a pedal): it goes
 * below that box, or beside it when there is no room below, and never over it. That way a
 * knob's help never covers the pedal's move and remove buttons.
 */
let tipEl = null, showTimer = 0, hideTimer = 0, owner = null, ownerBox = null;

function place(target, box) {
  const r = target.getBoundingClientRect();
  tipEl.style.left = '0px'; tipEl.style.top = '0px';
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight, m = 8;
  const clampX = (x) => Math.max(m, Math.min(window.innerWidth - w - m, x));
  let x = clampX(r.left + r.width / 2 - w / 2), y;
  if (box) {
    const b = box.getBoundingClientRect();
    if (b.bottom + 8 + h < window.innerHeight - m) y = b.bottom + 8;                          // below the box
    else {
      y = Math.max(m, Math.min(window.innerHeight - h - m, r.top));
      if (b.right + 8 + w < window.innerWidth - m) x = b.right + 8;                            // right of it
      else if (b.left - 8 - w > m) x = b.left - 8 - w;                                         // left of it
      else y = Math.max(m, b.top - h - 36);                                                   // above its tool row
    }
  } else {
    y = r.top - h - 8;                        // above if there is room, else below
    if (y < m) y = r.bottom + 8;
  }
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(y)}px`;
}

function show(target, text, box = null) {
  clearTimeout(hideTimer);
  tipEl = tipEl || document.getElementById('tip');
  if (!tipEl) return;
  owner = target; ownerBox = box;
  tipEl.textContent = text;
  tipEl.hidden = false;
  place(target, box);
}
export function hideTip(target) {
  if (target && target !== owner) return;
  clearTimeout(showTimer);
  if (tipEl) tipEl.hidden = true;
  owner = null;
}

/**
 * @param {HTMLElement} el @param {string|(() => string)} text
 * @param {{outside?: HTMLElement, delay?: number}} [opts] outside: keep the bubble off this box
 */
export function attachTip(el, text, { outside = null, delay = 350 } = {}) {
  const txt = () => (typeof text === 'function' ? text() : text);
  const box = () => (outside ? (typeof outside === 'function' ? outside() : outside) : null);
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(el, txt(), box()), delay);
  });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(el); });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { hideTip(el); return; } // dragging with a mouse: get out of the way
    show(el, txt(), box());
  });
  el.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { clearTimeout(hideTimer); hideTimer = setTimeout(() => hideTip(el), 2500); } });
  el.addEventListener('focusin', () => { if (el.matches(':focus-visible') || el.querySelector(':focus-visible')) show(el, txt(), box()); });
  el.addEventListener('focusout', () => hideTip(el));
}

window.addEventListener('scroll', () => hideTip(), { passive: true });
