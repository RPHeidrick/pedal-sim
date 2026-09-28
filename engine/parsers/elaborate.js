/**
 * Elaboration: turns the syntax tree from engine/parsers/netlist.js into a flat,
 * JSON-serialisable circuit description that the engine consumes.
 *
 *  - flattens .subckt instances (internal nodes become "XU1.node")
 *  - evaluates .param / {expressions} / subckt params
 *  - resolves .model cards (scope chain -> built-in library)
 *  - recognises pedal controls:
 *      X... <1> <wiper> <3> pot [R=100k] [taper=lin|log|rlog] [rot=0.5]
 *      R<NAME>_A / R<NAME>_B pairs sharing one (wiper) node
 *      X... <c> <a> <b> spdt [state=0]   (dpdt: c1 a1 b1 c2 a2 b2, 3pdt: 9 pins)
 *      X... <a> <b> spst [state=0]
 *  - maps op amp subcircuits (5-pin in+ in- v+ v- out, or 3-pin in+ in- out)
 *    to the built-in macromodel when no usable .subckt is supplied
 *  - applies pedal conventions: input node "in", output "out", supply "vcc",
 *    ground "0" (also "gnd")
 *
 * Every problem is reported as a diagnostic; nothing fails silently.
 */

import { parseNetlist, parseKeyValues } from './netlist.js';
import { resolveValue, parseValue } from './values.js';
import { BUILTIN_MODELS, OPAMP_PRESETS, opampPresetFor } from './library-models.js';

/** Model parameters the engine uses, per model type. Everything else is reported as ignored. */
const USED_PARAMS = {
  D: ['is', 'n', 'rs', 'bv', 'ibv', 'nbv'],
  NPN: ['is', 'bf', 'br', 'nf', 'nr', 'vaf', 'va', 'var', 'vb', 'ikf', 'ik', 'ikr', 'ise', 'ne', 'isc', 'nc', 'rb', 'rc', 're'],
  NJF: ['vto', 'beta', 'lambda', 'is', 'n', 'rd', 'rs'],
  NMOS: ['vto', 'kp', 'lambda', 'rd', 'rs', 'level', 'w', 'l'],
};
USED_PARAMS.PNP = USED_PARAMS.NPN;
USED_PARAMS.PJF = USED_PARAMS.NJF;
USED_PARAMS.PMOS = USED_PARAMS.NMOS;
USED_PARAMS.VDMOS = USED_PARAMS.NMOS;

const POT_RE = /^(pot|potentiometer|pot_?(lin|log|rlog|a|b|c)|pot[abc]|potlin|potlog)$/i;
const SWITCH_RE = /^(sw_?)?(spst|spdt|dpdt|3pdt|4pdt)(_.*)?$/i;

/** Canonical node name: lower-case, KiCad's leading "/" removed, "gnd" -> "0". */
export function canonNode(n) {
  let s = String(n).trim().toLowerCase();
  if (s.startsWith('/')) s = s.slice(1);
  if (s === 'gnd' || s === '0' || s === 'ground') return '0';
  return s;
}

/**
 * Parse + elaborate in one call.
 * @param {string} text
 * @param {{fileName?:string, files?:Record<string,string>}} [opts]
 */
export function loadNetlist(text, opts = {}) {
  const ast = parseNetlist(text, opts);
  return elaborate(ast);
}

/**
 * @param {ReturnType<typeof parseNetlist>} ast
 * @returns {Object} circuit description (see README "Circuit description")
 */
export function elaborate(ast) {
  const diagnostics = [...ast.diagnostics];
  const diag = (level, message, where) => diagnostics.push({ level, message, file: where?.file, line: where?.line });
  const elements = [];
  const ignoredModelParams = new Map(); // model name -> Set(param)

  // --- parameter evaluation ------------------------------------------------
  function evalParams(list, base, where) {
    const table = { ...base };
    for (const [k, expr] of list) {
      const v = resolveValue(expr, table);
      if (Number.isNaN(v)) diag('error', `Cannot evaluate .param ${k}=${expr}`, where);
      else table[k] = v;
    }
    return table;
  }

  // --- model lookup --------------------------------------------------------
  function findModel(name, chain) {
    const key = String(name).toLowerCase();
    for (let i = chain.length - 1; i >= 0; i--) {
      const m = chain[i].models.get(key);
      if (m) return m;
    }
    const b = BUILTIN_MODELS[key];
    if (b) return { name, type: b.type, params: b.params, flags: [], builtin: true };
    return null;
  }

  function findSubckt(name, chain) {
    const key = String(name).toLowerCase();
    for (let i = chain.length - 1; i >= 0; i--) {
      const s = chain[i].subckts.get(key);
      if (s) return s;
    }
    return null;
  }

  /** Numeric model params (lower-case keys), evaluated with the scope's params. */
  function modelParams(model, params, where) {
    const out = {};
    const used = USED_PARAMS[model.type] || [];
    for (const [k, raw] of Object.entries(model.params)) {
      if (!used.includes(k)) {
        if (!ignoredModelParams.has(model.name)) ignoredModelParams.set(model.name, new Set());
        ignoredModelParams.get(model.name).add(k.toUpperCase());
        continue;
      }
      const v = typeof raw === 'number' ? raw : resolveValue(raw, params);
      if (Number.isNaN(v)) diag('error', `Model ${model.name}: cannot evaluate ${k}=${raw}`, where);
      else out[k] = v;
    }
    return out;
  }

  // --- flatten ---------------------------------------------------------------
  const globals = ast.globals;
  const rootParams = evalParams(ast.root.params, {}, { file: ast.files[0] });

  function expandScope(scope, ctx) {
    for (const card of scope.cards) {
      try {
        expandCard(card, ctx);
      } catch (e) {
        diag('error', `${card.name}: ${e.message}`, card);
      }
    }
  }

  function mapNode(n, ctx) {
    const c = canonNode(n);
    if (c === '0' || globals.has(c)) return c;
    if (ctx.pinMap && ctx.pinMap.has(c)) return ctx.pinMap.get(c);
    return ctx.prefix ? `${ctx.prefix.toLowerCase()}.${c}` : c;
  }

  function val(token, ctx, what, card) {
    const v = resolveValue(token, ctx.params);
    if (Number.isNaN(v)) throw new Error(`cannot evaluate ${what} "${token}"`);
    return v;
  }

  function fullName(card, ctx) {
    return ctx.prefix ? `${ctx.prefix}.${card.name}` : card.name;
  }

  function splitValueAndExtras(tokens) {
    const pos = [];
    const kv = [];
    for (const t of tokens) (t.includes('=') ? kv : pos).push(t);
    return { pos, kv: parseKeyValues(kv).params };
  }

  function expandCard(card, ctx) {
    const t = card.tokens;
    const name = fullName(card, ctx);
    const where = { file: card.file, line: card.line };
    switch (card.kind) {
      case 'R': case 'C': case 'L': {
        if (t.length < 4) throw new Error('needs two nodes and a value');
        const nodes = [mapNode(t[1], ctx), mapNode(t[2], ctx)];
        const { pos, kv } = splitValueAndExtras(t.slice(3));
        const key = { R: 'r', C: 'c', L: 'l' }[card.kind];
        let raw = pos[0] ?? kv[key] ?? kv.value;
        if (raw == null) throw new Error('missing value');
        const value = val(raw, ctx, 'value', card);
        const extras = Object.keys(kv).filter((k) => k !== key && k !== 'value' && k !== 'ic' && k !== 'm');
        if (card.kind === 'C' && kv.q) throw new Error('charge-defined capacitors (Q=) are not supported');
        if (extras.length) diag('info', `${name}: ignored ${extras.join(', ')}`, where);
        if (card.kind === 'R' && value === 0) {
          diag('warning', `${name}: 0 ohm resistor replaced by 1 micro-ohm`, where);
        }
        const mult = kv.m ? val(kv.m, ctx, 'm', card) : 1;
        let v = value;
        if (card.kind === 'R' || card.kind === 'L') v = value / mult; else v = value * mult;
        if (card.kind === 'R' && v === 0) v = 1e-6;
        if (v < 0 && card.kind !== 'R') { diag('error', `${name}: a ${card.kind === 'C' ? 'capacitor' : 'inductor'} cannot have a negative value (${v})`, where); return; }
        if (!(v > 0) && !(card.kind === 'R' && v < 0)) {
          if (v === 0 && card.kind === 'C') { diag('warning', `${name}: zero capacitance, element skipped`, where); return; }
          if (v === 0 && card.kind === 'L') { diag('warning', `${name}: zero inductance treated as a short (1 micro-ohm)`, where); elements.push({ type: 'R', name, nodes, value: 1e-6 }); return; }
        }
        elements.push({ type: card.kind, name, nodes, value: v, where });
        return;
      }
      case 'V': case 'I': {
        if (t.length < 3) throw new Error('needs two nodes');
        const nodes = [mapNode(t[1], ctx), mapNode(t[2], ctx)];
        const src = parseSource(t.slice(3), ctx, card);
        elements.push({ type: card.kind, name, nodes, ...src, where });
        return;
      }
      case 'D': {
        if (t.length < 4) throw new Error('needs anode, cathode and model');
        const model = findModel(t[3], ctx.chain);
        if (!model) throw new Error(`unknown diode model "${t[3]}"`);
        if (model.type !== 'D') throw new Error(`model ${t[3]} is type ${model.type}, expected D`);
        const area = t[4] && !t[4].includes('=') && t[4].toLowerCase() !== 'off' ? val(t[4], ctx, 'area', card) : 1;
        if (model.builtin) noteBuiltin(model.name, where);
        elements.push({ type: 'D', name, nodes: [mapNode(t[1], ctx), mapNode(t[2], ctx)], model: { name: model.name, ...modelParams(model, ctx.params, where) }, area, where });
        return;
      }
      case 'Q': {
        if (t.length < 5) throw new Error('needs collector, base, emitter and model');
        // Optional substrate node: Q c b e [s] model [area]
        let mi = 4;
        let model = findModel(t[4], ctx.chain);
        if (!model && t[5]) { model = findModel(t[5], ctx.chain); mi = 5; }
        if (!model) throw new Error(`unknown transistor model "${t[4]}"`);
        if (model.type !== 'NPN' && model.type !== 'PNP') throw new Error(`model ${model.name} is type ${model.type}, expected NPN or PNP`);
        if (mi === 5) diag('info', `${name}: substrate node ignored`, where);
        const areaTok = t[mi + 1];
        const area = areaTok && !areaTok.includes('=') ? val(areaTok, ctx, 'area', card) : 1;
        if (model.builtin) noteBuiltin(model.name, where);
        elements.push({
          type: 'Q', name, polarity: model.type === 'NPN' ? 1 : -1,
          nodes: [mapNode(t[1], ctx), mapNode(t[2], ctx), mapNode(t[3], ctx)],
          model: { name: model.name, ...modelParams(model, ctx.params, where) }, area, where,
        });
        return;
      }
      case 'J': {
        if (t.length < 5) throw new Error('needs drain, gate, source and model');
        const model = findModel(t[4], ctx.chain);
        if (!model) throw new Error(`unknown JFET model "${t[4]}"`);
        if (model.type !== 'NJF' && model.type !== 'PJF') throw new Error(`model ${model.name} is type ${model.type}, expected NJF or PJF`);
        const area = t[5] && !t[5].includes('=') ? val(t[5], ctx, 'area', card) : 1;
        if (model.builtin) noteBuiltin(model.name, where);
        elements.push({
          type: 'J', name, polarity: model.type === 'NJF' ? 1 : -1,
          nodes: [mapNode(t[1], ctx), mapNode(t[2], ctx), mapNode(t[3], ctx)],
          model: { name: model.name, ...modelParams(model, ctx.params, where) }, area, where,
        });
        return;
      }
      case 'M': {
        if (t.length < 5) throw new Error('needs drain, gate, source [bulk] and model');
        let nodesTok, model;
        const m4 = findModel(t[4], ctx.chain);
        if (t.length >= 6 && !t[5].includes('=') && findModel(t[5], ctx.chain) && !(m4 && /MOS/.test(m4.type))) {
          nodesTok = t.slice(1, 5); model = findModel(t[5], ctx.chain);
        } else if (m4) {
          nodesTok = t.slice(1, 4); model = m4; // 3-terminal (LTspice VDMOS)
        } else {
          nodesTok = t.slice(1, 5); model = t[5] ? findModel(t[5], ctx.chain) : null;
        }
        if (!model) throw new Error(`unknown MOSFET model "${t[5] || t[4]}"`);
        if (!/^(NMOS|PMOS|VDMOS)$/.test(model.type)) throw new Error(`model ${model.name} is type ${model.type}, expected NMOS/PMOS/VDMOS`);
        const { kv } = splitValueAndExtras(t.slice(nodesTok.length + 2));
        const mp = modelParams(model, ctx.params, where);
        if (mp.level != null && mp.level !== 1) diag('warning', `${name}: model level ${mp.level} simulated as level 1`, where);
        if (model.params.gamma) diag('info', `${name}: body effect (GAMMA) ignored; bulk treated as tied to source`, where);
        let polarity = model.type === 'PMOS' ? -1 : 1;
        if (model.type === 'VDMOS' && model.flags.includes('pchan')) polarity = -1;
        if (model.type === 'VDMOS') diag('info', `${name}: VDMOS simulated as level 1 without body diode`, where);
        const w = kv.w ? val(kv.w, ctx, 'W', card) : (mp.w ?? 1);
        const l = kv.l ? val(kv.l, ctx, 'L', card) : (mp.l ?? 1);
        if (model.builtin) noteBuiltin(model.name, where);
        const nodes = nodesTok.map((n) => mapNode(n, ctx));
        if (nodes.length === 3) nodes.push(nodes[2]);
        elements.push({ type: 'M', name, polarity, nodes, model: { name: model.name, ...mp }, w, l, where });
        return;
      }
      case 'E': case 'G': case 'F': case 'H': {
        const rest = t.slice(3).map((x) => x.toLowerCase());
        if (rest.some((x) => x.startsWith('poly') || x.startsWith('value=') || x === 'value' || x.startsWith('table') || x.startsWith('laplace') || x.startsWith('freq'))) {
          throw new Error('behavioural forms (POLY, VALUE, TABLE, LAPLACE, FREQ) of controlled sources are not supported');
        }
        const nodes = [mapNode(t[1], ctx), mapNode(t[2], ctx)];
        if (card.kind === 'E' || card.kind === 'G') {
          if (t.length < 6) throw new Error('needs out+, out-, ctrl+, ctrl- and gain');
          nodes.push(mapNode(t[3], ctx), mapNode(t[4], ctx));
          elements.push({ type: card.kind, name, nodes, gain: val(t[5], ctx, 'gain', card), where });
        } else {
          if (t.length < 5) throw new Error('needs out+, out-, controlling V source and gain');
          const src = ctx.prefix ? `${ctx.prefix}.${t[3]}` : t[3];
          elements.push({ type: card.kind, name, nodes, source: src.toLowerCase(), gain: val(t[4], ctx, 'gain', card), where });
        }
        return;
      }
      case 'X':
        return expandInstance(card, ctx, name, where);
      case 'K':
        throw new Error('coupled inductors (K) are not supported yet');
      case 'B':
        throw new Error('behavioural sources (B) are not supported');
      case 'S': case 'W':
        throw new Error('voltage/current-controlled switches (S/W) are not supported; use an spdt/spst subcircuit for toggles');
      case 'T': case 'O':
        throw new Error('transmission lines are not supported');
      default:
        throw new Error(`element type "${card.kind}" is not supported`);
    }
  }

  const builtinNoted = new Set();
  function noteBuiltin(model, where) {
    if (builtinNoted.has(model.toLowerCase())) return;
    builtinNoted.add(model.toLowerCase());
    diag('info', `Using built-in model for ${model} (no .model supplied)`, where);
  }

  function parseSource(tokens, ctx, card) {
    const out = { dc: null, ac: 0, wave: null, rser: 0 };
    let i = 0;
    const num = (tok) => val(tok, ctx, 'source value', card);
    const collect = () => {
      const vals = [];
      while (i < tokens.length && !tokens[i].includes('=') && !Number.isNaN(resolveValue(tokens[i], ctx.params))) vals.push(num(tokens[i++]));
      return vals;
    };
    while (i < tokens.length) {
      const tok = tokens[i];
      const low = tok.toLowerCase();
      if (low === 'dc') { i++; out.dc = num(tokens[i++]); continue; }
      if (low === 'ac') {
        i++;
        out.ac = tokens[i] && !Number.isNaN(resolveValue(tokens[i], ctx.params)) ? num(tokens[i++]) : 1;
        if (tokens[i] && !Number.isNaN(resolveValue(tokens[i], ctx.params))) i++; // phase
        continue;
      }
      if (low === 'sin' || low === 'sine') {
        i++;
        const v = collect();
        out.wave = { kind: 'sin', vo: v[0] ?? 0, va: v[1] ?? 0, freq: v[2] ?? 1e3, td: v[3] ?? 0, theta: v[4] ?? 0, phase: v[5] ?? 0 };
        continue;
      }
      if (low === 'pulse') {
        i++;
        const v = collect();
        out.wave = { kind: 'pulse', v1: v[0] ?? 0, v2: v[1] ?? 0, td: v[2] ?? 0, tr: v[3] ?? 0, tf: v[4] ?? 0, pw: v[5] ?? Infinity, per: v[6] ?? Infinity };
        continue;
      }
      if (low === 'pwl') {
        i++;
        const v = collect();
        const pts = [];
        for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
        out.wave = { kind: 'pwl', points: pts };
        continue;
      }
      if (low === 'exp' || low === 'sffm' || low === 'am' || low === 'wavefile' || low.startsWith('wavefile=')) {
        diag('warning', `${card.name}: ${low.toUpperCase()} waveform not supported; using its DC value`, card);
        i++;
        collect();
        continue;
      }
      if (tok.includes('=')) {
        const [k, v] = tok.split('=');
        if (k.toLowerCase() === 'rser') out.rser = num(v);
        else diag('info', `${card.name}: ignored ${k}`, card);
        i++;
        continue;
      }
      if (out.dc == null && !Number.isNaN(resolveValue(tok, ctx.params))) { out.dc = num(tok); i++; continue; }
      diag('warning', `${card.name}: unrecognised source token "${tok}"`, card);
      i++;
    }
    if (out.dc == null) {
      out.dc = out.wave ? waveAtZero(out.wave) : 0;
    }
    return out;
  }

  function expandInstance(card, ctx, name, where) {
    const t = card.tokens;
    let end = t.length;
    for (let k = 1; k < t.length; k++) {
      if (t[k].includes('=') || t[k].toLowerCase() === 'params:') { end = k; break; }
    }
    if (end < 3) throw new Error('needs nodes and a subcircuit name');
    const subName = t[end - 1];
    const pins = t.slice(1, end - 1).map((n) => mapNode(n, ctx));
    const { params: rawParams } = parseKeyValues(t.slice(end));
    const instParams = {};
    for (const [k, v] of Object.entries(rawParams)) {
      const n = resolveValue(v, ctx.params);
      instParams[k] = Number.isNaN(n) ? v : n; // keep strings such as taper=log
    }

    if (POT_RE.test(subName)) return addPot(name, pins, subName, instParams, where);
    if (SWITCH_RE.test(subName)) return addSwitch(name, pins, subName, instParams, where);

    const def = findSubckt(subName, ctx.chain);
    const preset = opampPresetFor(subName);

    if (def) {
      if (def.pins.length !== pins.length) throw new Error(`subcircuit ${def.name} has ${def.pins.length} pins, instance gives ${pins.length}`);
      // Trial-expand so an unsimulatable vendor model can fall back to the built-in op amp.
      const mark = { el: elements.length, dg: diagnostics.length };
      expandSubckt(def, pins, instParams, ctx, name, where);
      const newErrors = diagnostics.slice(mark.dg).filter((d) => d.level === 'error');
      if (newErrors.length && preset && (pins.length === 5 || pins.length === 3)) {
        elements.length = mark.el;
        diagnostics.length = mark.dg;
        diag('warning', `${name}: supplied subcircuit ${def.name} uses unsupported elements (${newErrors[0].message}); using built-in ${preset} op amp macromodel`, where);
        return addOpamp(name, pins, preset, instParams, where);
      }
      return;
    }
    if (preset) {
      if (pins.length !== 5 && pins.length !== 3) throw new Error(`op amp ${subName} needs 5 pins (in+ in- v+ v- out) or 3 (in+ in- out)`);
      return addOpamp(name, pins, preset, instParams, where);
    }
    throw new Error(`unknown subcircuit "${subName}" (upload the file that defines it)`);
  }

  function expandSubckt(def, pins, instParams, ctx, name, where) {
    if (ctx.depth > 20) throw new Error('subcircuit nesting too deep (recursive definition?)');
    const pinMap = new Map();
    def.pins.forEach((p, i) => pinMap.set(canonNode(p), pins[i]));
    // Parameter precedence: instance > subckt defaults; defaults may reference globals.
    const params = { ...rootParams };
    for (const [k, v] of Object.entries(def.params)) {
      if (k in instParams) continue;
      const n = resolveValue(v, { ...params, ...instParams });
      if (Number.isNaN(n)) diag('error', `${name}: cannot evaluate subckt param ${k}=${v}`, where);
      else params[k] = n;
    }
    for (const [k, v] of Object.entries(instParams)) if (typeof v === 'number') params[k] = v;
    const inner = {
      prefix: name, pinMap, chain: [...ctx.chain, def.scope], depth: ctx.depth + 1,
      params: evalParams(def.scope.params, params, where),
    };
    expandScope(def.scope, inner);
  }

  function addOpamp(name, pins, preset, instParams, where) {
    const p = { ...OPAMP_PRESETS[preset] };
    // LTspice UniversalOpAmp / opamp parameter names map onto the macromodel.
    const map = { avol: 'aol', aol: 'aol', a0: 'aol', gbw: 'gbw', slew: 'sr', sr: 'sr', rin: 'rin', rout: 'rout' };
    for (const [k, v] of Object.entries(instParams)) {
      if (map[k] && typeof v === 'number') p[map[k]] = v;
      else if (k === 'rail' && typeof v === 'number') { p.dropHi = v; p.dropLo = v; }
      else if (k === 'vdrop' && typeof v === 'number') { p.dropHi = v; p.dropLo = v; }
    }
    const nodes = pins.length === 5 ? pins : [pins[0], pins[1], null, null, pins[2]];
    elements.push({ type: 'OPAMP', name, nodes, preset, params: p, where });
    diag('info', `${name}: built-in op amp macromodel "${preset}" (GBW ${p.gbw / 1e6} MHz, SR ${p.sr / 1e6} V/us)`, where);
  }

  function addPot(name, pins, subName, instParams, where) {
    if (pins.length !== 3) throw new Error(`pot needs 3 pins (lug1 wiper lug3), got ${pins.length}`);
    const r = numParam(instParams, ['r', 'rtot', 'value', 'rpot', 'res'], 100e3);
    let taper = String(instParams.taper ?? '').toLowerCase();
    if (!taper) {
      const s = subName.toLowerCase();
      if (/rlog|_c$|potc$/.test(s)) taper = 'rlog';
      else if (/log|_a$|pota$/.test(s)) taper = 'log';
      else taper = 'lin';
    }
    const rot = numParam(instParams, ['rot', 'pos', 'set', 'wiper', 't', 'x'], 0.5);
    pots.push({ type: 'POT', name, nodes: pins, r, taper: normTaper(taper), rot: clamp01(rot), where });
  }

  function addSwitch(name, pins, subName, instParams, where) {
    const kind = SWITCH_RE.exec(subName)[2].toLowerCase();
    const poles = [];
    if (kind === 'spst') {
      if (pins.length !== 2) throw new Error('spst needs 2 pins (a b)');
      poles.push([pins[0], null, pins[1]]);
    } else {
      const n = { spdt: 1, dpdt: 2, '3pdt': 3, '4pdt': 4 }[kind];
      if (pins.length !== n * 3) throw new Error(`${kind} needs ${n * 3} pins (common, a, b per pole)`);
      for (let k = 0; k < n; k++) poles.push(pins.slice(k * 3, k * 3 + 3));
    }
    const state = numParam(instParams, ['state', 'pos', 'on'], 0) ? 1 : 0;
    switches.push({ type: 'SW', name, kind, poles, state, where });
  }

  const pots = [];
  const switches = [];
  expandScope(ast.root, { prefix: '', pinMap: null, chain: [ast.root], depth: 0, params: rootParams });

  // --- resistor-pair pots: R<NAME>_A + R<NAME>_B sharing the wiper ---------
  const pairRe = /^(.*)_([ab])$/i;
  const byBase = new Map();
  for (const el of elements) {
    if (el.type !== 'R') continue;
    const m = pairRe.exec(el.name);
    if (!m) continue;
    const base = m[1].toLowerCase();
    if (!byBase.has(base)) byBase.set(base, {});
    byBase.get(base)[m[2].toLowerCase()] = el;
  }
  for (const [base, pair] of byBase) {
    if (!pair.a || !pair.b) continue;
    const shared = pair.a.nodes.filter((n) => pair.b.nodes.includes(n));
    if (shared.length !== 1) {
      diag('warning', `${pair.a.name}/${pair.b.name} look like a pot pair but do not share exactly one wiper node`, pair.a.where);
      continue;
    }
    const w = shared[0];
    const lug1 = pair.a.nodes.find((n) => n !== w);
    const lug3 = pair.b.nodes.find((n) => n !== w);
    const r = pair.a.value + pair.b.value;
    const frac = pair.a.value / r;
    elements.splice(elements.indexOf(pair.a), 1);
    elements.splice(elements.indexOf(pair.b), 1);
    const name = pair.a.name.replace(/_[ab]$/i, '');
    pots.push({ type: 'POT', name, nodes: [lug1, w, lug3], r, taper: 'lin', rot: frac, fromPair: true, where: pair.a.where });
  }

  // --- annotations (*@pot, *@switch, *@pedal) --------------------------------
  let pedalName = ast.title || '';
  let maxOversample = 0; // *@pedal oversample="1": the circuit makes (almost) no distortion, so it never needs oversampling
  const shortName = (n) => n.replace(/^.*\./, '').replace(/^[xr]/i, '');
  for (const a of ast.annotations) {
    if (a.kind === 'pedal') {
      if (a.params.name) pedalName = a.params.name;
      if (a.params.oversample) maxOversample = Math.max(1, Math.round(Number(a.params.oversample)) || 0);
      continue;
    }
    if (a.kind !== 'pot' && a.kind !== 'switch' && a.kind !== 'control') { diag('info', `Unknown annotation *@${a.kind} ignored`, a); continue; }
    const list = a.kind === 'switch' ? switches : a.kind === 'pot' ? pots : [...pots, ...switches];
    const target = String(a.target || '').toLowerCase();
    const hit = list.find((c) => c.name.toLowerCase() === target || shortName(c.name).toLowerCase() === target);
    if (!hit) { diag('warning', `Annotation *@${a.kind} ${a.target}: no such control`, a); continue; }
    if (a.params.label) hit.label = a.params.label;
    if (hit.type === 'POT') {
      if (a.params.taper) {
        const oldTaper = hit.taper;
        hit.taper = normTaper(a.params.taper);
        // A resistor pair's split is a physical resistance ratio; convert it to rotation under the new taper.
        if (hit.fromPair && oldTaper !== hit.taper) hit.rot = invTaper(hit.taper, hit.rot);
      }
      if (a.params.rot != null) hit.rot = clamp01(parseValue(a.params.rot));
    } else if (a.params.state != null) {
      hit.state = parseValue(a.params.state) ? 1 : 0;
    }
  }

  // --- controls ------------------------------------------------------------
  const controls = [];
  for (const p of pots) {
    p.control = controls.length;
    controls.push({ id: controls.length, kind: 'pot', name: p.name, label: p.label || shortName(p.name).toUpperCase(), taper: p.taper, r: p.r, value: p.rot });
    elements.push(p);
  }
  for (const s of switches) {
    s.control = controls.length;
    controls.push({ id: controls.length, kind: 'switch', name: s.name, label: s.label || shortName(s.name).toUpperCase(), switchKind: s.kind, value: s.state });
    elements.push(s);
  }

  // --- conventions: in / out / vcc / 0 --------------------------------------
  const nodeUse = new Map();
  const touch = (n, el) => { if (n == null) return; if (!nodeUse.has(n)) nodeUse.set(n, []); nodeUse.get(n).push(el); };
  for (const el of elements) {
    if (el.type === 'SW') el.poles.forEach((p) => p.forEach((n) => touch(n, el)));
    else el.nodes.forEach((n) => touch(n, el));
  }

  const vs = elements.filter((e) => e.type === 'V');
  let input = vs.find((v) => v.nodes[0] === 'in' && v.nodes[1] === '0') || vs.find((v) => v.nodes.includes('in'));
  if (input) {
    input.role = 'input';
    if (input.nodes[0] !== 'in' && input.nodes[1] !== '0') diag('warning', `Input source ${input.name} is not between "in" and ground; its value is replaced by the audio input anyway`, input.where);
  } else if (nodeUse.has('in')) {
    input = { type: 'V', name: 'Vin', nodes: ['in', '0'], dc: 0, ac: 1, wave: null, rser: 0, role: 'input', synthetic: true };
    elements.push(input);
    diag('info', 'No source on node "in"; an ideal audio input source was added', null);
  } else {
    diag('error', 'No node named "in". Name the input node "in" (see conventions).', null);
  }
  if (!nodeUse.has('out')) diag('error', 'No node named "out". Name the output node "out" (see conventions).', null);

  for (const v of vs) if (v !== input && (v.nodes.includes('vcc'))) v.role = 'supply';
  if (nodeUse.has('vcc') && !vs.some((v) => v.nodes.includes('vcc'))) {
    elements.push({ type: 'V', name: 'Vsupply', nodes: ['vcc', '0'], dc: 9, ac: 0, wave: null, rser: 0, role: 'supply', synthetic: true });
    diag('warning', 'Node "vcc" has no source; a 9 V supply was added', null);
  }

  // Controlled sources F/H must reference an existing V source.
  const vnames = new Set(elements.filter((e) => e.type === 'V').map((e) => e.name.toLowerCase()));
  for (const e of elements) {
    if ((e.type === 'F' || e.type === 'H') && !vnames.has(e.source)) diag('error', `${e.name}: controlling source ${e.source} not found`, e.where);
  }

  // Dangling nodes (one connection) are legal but usually mistakes.
  for (const [n, users] of nodeUse) {
    if (n === '0' || n === 'out' || n === 'in') continue;
    if (users.length === 1 && users[0].type !== 'OPAMP' && users[0].type !== 'SW') diag('warning', `Node "${n}" connects to only ${users[0].name}`, users[0].where);
  }
  if (![...nodeUse.keys()].includes('0')) diag('error', 'Circuit has no ground (node 0)', null);

  for (const [model, set] of ignoredModelParams) {
    diag('info', `Model ${model}: ignored parameters ${[...set].join(' ')} (capacitance/temperature/noise terms are not modelled)`, null);
  }

  const nodes = [...nodeUse.keys()].filter((n) => n !== '0').sort((a, b) => nodeOrder(a) - nodeOrder(b) || a.localeCompare(b));
  const errors = diagnostics.filter((d) => d.level === 'error');
  for (const el of elements) delete el.where;
  return {
    title: ast.title,
    name: pedalName || 'Untitled pedal',
    maxOversample,
    nodes,
    elements,
    controls,
    diagnostics,
    ok: errors.length === 0,
    files: ast.files,
  };
}

function nodeOrder(n) {
  return { in: 0, out: 1, vcc: 2 }[n] ?? 3;
}

function numParam(obj, keys, dflt) {
  for (const k of keys) {
    if (obj[k] != null) {
      const v = typeof obj[k] === 'number' ? obj[k] : parseValue(obj[k]);
      if (!Number.isNaN(v)) return v;
    }
  }
  return dflt;
}

function normTaper(t) {
  const s = String(t).toLowerCase();
  if (s === 'log' || s === 'a' || s === 'audio') return 'log';
  if (s === 'rlog' || s === 'revlog' || s === 'c' || s === 'reverse') return 'rlog';
  return 'lin';
}

function clamp01(x) { return Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5)); }

/** Inverse of engine taper for log/rlog (kept here to avoid parser->engine import). */
function invTaper(taper, frac) {
  const B = 81; // must match engine/js/taper.js
  if (taper === 'log') return Math.log(1 + frac * (B - 1)) / Math.log(B);
  if (taper === 'rlog') return 1 - Math.log(1 + (1 - frac) * (B - 1)) / Math.log(B);
  return frac;
}

function waveAtZero(w) {
  if (w.kind === 'sin') return w.vo + (w.td > 0 ? 0 : w.va * Math.sin((w.phase * Math.PI) / 180));
  if (w.kind === 'pulse') return w.td > 0 || w.tr > 0 ? w.v1 : w.v2;
  if (w.kind === 'pwl') return w.points.length ? w.points[0][1] : 0;
  return 0;
}
