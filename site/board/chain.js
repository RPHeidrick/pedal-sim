/**
 * The pedal chain: which pedals are on the board, in what order, and how they are drawn.
 *
 * `board` is the single source of truth. Every change follows the same three steps:
 *   1. change `board`
 *   2. tell the audio thread (audio.send: add / remove / order / control / bypass)
 *   3. redraw (renderChain) and remember it (save)
 * so the picture, the sound and the saved copy always agree.
 */
import { $, audio, didThing, prefs, savePrefs, toast } from '../core.js';
import { entries, entryByKey, loadDesc, typeName, knobHelp, niceLabel, sameJob, VARIANT_LABEL } from './library.js';
import { closeInfo, toggleInfo } from './info-card.js';
import { zoom } from './zoom.js';
import { setTrim } from '../audio/output-rack.js';
import { createKnob } from '../looks/knob.js';
import { attachTip, hideTip } from '../help/tips.js';
import { openMenu, closeMenu } from '../looks/theme.js';
import { burst, flip, reducedMotion } from '../looks/fx.js';
import { openPaintShop } from '../looks/paint.js';

/** @type {{uid:number, key:string, variant:number, desc:Object, values:number[], bypass:boolean, finish?:string, label?:string}[]} */
export let board = [];
let nextUid = 1;

// "Dirty" = the visitor has shaped this board themselves (added, removed, moved pedals or
// turned knobs). An untouched board may be swapped for one that suits a new sample; a
// dirty one is never replaced without asking.
export let boardDirty = !!prefs.boardDirty;
export const markDirty = (d = true) => { if (boardDirty !== d) { boardDirty = d; savePrefs({ boardDirty: d }); } };

// --- saving -------------------------------------------------------------------------------
export function save() {
  try {
    localStorage.setItem('pedal-sim.board', JSON.stringify(board.map(snapshot)));
  } catch { /* storage unavailable: fine */ }
}
let saveTimer = 0;
/** Save a moment later (a knob drag would otherwise save dozens of times a second). */
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = 0; save(); }, 400); }
addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); save(); } }); // a knob turned just before leaving is kept

/** Everything needed to rebuild a pedal: knobs by label, switch, finish and name. */
export function snapshot(p) {
  return { key: p.key, variant: p.variant, values: p.values.slice(), bypass: p.bypass, labels: p.desc.controls.map((c) => c.label), finish: p.finish, label: p.label };
}

/** The board saved on the last visit, or null. */
export function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem('pedal-sim.board') || 'null');
    return Array.isArray(saved) ? saved : null;
  } catch { return null; }
}

/** Custom (Workshop) pedals on the board, so a saved or shared board can rebuild them. */
export const creationsOnBoard = () => [...new Set(board.map((p) => p.key).filter((k) => k.startsWith('custom:')))].map((k) => (entryByKey(k) || {}).creation).filter(Boolean);

// --- changing the board --------------------------------------------------------------------
let enterUid = 0; // the pedal that just arrived gets the drop-in animation

/** Add a pedal to the end of the chain. Knob values can be given by position or by label. */
export async function addPedal(key, { variant = 0, values = null, bypass = false, labels = null, finish, label, animate = true } = {}) {
  const entry = entryByKey(key);
  if (!entry) return;
  if (!entry.variants[variant]) variant = 0; // e.g. a damaged share link
  try {
    const desc = await loadDesc(entry.variants[variant]);
    const vals = desc.controls.map((c, i) => {
      if (values && labels) { const j = labels.indexOf(c.label); if (j >= 0) return values[j]; }
      return values && values[i] != null ? values[i] : c.value;
    });
    const p = { uid: nextUid++, key, variant, desc, values: vals, bypass, finish, label };
    board.push(p);
    audio.send({ type: 'add', uid: p.uid, desc, controls: vals, bypass });
    if (animate) enterUid = p.uid;
    renderChain();
    enterUid = 0;
    save();
  } catch (err) { toast(String(err.message || err)); }
}

/** Flip a pedal's variant switch (Si / Ge). Knobs keep their positions by label. */
async function switchVariant(p, variant) {
  const entry = entryByKey(p.key);
  const desc = await loadDesc(entry.variants[variant]);
  const byLabel = new Map(p.desc.controls.map((c, i) => [c.label, p.values[i]]));
  p.values = desc.controls.map((c) => (byLabel.has(c.label) ? byLabel.get(c.label) : c.value));
  p.desc = desc;
  p.variant = variant;
  audio.send({ type: 'replace', uid: p.uid, desc, controls: p.values });
  renderChain();
  save();
}

function removePedal(p) {
  markDirty();
  // Take it off the board (and out of the audio) straight away, so the board, the saved
  // copy and the sound always agree, even if something else redraws the chain while the
  // goodbye animation is still playing.
  board = board.filter((x) => x !== p);
  audio.send({ type: 'remove', uid: p.uid });
  save();
  const el = document.querySelector(`#chain .pedal[data-key="${p.uid}"]`);
  const finish = () => flip($('chain-inner'), '.pedal, .jack, .add-slot', renderChain, { scale: zoom });
  if (!el || reducedMotion()) { finish(); return; }
  closeInfo(); closeMenu();
  burst(el);
  el.classList.add('leaving');
  el.addEventListener('animationend', () => { if (el.isConnected) finish(); }, { once: true });
}

function movePedal(p, dir) {
  markDirty();
  const i = board.indexOf(p), j = i + dir;
  if (j < 0 || j >= board.length) return;
  [board[i], board[j]] = [board[j], board[i]];
  audio.send({ type: 'order', uids: board.map((x) => x.uid) });
  flip($('chain-inner'), '.pedal, .jack, .add-slot', renderChain, { scale: zoom });
  save();
}

/** Drag and drop reorder: the page already shows the new order; make the board match. */
export function reorderTo(uids) {
  const next = uids.map((u) => board.find((p) => p.uid === u)).filter(Boolean);
  if (next.length !== board.length || next.every((p, i) => p === board[i])) { renderChain(); return; }
  markDirty();
  board = next;
  audio.send({ type: 'order', uids: board.map((x) => x.uid) });
  renderChain();
  save();
  didThing('move');
}

/** Workshop: a creation was deleted, so take it off the board. */
export function removeKeyFromBoard(key) {
  const gone = board.filter((p) => p.key === key);
  if (!gone.length) return;
  for (const p of gone) audio.send({ type: 'remove', uid: p.uid });
  board = board.filter((p) => p.key !== key);
  renderChain(); save();
}
/** Workshop: a creation was edited and got a new key. */
export function renameKeyOnBoard(from, to) {
  let n = 0;
  for (const p of board) if (p.key === from) { p.key = to; n++; }
  if (n) { renderChain(); save(); }
}

// --- swapping the whole board ------------------------------------------------------------------
let boardQueue = Promise.resolve();
/** Run board swaps one after another, never interleaved (two quick clicks would merge two boards). */
export function oneAtATime(job) {
  const run = boardQueue.then(job, job);
  boardQueue = run.catch(() => {});
  return run;
}
/**
 * Swap the whole chain. Items: {key, variant, values?, labels?, bypass?, byLabel?}.
 * `levelMatch` (dB) evens out its loudness; your Volume is untouched.
 */
export function replaceBoard(items, levelMatch) { return oneAtATime(() => replaceBoardNow(items, levelMatch)); }
async function replaceBoardNow(items, levelMatch) {
  for (const p of board) audio.send({ type: 'remove', uid: p.uid });
  board = [];
  renderChain();
  for (const it of items) {
    let { values, labels } = it;
    if (it.byLabel) { labels = Object.keys(it.byLabel); values = labels.map((l) => it.byLabel[l]); }
    await addPedal(it.key, { variant: it.variant || 0, values, labels, bypass: !!it.bypass, finish: it.finish, label: it.label });
  }
  if (levelMatch != null) setTrim(levelMatch);
  save();
}

// --- drawing ---------------------------------------------------------------------------------
/** Redraw the whole chain: Guitar jack, cable, pedal, cable, ..., Add pedal slot, Amp jack. */
export function renderChain() {
  closeInfo();
  const root = $('chain-inner');
  root.replaceChildren();
  root.append(jack('Guitar'));
  if (!board.length) {
    const empty = document.createElement('div');
    empty.className = 'chain-empty';
    empty.innerHTML = 'No pedals yet. <a href="#library">Add one from the library</a>.';
    root.append(cable(), empty);
  }
  board.forEach((p, i) => {
    const c = cable();
    if (p.uid === enterUid) c.classList.add('plug-in');
    root.append(c, pedalEl(p, i));
  });
  if (board.length) root.append(cable(), addSlot());
  root.append(cable(), jack('Amp'));
}

/** An empty slot at the end of the board: click it to pick a pedal without scrolling. */
function addSlot() {
  const b = document.createElement('button');
  b.className = 'add-slot';
  b.dataset.key = 'add-slot';
  b.innerHTML = '<span class="add-plus" aria-hidden="true">+</span><span>Add pedal</span>';
  b.title = 'Add a pedal to the end of the chain';
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
    closeInfo(); hideTip();
    openMenu(b, (pop) => {
      pop.classList.add('pick-pop');
      pop.setAttribute('aria-label', 'Pick a pedal');
      pop.innerHTML = '<h4>Pick a pedal</h4>';
      for (const e of entries.filter((x) => !x.hidden)) {
        const o = document.createElement('button');
        o.className = 'pick-opt';
        o.style.setProperty('--pedal', e.color);
        o.innerHTML = '<span class="pick-swatch" aria-hidden="true"></span><span><b></b><small></small></span>';
        o.querySelector('b').textContent = e.name;
        o.querySelector('small').textContent = `${typeName(e.type)}${e.origin === 'original' ? ' · My design' : ''}`;
        o.addEventListener('click', () => { closeMenu(); addPedal(e.key).then(() => { markDirty(); didThing('pedal'); }); });
        pop.append(o);
      }
    });
  });
  return b;
}

function jack(label) {
  const d = document.createElement('div');
  d.className = 'jack';
  d.dataset.key = `jack-${label}`;
  d.innerHTML = `<span class="jack-plug" aria-hidden="true"></span><span>${label}</span>`;
  return d;
}
function cable() { const d = document.createElement('div'); d.className = 'cable'; d.setAttribute('aria-hidden', 'true'); return d; }

/** One pedal: tools on top, knobs, variant switch, name, LED and footswitch. */
function pedalEl(p, index) {
  const entry = entryByKey(p.key);
  const el = document.createElement('article');
  el.className = 'pedal grabbable';
  el.dataset.key = String(p.uid);
  if (p.finish) el.dataset.finish = p.finish;
  if (p.uid === enterUid && !reducedMotion()) {
    el.classList.add('enter');
    el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  }
  el.classList.toggle('off', p.bypass);
  el.style.setProperty('--pedal', entry.color);
  const pots = p.desc.controls.filter((c) => c.kind === 'pot').length;
  el.style.setProperty('--cols', String(pots <= 4 ? Math.max(pots, 2) : 3));
  el.innerHTML = `
    <button class="pedal-info" aria-label="What does this pedal do?" aria-expanded="false">i</button>
    <div class="pedal-tools">
      <button class="tool" data-act="paint" title="Paint shop: change the finish and the name on the box" aria-label="Paint shop" aria-haspopup="dialog"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M10.6 1.2a1.5 1.5 0 0 1 2.1 0l2.1 2.1a1.5 1.5 0 0 1 0 2.1L8.4 11.8 4.2 7.6zM3.5 8.3l4.2 4.2-.7.7c-.8.8-2 1-3 .6L1.3 15a.5.5 0 0 1-.7-.7l1.2-2.6c-.4-1-.2-2.2.6-3z"/></svg></button>
      <button class="tool" data-act="left" title="Move earlier (or drag the pedal)" aria-label="Move earlier">‹</button>
      <button class="tool" data-act="right" title="Move later" aria-label="Move later">›</button>
      <button class="tool" data-act="remove" title="Remove" aria-label="Remove">×</button>
    </div>
    <div class="pedal-knobs"></div>
    <div class="pedal-variant"></div>
    <div class="pedal-name"></div>
    <div class="pedal-led" aria-hidden="true"></div>
    <button class="footswitch" aria-pressed="${!p.bypass}"></button>`;
  el.querySelector('.pedal-name').textContent = p.label || entry.name;
  el.setAttribute('aria-label', p.label ? `${p.label} (${entry.name})` : entry.name);

  // footswitch: bypass on / off
  const fs = el.querySelector('.footswitch');
  fs.setAttribute('aria-label', `${entry.name} ${p.bypass ? 'bypassed' : 'on'}`);
  fs.addEventListener('click', () => {
    p.bypass = !p.bypass;
    el.classList.toggle('off', p.bypass);
    fs.setAttribute('aria-pressed', String(!p.bypass));
    fs.setAttribute('aria-label', `${entry.name} ${p.bypass ? 'bypassed' : 'on'}`);
    audio.send({ type: 'bypass', uid: p.uid, on: p.bypass });
    el.classList.remove('stomp'); void el.offsetWidth; el.classList.add('stomp');
    save();
    didThing('bypass');
  });
  attachTip(fs, () => (p.bypass ? 'Off: the guitar goes straight through. Click to switch the pedal on.' : 'On: click to switch the pedal off and hear the difference.'));

  // tools: info, move, remove, paint
  const info = el.querySelector('.pedal-info');
  info.addEventListener('click', (e) => { e.stopPropagation(); toggleInfo(p, info); });
  el.querySelector('[data-act=left]').disabled = index === 0;
  el.querySelector('[data-act=right]').disabled = index === board.length - 1;
  el.querySelector('[data-act=left]').addEventListener('click', () => movePedal(p, -1));
  el.querySelector('[data-act=right]').addEventListener('click', () => movePedal(p, 1));
  el.querySelector('[data-act=remove]').addEventListener('click', () => removePedal(p));
  const paintBtn = el.querySelector('[data-act=paint]');
  paintBtn.addEventListener('click', (e) => {
    e.stopPropagation(); closeInfo(); hideTip();
    if (paintBtn.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
    openPaintShop(paintBtn, p, entry, () => {
      if (p.finish) el.dataset.finish = p.finish; else delete el.dataset.finish;
      el.querySelector('.pedal-name').textContent = p.label || entry.name;
      markDirty(); saveSoon(); didThing('paint');
    });
  });

  // knobs
  const knobs = el.querySelector('.pedal-knobs');
  p.desc.controls.forEach((c, i) => {
    if (c.kind !== 'pot') return;
    const k = createKnob({
      label: niceLabel(c.label),
      value: p.values[i], defaultValue: c.value,
      onChange: (v) => { p.values[i] = v; audio.send({ type: 'control', uid: p.uid, index: i, value: v }); saveSoon(); markDirty(); didThing('knob'); },
    });
    const help = knobHelp(entry, c.label);
    if (help) attachTip(k.el, `${niceLabel(c.label)}: ${help} ${sameJob(c.label)}`.trim());
    knobs.append(k.el);
  });

  // variant switch (only pedals with more than one circuit, e.g. Si / Ge)
  if (entry.variants.length > 1) {
    const sw = el.querySelector('.pedal-variant');
    sw.setAttribute('role', 'radiogroup');
    sw.setAttribute('aria-label', entry.switchLabel || 'Variant');
    entry.variants.forEach((v, vi) => {
      const b = document.createElement('button');
      b.textContent = VARIANT_LABEL[v.id] || v.name;
      b.title = v.name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(vi === p.variant));
      b.addEventListener('click', () => { if (vi !== p.variant) switchVariant(p, vi).catch((e) => toast(String(e.message || e))); });
      sw.append(b);
    });
    const sub = document.createElement('div');
    sub.className = 'pedal-sub';
    sub.textContent = entry.variants[p.variant].name.replace(/^.*·\s*/, '') === 'Si' ? 'Silicon NPN · 2N3904' : 'Germanium PNP · 2N1309';
    el.querySelector('.pedal-name').after(sub);
  }
  return el;
}
