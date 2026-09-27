/**
 * Guided tour: a card that walks a first-time visitor through the page one step at a
 * time, pointing at the control it is talking about.
 *
 * The page stays fully usable while the tour is open (the spotlight does not block
 * clicks). The guide never moves on by itself: when a step asks the visitor to do
 * something and they do it, the card says so and invites them to take their time
 * and listen, and they move on when they are ready: Next, a click anywhere outside
 * the card and the highlighted control, or any key (Left arrow or Backspace goes
 * back, Esc ends the guide). Clicks and keys meant for the highlighted control, or
 * typed into a field, keep their normal job. Steps:
 *   { target: () => Element, title, body, waitFor?: 'event name', doneText?, before?: () => void }
 * Call tour.notify('event name') from the app when that thing happens.
 */
export class Tour {
  constructor(steps, { onEnd = () => {} } = {}) {
    this.steps = steps;
    this.onEnd = onEnd;
    this.i = -1;
    this.raf = 0;
    this.card = null;
    this.ring = null;
  }

  get active() { return this.i >= 0; }

  start(at = 0) {
    this.build();
    this.go(at);
  }

  build() {
    if (this.card) return;
    this.ring = document.createElement('div');
    this.ring.className = 'tour-ring';
    this.card = document.createElement('div');
    this.card.className = 'tour-card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    this.card.innerHTML = `
      <p class="tour-step"></p>
      <h3 class="tour-title"></h3>
      <p class="tour-body"></p>
      <p class="tour-wait" hidden></p>
      <p class="tour-done" hidden></p>
      <p class="tour-keys">Click anywhere or press any key to continue · Esc to skip</p>
      <div class="tour-actions">
        <button class="tour-skip" type="button">Skip guide</button>
        <span class="tour-spacer"></span>
        <button class="tour-back btn-secondary" type="button">Back</button>
        <button class="tour-next btn-primary" type="button">Next</button>
      </div>`;
    this.card.querySelector('.tour-skip').addEventListener('click', () => this.end());
    const step = (d) => { if (Date.now() >= this.guardUntil) this.go(this.i + d); };
    this.card.querySelector('.tour-back').addEventListener('click', () => step(-1));
    this.card.querySelector('.tour-next').addEventListener('click', () => step(1));
    this.onKey = (e) => this.key(e);
    this.onDown = (e) => { if (e.pointerType === 'mouse' && e.button === 0 && this.outside(e.target)) { e.preventDefault(); e.stopPropagation(); } };
    this.onClick = (e) => {
      if (!this.outside(e.target)) return;
      e.preventDefault(); e.stopPropagation();          // the click only moves the guide on
      if (Date.now() >= this.guardUntil) this.go(this.i + 1);
    };
    document.body.append(this.ring, this.card);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('click', this.onClick, true);
  }

  /** A click here should advance the guide: not on the card, not on the highlighted control, not in a dialog. */
  outside(t) {
    if (!(t instanceof Element) || !this.card) return false;
    if (this.card.contains(t) || document.querySelector('dialog[open]')) return false;
    if (t.closest('.info-pop, .menu-pop, dialog')) return false; // popups the guide itself asks you to open
    return !(this.target && this.target.contains(t));
  }

  key(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.end(); return; }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock', 'Fn'].includes(e.key)) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target instanceof Element ? e.target : null;
    // keys that operate whatever has focus (press a button, move a knob) keep that job;
    // any other key moves the guide on, even right after clicking the highlighted control
    const operate = ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key);
    if (t && t !== document.body) {
      if (t.closest('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]')) return; // typing text
      if (operate && t.closest('select, input, [role="slider"], button, a')) return;
      if (operate && this.target && this.target.contains(t)) return;
    }
    if (Date.now() < this.guardUntil) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft' || e.key === 'Backspace') this.go(this.i - 1);
    else this.go(this.i + 1);
  }

  go(i) {
    if (i >= this.steps.length) { this.end(true); return; }
    if (i < 0) i = 0;
    this.i = i;
    this.guardUntil = Date.now() + 350; // one click or key moves one step, never two
    const s = this.steps[i];
    if (s.before) s.before();
    const q = (sel) => this.card.querySelector(sel);
    q('.tour-step').textContent = `Step ${i + 1} of ${this.steps.length}`;
    q('.tour-title').textContent = s.title;
    q('.tour-body').textContent = s.body;
    this.done = false;
    q('.tour-wait').hidden = !s.waitFor;
    q('.tour-wait').textContent = s.waitHint || 'Your turn: try it now. There is no rush.';
    q('.tour-done').hidden = true;
    q('.tour-next').classList.remove('ready');
    // fade the new text in, so a change of step is easy to notice
    this.card.classList.remove('enter');
    void this.card.offsetWidth;
    this.card.classList.add('enter');
    q('.tour-back').hidden = i === 0;
    q('.tour-next').textContent = i === this.steps.length - 1 ? 'Finish' : 'Next';
    const el = s.target && s.target();
    this.target = el || null;
    // only scroll when the target is not already comfortably on screen
    if (el) {
      const r = el.getBoundingClientRect();
      const visible = r.top >= 70 && r.bottom <= window.innerHeight - 20;
      if (!visible) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
    cancelAnimationFrame(this.raf);
    const follow = () => { this.position(); this.raf = requestAnimationFrame(follow); };
    follow();
    q('.tour-next').focus({ preventScroll: true });
  }

  /** The app reports what the visitor did. The step acknowledges it and waits for Next. */
  notify(event) {
    if (!this.active || this.done) return;
    const s = this.steps[this.i];
    if (s.waitFor !== event) return;
    this.done = true;
    const q = (sel) => this.card.querySelector(sel);
    q('.tour-wait').hidden = true;
    q('.tour-done').textContent = s.doneText || 'Nice. Take a moment to listen, then press Next when you are ready.';
    q('.tour-done').hidden = false;
    q('.tour-next').classList.add('ready');
  }

  position() {
    const card = this.card, ring = this.ring, el = this.target, m = 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (!el || !el.isConnected) {
      ring.hidden = true;
      card.style.left = `${Math.round((vw - cw) / 2)}px`;
      card.style.top = `${Math.round((vh - ch) / 2)}px`;
      return;
    }
    const r = el.getBoundingClientRect();
    ring.hidden = false;
    const pad = 6;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    // below the target if it fits, else above, else beside it, else pinned to the bottom
    let x = r.left + r.width / 2 - cw / 2, y;
    if (r.bottom + m + ch < vh) y = r.bottom + m;
    else if (r.top - m - ch > 0) y = r.top - m - ch;
    else if (r.right + m + cw < vw) { x = r.right + m; y = r.top + r.height / 2 - ch / 2; }
    else if (r.left - m - cw > 0) { x = r.left - m - cw; y = r.top + r.height / 2 - ch / 2; }
    else y = vh - ch - m;
    card.style.left = `${Math.round(Math.max(m, Math.min(vw - cw - m, x)))}px`;
    card.style.top = `${Math.round(Math.max(m, Math.min(vh - ch - m, y)))}px`;
  }

  end(finished = false) {
    cancelAnimationFrame(this.raf);
    this.i = -1;
    this.card?.remove(); this.ring?.remove();
    this.card = this.ring = null;
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('click', this.onClick, true);
    this.onEnd(finished);
  }
}
