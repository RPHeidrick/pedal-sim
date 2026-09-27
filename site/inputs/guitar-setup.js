/**
 * "Plug in your guitar": a four step setup for playing a real guitar through the pedals.
 *   1 Connect  pick the interface or cable (spots a USB guitar cable by its name), with tips
 *   2 Level    a two part measurement (see input-check.js): 3 s of silence to measure the
 *              noise and hum, then 4 s of loud playing; sets the input level and the cleanup
 *   3 Tune     a tuner on what the pedals hear
 *   4 Play     delay (latency) check and tips to keep it low
 * Figma: "Phase 10 · Tube Amp" page, "Guitar setup" frames.
 */
import { detectPitch, describePitch, nearestString } from './tuner.js';
import { analyzeQuiet, analyzeLoud, recommend } from './input-check.js';

// A guitar-to-USB cable shows up in Windows and macOS as something like "... Guitar Adapter".
const USB_CABLE = /guitar (adapter|link|cable)|guitar usb|usb guitar/i;
const CABLES = [
  { id: 'interface', name: 'Audio interface', text: 'A small box with an instrument input. Plug the guitar into the instrument (Hi-Z) input.' },
  { id: 'usbcable', name: 'USB guitar cable', text: 'A guitar-to-USB cable. It works as a USB microphone, with no drivers.' },
  { id: 'mic', name: 'Microphone (acoustic)', text: 'An acoustic guitar in front of the computer\'s microphone or a USB mic. Use headphones.' },
];
const TIPS = {
  interface: ['Turn the interface\'s gain knob up until the loudest strum lights green or yellow, never red.', 'Turn off "direct monitor" on the interface if it has one, or you will hear the dry guitar too.'],
  usbcable: ['Plug it straight into a USB port on the computer, not a hub.', 'Windows: Settings, System, Sound, Input, then the cable (often called "... Guitar Adapter"). Set its volume to 100: the more level from the cable, the less noise. The next step checks it does not clip.', 'Mac: it appears in System Settings, Sound, Input. No driver needed.', 'If it is not listed, unplug it, plug it back in, and press Find my guitar again.'],
  mic: ['Headphones are a must: speakers would feed back into the microphone.', 'Sit close to the microphone and keep the room quiet.'],
};

export class GuitarSetup {
  /**
   * @param {HTMLDialogElement} dialog
   * @param {{audio, selectLive:(deviceId:string)=>Promise<void>, ensurePower:()=>Promise<void>, setInGain:(db:number)=>void, setCleanup:(c:Object)=>void, getInGain:()=>number, latencyMs:()=>number|null, onDone:()=>void}} api
   */
  constructor(dialog, api) {
    this.d = dialog; this.api = api;
    this.step = 0; this.cable = 'interface'; this.deviceId = ''; this.raf = 0;
    dialog.addEventListener('close', () => this.stopLoop());
  }

  /** Open at the first step, or at `step` (1 = the noise and level check) when the guitar is already connected. */
  open(step = 0) {
    this.step = step;
    this.render();
    if (!this.d.open) this.d.showModal();
  }

  stopLoop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  render() {
    this.stopLoop();
    const steps = ['Connect', 'Level & noise', 'Tune', 'Play'];
    this.d.innerHTML = `
      <div class="gs-head">
        <h3>Plug in your guitar</h3>
        <button class="info-close" data-act="close" aria-label="Close">×</button>
      </div>
      <ol class="gs-steps">${steps.map((s, i) => `<li class="${i === this.step ? 'on' : i < this.step ? 'done' : ''}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>
      <div class="gs-body"></div>
      <div class="gs-actions"><button class="btn-secondary" data-act="back">Back</button><span class="tour-spacer"></span><button class="btn-primary" data-act="next">Next</button></div>`;
    this.d.querySelector('[data-act=close]').addEventListener('click', () => this.d.close());
    const back = this.d.querySelector('[data-act=back]');
    back.hidden = this.step === 0;
    back.addEventListener('click', () => { this.step--; this.render(); });
    this.next = this.d.querySelector('[data-act=next]');
    this.next.addEventListener('click', () => this.advance());
    const body = this.d.querySelector('.gs-body');
    [this.connect, this.level, this.tune, this.play][this.step].call(this, body);
  }

  async advance() {
    if (this.step === 0) {
      try {
        this.next.disabled = true; this.next.textContent = 'Connecting…';
        await this.api.ensurePower();
        await this.api.selectLive(this.deviceId);
        if (!this.d.open) return; // closed while connecting: do not start the next step
      } catch (e) {
        if (!this.d.open) return;
        this.next.disabled = false; this.next.textContent = 'Next';
        this.note(`Could not open that input: ${e.message || e}. Allow microphone access in the browser (the icon in the address bar), then try again.`);
        return;
      }
    }
    if (this.step === 3) { this.d.close(); this.api.onDone(); return; }
    this.step++;
    this.render();
  }

  note(text) {
    let n = this.d.querySelector('.gs-note');
    if (!n) { n = document.createElement('p'); n.className = 'gs-note'; this.d.querySelector('.gs-body').append(n); }
    n.textContent = text;
  }

  // ---- 1 connect
  connect(body) {
    body.innerHTML = `<p class="sc-lede">What are you plugging in with?</p>
      <div class="gs-cables" role="radiogroup" aria-label="Cable or interface"></div>
      <ul class="sc-tips gs-tips"></ul>
      <div class="gs-devices"><button class="btn-secondary" data-act="find">Find my guitar</button><div class="gs-dev-list" role="radiogroup" aria-label="Input"></div></div>`;
    const cables = body.querySelector('.gs-cables');
    const tips = body.querySelector('.gs-tips');
    const paint = () => {
      cables.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === this.cable)));
      tips.innerHTML = TIPS[this.cable].map((t) => `<li>${t}</li>`).join('');
    };
    for (const c of CABLES) {
      const b = document.createElement('button');
      b.className = 'sc-profile gs-cable'; b.dataset.id = c.id; b.setAttribute('role', 'radio');
      b.innerHTML = '<b></b><small></small>';
      b.querySelector('b').textContent = c.name; b.querySelector('small').textContent = c.text;
      b.addEventListener('click', () => { this.cable = c.id; paint(); this.pickBest(); });
      cables.append(b);
    }
    paint();
    this.next.textContent = 'Connect';
    body.querySelector('[data-act=find]').addEventListener('click', () => this.find(body));
    if (this.devices) this.showDevices(body); else this.find(body, true);
  }

  async find(body, quiet = false) {
    try {
      let devs = await this.api.audio.inputDevices();
      if (!devs.some((d) => d.label)) {
        if (quiet) { this.showDevices(body, devs); return; }
        await this.api.audio.askInputPermission();
        devs = await this.api.audio.inputDevices();
      }
      this.showDevices(body, devs);
    } catch { this.note('The browser did not allow access to audio inputs. Click the icon at the left of the address bar, allow the microphone, then press Find my guitar again.'); }
  }

  showDevices(body, devs = this.devices || []) {
    this.devices = devs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const list = body.querySelector('.gs-dev-list');
    list.replaceChildren();
    if (!this.devices.length || !this.devices.some((d) => d.label)) {
      list.innerHTML = '<p class="hint">Press "Find my guitar" and allow access, so the site can list your inputs by name.</p>';
      return;
    }
    const usbCable = this.devices.find((d) => USB_CABLE.test(d.label));
    if (usbCable && this.cable !== 'usbcable') { this.cable = 'usbcable'; this.render(); return; }
    this.pickBest();
    for (const d of this.devices) {
      const b = document.createElement('button');
      b.className = 'gs-dev'; b.setAttribute('role', 'radio'); b.dataset.id = d.deviceId;
      b.setAttribute('aria-checked', String(d.deviceId === this.deviceId));
      b.textContent = d.label || 'Audio input';
      if (USB_CABLE.test(d.label)) b.insertAdjacentHTML('beforeend', ' <span class="badge mine">USB guitar cable</span>');
      b.addEventListener('click', () => { this.deviceId = d.deviceId; list.querySelectorAll('.gs-dev').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.id === this.deviceId))); });
      list.append(b);
    }
  }

  pickBest() {
    const devs = this.devices || [];
    if (!devs.length) return;
    const pick = this.cable === 'usbcable' ? devs.find((d) => USB_CABLE.test(d.label))
      : this.cable === 'mic' ? devs.find((d) => /microphone|mic/i.test(d.label))
        : devs.find((d) => /interface|line|instrument|hi-?z|usb/i.test(d.label) && !USB_CABLE.test(d.label));
    if (pick && !devs.some((d) => d.deviceId === this.deviceId)) this.deviceId = pick.deviceId;
    if (!this.deviceId) this.deviceId = (pick || devs[0]).deviceId;
  }

  // ---- 2 level and noise
  level(body) {
    body.innerHTML = `<p class="sc-lede">Two short recordings set up your guitar: first <b>silence</b>, so the site can measure the noise and hum and remove them, then your <b>loudest playing</b>, to set the level.</p>
      <div class="gs-meter"><div class="meter"><div class="meter-fill" data-el="fill"></div></div><output class="mono" data-el="db">-∞ dB</output></div>
      <p class="gs-big" data-el="status">Strum once to check the guitar is coming through.</p>
      <button class="btn-primary" data-act="measure">Start the check</button>
      <div class="gs-report" data-el="report" hidden></div>`;
    const fill = body.querySelector('[data-el=fill]'), dbOut = body.querySelector('[data-el=db]'), status = body.querySelector('[data-el=status]');
    const btn = body.querySelector('[data-act=measure]'), report = body.querySelector('[data-el=report]');
    const an = this.api.audio.inTap, x = new Float32Array(an.fftSize);
    let heard = false, busy = false;
    const loop = () => {
      an.getFloatTimeDomainData(x);
      let p = 0; for (const v of x) p = Math.max(p, Math.abs(v));
      const d = p > 0 ? 20 * Math.log10(p) : -99;
      fill.style.width = `${Math.max(0, Math.min(100, ((d + 72) / 72) * 100))}%`;
      dbOut.textContent = d > -99 ? `${d.toFixed(0)} dB` : '-∞ dB';
      if (!heard && !busy && d > -60) { heard = true; status.textContent = 'Got it: the guitar is coming through. Press Start the check.'; }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
    const countdown = (text, seconds) => {
      const end = performance.now() + seconds * 1000;
      const t = setInterval(() => {
        const left = Math.ceil((end - performance.now()) / 1000);
        status.textContent = `${text} ${Math.max(1, left)}`;
      }, 200);
      status.textContent = `${text} ${seconds}`;
      return () => clearInterval(t);
    };
    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true; btn.disabled = true; report.hidden = true;
      try {
        const audio = this.api.audio, fs = audio.ctx.sampleRate;
        let stop = countdown('Part 1: mute the strings with your hand and stay quiet…', 3);
        const quietRaw = await audio.capture(3);
        stop();
        if (!this.d.open) return;
        stop = countdown('Part 2: now play your loudest chord, again and again…', 4);
        const loudRaw = await audio.capture(4);
        stop();
        if (!this.d.open) return;
        status.textContent = 'Working it out…';
        await new Promise((r) => setTimeout(r, 30)); // let the page draw before the number crunching
        const quiet = analyzeQuiet(quietRaw, fs), loud = analyzeLoud(loudRaw, fs);
        if (!(loud.peakDb > -70) || loud.peakDb - quiet.noiseDb < 6) {
          status.textContent = 'Your playing was hardly louder than the silence. Check the guitar volume knob and the cable, then try again.';
          return;
        }
        const r = recommend(quiet, loud);
        this.api.setInGain(r.inGainDb);
        this.api.setCleanup(r.cleanup);
        status.textContent = `Done: input level ${r.inGainDb > 0 ? '+' : ''}${r.inGainDb} dB, cleanup on.`;
        this.showReport(report, quiet, r);
      } catch (e) {
        status.textContent = `The check did not finish (${e.message || e}). Press Start the check to try again.`;
      } finally {
        busy = false; btn.disabled = false; btn.textContent = 'Check again';
      }
    });
  }

  /** The results of the check, in plain words. */
  showReport(el, quiet, r) {
    const grade = r.cleanSnrDb >= 55 ? ['good', 'Very clean'] : r.cleanSnrDb >= 40 ? ['ok', 'Clean enough'] : ['warn', 'Noisy'];
    el.hidden = false;
    el.innerHTML = `
      <dl class="gs-results">
        <dt>Noise</dt><dd><span class="mono">${Math.round(quiet.noiseDb)} dB</span> → <span class="mono">${Math.round(quiet.cleanNoiseDb)} dB</span> after cleanup</dd>
        <dt>Hum</dt><dd>${quiet.hum ? `${quiet.hum.hz.toFixed(2)} Hz, ${quiet.hum.harmonics.length} harmonic${quiet.hum.harmonics.length === 1 ? '' : 's'}: removed` : 'none found'}</dd>
        <dt>Playing vs noise</dt><dd><span class="mono">${r.snrDb} dB</span> → <span class="mono">${r.cleanSnrDb} dB</span> <span class="gs-grade ${grade[0]}">${grade[1]}</span></dd>
        <dt>Noise gate</dt><dd>${r.cleanup.gate}, opens above <span class="mono">${r.cleanup.gateDb} dB</span></dd>
      </dl>
      ${r.advice.length ? `<ul class="sc-tips">${r.advice.map((a) => `<li>${a}</li>`).join('')}</ul>` : ''}`;
  }

  // ---- 3 tune
  tune(body) {
    body.innerHTML = `<p class="sc-lede">Play one open string at a time and turn its tuning peg until the needle sits in the middle.</p>
      <div class="tuner"><div class="tuner-note" data-el="note">–</div><div class="tuner-scale"><span class="tuner-needle" data-el="needle"></span></div>
      <div class="tuner-read mono" data-el="read">Play a string</div></div>
      <p class="hint">Standard tuning, low to high: E A D G B E.</p>`;
    this.next.textContent = 'Next';
    const an = this.api.audio.inTap, x = new Float32Array(an.fftSize);
    const note = body.querySelector('[data-el=note]'), needle = body.querySelector('[data-el=needle]'), read = body.querySelector('[data-el=read]');
    let last = 0, smooth = 0;
    const loop = (t) => {
      if (t - last > 60) {
        last = t;
        an.getFloatTimeDomainData(x);
        const hz = detectPitch(x, this.api.audio.ctx.sampleRate);
        if (hz) {
          const p = describePitch(hz);
          smooth = smooth * 0.6 + p.cents * 0.4;
          const s = nearestString(69 + 12 * Math.log2(hz / 440));
          note.textContent = p.name;
          needle.style.left = `${50 + Math.max(-50, Math.min(50, smooth))}%`;
          const ok = Math.abs(smooth) <= 5;
          note.classList.toggle('in-tune', ok);
          read.textContent = `${hz.toFixed(1)} Hz · ${smooth > 0 ? '+' : ''}${Math.round(smooth)} cents · ${ok ? 'in tune' : smooth < 0 ? 'tune up (tighten)' : 'tune down (loosen)'} · string ${s.n} (${s.name})`;
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---- 4 play
  play(body) {
    const ms = this.api.latencyMs();
    const r = ms == null ? '' : ms < 15 ? 'excellent' : ms < 30 ? 'good' : ms < 50 ? 'noticeable' : 'high';
    body.innerHTML = `<p class="sc-lede">You are ready. Everything you play now goes through the pedals on the board.</p>
      <p class="gs-big">Delay: <b class="mono">${ms == null ? '—' : `${Math.round(ms)} ms`}</b> <span class="dim">${r}</span></p>
      <ul class="sc-tips">
        <li>Use <b>headphones or wired speakers</b>. Bluetooth adds 100 ms or more.</li>
        <li>Close other programs that use audio (games, video calls, music players).</li>
        <li>Chrome and Edge usually have the lowest delay.</li>
        <li>More sound settings, then Quality at 1x or 2x lowers the delay a little if your computer struggles.</li>
        ${this.cable === 'usbcable' ? '<li>A USB guitar cable adds a little delay of its own. For the lowest delay, an audio interface is the next step up.</li>' : ''}
      </ul>`;
    this.next.textContent = 'Start playing';
  }
}
