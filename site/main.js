/**
 * Start here: the page's entry point (index.html loads this file).
 *
 * Each part of the page lives in its own file; this one only connects them and starts up.
 *
 *   core.js                  shared helpers: $, audio, prefs, toast, hooks
 *   layout.js                folding panels, local preview badge
 *   board/library.js         the pedal library as data
 *   board/library-ui.js      the library cards below the board
 *   board/chain.js           the pedals on the board (add, remove, move, draw)
 *   board/info-card.js       the "i" card on each pedal
 *   board/starter-boards.js  starter boards, saved boards, Save and Share
 *   board/zoom.js            chain zoom
 *   inputs/input-rack.js     the Input panel (sample, live, digital, file)
 *   audio/output-rack.js     the Output panel, Power, meters, scope
 *   audio/audio.js           the browser audio graph; audio/pedal-worklet.js runs the pedals
 *   help/guide.js            the guided tour steps
 *   workshop/, build/        Pedal Workshop and "Build it yourself" sheets
 *   looks/                   themes, paint shop, motion effects, knobs
 *
 * Circuits are parsed here on the main thread and run in the audio worklet
 * (C++ engine compiled to WebAssembly, with a JavaScript fallback).
 */
import { $, audio, hooks, prefs, savePrefs, toast, didThing, tourActive } from './core.js';
import './layout.js';
import { entryByKey, registerEntry, unregisterEntry, registerCreations, netlistText } from './board/library.js';
import { renderLibrary, renderTypes } from './board/library-ui.js';
import { addPedal, reorderTo, renderChain, restore, save, markDirty, replaceBoard, oneAtATime, removeKeyFromBoard, renameKeyOnBoard } from './board/chain.js';
import { closeInfo } from './board/info-card.js';
import { renderPresets, suggestBoardFor } from './board/starter-boards.js';
import { zoom } from './board/zoom.js';
import { decodeBoard } from './board/share.js';
import { renderSamples, selectSource, restoreLive } from './inputs/input-rack.js';
import { setTrim } from './audio/output-rack.js';
import { startTour } from './help/guide.js';
import { hideTip } from './help/tips.js';
import { applyLook, mountLookPicker, closeMenu } from './looks/theme.js';
import { enableDrag } from './looks/fx.js';
import { mountWorkshop } from './workshop/ui.js';
import { openBuildSheet } from './build/ui.js';

// --- connect the parts ---------------------------------------------------------------------
/** "Build it yourself": parts, schematic, wiring, drill template and steps for any pedal. */
hooks.openBuild = (entry, variant = 0) => {
  closeInfo(); hideTip(); closeMenu();
  openBuildSheet($('build-sheet'), entry, variant, netlistText)
    .then(() => didThing('build'))
    .catch((e) => toast(`Could not make the build sheet: ${e.message || e}`));
};
/** Picking an acoustic sample offers acoustic boards, and so on. */
hooks.onSoundGroupChange = (group) => { renderPresets(); if (!tourActive()) suggestBoardFor(group); };

// Pedal Workshop: describe your sound, build a pedal, your creations
mountWorkshop($('workshop'), {
  openBuild: (e) => hooks.openBuild(e, 0),
  entryByKey, registerEntry, unregisterEntry,
  addPedal: (key) => addPedal(key).then(() => { markDirty(); didThing('pedal'); $('board').scrollIntoView({ behavior: 'smooth', block: 'start' }); }),
  removeFromBoard: removeKeyFromBoard,
  renameOnBoard: renameKeyOnBoard,
  loadBoard: async (r) => {
    await replaceBoard(r.pedals.map((p) => ({ key: p.key, variant: p.variant || 0, byLabel: p.values })), r.level);
    markDirty(); savePrefs({ preset: null });
    document.querySelectorAll('.preset').forEach((b) => b.classList.remove('selected'));
    $('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`Loaded "${r.name}". Press Power on if it is off, then turn the knobs to taste.`);
  },
  toast,
  afterChange: () => renderLibrary(),
});

// look (theme): applied early by index.html; the header button switches it
mountLookPicker($('look'), () => document.documentElement.dataset.theme, (id) => { applyLook(id); savePrefs({ look: id }); });
// drag pedals to reorder them
enableDrag($('chain-inner'), { getScale: () => zoom, onDrop: reorderTo, onStart: () => { closeInfo(); hideTip(); closeMenu(); } });

// --- first draw ----------------------------------------------------------------------------
renderTypes();
renderSamples();
renderPresets();
renderLibrary();
renderChain();
if (!prefs.tourSeen) setTimeout(startTour, 800); // first visit: offer the guide
if (prefs.source === 'digital') selectSource('digital');
else if (prefs.source === 'live') restoreLive();
// once the page has settled, download the engine and the sample so Power on is instant
setTimeout(() => (window.requestIdleCallback || ((f) => f()))(() => audio.prefetch()), 1500);

// --- which board to show: a shared link, else last visit's board, else the default pedal -----------
const saved = restore();
const shared = (() => { // a shared board link: #b=...
  const m = location.hash.match(/^#b=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { return decodeBoard(m[1]); } catch { toast('That board link could not be read. It may have been cut short when it was copied.'); return null; }
})();
oneAtATime(async () => {
  if (shared) {
    registerCreations(shared.creations);
    renderLibrary();
    for (const s of shared.board) await addPedal(s.key, s);
    if (shared.trim != null) setTrim(shared.trim);
    save(); markDirty(true);
    history.replaceState(null, '', location.pathname + location.search);
    toast(`Loaded a shared board${shared.name ? ` "${shared.name}"` : ''}. Press Power on to hear it. Save it with the disk button to keep it.`);
  } else if (saved && saved.length) for (const s of saved) await addPedal(s.key, s);
  else await addPedal('reverse-parallel-fuzz');
});
