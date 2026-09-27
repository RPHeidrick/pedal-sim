/**
 * SPICE netlist parser (syntax level).
 *
 * Reads the text of an LTspice ("View > SPICE Netlist") or KiCad ("Export >
 * Netlist > SPICE") netlist and returns a scoped syntax tree: element cards,
 * .model / .subckt / .param definitions and pedal annotations. It does not
 * interpret element semantics; that is engine/parsers/elaborate.js.
 *
 * Handled syntax:
 *   - first line title (SPICE convention) when it is a comment or not an element
 *   - '+' continuation lines, '*' comment lines, ';' and ' $ ' inline comments
 *   - parentheses/commas as separators outside {braces}; "k = v" joined to "k=v"
 *   - .include / .inc / .lib <file> [section] resolved against uploaded files
 *   - nested .subckt ... .ends, .model, .param, .global, .end, .control blocks
 *   - pedal annotations in comments:  *@pot NAME taper=log label="Gain"
 *                                     *@switch NAME label="Mode"
 *                                     *@pedal name="My Fuzz"
 */

/** LTspice / KiCad libraries that are implicitly available in those tools. */
const TOOL_BUILTIN_LIBS = /^(opamp\.sub|universalopamp2?\.lib|ltc\d*\.lib|lt[a-z]*\.lib|adi\d*\.lib|standard\.(bjt|dio|jft|mos|cap|ind|res|bead)|.*\.asy)$/i;

/** Directives that describe analyses the pedal engine ignores on purpose. */
const IGNORED_DIRECTIVES = new Set([
  '.tran', '.ac', '.dc', '.op', '.noise', '.four', '.tf', '.meas', '.measure', '.step', '.save',
  '.probe', '.backanno', '.print', '.plot', '.options', '.option', '.opt', '.temp', '.width',
  '.nodeset', '.ic', '.wave', '.loadbias', '.savebias', '.net', '.ferret', '.text', '.csparam',
]);

/**
 * @typedef {Object} Diagnostic
 * @property {'error'|'warning'|'info'} level
 * @property {string} message
 * @property {string} [file]
 * @property {number} [line]
 */

/**
 * @typedef {Object} Card  one element line after continuation merging
 * @property {string} name   element name as written (e.g. "R1", "XVOL")
 * @property {string} kind   upper-case first letter
 * @property {string[]} tokens all tokens including the name
 * @property {string} file
 * @property {number} line
 */

/**
 * @typedef {Object} Scope
 * @property {Card[]} cards
 * @property {Map<string, Object>} models   lower-case name -> {name,type,params,flags,line,file}
 * @property {Map<string, Object>} subckts  lower-case name -> {name,pins,params,scope,line,file}
 * @property {Array<[string,string]>} params  ordered .param assignments (raw expressions)
 */

function newScope() {
  return { cards: [], models: new Map(), subckts: new Map(), params: [] };
}

/**
 * Split a logical line into tokens. {..} and '..' groups are kept intact;
 * parentheses and commas outside them act as whitespace. "a = b" joins.
 */
export function tokenize(line) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  const flush = () => { if (cur) { out.push(cur); cur = ''; } };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (depth > 0) {
      cur += c;
      if (c === '{') depth++;
      else if (c === '}') depth--;
      continue;
    }
    if (c === '{') { depth = 1; cur += c; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (/\s|[(),]/.test(c)) { flush(); continue; }
    if (c === '=') { flush(); out.push('='); continue; }
    cur += c;
  }
  flush();
  // join "k = v" into "k=v"
  const joined = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === '=' && joined.length && i + 1 < out.length) {
      joined[joined.length - 1] += '=' + out[++i];
    } else if (out[i] !== '=') {
      joined.push(out[i]);
    }
  }
  return joined;
}

/** Parse "k=v" tokens (and bare flags) into an object with lower-case keys. */
export function parseKeyValues(tokens) {
  const params = {};
  const flags = [];
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq > 0) params[t.slice(0, eq).toLowerCase()] = t.slice(eq + 1).replace(/^["']|["']$/g, '');
    else if (t.toLowerCase() !== 'params:') flags.push(t.toLowerCase());
  }
  return { params, flags };
}

function stripInlineComment(line) {
  // ';' starts a comment anywhere (LTspice). ' $ ' starts one in ngspice/KiCad.
  let s = line;
  const semi = s.indexOf(';');
  if (semi >= 0) s = s.slice(0, semi);
  const dollar = s.search(/\s\$(\s|$)/);
  if (dollar >= 0) s = s.slice(0, dollar);
  return s;
}

function parseAnnotation(text, file, line) {
  const body = text.replace(/^[*;]@/, '').trim();
  const toks = tokenize(body);
  if (!toks.length) return null;
  const kind = toks[0].toLowerCase();
  const rest = toks.slice(1);
  let target = null;
  if (rest.length && !rest[0].includes('=')) target = rest.shift();
  const { params } = parseKeyValues(rest);
  return { kind, target, params, file, line };
}

/** Looks like an element card with enough fields to be real, used for the title heuristic. */
const MIN_TOKENS = { R: 4, C: 4, L: 4, V: 3, I: 3, D: 4, Q: 5, J: 5, M: 5, X: 3, E: 6, G: 6, F: 5, H: 5, B: 4, S: 5, K: 4, T: 5, W: 5 };
function looksLikeElement(line) {
  const t = tokenize(line);
  if (!/^[a-z][\w.:#$-]*$/i.test(t[0] || '')) return false;
  const kind = t[0][0].toUpperCase();
  if (!MIN_TOKENS[kind] || t.length < MIN_TOKENS[kind]) return false;
  // Passive values must look numeric ("Fuzz clone build" is a title, "R1 a b 1k" is not)
  if ('RCL'.includes(kind)) return /^[\d.{+-]/.test(t[3]) || t[3].includes('=');
  if (kind === 'B') return t.some((x) => x.includes('='));
  return true;
}

/**
 * Parse netlist text.
 * @param {string} text
 * @param {Object} [opts]
 * @param {string} [opts.fileName]
 * @param {Record<string,string>} [opts.files] uploaded companions (name -> text) for .include
 * @returns {{title:string, root:Scope, globals:Set<string>, annotations:Object[], diagnostics:Diagnostic[], files:string[]}}
 */
export function parseNetlist(text, opts = {}) {
  const fileName = opts.fileName || 'netlist';
  const files = new Map();
  for (const [k, v] of Object.entries(opts.files || {})) files.set(baseName(k).toLowerCase(), { name: k, text: v });

  const diagnostics = [];
  const annotations = [];
  const globals = new Set();
  const root = newScope();
  const includeStack = [];
  const usedFiles = [fileName];
  let title = '';
  const diag = (level, message, file, line) => diagnostics.push({ level, message, file, line });

  // Scope stack for nested .subckt definitions.
  const stack = [{ scope: root, def: null }];
  const top = () => stack[stack.length - 1];
  let ended = false;

  function processFile(src, name, isMain) {
    const logical = joinContinuations(src, name, diag);
    let first = isMain;
    let skipControl = false;
    for (const { text: raw, line } of logical) {
      if (ended) return;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      if (first) {
        first = false;
        if (trimmed.startsWith('*') || trimmed.startsWith(';')) {
          title = trimmed.replace(/^[*;]+\s*/, '');
          if (/^[*;]@/.test(trimmed)) { const a = parseAnnotation(trimmed, name, line); if (a) annotations.push(a); }
          continue;
        }
        if (!trimmed.startsWith('.') && !looksLikeElement(stripInlineComment(trimmed))) {
          title = trimmed;
          continue;
        }
        if (!trimmed.startsWith('.')) {
          diag('info', 'First line parsed as an element; strict SPICE would treat it as the title.', name, line);
        }
      }

      if (/^[*;]@/.test(trimmed)) {
        const a = parseAnnotation(trimmed, name, line);
        if (a) annotations.push(a);
        continue;
      }
      if (trimmed.startsWith('*')) continue;

      const content = stripInlineComment(trimmed).trim();
      if (!content) continue;

      if (skipControl) {
        if (/^\.endc\b/i.test(content)) skipControl = false;
        continue;
      }

      if (content.startsWith('.')) {
        const toks = tokenize(content);
        if (!toks.length) continue;
        const dir = toks[0].toLowerCase();
        handleDirective(dir, toks, content, name, line, () => { skipControl = true; });
        continue;
      }

      const toks = tokenize(content);
      if (!toks.length) continue; // a line of only punctuation: nothing to read
      top().scope.cards.push({ name: toks[0], kind: toks[0][0].toUpperCase(), tokens: toks, file: name, line });
    }
  }

  function handleDirective(dir, toks, content, file, line, startControl) {
    const cur = top();
    switch (dir) {
      case '.title':
        title = content.slice(6).trim();
        return;
      case '.end':
        if (stack.length > 1) diag('error', `.end reached inside .subckt ${cur.def.name}`, file, line);
        ended = includeStack.length === 0;
        return;
      case '.control':
        startControl();
        return;
      case '.global':
        for (const n of toks.slice(1)) globals.add(n.toLowerCase());
        return;
      case '.param':
      case '.params': {
        const { params } = parseKeyValues(toks.slice(1));
        for (const [k, v] of Object.entries(params)) cur.scope.params.push([k, v]);
        return;
      }
      case '.model': {
        if (toks.length < 3) { diag('error', 'Malformed .model (need name and type)', file, line); return; }
        const mname = toks[1];
        let type = toks[2];
        let rest = toks.slice(3);
        if (/^ako:/i.test(type)) {
          diag('error', `.model ${mname}: AKO models are not supported; write the parameters out in full`, file, line);
          return;
        }
        const { params, flags } = parseKeyValues(rest);
        const key = mname.toLowerCase();
        if (cur.scope.models.has(key)) diag('warning', `.model ${mname} redefined; the later definition wins`, file, line);
        cur.scope.models.set(key, { name: mname, type: type.toUpperCase(), params, flags, file, line });
        return;
      }
      case '.subckt': {
        if (toks.length < 2) { diag('error', 'Malformed .subckt', file, line); return; }
        const sname = toks[1];
        const pins = [];
        const kv = [];
        let inParams = false;
        for (const t of toks.slice(2)) {
          if (t.toLowerCase() === 'params:') { inParams = true; continue; }
          if (inParams || t.includes('=')) kv.push(t);
          else pins.push(t);
        }
        const { params } = parseKeyValues(kv);
        const def = { name: sname, pins, params, scope: newScope(), file, line };
        const key = sname.toLowerCase();
        if (cur.scope.subckts.has(key)) diag('warning', `.subckt ${sname} redefined; the later definition wins`, file, line);
        cur.scope.subckts.set(key, def);
        stack.push({ scope: def.scope, def });
        return;
      }
      case '.ends': {
        if (stack.length === 1) { diag('error', '.ends without matching .subckt', file, line); return; }
        stack.pop();
        return;
      }
      case '.include':
      case '.inc':
      case '.lib': {
        const target = (toks[1] || '').replace(/^["']|["']$/g, '');
        const section = toks[2];
        if (!target) { diag('error', `${dir} without a file name`, file, line); return; }
        const base = baseName(target);
        const f = files.get(base.toLowerCase());
        if (!f) {
          if (TOOL_BUILTIN_LIBS.test(base)) {
            diag('info', `${dir} ${base}: LTspice/KiCad built-in library; built-in models are used instead`, file, line);
          } else {
            diag('warning', `${dir} ${base}: file not uploaded. Upload it alongside the netlist (models/subcircuits it defines will be missing).`, file, line);
          }
          return;
        }
        if (includeStack.includes(f.name)) { diag('error', `Recursive include of ${f.name}`, file, line); return; }
        includeStack.push(f.name);
        if (!usedFiles.includes(f.name)) usedFiles.push(f.name);
        let src = f.text;
        if (dir === '.lib' && section) src = extractLibSection(src, section);
        processFile(src, f.name, false);
        includeStack.pop();
        if (ended && includeStack.length === 0) ended = false; // .end inside an include only ends that file
        return;
      }
      case '.endl':
        return;
      case '.func':
        diag('warning', '.func is not supported; expressions that call it will fail', file, line);
        return;
      default:
        if (IGNORED_DIRECTIVES.has(dir)) {
          diag('info', `${dir} ignored (analysis/simulator directive)`, file, line);
        } else {
          diag('warning', `Unknown directive ${dir} ignored`, file, line);
        }
    }
  }

  processFile(String(text).replace(/^﻿/, ''), fileName, true);
  if (stack.length > 1) diag('error', `Missing .ends for .subckt ${top().def.name}`, fileName);

  return { title, root, globals, annotations, diagnostics, files: usedFiles };
}

/** Merge '+' continuation lines; return [{text, line}] with 1-based line numbers. */
function joinContinuations(src, file, diag) {
  const lines = src.split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\+/.test(l)) {
      if (!out.length) { diag('error', 'Continuation line with nothing to continue', file, i + 1); continue; }
      out[out.length - 1].text += ' ' + l.replace(/^\s*\+/, '');
    } else {
      out.push({ text: l, line: i + 1 });
    }
  }
  return out;
}

function extractLibSection(src, section) {
  const lines = src.split(/\r\n|\r|\n/);
  const out = [];
  let inside = false;
  const want = section.toLowerCase();
  for (const l of lines) {
    const t = l.trim().toLowerCase();
    if (!inside && t.startsWith('.lib') && t.split(/\s+/)[1] === want) { inside = true; continue; }
    if (inside && t.startsWith('.endl')) break;
    if (inside) out.push(l);
  }
  return out.length ? out.join('\n') : src;
}

export function baseName(p) {
  return String(p).split(/[\\/]/).pop();
}
