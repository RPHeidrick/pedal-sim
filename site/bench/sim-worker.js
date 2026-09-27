/**
 * Engine bench worker: parse + analyse + render off the main thread.
 * The engine modules have no DOM dependencies, so this is the same code that
 * will run in the AudioWorklet.
 */
import { loadNetlist } from '../../engine/parsers/elaborate.js';
import { operatingPoint, dcSweep, dynamicTransfer, render } from '../../engine/js/analysis.js';
import { sine, pluck, chord, harmonics } from '../../engine/js/signals.js';

self.onmessage = (e) => {
  const { id, text, fileName, files, controls, signal, oversample, sweep } = e.data;
  const t0 = performance.now();
  try {
    const desc = loadNetlist(text, { fileName, files });
    const summary = {
      name: desc.name, title: desc.title, ok: desc.ok, diagnostics: desc.diagnostics,
      controls: desc.controls, nodes: desc.nodes,
      counts: countTypes(desc.elements),
    };
    if (!desc.ok) { self.postMessage({ id, summary }); return; }

    const ctl = desc.controls.map((c) => (controls && controls[c.name] != null ? controls[c.name] : c.value));
    const op = operatingPoint(desc, { controls: ctl });
    const dc = dcSweep(desc, { from: -sweep, to: sweep, points: 201, controls: ctl });
    const dyn = dynamicTransfer(desc, { freq: 200, amplitude: sweep, controls: ctl, oversample });

    const fs = 48000;
    const gen = { sine: sine, pluck: pluck }[signal.kind];
    const input = signal.kind === 'chord' ? chord(fs, signal.dur, signal.amp) : gen(fs, signal.dur, signal.freq, signal.amp);
    const r = render(desc, input, { sampleRate: fs, oversample, controls: ctl });
    const out = r.output;
    for (let i = 0; i < out.length; i++) out[i] -= r.dcOut;
    const h = signal.kind === 'sine' ? harmonics(out, fs, signal.freq, 10) : null;
    const input32 = Float32Array.from(input);

    self.postMessage({
      id, summary,
      op: { ok: op.ok, method: op.method, iterations: op.iterations, nodes: op.nodes, currents: op.currents, devices: op.devices, unknowns: op.unknowns, ms: op.ms },
      dc: { vin: dc.vin, vout: dc.vout, ok: dc.ok },
      dyn: { vin: dyn.vin, vout: dyn.vout },
      tran: {
        input: input32, output: out, fs, latency: r.latency, stats: r.stats, realtime: r.realtime,
        ms: r.ms, dcOut: r.dcOut, harmonics: h,
      },
      ms: performance.now() - t0,
    }, [input32.buffer, out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};

function countTypes(elements) {
  const c = {};
  for (const e of elements) c[e.type] = (c[e.type] || 0) + 1;
  return c;
}
