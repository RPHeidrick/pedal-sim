/**
 * Tiny SVG line plot for Node tools (waveforms, transfer curves).
 * series: [{ x?: ArrayLike<number>, y: ArrayLike<number>, color, label }]
 */
export function svgPlot(series, { width = 900, height = 320, title = '', xlabel = '', ylabel = '' } = {}) {
  const m = { l: 60, r: 16, t: 34, b: 40 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.y.length; i++) {
      const x = s.x ? s.x[i] : i;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, s.y[i]); y1 = Math.max(y1, s.y[i]);
    }
  }
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06;
  y0 -= pad; y1 += pad;
  const sx = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * w;
  const sy = (y) => m.t + h - ((y - y0) / (y1 - y0)) * h;
  const fmt = (v) => (Math.abs(v) >= 100 || v === 0 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="monospace" font-size="11">`;
  out += '<rect width="100%" height="100%" fill="#16181c"/>';
  out += `<text x="${m.l}" y="20" fill="#e8e6e1" font-size="13">${esc(title)}</text>`;
  for (let k = 0; k <= 4; k++) {
    const yv = y0 + ((y1 - y0) * k) / 4;
    const yy = sy(yv);
    out += `<line x1="${m.l}" x2="${m.l + w}" y1="${yy}" y2="${yy}" stroke="#2c3036"/>`;
    out += `<text x="${m.l - 6}" y="${yy + 4}" fill="#8b9098" text-anchor="end">${fmt(yv)}</text>`;
    const xv = x0 + ((x1 - x0) * k) / 4;
    out += `<text x="${sx(xv)}" y="${m.t + h + 16}" fill="#8b9098" text-anchor="middle">${fmt(xv)}</text>`;
  }
  if (y0 < 0 && y1 > 0) out += `<line x1="${m.l}" x2="${m.l + w}" y1="${sy(0)}" y2="${sy(0)}" stroke="#4a4f57"/>`;
  out += `<text x="${m.l + w / 2}" y="${height - 6}" fill="#8b9098" text-anchor="middle">${esc(xlabel)}</text>`;
  out += `<text x="14" y="${m.t + h / 2}" fill="#8b9098" transform="rotate(-90 14 ${m.t + h / 2})" text-anchor="middle">${esc(ylabel)}</text>`;
  series.forEach((s, si) => {
    const n = s.y.length;
    const step = Math.max(1, Math.floor(n / (w * 2)));
    let d = '';
    for (let i = 0; i < n; i += step) d += `${i ? 'L' : 'M'}${sx(s.x ? s.x[i] : i).toFixed(1)},${sy(s.y[i]).toFixed(1)}`;
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.4"/>`;
    out += `<text x="${m.l + w - 8}" y="${m.t + 14 + si * 14}" fill="${s.color}" text-anchor="end">${esc(s.label || '')}</text>`;
  });
  return `${out}</svg>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
