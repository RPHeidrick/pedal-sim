/**
 * Your creations from the Pedal Workshop, kept in this browser (localStorage).
 * A creation is only its recipe (template + choices + name + colour); the netlist is rebuilt
 * from the template each time, so creations keep working when the engine improves.
 */
import { templateById, buildNetlist, defaults } from './templates.js';

const KEY = 'pedal-sim.creations';

export function loadCreations() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    // Keep only creations this version can still build: known template, and every stored
    // choice still one of that template's choices (a renamed choice would otherwise crash the page).
    return Array.isArray(list) ? list.filter((c) => {
      const t = c && c.id && templateById(c.template);
      if (!t) return false;
      return Object.entries(c.options || {}).every(([k, v]) => { const o = t.options.find((x) => x.id === k); return !o || o.choices.some((ch) => ch.id === v); });
    }) : [];
  } catch { return []; }
}
export function saveCreations(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable: fine for this visit */ }
}
export const newId = () => Math.random().toString(36).slice(2, 9);

/** Library entry for a creation (same shape as the built in ones). */
export function creationEntry(c) {
  const t = templateById(c.template);
  const o = { ...defaults(t), ...c.options };
  const netlist = buildNetlist(t, o, c.name);
  const recipe = t.options.map((x) => x.choices.find((y) => y.id === o[x.id]).name).join(' · ');
  const variantId = `custom:${c.id}:${hash(netlist)}`;
  return {
    key: `custom:${c.id}`, name: c.name, color: c.color || t.color, type: t.type, category: 'gain', origin: 'custom',
    blurb: `${t.name}: ${recipe}. Made in the Pedal Workshop.`, sounds: '', knobs: t.knobs || {},
    variants: [{ id: variantId, name: c.name, netlist, file: `${slug(c.name)}.cir` }], creation: c,
  };
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-pedal';
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
