/**
 * Shared helpers that every part of the page uses.
 *
 *   $            shorthand for document.getElementById
 *   audio        the one AudioEngine (site/audio/audio.js) that owns the sound
 *   prefs        page settings remembered between visits (this browser only)
 *   toast        the message bar at the bottom of the page
 *   didThing     tells the guided tour that the visitor did something it was waiting for
 *   hooks        a few actions that main.js fills in, so modules can call each other
 *                without importing each other in a circle
 */
import { AudioEngine } from './audio/audio.js';

export const $ = (id) => document.getElementById(id);
export const audio = new AudioEngine();
export const dB = (x) => Math.pow(10, x / 20);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// --- remembered settings -----------------------------------------------------------------
export const prefs = (() => { try { return JSON.parse(localStorage.getItem('pedal-sim.prefs') || '{}') || {}; } catch { return {}; } })();
let prefsTimer = 0;
const writePrefs = () => { clearTimeout(prefsTimer); prefsTimer = 0; try { localStorage.setItem('pedal-sim.prefs', JSON.stringify(prefs)); } catch { /* storage unavailable */ } };
/** Change some settings; they are written to storage a moment later (many quick changes = one write). */
export function savePrefs(patch) {
  Object.assign(prefs, patch);
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(writePrefs, 300);
}
// leaving or reloading the page within that moment still keeps the change
addEventListener('pagehide', () => { if (prefsTimer) writePrefs(); });

// --- guided tour hooks ----------------------------------------------------------------------
/** The running guided tour, if any (site/help/guide.js sets it). */
export const guide = { tour: null };
export const tourActive = () => !!(guide.tour && guide.tour.active);
/** Anything the guide waits for ("power", "sample", "pedal", "knob", "bypass", "compare", "preset", ...). */
export const didThing = (what) => { if (guide.tour) guide.tour.notify(what); };

// --- actions filled in by main.js ------------------------------------------------------------
export const hooks = {
  /** Open the "Build it yourself" sheet for a library entry. */
  openBuild: (entry, variant) => {},
  /** The visitor picked a sample of another kind (electric / acoustic / bass). */
  onSoundGroupChange: (group) => {},
};

// --- message bar ------------------------------------------------------------------------------
let toastTimer = 0;
/** @param {string} msg @param {{label: string, run: () => void}} [action] e.g. Undo */
export function toast(msg, action = null) {
  const t = $('toast'), a = $('toast-action');
  $('toast-text').textContent = msg;
  a.hidden = !action;
  a.onclick = null;
  if (action) { a.textContent = action.label; a.onclick = () => { t.hidden = true; action.run(); }; }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 9000 : 6000);
}
