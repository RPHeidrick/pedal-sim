/**
 * Small canvas line plot: grid, axes, labels, multiple series, log x.
 * Colours come from CSS custom properties so plots follow the theme tokens.
 * Used by the engine bench now and by AnalysisPanel later.
 */

export class Plot {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{xlabel?:string, ylabel?:string, xlog?:boolean, equal?:boolean}} [opts]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.last = null;
    this.ro = new ResizeObserver(() => this.last && this.draw(...this.last));
    this.ro.observe(canvas);
  }

  /**
   * @param {Array<{x?:ArrayLike<number>, y:ArrayLike<number>, color?:string, label?:string, width?:number, dash?:number[]}>} series
   * @param {{x?:[number,number], y?:[number,number], title?:string}} [range]
   */
  draw(series, range = {}) {
    this.last = [series, range];
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(cv);
    const v = (n, d) => css.getPropertyValue(n).trim() || d;
    const col = {
      bg: v('--c-panel-2', '#1d2126'), grid: v('--c-grid', '#252a30'), axis: v('--c-axis', '#3a4048'),
      text: v('--c-text-dim', '#8e949c'), mono: v('--font-mono', 'monospace'),
    };
    g.fillStyle = col.bg;
    g.fillRect(0, 0, W, H);

    const m = { l: 52, r: 10, t: 10, b: 26 };
    const w = W - m.l - m.r;
    const h = H - m.t - m.b;
    const xlog = !!this.opts.xlog;
    const tx = (x) => (xlog ? Math.log10(Math.max(x, 1e-30)) : x);

    let [x0, x1] = range.x || [Infinity, -Infinity];
    let [y0, y1] = range.y || [Infinity, -Infinity];
    if (!range.x || !range.y) {
      for (const s of series) {
        for (let i = 0; i < s.y.length; i++) {
          const xv = s.x ? s.x[i] : i;
          const yv = s.y[i];
          if (!Number.isFinite(yv)) continue;
          if (!range.x) { x0 = Math.min(x0, xv); x1 = Math.max(x1, xv); }
          if (!range.y) { y0 = Math.min(y0, yv); y1 = Math.max(y1, yv); }
        }
      }
      if (!range.y) {
        if (!(y1 > y0)) { y0 -= 1; y1 += 1; }
        const pad = (y1 - y0) * 0.08;
        y0 -= pad; y1 += pad;
      }
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;
    if (!(x1 > x0)) x1 = x0 + 1;
    if (this.opts.equal) {
      // same scale on both axes (transfer curves)
      const sx = w / (x1 - x0), sy = h / (y1 - y0);
      if (sx < sy) { const c = (y0 + y1) / 2, half = h / sx / 2; y0 = c - half; y1 = c + half; }
      else { const c = (x0 + x1) / 2, half = w / sy / 2; x0 = c - half; x1 = c + half; }
    }
    const X0 = tx(x0), X1 = tx(x1);
    const px = (x) => m.l + ((tx(x) - X0) / (X1 - X0)) * w;
    const py = (y) => m.t + h - ((y - y0) / (y1 - y0)) * h;

    g.font = `10px ${col.mono}`;
    g.lineWidth = 1;
    // grid + labels
    const yt = ticks(y0, y1, Math.max(3, Math.floor(h / 40)));
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const t of yt) {
      const yy = Math.round(py(t)) + 0.5;
      g.strokeStyle = Math.abs(t) < 1e-12 ? col.axis : col.grid;
      g.beginPath(); g.moveTo(m.l, yy); g.lineTo(m.l + w, yy); g.stroke();
      g.fillStyle = col.text;
      g.fillText(fmt(t), m.l - 6, yy);
    }
    const xt = xlog ? logTicks(x0, x1) : ticks(x0, x1, Math.max(3, Math.floor(w / 70)));
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const t of xt) {
      const xx = Math.round(px(t)) + 0.5;
      g.strokeStyle = !xlog && Math.abs(t) < 1e-12 ? col.axis : col.grid;
      g.beginPath(); g.moveTo(xx, m.t); g.lineTo(xx, m.t + h); g.stroke();
      g.fillStyle = col.text;
      g.fillText(fmt(t), xx, m.t + h + 6);
    }
    g.strokeStyle = col.axis;
    g.strokeRect(m.l + 0.5, m.t + 0.5, w - 1, h - 1);

    // series
    g.save();
    g.beginPath();
    g.rect(m.l, m.t, w, h);
    g.clip();
    for (const s of series) {
      g.strokeStyle = s.color || '#f0a64a';
      g.lineWidth = s.width || 1.5;
      g.setLineDash(s.dash || []);
      g.beginPath();
      const n = s.y.length;
      const step = Math.max(1, Math.floor(n / (w * 2)));
      let pen = false;
      for (let i = 0; i < n; i += step) {
        const yv = s.y[i];
        if (!Number.isFinite(yv)) { pen = false; continue; }
        const X = px(s.x ? s.x[i] : i);
        const Y = py(yv);
        if (pen) g.lineTo(X, Y); else { g.moveTo(X, Y); pen = true; }
      }
      g.stroke();
    }
    g.restore();

    // legend
    g.textAlign = 'right';
    g.textBaseline = 'top';
    let ly = m.t + 6;
    for (const s of series) {
      if (!s.label) continue;
      g.fillStyle = s.color || '#f0a64a';
      g.fillText(s.label, m.l + w - 8, ly);
      ly += 13;
    }
    if (this.opts.xlabel) {
      g.fillStyle = col.text;
      g.textAlign = 'left';
      g.textBaseline = 'bottom';
      g.fillText(this.opts.xlabel, m.l + 4, m.t + h - 4);
    }
    if (this.opts.ylabel) {
      g.fillStyle = col.text;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(this.opts.ylabel, m.l + 4, m.t + 4);
    }
  }
}

function ticks(a, b, count) {
  const span = b - a;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let t = Math.ceil(a / step) * step; t <= b + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return out;
}

function logTicks(a, b) {
  const out = [];
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) {
    for (const k of [1, 2, 5]) {
      const t = k * 10 ** e;
      if (t >= a && t <= b) out.push(t);
    }
  }
  return out;
}

function fmt(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return `${+(v / 1000).toPrecision(3)}k`;
  if (a >= 1) return `${+v.toPrecision(3)}`;
  if (a >= 1e-3) return `${+(v * 1000).toPrecision(3)}m`;
  if (a >= 1e-6) return `${+(v * 1e6).toPrecision(3)}µ`;
  return v.toExponential(1);
}
