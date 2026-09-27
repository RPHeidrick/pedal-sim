/**
 * Small help bubbles. attachTip(el, text) shows `text` near `el`:
 *   mouse: on hover (after a short pause), keyboard: on focus,
 *   touch: when the control is touched, fading a moment after the finger lifts.
 * One shared bubble (#tip) is reused, so any number of controls cost nothing.
 */
let tipEl = null, showTimer = 0, hideTimer = 0, owner = null;

function place(target) {
  const r = target.getBoundingClientRect();
  tipEl.style.left = '0px'; tipEl.style.top = '0px';
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight, m = 8;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(m, Math.min(window.innerWidth - w - m, x));
  let y = r.top - h - 8;                      // above if there is room, else below
  if (y < m) y = r.bottom + 8;
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(y)}px`;
}

function show(target, text) {
  clearTimeout(hideTimer);
  tipEl = tipEl || document.getElementById('tip');
  if (!tipEl) return;
  owner = target;
  tipEl.textContent = text;
  tipEl.hidden = false;
  place(target);
}
export function hideTip(target) {
  if (target && target !== owner) return;
  clearTimeout(showTimer);
  if (tipEl) tipEl.hidden = true;
  owner = null;
}

/** @param {HTMLElement} el @param {string|(() => string)} text */
export function attachTip(el, text) {
  const txt = () => (typeof text === 'function' ? text() : text);
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(el, txt()), 350);
  });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(el); });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { hideTip(el); return; } // dragging with a mouse: get out of the way
    show(el, txt());
  });
  el.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { clearTimeout(hideTimer); hideTimer = setTimeout(() => hideTip(el), 2500); } });
  el.addEventListener('focusin', () => { if (el.matches(':focus-visible') || el.querySelector(':focus-visible')) show(el, txt()); });
  el.addEventListener('focusout', () => hideTip(el));
}

window.addEventListener('scroll', () => hideTip(), { passive: true });
