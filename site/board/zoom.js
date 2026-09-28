/**
 * Chain zoom: the -, %, + and Fit buttons above the pedals.
 *
 * CSS zoom scales the pedals *and* their layout, so the chain scrolls correctly and
 * knobs keep working at any size. Ctrl + scroll (or a trackpad pinch) zooms around the pointer.
 */
import { $, clamp, prefs, savePrefs } from '../core.js';

const ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 1.15;
/** Current zoom factor (1 = 100%). Other files read it; only this file changes it. */
export let zoom = 1;
const zoomSupported = typeof CSS !== 'undefined' && CSS.supports('zoom', '2');

function setZoom(z, anchor = null) {
  const chain = $('chain');
  z = clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX);
  // keep the point under the pointer (or the centre) where it is
  const ax = anchor == null ? chain.clientWidth / 2 : anchor;
  const contentX = (chain.scrollLeft + ax) / zoom;
  zoom = z;
  $('chain-inner').style.zoom = String(z);
  chain.scrollLeft = contentX * z - ax;
  $('zoom-level').textContent = `${Math.round(z * 100)}%`;
  document.querySelector('[data-zoom=out]').disabled = z <= ZOOM_MIN;
  document.querySelector('[data-zoom=in]').disabled = z >= ZOOM_MAX;
  savePrefs({ zoom: z });
}

/** True once the visitor has zoomed by hand this visit: the phone auto fit then leaves it alone. */
let zoomedByHand = false;
/**
 * On a phone, keep the whole board in view as pedals come and go (a pedal cut off at the
 * edge looks broken), unless the visitor has chosen a zoom themselves.
 */
export function autoFit() {
  if (!zoomSupported || zoomedByHand || window.innerWidth > 760) return;
  requestAnimationFrame(fitZoom);
}

/** Zoom so the whole chain fits the width of the board (never above 125%). */
export function fitZoom() {
  const chain = $('chain'), inner = $('chain-inner');
  // measure the chain at its narrowest (cables not stretched), converted back to 100%
  inner.classList.add('measuring');
  const natural = inner.getBoundingClientRect().width / zoom;
  inner.classList.remove('measuring');
  const cs = getComputedStyle(chain);
  const avail = chain.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  setZoom(clamp(Math.floor((avail / natural) * 100) / 100, ZOOM_MIN, 1.25));
  chain.scrollLeft = 0;
}

if (zoomSupported) {
  document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.zoom;
    zoomedByHand = act !== 'fit';
    if (act === 'in') setZoom(zoom * ZOOM_STEP);
    else if (act === 'out') setZoom(zoom / ZOOM_STEP);
    else if (act === 'reset') setZoom(1);
    else fitZoom();
  }));
  $('chain').addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomedByHand = true;
    const r = $('chain').getBoundingClientRect();
    setZoom(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left);
  }, { passive: false });
  setZoom(prefs.zoom || 1);
} else {
  document.querySelector('.zoom').hidden = true; // very old browser: plain scrolling chain
}
