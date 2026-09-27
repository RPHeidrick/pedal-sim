/**
 * Save and share boards.
 *  - "My boards": save the current board under a name, in this browser.
 *  - "Share": the whole board (pedals, knobs, switches, paint, names, and any Workshop
 *    pedals it uses) packed into a link. No server: everything is in the link itself,
 *    after the #, so it never even reaches a web server.
 */
const KEY = 'pedal-sim.myboards';

export function loadMyBoards() {
  try { const l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l.filter((b) => b && b.id && Array.isArray(b.board)) : []; } catch { return []; }
}
export function saveMyBoards(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** @param {{key,variant,values,bypass,finish,label,labels}[]} snaps @param {number} trim @param {Object[]} creations recipes of any custom pedals on the board */
export function encodeBoard(snaps, trim, creations = [], name = '') {
  const data = {
    v: 1, n: name || undefined, t: trim,
    p: snaps.map((s) => [s.key, s.variant || 0, s.labels, s.values.map((x) => Math.round(x * 1000) / 1000), s.bypass ? 1 : 0, s.finish || 0, s.label || 0]),
    c: creations.length ? creations.map((c) => [c.id, c.template, c.options, c.color, c.name]) : undefined,
  };
  return b64(JSON.stringify(data));
}

export function decodeBoard(str) {
  const d = JSON.parse(unb64(str));
  if (!d || d.v !== 1 || !Array.isArray(d.p)) throw new Error('not a Pedal Sim board link');
  // text from a link is shortened and flattened to one line (a new line could smuggle extra circuit lines in)
  const clean = (x, n = 40) => (typeof x === 'string' ? x.replace(/[\r\n\t"]/g, ' ').slice(0, n) : undefined);
  return {
    name: clean(d.n, 60) || '',
    trim: Number.isFinite(d.t) ? Math.max(-30, Math.min(24, d.t)) : null,
    board: d.p.slice(0, 16).map(([key, variant, labels, values, bypass, finish, label]) => ({
      key: clean(key, 60), variant: Number(variant) || 0,
      labels: Array.isArray(labels) ? labels.map((l) => clean(l)) : null,
      values: Array.isArray(values) ? values.map((v) => Math.max(0, Math.min(1, Number(v) || 0))) : null,
      bypass: !!bypass, finish: clean(finish || undefined), label: clean(label || undefined, 22),
    })).filter((p) => p.key),
    creations: Array.isArray(d.c) ? d.c.slice(0, 16).map(([id, template, options, color, name]) => ({
      id: clean(id, 20), template: clean(template), options: options && typeof options === 'object' ? options : {},
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : undefined, name: clean(name, 24) || 'Shared pedal',
    })).filter((c) => c.id) : [],
  };
}

export const boardLink = (code) => `${location.origin}${location.pathname}#b=${code}`;
