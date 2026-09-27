/**
 * The pedal library as data: which pedals exist, their names, colours and knob help.
 * No drawing here (that is library-ui.js), so any file can look pedals up.
 *
 * An "entry" is one pedal in the library. Circuits that share a box with a switch
 * (Reverse Parallel Fuzz: Si / Ge) become one entry with several "variants".
 */
import { STARTER_PEDALS, EFFECT_TYPES, knobRole, starterUrl } from '../../circuits/index.js';
import { loadNetlist } from '../../engine/parsers/elaborate.js';
import { creationEntry } from '../workshop/store.js';

// Pedals that share an enclosure with a variant switch, keyed by `family` in circuits/index.js
const FAMILIES = {
  'reverse-parallel-fuzz': { name: 'Reverse Parallel Fuzz', color: '#c97a2c', switchLabel: 'Transistors', type: 'fuzz',
    blurb: 'My Reverse Parallel Fuzz: two three transistor fuzz circuits of opposite polarity in one box. Flip between silicon NPN and germanium PNP; the knobs stay where you left them.',
    sounds: 'Thick, buzzy 60s style fuzz. Flip to Si for a brighter bite, or Ge for a softer, rounder fuzz.',
    knobs: {
      Gain: 'How much fuzz. Low is a gritty crunch, high is a thick, singing wall of sound.',
      Mod: 'The texture of the fuzz. Lower is thinner and more touch sensitive, higher is thicker and more saturated.',
      Volume: 'How loud the pedal is when it is on. Match it to the bypassed sound, or turn it up for a lift.',
    } },
};
/** Short labels for the variant switch on the pedal. */
export const VARIANT_LABEL = { 'rp-fuzz-si': 'Si', 'rp-fuzz-ge': 'Ge' };

/** Every library entry, built-in first; Workshop creations are added with registerEntry. */
export const entries = [];
for (const p of STARTER_PEDALS) {
  if (p.family) {
    let e = entries.find((x) => x.key === p.family);
    if (!e) { e = { key: p.family, ...FAMILIES[p.family], category: p.category, origin: p.origin, variants: [] }; entries.push(e); }
    e.variants.push(p);
  } else entries.push({ key: p.id, name: p.name, color: p.color, blurb: p.blurb, sounds: p.sounds, knobs: p.knobs || {}, type: p.type, category: p.category, origin: p.origin, variants: [p] });
}
export const entryByKey = (k) => entries.find((e) => e.key === k);

/** Pedals made in the Pedal Workshop join the library here (hidden ones only exist for "Try it"). */
export function registerEntry(e, { hidden = false } = {}) { unregisterEntry(e.key); e.hidden = hidden; entries.push(e); }
export function unregisterEntry(key) { const i = entries.findIndex((e) => e.key === key); if (i >= 0) entries.splice(i, 1); }
/** Workshop recipes that came with a saved board or a shared link. */
export function registerCreations(list) { for (const c of list) if (!entryByKey(`custom:${c.id}`)) { try { registerEntry(creationEntry(c)); } catch { /* unknown template */ } } }

// --- words shown to the visitor ----------------------------------------------------------------
export const typeName = (id) => (EFFECT_TYPES.find((t) => t.id === id) || {}).name || '';
export const knobHelp = (entry, label) => {
  const k = Object.keys(entry.knobs || {}).find((x) => x.toLowerCase() === label.toLowerCase());
  return k ? entry.knobs[k] : '';
};
/** "GAIN" -> "Gain" */
export const niceLabel = (l) => l.charAt(0) + l.slice(1).toLowerCase();
/** "Same job as Gain and Fuzz on other pedals." for a Drive knob, and so on */
export const sameJob = (label) => {
  const r = knobRole(label);
  if (!r || !r.others.length) return '';
  return `Same job as ${r.others.join(' and ')} on other pedals.`;
};

// --- circuits -------------------------------------------------------------------------------
/** The netlist text for a variant (Workshop pedals carry theirs; library ones are fetched). */
export const netlistText = async (v) => v.netlist || (await fetch(starterUrl(v.file))).text();

const descCache = new Map();
/** Parse a variant's netlist into a circuit description the engine can run (cached). */
export async function loadDesc(variant) {
  if (descCache.has(variant.id)) return descCache.get(variant.id);
  const desc = loadNetlist(await netlistText(variant), { fileName: variant.file });
  if (!desc.ok) throw new Error(`${variant.name}: ${desc.diagnostics.filter((d) => d.level === 'error').map((d) => d.message).join('; ')}`);
  descCache.set(variant.id, desc);
  return desc;
}
