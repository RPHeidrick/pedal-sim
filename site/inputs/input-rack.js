/**
 * The Input panel (left of the board): what goes into the pedals.
 *
 *   Sample   looped recordings (yours first, then CC0 ones)
 *   Live     a guitar through an audio interface or a USB guitar cable
 *   Digital  chord pads, Auto strum and a fretboard
 *   File     any WAV / MP3 from the visitor's computer
 *
 * Plus the Input level slider and the "Plug in your guitar" setup.
 */
import { $, audio, dB, didThing, hooks, prefs, savePrefs, toast } from '../core.js';
import { SAMPLES, SAMPLE_GROUPS, DEFAULT_SAMPLE, MY_SLOTS, sampleById } from './samples.js';
import { mountDigitalDeck } from './digital-ui.js';
import { GuitarSetup } from './guitar-setup.js';
import { closeInfo } from '../board/info-card.js';
import { hideTip } from '../help/tips.js';
import { DEFAULT_CLEANUP } from '../audio/input-cleanup.js';
import { encodeWavFloat } from './wav-file.js';

// --- input level ---------------------------------------------------------------------------
export const IN_VOLTS_FS = 0.5; // volts at digital full scale for 0 dB input level (typical passive pickup DI)

export function applyInGain() {
  const db = +$('in-gain').value;
  $('in-gain-val').textContent = `${db > 0 ? '+' : ''}${db} dB`;
  audio.send({ type: 'settings', inGain: IN_VOLTS_FS * dB(db) });
  savePrefs({ inGain: db });
}
$('in-gain').addEventListener('input', () => { applyInGain(); didThing('input'); });
if (prefs.inGain != null) $('in-gain').value = prefs.inGain;
applyInGain();

// --- response: how small a sound card buffer to ask for (read when the sound starts) ---------
audio.lowLatency = prefs.response !== 'steady';
$('response').value = audio.lowLatency ? 'fast' : 'steady';
$('response').addEventListener('change', () => {
  audio.lowLatency = $('response').value !== 'steady';
  savePrefs({ response: $('response').value });
  // the buffer size is fixed once the sound has started, so it applies from the next page load
  if (audio.ctx) toast('Reload the page to apply the new response setting.', { label: 'Reload', run: () => location.reload() });
});

// --- samples ---------------------------------------------------------------------------------
/** The chosen sample (it keeps playing when you switch to another input and back). */
export let sampleId = sampleById(prefs.sample || DEFAULT_SAMPLE).id;
audio.sampleId = sampleId;
/** electric, acoustic or bass: which kind of sound is playing (picks the starter boards). */
export const currentGroup = () => sampleById(sampleId).group;

const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export function renderSamples() {
  const root = $('sample-list');
  root.replaceChildren();
  const mine = SAMPLES.filter((x) => x.mine).length;
  if (isLocal && mine < MY_SLOTS) { // only on your own computer: a reminder of the free slots
    const n = document.createElement('p');
    n.className = 'hint slots-hint';
    n.innerHTML = `<b>Your recordings: ${mine} of ${MY_SLOTS}.</b> Drag a WAV onto <code>add-recording.cmd</code> to add one. (Only you see this note.)`;
    root.append(n);
  }
  for (const grp of SAMPLE_GROUPS) {
    if (!SAMPLES.some((x) => x.group === grp.id)) continue; // e.g. no acoustic recordings yet
    const h = document.createElement('p');
    h.className = 'sample-group';
    h.textContent = grp.name;
    h.title = grp.note;
    root.append(h);
    for (const smp of SAMPLES.filter((x) => x.group === grp.id)) root.append(sampleButton(smp));
  }
}

function sampleButton(smp) {
  const on = smp.id === sampleId;
  const b = document.createElement('button');
  b.className = 'sample';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(on));
  b.innerHTML = '<span class="sample-title"><span class="sample-name"></span><span class="sample-kind"></span></span><span class="sample-good"></span>';
  b.querySelector('.sample-name').textContent = smp.name;
  // a small badge for where the recording came from (e.g. CC0); the group heading says electric or acoustic
  const kind = b.querySelector('.sample-kind');
  kind.textContent = smp.badge || '';
  kind.classList.toggle('real', !!smp.badge);
  kind.classList.toggle('mine', !!smp.mine);
  // only the chosen sample shows its note, so the list stays short
  const good = b.querySelector('.sample-good');
  good.textContent = `Good for: ${smp.good.charAt(0).toLowerCase()}${smp.good.slice(1)}`;
  good.hidden = !on;
  b.title = `${smp.name} (${smp.kind}${smp.credit ? `; ${smp.credit}` : ''}). Good for: ${smp.good}`;
  b.addEventListener('click', () => pickSample(smp.id));
  return b;
}

async function pickSample(id) {
  const was = currentGroup();
  sampleId = id;
  savePrefs({ sample: id });
  renderSamples();
  try {
    if (audio.running) await audio.setSource('sample', { sampleId: id });
    else audio.sampleId = id;
  } catch (err) { toast(`Could not load that sample: ${err.message || err}`); }
  const now = currentGroup();
  if (now !== was) hooks.onSoundGroupChange(now);
  didThing('sample');
}

// --- choosing the input ----------------------------------------------------------------------
/** Show one input's controls in the panel (the tabs at the top of the Input panel). */
function showSourceTab(kind) {
  document.querySelectorAll('.seg [data-src]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.src === kind)));
  document.querySelectorAll('.src-extra').forEach((d) => { d.hidden = d.dataset.for !== kind; });
  $('digital-deck').hidden = kind !== 'digital';
  if (kind !== 'digital' && deck) deck.stop();
}

export async function selectSource(kind) {
  showSourceTab(kind);
  if (kind === 'live') audio.deviceId = $('device').value || '';
  savePrefs({ source: kind === 'file' ? 'sample' : kind });
  // samples are level matched; live and file inputs start at 0 dB and the player trims
  if (kind === 'file' && !audio.buffers.file) { audio.disconnectSource(); audio.sourceKind = 'file'; return; } // silence until a file is chosen
  try {
    if (audio.running) await audio.setSource(kind, { deviceId: $('device').value || undefined, sampleId });
    else audio.sourceKind = kind;
    if (kind === 'live') await listDevices();
  } catch (err) {
    toast(kind === 'live' ? 'Could not open the audio input. Allow microphone access in the browser, then pick your interface.' : String(err.message || err));
  }
}
document.querySelectorAll('.seg [data-src]').forEach((b) => b.addEventListener('click', () => selectSource(b.dataset.src)));

/** Fill the device menu with the computer's audio inputs (names appear once access is allowed). */
async function listDevices() {
  const sel = $('device');
  const cur = sel.value;
  const devs = await audio.inputDevices();
  sel.replaceChildren(new Option('Default input', ''));
  for (const d of devs) if (d.deviceId && d.deviceId !== 'default') sel.append(new Option(d.label || 'Audio input', d.deviceId));
  sel.value = cur;
}
$('device').addEventListener('change', () => {
  audio.deviceId = $('device').value || '';
  savePrefs({ device: audio.deviceId });
  if (audio.running && audio.sourceKind === 'live') audio.setSource('live', { deviceId: audio.deviceId }).catch((e) => toast(String(e.message || e)));
});

/** After a reload: back on the Guitar tab with the same input chosen (it starts with Power on). */
export async function restoreLive() {
  showSourceTab('live');
  audio.sourceKind = 'live';
  audio.deviceId = prefs.device || '';
  try { await listDevices(); } catch { /* no permission yet: the default input is used */ }
  if ([...$('device').options].some((o) => o.value === audio.deviceId)) $('device').value = audio.deviceId;
  else audio.deviceId = ''; // that input is not plugged in now
}

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    await audio.loadFile(f);
    $('file-name').textContent = `Playing: ${f.name} (looped)`;
    if (audio.running) await audio.setSource('file');
  } catch { toast('That file could not be decoded. Try WAV or MP3.'); }
});

// --- power helper ------------------------------------------------------------------------------
/** Start the sound if it is off (from a click on a pad, the setup, …) and wait until it runs. */
let powering = null;
export function ensurePower() { return powering || (powering = powerUp().finally(() => { powering = null; })); }
async function powerUp() {
  const on = () => audio.running && $('power').getAttribute('aria-pressed') === 'true';
  if (on()) return;
  if ($('power').getAttribute('aria-pressed') !== 'true') $('power').click();
  for (let i = 0; i < 160 && !on(); i++) await new Promise((r) => setTimeout(r, 50));
  if (!on()) throw new Error('the sound did not start');
}

// --- digital guitar and live guitar setup ------------------------------------------------------
export const deck = mountDigitalDeck($('digital-deck'), {
  audio,
  ensureReady: async () => {
    if (audio.sourceKind !== 'digital') await selectSource('digital');
    await ensurePower();
  },
  onPlay: () => didThing('digital'),
});

const guitarSetup = new GuitarSetup($('guitar-setup'), {
  audio,
  ensurePower,
  selectLive: async (deviceId) => {
    await listDevices().catch(() => {});
    if (deviceId) $('device').value = deviceId;
    showSourceTab('live');
    await audio.setSource('live', { deviceId: deviceId || undefined });
    savePrefs({ source: 'live', device: deviceId || '' });
  },
  setInGain: (db) => { $('in-gain').value = String(db); applyInGain(); },
  setCleanup: (c) => applyCleanup(c),
  getInGain: () => Number($('in-gain').value),
  latencyMs: () => { const m = audio.latencyMs(); return m == null ? null : m; },
  onDone: () => { didThing('guitar'); toast('Your guitar is going through the pedals. Try a starter board, or stomp the footswitches.'); },
});
$('gs-open').addEventListener('click', () => { closeInfo(); hideTip(); guitarSetup.open(); });

// --- live guitar cleanup (hum canceller, hiss filter, noise gate: see site/audio/input-cleanup.js) ---
/** Change the cleanup, remember it, and show it in the panel. */
function applyCleanup(patch) {
  audio.setCleanup(patch);
  savePrefs({ cleanup: audio.cleanup });
  renderCleanup();
}
function renderCleanup() {
  const c = { ...DEFAULT_CLEANUP, ...audio.cleanup };
  $('cleanup-on').checked = c.enabled;
  $('cleanup-gate').value = c.gate;
  $('cleanup-hiss').checked = c.hiss !== false;
  $('cleanup').classList.toggle('off', !c.enabled);
  $('cleanup-summary').textContent = c.humHz
    ? `Removing rumble, hiss and ${c.humHz.toFixed(2)} Hz hum (${c.harmonics.length} harmonic${c.harmonics.length === 1 ? '' : 's'}). Gate opens above ${c.gateDb} dB.`
    : 'Removes rumble and hiss. Run the noise check to remove hum and set the gate for your guitar.';
}
// until the noise check has run, the gate stays off (its threshold is not known yet)
audio.setCleanup(prefs.cleanup || { enabled: true, gate: 'off' });
renderCleanup();
$('cleanup-on').addEventListener('change', () => applyCleanup({ enabled: $('cleanup-on').checked }));
$('cleanup-gate').addEventListener('change', () => applyCleanup({ gate: $('cleanup-gate').value }));
$('cleanup-hiss').addEventListener('change', () => applyCleanup({ hiss: $('cleanup-hiss').checked }));

/** Make sure the sound is on and the live guitar is the input (for the check and the test clip). */
async function ensureLive() {
  await ensurePower();
  if (audio.sourceKind !== 'live') await selectSource('live');
}
$('cleanup-check').addEventListener('click', async () => {
  try { await ensureLive(); closeInfo(); hideTip(); guitarSetup.open(1); }
  catch (e) { toast(`Could not start the check: ${e.message || e}`); }
});

// --- Record a riff: the cleaned guitar (before the input level and the pedals), up to 60 s ---
// On your own computer the hint says how to put it on the site: drag it onto add-recording.cmd,
// which trims and levels it and lists it under "My recordings" (see samples/mine/README.md).
if (isLocal) $('riff-hint').textContent = 'Up to 60 seconds of your cleaned-up guitar. It saves a WAV in Downloads: drag it onto add-recording.cmd to put it on the site.';
let riffStop = null;
$('riff-rec').addEventListener('click', async () => {
  const btn = $('riff-rec'), label = btn.querySelector('.riff-label');
  if (riffStop) { riffStop(); return; } // second click: stop
  let timer = 0;
  try {
    await ensureLive();
    const t0 = performance.now();
    btn.setAttribute('aria-pressed', 'true');
    const tick = () => { const s = Math.floor((performance.now() - t0) / 1000); label.textContent = `Stop recording (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`; };
    tick(); timer = setInterval(tick, 250);
    const x = await audio.capture(60, { stage: 'clean', onStart: (stop) => { riffStop = stop; } });
    if (x.length < audio.ctx.sampleRate * 2) { toast('That was shorter than 2 seconds, so nothing was saved.'); return; }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    downloadWav(x, `my-riff-${stamp}.wav`);
    toast(isLocal ? 'Saved your riff to Downloads. Drag it onto add-recording.cmd to add it to the site.' : 'Saved your riff to your Downloads folder.');
  } catch (e) { toast(`Could not record: ${e.message || e}`); }
  finally {
    clearInterval(timer); riffStop = null;
    btn.setAttribute('aria-pressed', 'false'); label.textContent = 'Record a riff';
  }
});

/** Offer samples as a 32-bit float WAV download. */
function downloadWav(x, name) {
  const url = URL.createObjectURL(new Blob([encodeWavFloat(x, audio.ctx.sampleRate)], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// A test clip: 10 s of the raw signal (before any cleanup), saved as a WAV file, so the noise
// can be looked at in detail (or sent to someone who can help).
$('cleanup-clip').addEventListener('click', async () => {
  const btn = $('cleanup-clip');
  if (btn.disabled) return;
  try {
    await ensureLive();
    btn.disabled = true;
    toast('Recording 10 seconds: stay quiet for the first 3, then play some chords and single notes.');
    const x = await audio.capture(10);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    downloadWav(x, `guitar-test-clip-${stamp}.wav`);
    toast('Saved the test clip to your Downloads folder.');
  } catch (e) { toast(`Could not record: ${e.message || e}`); }
  finally { btn.disabled = false; }
});
