/**
 * Rotary knob with a slider underneath. Value 0..1 (pot rotation).
 * Knob: drag up/down, scroll, or use the arrow keys; Shift for fine control.
 * Slider: drag sideways or click anywhere on it. Both always move together.
 * Double-click either one to reset to the default. The value (0 to 10) is
 * always shown. Renders as SVG so it stays sharp at any zoom.
 */
const SWEEP = 270; // degrees, like a real pot
const START = -135;

export function createKnob({ label, value = 0.5, defaultValue = value, size = 42, onChange }) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.innerHTML = `
    <svg viewBox="0 0 48 48" width="${size}" height="${size}">
      <circle class="knob-ring" cx="24" cy="24" r="21"/>
      <path class="knob-track" d=""/>
      <path class="knob-arc" d=""/>
      <circle class="knob-body" cx="24" cy="24" r="16"/>
      <line class="knob-pointer" x1="24" y1="24" x2="24" y2="10"/>
    </svg>
    <span class="knob-label"></span>
    <input class="knob-slider" type="range" min="0" max="1000" step="1" tabindex="-1" aria-hidden="true">
    <span class="knob-value"></span>`;
  const svg = el.querySelector('svg');
  const arc = el.querySelector('.knob-arc');
  const track = el.querySelector('.knob-track');
  const pointer = el.querySelector('.knob-pointer');
  el.querySelector('.knob-label').textContent = label;
  const readout = el.querySelector('.knob-value');
  const slider = el.querySelector('.knob-slider');

  svg.setAttribute('role', 'slider');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('aria-valuemin', '0');
  svg.setAttribute('aria-valuemax', '10');

  const polar = (deg, r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [24 + r * Math.cos(a), 24 + r * Math.sin(a)];
  };
  const arcPath = (from, to, r) => {
    const [x1, y1] = polar(from, r), [x2, y2] = polar(to, r);
    const large = to - from > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  track.setAttribute('d', arcPath(START, START + SWEEP, 21));

  let v = value;
  const render = () => {
    const deg = START + v * SWEEP;
    arc.setAttribute('d', v > 0.001 ? arcPath(START, deg, 21) : '');
    pointer.setAttribute('transform', `rotate(${deg} 24 24)`);
    readout.textContent = (v * 10).toFixed(1);
    svg.setAttribute('aria-valuenow', (v * 10).toFixed(1));
    slider.value = String(Math.round(v * 1000));
    slider.style.setProperty('--p', `${(v * 100).toFixed(1)}%`);
  };
  const set = (nv, fire = true) => {
    nv = Math.min(1, Math.max(0, nv));
    if (nv === v) return;
    v = nv;
    render();
    if (fire && onChange) onChange(v);
  };

  // drag
  let dragY = null, dragV = 0;
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    dragY = e.clientY; dragV = v;
    el.classList.add('active');
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragY == null) return;
    const px = e.shiftKey ? 600 : 160; // pixels for full travel
    set(dragV + (dragY - e.clientY) / px);
  });
  const end = () => { dragY = null; el.classList.remove('active'); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', () => set(defaultValue));
  // Ctrl + scroll is left alone so it can zoom the signal chain
  const wheel = (e) => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); set(v - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02)); };
  svg.addEventListener('wheel', wheel, { passive: false });

  // slider: the browser handles dragging and clicking; we mirror it into the knob
  slider.addEventListener('input', () => set(+slider.value / 1000));
  slider.addEventListener('dblclick', () => set(defaultValue));
  slider.addEventListener('wheel', wheel, { passive: false });
  slider.addEventListener('pointerdown', () => el.classList.add('active'));
  slider.addEventListener('pointerup', () => el.classList.remove('active'));
  slider.addEventListener('pointercancel', () => el.classList.remove('active'));
  svg.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(v + d); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(v - d); e.preventDefault(); }
    else if (e.key === 'Home') { set(0); e.preventDefault(); }
    else if (e.key === 'End') { set(1); e.preventDefault(); }
  });

  render();
  return { el, get value() { return v; }, set: (nv) => set(nv, false) };
}
