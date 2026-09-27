/**
 * Built-in device models, used when a netlist references a part without
 * defining it (LTspice silently pulls these from its standard.* libraries).
 * Values are typical published SPICE parameters or close approximations of
 * them; an inline .model or an uploaded .include always takes precedence.
 */

const M = (type, params) => ({ type, params, builtin: true });

export const BUILTIN_MODELS = {
  // --- diodes -------------------------------------------------------------
  '1n4148': M('D', { is: 2.52e-9, rs: 0.568, n: 1.752, bv: 100, ibv: 100e-6 }),
  '1n914': M('D', { is: 2.52e-9, rs: 0.568, n: 1.752, bv: 100, ibv: 100e-6 }),
  '1n34a': M('D', { is: 2e-7, rs: 7, n: 1.3, bv: 60, ibv: 15e-6 }), // germanium
  '1n60': M('D', { is: 5e-7, rs: 6, n: 1.4, bv: 40, ibv: 15e-6 }), // germanium
  '1n5817': M('D', { is: 31.7e-6, rs: 0.051, n: 1.373, bv: 20, ibv: 1e-3 }),
  '1n5819': M('D', { is: 31.7e-6, rs: 0.042, n: 1.373, bv: 40, ibv: 1e-3 }),
  'bat41': M('D', { is: 1.2e-8, rs: 5, n: 1.03, bv: 100, ibv: 1e-5 }),
  'bat46': M('D', { is: 1.3e-8, rs: 1.5, n: 1.02, bv: 100, ibv: 1e-5 }),
  '1n4001': M('D', { is: 14.11e-9, rs: 0.0339, n: 1.984, bv: 75, ibv: 1e-5 }),
  '1n4007': M('D', { is: 14.11e-9, rs: 0.0339, n: 1.984, bv: 1000, ibv: 1e-5 }),
  'led_red': M('D', { is: 1e-22, rs: 2.5, n: 1.5 }),
  'led': M('D', { is: 1e-22, rs: 2.5, n: 1.5 }),
  'led_green': M('D', { is: 1e-25, rs: 3, n: 1.6 }),
  'bzx55c4v7': M('D', { is: 1e-14, rs: 5, n: 1, bv: 4.7, ibv: 5e-3 }),
  '1n4733': M('D', { is: 1e-14, rs: 2, n: 1, bv: 5.1, ibv: 5e-3 }),
  '1n4742': M('D', { is: 1e-14, rs: 3, n: 1, bv: 12, ibv: 5e-3 }),

  // --- bipolar ------------------------------------------------------------
  '2n3904': M('NPN', { is: 6.734e-15, bf: 416.4, nf: 1, vaf: 74.03, ikf: 0.06678, ise: 6.734e-15, ne: 1.259, br: 0.7371, nr: 1, rb: 10, rc: 1 }),
  // 2N1309 (TO-5 germanium PNP). Fitted to the DC operating point of Richard Heidrick's own
  // LTspice sim of his Reverse Parallel Fuzz (Ge side), which uses the 2N1309 model from his LTspice
  // component library (standard.bjt, the free library that ships with LTspice and is mirrored on
  // ltwiki.org). Fitted here from scratch: all three stages' Ic and Ib within 0.5% of that sim.
  // Consistent with the Central Semiconductor datasheet (hFE >= 20 @ 10 mA, VCE(sat) 0.2 V).
  '2n1309': M('PNP', { is: 1.707e-8, bf: 145.4, nf: 1.26, vaf: 35, ikf: 0.25, ise: 6.959e-9, ne: 1.748, br: 6, nr: 1.26, rb: 60, rc: 1.5, re: 0.5 }),
  '2n3906': M('PNP', { is: 1.41e-15, bf: 180.7, nf: 1, vaf: 18.7, ikf: 0.08, ise: 0, ne: 1.5, br: 4.977, nr: 1, rb: 10, rc: 2.5 }),
  '2n5088': M('NPN', { is: 5.911e-15, bf: 1122, nf: 1, vaf: 62.37, ikf: 0.0154, ise: 5.911e-15, ne: 1.394, br: 1.271, nr: 1, rb: 10, rc: 1.61 }),
  '2n5089': M('NPN', { is: 5.911e-15, bf: 1434, nf: 1, vaf: 62.37, ikf: 0.0154, ise: 5.911e-15, ne: 1.394, br: 1.262, nr: 1, rb: 10, rc: 1.61 }),
  'bc549c': M('NPN', { is: 7.049e-15, bf: 381.7, nf: 1, vaf: 21.84, ikf: 0.1, ise: 7.049e-15, ne: 1.5, br: 2.5, nr: 1, rb: 10, rc: 1 }),
  'bc109': M('NPN', { is: 1.8e-14, bf: 400, nf: 1, vaf: 35, ikf: 0.08, ise: 5e-14, ne: 1.46, br: 35.5, nr: 1, rb: 10, rc: 1 }),
  'bc109c': M('NPN', { is: 1.8e-14, bf: 520, nf: 1, vaf: 35, ikf: 0.08, ise: 5e-14, ne: 1.46, br: 35.5, nr: 1, rb: 10, rc: 1 }),
  '2sc1815': M('NPN', { is: 2.04e-15, bf: 400, nf: 1, vaf: 100, ikf: 0.1, ise: 1e-14, ne: 1.5, br: 3, nr: 1, rb: 10, rc: 1 }),
  '2n2222': M('NPN', { is: 14.34e-15, bf: 255.9, nf: 1, vaf: 74.03, ikf: 0.2847, ise: 14.34e-15, ne: 1.307, br: 6.092, nr: 1, rb: 10, rc: 1 }),
  // Germanium PNPs: large IS and leakage (ISE) are what give Ge fuzzes their bias sensitivity.
  'ac128': M('PNP', { is: 3e-6, bf: 90, nf: 1.15, vaf: 30, ikf: 0.3, ise: 100e-9, ne: 1.8, br: 5, nr: 1.15, rb: 80, rc: 2, re: 0.5 }),
  'nkt275': M('PNP', { is: 2.5e-6, bf: 75, nf: 1.15, vaf: 25, ikf: 0.1, ise: 80e-9, ne: 1.8, br: 4, nr: 1.15, rb: 100, rc: 3, re: 0.5 }),
  'oc44': M('PNP', { is: 2e-6, bf: 60, nf: 1.15, vaf: 20, ikf: 0.05, ise: 60e-9, ne: 1.8, br: 4, nr: 1.15, rb: 150, rc: 5, re: 1 }),
  'ac187': M('NPN', { is: 3e-6, bf: 90, nf: 1.15, vaf: 30, ikf: 0.3, ise: 100e-9, ne: 1.8, br: 5, nr: 1.15, rb: 80, rc: 2, re: 0.5 }),

  // --- JFETs --------------------------------------------------------------
  'j201': M('NJF', { vto: -0.8, beta: 1.304e-3, lambda: 2.25e-3, is: 114.5e-15, n: 1, rd: 1, rs: 1 }),
  '2n5457': M('NJF', { vto: -1.372, beta: 1.125e-3, lambda: 2.3e-3, is: 181.3e-15, n: 1, rd: 1, rs: 1 }),
  '2n5458': M('NJF', { vto: -2.1, beta: 1.0e-3, lambda: 2.3e-3, is: 181.3e-15, n: 1, rd: 1, rs: 1 }),
  'mpf102': M('NJF', { vto: -3.0, beta: 0.4e-3, lambda: 3e-3, is: 33.57e-15, n: 1, rd: 1, rs: 1 }),
  '2sk30a': M('NJF', { vto: -1.2, beta: 1.6e-3, lambda: 3e-3, is: 1e-14, n: 1 }),
  '2n5460': M('PJF', { vto: -2.0, beta: 1.2e-3, lambda: 5e-3, is: 1e-14, n: 1 }),

  // --- MOSFETs (level 1 approximations) -----------------------------------
  '2n7000': M('NMOS', { vto: 1.8, kp: 0.1, lambda: 0.01, rd: 1, rs: 0.5 }),
  'bs170': M('NMOS', { vto: 1.8, kp: 0.1, lambda: 0.01, rd: 1, rs: 0.5 }),
  'bs250': M('PMOS', { vto: -2.4, kp: 0.05, lambda: 0.01, rd: 2, rs: 1 }),
};

/**
 * Op amp macromodel presets. Recognised by subcircuit name when no .subckt of
 * that name is supplied (or the supplied one cannot be simulated).
 *   aol: open loop gain, gbw: Hz, sr: V/s, rin: ohm, rout: ohm,
 *   dropHi/dropLo: output headroom from V+ / V- in volts.
 */
export const OPAMP_PRESETS = {
  generic: { aol: 2e5, gbw: 1e6, sr: 0.5e6, rin: 2e6, rout: 75, dropHi: 1.5, dropLo: 1.5 },
  tl072: { aol: 2e5, gbw: 3e6, sr: 13e6, rin: 1e12, rout: 75, dropHi: 1.5, dropLo: 1.5 },
  tl062: { aol: 3e5, gbw: 1e6, sr: 3.5e6, rin: 1e12, rout: 100, dropHi: 1.5, dropLo: 1.5 },
  lf353: { aol: 1e5, gbw: 4e6, sr: 13e6, rin: 1e12, rout: 75, dropHi: 1.5, dropLo: 1.5 },
  jrc4558: { aol: 3e5, gbw: 3e6, sr: 1e6, rin: 5e6, rout: 75, dropHi: 1.0, dropLo: 1.0 },
  ne5532: { aol: 1e5, gbw: 10e6, sr: 9e6, rin: 3e5, rout: 30, dropHi: 1.5, dropLo: 1.5 },
  lm358: { aol: 1e5, gbw: 1e6, sr: 0.3e6, rin: 2e6, rout: 100, dropHi: 1.5, dropLo: 0.02 },
  lm741: { aol: 2e5, gbw: 1e6, sr: 0.5e6, rin: 2e6, rout: 75, dropHi: 2, dropLo: 2 },
  opa2134: { aol: 1e6, gbw: 8e6, sr: 20e6, rin: 1e13, rout: 40, dropHi: 1.0, dropLo: 1.0 },
  ideal: { aol: 1e6, gbw: 100e6, sr: 1e9, rin: 1e12, rout: 1, dropHi: 0, dropLo: 0 },
};

const OPAMP_ALIASES = {
  opamp: 'generic', opamp2: 'generic', universalopamp: 'generic', universalopamp2: 'generic',
  level1: 'generic', level2: 'generic', idealopamp: 'ideal', ideal_opamp: 'ideal',
  tl071: 'tl072', tl072: 'tl072', tl074: 'tl072', tl081: 'tl072', tl082: 'tl072', tl084: 'tl072',
  tl061: 'tl062', tl062: 'tl062', tl064: 'tl062',
  lf351: 'lf353', lf353: 'lf353',
  jrc4558: 'jrc4558', rc4558: 'jrc4558', njm4558: 'jrc4558', '4558': 'jrc4558', jrc4558d: 'jrc4558', rc4559: 'jrc4558',
  ne5532: 'ne5532', ne5534: 'ne5532', '5532': 'ne5532',
  lm358: 'lm358', lm324: 'lm358', lm2904: 'lm358',
  lm741: 'lm741', ua741: 'lm741', '741': 'lm741',
  opa2134: 'opa2134', opa134: 'opa2134', opa2604: 'opa2134',
};

/** Returns the preset key for an op amp subcircuit name, or null. */
export function opampPresetFor(name) {
  const k = String(name).toLowerCase().replace(/[-\s]/g, '');
  if (OPAMP_ALIASES[k]) return OPAMP_ALIASES[k];
  // strip common package suffixes: TL072CP, NE5532P, JRC4558D ...
  for (const [alias, preset] of Object.entries(OPAMP_ALIASES)) {
    if (alias.length >= 4 && k.startsWith(alias)) return preset;
  }
  return null;
}
