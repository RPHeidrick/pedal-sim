/**
 * The Digital guitar deck under the pedalboard: chord pads, Auto strum and a fretboard.
 * Chords come in pages (Open, 7ths, Sus & add, Barre & power) of at most 12 pads.
 * Keys: 1 to 9, 0, - and = strum the pads on the page shown; Space starts or stops Auto strum.
 */
import { DigitalGuitar, OPEN_STRINGS, FRETS, CHORDS, CHORD_SETS, PATTERNS, PROGRESSIONS, noteName } from './digital.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

export function mountDigitalDeck(root, { audio, ensureReady, onPlay }) {
  const gtr = new DigitalGuitar(audio);
  let chord = CHORDS.find((c) => c.id === 'Em');
  let page = CHORD_SETS[0].id;
  const onPage = () => CHORDS.filter((c) => c.set === page);
  let mute = false;
  root.innerHTML = `
    <div class="deck-head">
      <div><h2>Digital guitar</h2><p class="dim">Real recorded guitar notes, played through your pedals. Click a chord, turn on Auto strum, or tap the fretboard.</p></div>
      <div class="deck-tools">
        <button class="toggle" data-act="rhythm" aria-pressed="false" title="Keep a rhythm going on the chosen chord (Space)">▶ Auto strum</button>
        <label class="field inline"><span>Rhythm</span><select data-el="pattern"></select></label>
        <label class="field inline"><span>Chords</span><select data-el="prog"></select></label>
        <label class="field inline deck-tempo"><span>Tempo <output class="mono" data-el="bpm-val">96</output></span><input type="range" min="60" max="170" step="1" value="96" data-el="bpm"></label>
        <label class="check"><input type="checkbox" data-el="mute"> Palm mute</label>
      </div>
    </div>
    <div class="chord-sets seg" role="tablist" aria-label="Chord pages"></div>
    <div class="pads" role="group" aria-label="Chords"></div>
    <div class="fretboard" role="group" aria-label="Fretboard: click a fret to play a note"></div>
    <p class="hint deck-credit">Notes: FreePats "Electric Guitar FSBS (direct)", a single coil electric guitar recorded straight into an interface, public domain (CC0). Keys 1 to 9, 0, - and = strum the chords on the page shown (Shift for an up strum); Space starts Auto strum.</p>`;
  const $ = (s) => root.querySelector(s);
  const pads = $('.pads');
  const padEls = new Map();
  function drawPads() {
    pads.replaceChildren(); padEls.clear();
    onPage().forEach((c, i) => {
      const b = document.createElement('button');
      b.className = `pad${c.power ? ' power-chord' : ''}${c.id === chord.id ? ' on' : ''}`;
      b.innerHTML = `<b>${c.name}</b><small>${c.kind}</small><kbd>${KEYS[i]}</kbd>`;
      b.title = `${c.name}: click to strum (key ${KEYS[i]}, Shift for an up strum)`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); playChord(c, e.shiftKey ? 'U' : 'D'); });
      pads.append(b); padEls.set(c.id, b);
    });
  }
  const sets = $('.chord-sets');
  for (const cs of CHORD_SETS) {
    const b = document.createElement('button');
    b.setAttribute('role', 'tab'); b.dataset.set = cs.id; b.textContent = cs.name;
    b.setAttribute('aria-selected', String(cs.id === page));
    b.addEventListener('click', () => {
      page = cs.id;
      sets.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.set === page)));
      drawPads();
    });
    sets.append(b);
  }
  drawPads();
  const sel = (el, list) => { for (const x of list) el.append(new Option(x.name, x.id)); };
  sel($('[data-el=pattern]'), PATTERNS);
  sel($('[data-el=prog]'), PROGRESSIONS);
  $('[data-el=pattern]').value = 'pop';
  const bpm = $('[data-el=bpm]');
  bpm.addEventListener('input', () => { $('[data-el=bpm-val]').textContent = bpm.value; });
  $('[data-el=mute]').addEventListener('change', (e) => { mute = e.target.checked; });

  // fretboard: high e on top, like tab
  const fb = $('.fretboard');
  const cells = [];
  for (let s = 5; s >= 0; s--) {
    const row = document.createElement('div');
    row.className = 'string-row';
    row.style.setProperty('--gauge', `${1 + (5 - s) * 0.35}px`);
    cells[s] = [];
    for (let f = 0; f <= FRETS; f++) {
      const m = OPEN_STRINGS[s] + f;
      const c = document.createElement('button');
      c.className = f === 0 ? 'fret open' : 'fret';
      c.setAttribute('aria-label', `${noteName(m)}, string ${6 - s}, ${f ? `fret ${f}` : 'open'}`);
      c.dataset.note = noteName(m).replace(/\d/, '');
      c.addEventListener('pointerdown', async (e) => { e.preventDefault(); if (await ready()) gtr.pluck(s, m, { mute }); });
      cells[s].push(c); row.append(c);
    }
    fb.append(row);
  }
  const marks = document.createElement('div');
  marks.className = 'fret-marks';
  for (let f = 0; f <= FRETS; f++) { const d = document.createElement('span'); d.textContent = [3, 5, 7, 9, 15].includes(f) ? '•' : f === 12 ? '••' : ''; marks.append(d); }
  fb.append(marks);
  gtr.onNote = (s, m) => {
    const f = m - OPEN_STRINGS[s];
    const c = cells[s] && cells[s][f];
    if (!c) return;
    c.classList.remove('ring'); void c.offsetWidth; c.classList.add('ring');
  };

  async function ready() {
    try {
      await ensureReady();
      await gtr.load();
      onPlay && onPlay();
      return true;
    } catch (e) { return false; }
  }
  async function playChord(c, dir = 'D') {
    chord = c;
    padEls.forEach((b, id) => b.classList.toggle('on', id === c.id));
    const b = padEls.get(c.id);
    if (b) { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); }
    if (!(await ready())) return;
    if (!gtr.rhythmOn) gtr.strum(c, { dir, mute });
  }

  const rhythmBtn = $('[data-act=rhythm]');
  async function toggleRhythm() {
    if (gtr.rhythmOn) { gtr.stopRhythm(); rhythmBtn.setAttribute('aria-pressed', 'false'); rhythmBtn.textContent = '▶ Auto strum'; return; }
    if (!(await ready())) return;
    rhythmBtn.setAttribute('aria-pressed', 'true'); rhythmBtn.textContent = '■ Stop';
    gtr.startRhythm({
      getBpm: () => Number(bpm.value),
      getPattern: () => PATTERNS.find((p) => p.id === $('[data-el=pattern]').value),
      getChord: (bar) => {
        const prog = PROGRESSIONS.find((p) => p.id === $('[data-el=prog]').value);
        if (!prog.chords) return chord;
        return CHORDS.find((c) => c.id === prog.chords[bar % prog.chords.length]);
      },
      onBar: (bar) => {
        const prog = PROGRESSIONS.find((p) => p.id === $('[data-el=prog]').value);
        const id = prog.chords ? prog.chords[bar % prog.chords.length] : chord.id;
        setTimeout(() => padEls.forEach((b, k) => b.classList.toggle('on', k === id)), 60);
      },
    });
  }
  rhythmBtn.addEventListener('click', toggleRhythm);

  const onKey = (e) => {
    if (root.hidden || e.target.closest('input, select, textarea, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open], .tour-card')) return;
    const i = KEYS.indexOf(e.key);
    const c = i >= 0 && onPage()[i];
    if (c) { e.preventDefault(); playChord(c, e.shiftKey ? 'U' : 'D'); }
    else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); toggleRhythm(); }
  };
  document.addEventListener('keydown', onKey);
  return { guitar: gtr, stop: () => { gtr.stopAll(); rhythmBtn.setAttribute('aria-pressed', 'false'); rhythmBtn.textContent = '▶ Auto strum'; } };
}
