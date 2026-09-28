/**
 * The Output panel (right of the board) and the Power button.
 *
 *   Volume + Level match   how loud (Volume is yours; Level match evens out boards)
 *   Safety cap             limiter ceiling -12 dBFS and Volume capped at -6 dB
 *   Listening on           speakers / headphones profiles, and the Sound check window
 *   Amp (cab)              speaker cabinet filter at the end of the chain
 *   Quality                oversampling 1x..8x, or Auto
 *   Engine                 C++ (WebAssembly) or JavaScript
 *   Meters, scope, engine load, "Hear without pedals"
 */
import { $, audio, clamp, dB, didThing, prefs, savePrefs, toast, tourActive } from '../core.js';
import { OUTPUT_PROFILES, profileById } from './output-profiles.js';
import { applyInGain, deck, IN_VOLTS_FS } from '../inputs/input-rack.js';
import { closeInfo } from '../board/info-card.js';
import { hideTip } from '../help/tips.js';

// --- volume and level match ---------------------------------------------------------------
// Output level = Volume (how loud *you* want it; starts quiet) + Level match (evens out
// loudness between pedals and boards). Keeping them apart means loading a board or
// pressing Match level never makes it louder than the Volume you chose.
const SAFE_CEILING = -12, FULL_CEILING = -1;     // dBFS, limiter ceiling with / without the safety cap
const DEFAULT_TRIM = 5;                          // level match for the first-visit board (Reverse Parallel Fuzz, measured)
/** Level match in dB. Other files read it; change it with setTrim. */
export let trim = prefs.trim != null ? prefs.trim : DEFAULT_TRIM;
const fmtDb = (x) => `${x > 0 ? '+' : ''}${x} dB`;

function applyOutGain() {
  const db = +$('out-gain').value;
  $('out-gain-val').textContent = fmtDb(db);
  $('sc-volume').value = db;
  $('sc-volume-val').textContent = fmtDb(db);
  $('level-match').textContent = `Level match ${fmtDb(trim)}`;
  audio.send({ type: 'settings', outGain: dB(db + trim) });
  savePrefs({ master: db, trim });
}
export function setTrim(t) { trim = clamp(Math.round(t * 2) / 2, -30, 24); applyOutGain(); }
function onVolumeInput(v) { $('out-gain').value = v; applyOutGain(); didThing('volume'); }
$('out-gain').addEventListener('input', () => onVolumeInput($('out-gain').value));
$('sc-volume').addEventListener('input', () => onVolumeInput($('sc-volume').value));
if (prefs.master != null) $('out-gain').value = prefs.master; // older saved "outGain" values are ignored: everyone restarts quiet

// --- safety cap ----------------------------------------------------------------------------
function applySafety(on, save = true) {
  $('safety').checked = on; $('sc-safety').checked = on;
  const max = on ? -6 : 0;
  for (const id of ['out-gain', 'sc-volume']) $(id).max = String(max);
  if (+$('out-gain').value > max) $('out-gain').value = max;
  audio.send({ type: 'settings', ceiling: on ? SAFE_CEILING : FULL_CEILING });
  if (save) savePrefs({ safety: on });
  applyOutGain();
}
$('safety').addEventListener('change', () => applySafety($('safety').checked));
$('sc-safety').addEventListener('change', () => applySafety($('sc-safety').checked));

// --- what the visitor is listening on --------------------------------------------------------
let profile = profileById(prefs.listen);
function renderProfiles() {
  const sel = $('listen');
  sel.replaceChildren(...OUTPUT_PROFILES.map((p) => new Option(p.short, p.id)));
  sel.value = profile.id;
  const root = $('sc-profiles');
  root.replaceChildren();
  for (const p of OUTPUT_PROFILES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sc-profile';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(p.id === profile.id));
    b.textContent = p.name;
    b.addEventListener('click', () => setProfile(p.id));
    root.append(b);
  }
  $('listen-tip').textContent = profile.tip;
  $('sc-tips').replaceChildren(...profile.tips.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
}
/** Choosing where you listen may turn the volume down (never up) and sets the safety cap default. */
function setProfile(id) {
  profile = profileById(id);
  savePrefs({ listen: profile.id });
  if (+$('out-gain').value > profile.start) $('out-gain').value = profile.start;
  applySafety(profile.safety);
  renderProfiles();
  didThing('volume');
}
$('listen').addEventListener('change', () => setProfile($('listen').value));
renderProfiles();
if (prefs.master == null) $('out-gain').value = profile.start; // first visit: the quiet start for this kind of output
applySafety(prefs.safety != null ? prefs.safety : profile.safety, false);

// "More sound settings" stays open or closed the way the visitor left it
$('more-out').open = !!prefs.moreOpen;
$('more-out').addEventListener('toggle', () => savePrefs({ moreOpen: $('more-out').open }));

// Sound check: opens on the first power on (unless the guide is running), or from the Output panel
function openSoundCheck() { closeInfo(); hideTip(); renderProfiles(); $('sound-check').showModal(); }
$('sound-check-open').addEventListener('click', openSoundCheck);
$('sound-check').addEventListener('close', () => savePrefs({ soundCheckSeen: true }));

// --- speaker cabinet: stands in for the amp at the end of the chain -----------------------------
if (prefs.cab) $('cab').value = prefs.cab;
function applyCab() { audio.send({ type: 'settings', cab: $('cab').value }); savePrefs({ cab: $('cab').value }); }
$('cab').addEventListener('change', applyCab);
applyCab();

// --- Match level ------------------------------------------------------------------------------
// Set the level match so what is playing would peak at -6 dBFS with Volume at 0 dB. Your
// Volume stays where you put it, so this evens things out without ever jumping louder.
const recentPeaks = [];
$('auto-level').addEventListener('click', () => {
  const peak = Math.max(0, ...recentPeaks);
  if (!audio.running || peak < 1e-4) { toast('Power on and let a sound play for a few seconds, then press Match level.'); return; }
  const master = +$('out-gain').value;
  setTrim(trim + (-6 - (20 * Math.log10(peak) - master)));
  recentPeaks.length = 0;
});

// --- quality (oversampling) ----------------------------------------------------------------------
// Fixed 1x/2x/4x/8x, or Auto. Auto aims for 4x (fuzz stays free of aliasing fizz), steps
// down to 2x then 1x under sustained load, and back up when there is room.
const AUTO_MAX = 4;
let osActive = AUTO_MAX;
let hot = 0, cool = 0; // how many reports in a row the load was high / low
function setOversample(L) { if (L !== osActive) { osActive = L; audio.send({ type: 'settings', oversample: L }); } updateQualityNote(); }
function wantedOversample() { const v = $('oversample').value; return v === 'auto' ? null : +v; }
function updateQualityNote() {
  const auto = $('oversample').value === 'auto';
  $('latency').dataset.quality = auto ? `Auto · running ${osActive}×` : `${osActive}×`;
  renderLatency();
}
if (prefs.quality) $('oversample').value = prefs.quality;
$('oversample').addEventListener('change', () => { hot = cool = 0; savePrefs({ quality: $('oversample').value }); setOversample(wantedOversample() || AUTO_MAX); });
function autoQuality(load) {
  if (wantedOversample()) return;
  if (load > 0.85) { hot++; cool = 0; } else if (load < 0.3 && osActive < AUTO_MAX) { cool++; hot = 0; } else { hot = cool = 0; }
  if (hot >= 6 && osActive > 1) {
    hot = 0; setOversample(osActive / 2);
    if (osActive === 1) toast('Auto quality: dropped to 1× to keep audio smooth with this chain. Fuzz may sound grainier; bypass a pedal to get it back.');
  }
  if (cool >= 40 && osActive < AUTO_MAX) { cool = 0; setOversample(osActive * 2); }
}
function renderLatency() {
  // oversampling filters (24 taps per phase) add about half a millisecond
  const lat = audio.latencyMs(osActive > 1 ? 24 - (osActive - 1) / osActive : 0);
  // two fixed lines (format, then quality and delay), so nothing reflows as numbers change
  if (audio.ctx) $('audio-format').textContent = `${(audio.ctx.sampleRate / 1000).toFixed(1).replace('.0', '')} kHz · 32-bit float`;
  $('audio-quality').textContent = `${$('latency').dataset.quality || ''}${lat ? ` · ${lat.toFixed(0)} ms delay` : ''}`;
  $('latency').title = 'Sample rate and precision of the audio path, oversampling used for the circuits, and the delay from input to output.';
  // the Guitar tab's own delay line, plus a tip when the guitar cable and the headphones run
  // at different sample rates (the browser then has to convert, which adds a little delay)
  if (audio.sourceKind === 'live' && audio.stream && lat) {
    $('live-delay').textContent = `about ${lat.toFixed(0)} ms`;
    const inRate = audio.inputSettings().sampleRate, outRate = audio.ctx.sampleRate;
    const hint = $('live-delay-hint');
    hint.hidden = !(inRate && inRate !== outRate);
    if (!hint.hidden) hint.textContent = `Your guitar input runs at ${inRate / 1000} kHz and your output at ${outRate / 1000} kHz. Setting both to ${outRate / 1000} kHz in your computer's sound settings saves a conversion step.`;
  } else {
    $('live-delay').textContent = '—';
    $('live-delay-hint').hidden = true;
  }
}

// --- engine choice ------------------------------------------------------------------------------
audio.onEngine = (e) => { $('engine').value = e; };
$('engine').addEventListener('change', () => { hot = cool = 0; audio.send({ type: 'settings', engine: $('engine').value }); });
audio.onError = (m) => toast(`Engine: ${m.message}`);

// --- Hear without pedals --------------------------------------------------------------------------
$('compare').addEventListener('click', () => {
  const on = $('compare').getAttribute('aria-pressed') !== 'true';
  $('compare').setAttribute('aria-pressed', String(on));
  $('compare').textContent = on ? 'Back to pedals' : 'Hear without pedals';
  $('chain').classList.toggle('dry', on);
  audio.send({ type: 'settings', compare: on });
  didThing('compare');
});
/** Make sure the pedals are heard (turn "Hear without pedals" off). */
export function ensureWet() { if ($('compare').getAttribute('aria-pressed') === 'true') $('compare').click(); }

// --- power ------------------------------------------------------------------------------------------
$('power').addEventListener('click', async () => {
  const btn = $('power');
  if (audio.running) {
    await audio.stop();
    btn.setAttribute('aria-pressed', 'false');
    btn.querySelector('.power-label').textContent = 'Power on';
    document.body.classList.remove('live');
    document.documentElement.style.setProperty('--sig', '0');
    if (deck) deck.stop();
    return;
  }
  try {
    btn.querySelector('.power-label').textContent = 'Starting…';
    await audio.start();
    // the audio thread is new, so send it every current setting
    applyInGain(); applyOutGain(); applyCab();
    audio.send({ type: 'settings', ceiling: $('safety').checked ? SAFE_CEILING : FULL_CEILING });
    osActive = 0; setOversample(wantedOversample() || AUTO_MAX);
    btn.setAttribute('aria-pressed', 'true');
    btn.querySelector('.power-label').textContent = 'Power off';
    document.body.classList.add('live');
    drawScope();
    didThing('power');
    if (!prefs.soundCheckSeen && !tourActive()) openSoundCheck();
  } catch (err) {
    btn.querySelector('.power-label').textContent = 'Power on';
    toast(`Audio could not start: ${err.message || err}`);
  }
});

// --- meters (about 10 reports a second from the audio thread) ---------------------------------------
const meterPct = (peak) => {
  if (peak <= 0) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
};
let overloadWarned = false, overload = 0, limitHold = 0, limitWorst = 0;
let statCount = 0;
audio.onStats = (s) => {
  if (++statCount % 10 === 1) renderLatency(); // about once a second: the delay can change as devices settle
  // input meters show the level the pedals get (after the input level), like the samples at 0 dB
  const inLevel = s.inVolts / IN_VOLTS_FS;
  $('in-meter').style.width = `${meterPct(inLevel)}%`;
  $('gate-led').classList.toggle('open', s.gateOpen === true);
  $('out-meter').style.width = `${meterPct(s.outPeak)}%`;
  $('out-meter').classList.toggle('hot', s.outPeak > 0.9);
  $('in-meter-mini').style.height = `${meterPct(inLevel)}%`;
  $('out-meter-mini').style.height = `${meterPct(s.outPeak)}%`;
  document.documentElement.style.setProperty('--sig', (meterPct(s.outPeak) / 100).toFixed(2)); // cables and tubes glow with the signal
  recentPeaks.push(s.outPeak); if (recentPeaks.length > 30) recentPeaks.shift();
  // limiter readout, held about 1.5 s so a brief peak is still readable
  const lim = s.limitDb || 0;
  if (lim < -0.5) { limitWorst = limitHold > 0 ? Math.min(limitWorst, lim) : lim; limitHold = 15; }
  else limitHold = Math.max(0, limitHold - 1);
  $('limit').textContent = limitHold ? `Limiting ${limitWorst.toFixed(1)} dB` : 'Peak limiter idle';
  $('limit').title = limitHold ? 'The output is louder than the speakers can take, so the safety limiter is turning it down. Lower Volume or press Auto level for a clean signal.' : 'Protects your ears and speakers above -1 dB. It does nothing until the output gets that loud.';
  $('limit').classList.toggle('warn', limitHold > 0);
  document.body.classList.toggle('limiting', limitHold > 0); // lights TILT in the Arcade look
  // fixed format so the readout never changes width: "  86 mV" .. " 999 mV", then "1.02 V"
  $('in-volts').textContent = s.inVolts < 0.9995 ? `${(s.inVolts * 1000).toFixed(0)} mV` : `${s.inVolts.toFixed(2)} V`;
  // engine load: share of the time budget the pedals used
  const load = Math.min(1.5, s.load);
  $('cpu-meter').style.width = `${Math.min(100, load * 100)}%`;
  $('cpu-meter').classList.toggle('hot', load > 0.8);
  $('cpu-val').textContent = `${Math.round(load * 100)}%`;
  autoQuality(s.load);
  overload = s.load > 0.95 ? overload + 1 : 0;
  if (overload >= 10 && !overloadWarned && (wantedOversample() || osActive) === 1) { overloadWarned = true; toast('This chain is more than your computer can run in real time, so audio may crackle. Bypass or remove a pedal.'); }
};

// --- scope: the moving waveform in the Output panel -------------------------------------------------
function drawScope() {
  const cv = $('scope');
  const g = cv.getContext('2d');
  let color = '', grid = '', look = '';
  const data = new Float32Array(audio.analyser.fftSize);
  const frame = () => {
    if (!audio.running) { g.clearRect(0, 0, cv.width, cv.height); return; }
    if (look !== document.documentElement.dataset.theme) { // colours follow the chosen look
      look = document.documentElement.dataset.theme;
      const css = getComputedStyle(document.documentElement);
      color = css.getPropertyValue('--c-accent').trim(); grid = css.getPropertyValue('--c-grid').trim();
    }
    audio.analyser.getFloatTimeDomainData(data);
    // trigger on a rising zero crossing so the trace holds still
    let start = 0;
    for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
    const w = cv.width, h = cv.height, mid = h / 2, span = 1024;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = grid; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < span; i++) {
      const x = (i / (span - 1)) * w;
      const y = mid - data[start + i] * (mid - 6);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
