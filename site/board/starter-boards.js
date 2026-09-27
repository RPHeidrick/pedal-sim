/**
 * The row of boards above the chain: your saved boards first, then the starter boards
 * (site/board/presets.js) that suit the sound being played. Also the Save and Share buttons.
 */
import { $, didThing, prefs, savePrefs, toast, tourActive } from '../core.js';
import { PRESETS, RECOMMENDED } from './presets.js';
import { loadMyBoards, saveMyBoards, encodeBoard, boardLink } from './share.js';
import { entryByKey, registerCreations } from './library.js';
import { renderLibrary } from './library-ui.js';
import { board, boardDirty, markDirty, snapshot, replaceBoard, creationsOnBoard } from './chain.js';
import { fitZoom } from './zoom.js';
import { trim, ensureWet } from '../audio/output-rack.js';
import { currentGroup } from '../inputs/input-rack.js';
import { openMenu, closeMenu } from '../looks/theme.js';

let showAllBoards = false;
let myBoards = loadMyBoards();
const selectPresetButton = (id) => document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('selected', b.dataset.preset === id));

export function renderPresets() {
  const root = $('preset-row');
  root.replaceChildren();
  for (const mb of myBoards) root.append(myBoardButton(mb)); // your saved boards come first
  const group = currentGroup();
  // show the boards that suit the sound being played; the rest are one click away
  const list = showAllBoards ? PRESETS : PRESETS.filter((pr) => pr.suits.includes(group));
  for (const pr of list) {
    const b = document.createElement('button');
    b.className = 'preset';
    b.dataset.preset = pr.id;
    b.classList.toggle('selected', pr.id === prefs.preset);
    b.innerHTML = '<span class="preset-pedals" aria-hidden="true"></span><span class="preset-name"></span><span class="preset-text"></span>';
    b.querySelector('.preset-pedals').append(...pr.pedals.map((pp) => colourDot(entryByKey(pp.key))));
    b.querySelector('.preset-name').textContent = pr.name;
    b.querySelector('.preset-text').textContent = pr.text;
    if (showAllBoards && !pr.suits.includes(group)) b.classList.add('other');
    b.setAttribute('aria-label', `Load starter board: ${pr.name}`);
    b.addEventListener('click', () => loadPreset(pr));
    root.append(b);
  }
  const hidden = PRESETS.length - PRESETS.filter((pr) => pr.suits.includes(group)).length;
  $('presets-for').textContent = `Boards for ${group === 'acoustic' ? 'acoustic guitar' : group === 'bass' ? 'bass' : 'electric guitar'}.`;
  const more = $('presets-all');
  more.hidden = hidden === 0;
  more.textContent = showAllBoards ? 'Show only the boards for this sound' : `Show all ${PRESETS.length} boards`;
}
$('presets-all').addEventListener('click', () => { showAllBoards = !showAllBoards; renderPresets(); });

function colourDot(entry) { const d = document.createElement('span'); d.style.background = entry.color; return d; }

function myBoardButton(mb) {
  const b = document.createElement('div');
  b.className = 'preset mine-board';
  b.setAttribute('role', 'button'); b.tabIndex = 0;
  b.innerHTML = '<span class="preset-pedals" aria-hidden="true"></span><span class="preset-name"></span><span class="preset-text"></span><button class="mb-del" aria-label="Delete this saved board" title="Delete">×</button>';
  b.querySelector('.preset-pedals').append(...mb.board.map((pp) => entryByKey(pp.key)).filter(Boolean).map(colourDot));
  b.querySelector('.preset-name').textContent = mb.name;
  b.querySelector('.preset-text').textContent = `My board · ${mb.board.length} pedal${mb.board.length === 1 ? '' : 's'}`;
  const load = () => loadSaved(mb);
  b.addEventListener('click', (e) => { if (!e.target.closest('.mb-del')) load(); });
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(); } });
  b.querySelector('.mb-del').addEventListener('click', () => { myBoards = myBoards.filter((x) => x !== mb); saveMyBoards(myBoards); renderPresets(); toast(`Deleted "${mb.name}".`); });
  return b;
}

/** A sample of the other kind was picked: load a board that suits it, or offer one. */
export function suggestBoardFor(group) {
  const pr = PRESETS.find((x) => x.id === RECOMMENDED[group]);
  if (!pr) return;
  const onBoard = PRESETS.find((x) => x.id === prefs.preset);
  if (onBoard && onBoard.suits.includes(group) && !boardDirty) return; // already suitable
  const kind = group === 'acoustic' ? 'acoustic guitar' : 'electric guitar';
  if (!boardDirty) { loadPreset(pr, `Switched to "${pr.name}", a board that suits ${kind}.`); return; }
  toast(`Your board is set up for ${group === 'acoustic' ? 'electric' : 'acoustic'} guitar. "${pr.name}" suits ${kind} better.`, { label: 'Load it', run: () => loadPreset(pr) });
}

let presetBusy = false;
/** Load a starter board. The message bar offers Undo, which puts the old board back. */
async function loadPreset(pr, message = null) {
  if (presetBusy) return;
  presetBusy = true;
  const before = { board: board.map(snapshot), trim };
  try {
    await replaceBoard(pr.pedals.map((pp) => ({ key: pp.key, variant: pp.variant || 0, byLabel: pp.values })), pr.level);
    selectPresetButton(pr.id);
    ensureWet();
    savePrefs({ preset: pr.id });
    markDirty(false);
    toast(message || `Loaded "${pr.name}". Turn the knobs and see what changes.`, { label: 'Undo', run: () => {
      replaceBoard(before.board, before.trim);
      savePrefs({ preset: null });
      markDirty(true);
      selectPresetButton(null);
    } });
    didThing('preset');
    if (!tourActive()) setTimeout(() => { fitZoom(); }, 50);
  } finally { presetBusy = false; }
}

async function loadSaved(mb) {
  const before = { board: board.map(snapshot), trim };
  registerCreations(mb.creations || []);
  renderLibrary();
  await replaceBoard(mb.board, mb.trim);
  markDirty(false);
  selectPresetButton(null);
  toast(`Loaded "${mb.name}".`, { label: 'Undo', run: () => replaceBoard(before.board, before.trim) });
}

// --- Save and Share buttons ------------------------------------------------------------------
$('board-save').addEventListener('click', () => {
  const btn = $('board-save');
  if (btn.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
  if (!board.length) { toast('Add a pedal first, then save the board.'); return; }
  openMenu(btn, (pop) => {
    pop.classList.add('paint-pop');
    pop.innerHTML = '<h4>Save this board</h4><label>Name<input type="text" maxlength="28" placeholder="My crunch board"></label><div class="paint-actions"><span class="hint">Saved in this browser.</span><button class="text-btn" data-act="ok">Save</button></div>';
    const input = pop.querySelector('input');
    const ok = () => {
      const name = input.value.trim() || `My board ${myBoards.length + 1}`;
      myBoards = [{ id: Math.random().toString(36).slice(2, 9), name, board: board.map(snapshot), trim, creations: creationsOnBoard() }, ...myBoards].slice(0, 24);
      if (!saveMyBoards(myBoards)) toast('This browser would not save it (private window?).');
      closeMenu(); renderPresets();
      toast(`Saved "${name}". It is first in the starter boards.`);
      didThing('save');
    };
    pop.querySelector('[data-act=ok]').addEventListener('click', ok);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });
});

$('board-share').addEventListener('click', () => {
  const btn = $('board-share');
  if (btn.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
  if (!board.length) { toast('Add a pedal first, then share the board.'); return; }
  const link = boardLink(encodeBoard(board.map(snapshot), trim, creationsOnBoard()));
  openMenu(btn, (pop) => {
    pop.classList.add('paint-pop');
    pop.innerHTML = '<h4>Share this board</h4><p class="hint">Anyone who opens this link gets this exact board: pedals, knobs, paint and names. Nothing is uploaded: the board is inside the link.</p><label>Link<input type="text" readonly></label><div class="paint-actions"><span></span><button class="text-btn" data-act="copy">Copy link</button></div>';
    const input = pop.querySelector('input');
    input.value = link;
    input.addEventListener('focus', () => input.select());
    pop.querySelector('[data-act=copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); toast('Link copied. Paste it anywhere to share your board.'); closeMenu(); }
      catch { input.focus(); input.select(); toast('Press Ctrl+C to copy the link.'); }
    });
  });
});
