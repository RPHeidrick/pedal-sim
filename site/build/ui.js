/**
 * "Build it yourself" sheet for any pedal: parts list, schematic, wiring, drill template and
 * steps, with downloads. Everything is made here in the browser from the pedal's netlist:
 * plain text and pictures (CSV, SVG, the netlist), nothing to install or run.
 * Figma: "Phase 12 · Build it" page.
 */
import { readNetlist, partsList, partsCsv, enclosureFor } from './parts.js';
import { schematicSvg } from './schematic.js';
import { drillSvg, wiringSteps, wiringSvg, buildSteps } from './drill.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pedal';

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {{name:string, color:string, origin:string, variants:{name:string, file:string, netlist?:string}[]}} entry
 * @param {number} variant
 * @param {(v)=>Promise<string>} getText  netlist text for a variant
 */
export async function openBuildSheet(dialog, entry, variant, getText) {
  const v = entry.variants[variant] || entry.variants[0];
  const text = await getText(v);
  const net = readNetlist(text);
  const title = entry.variants.length > 1 ? v.name.replace(/\s*·\s*/, ' (') + (v.name.includes('·') ? ')' : '') : entry.name;
  const rows = partsList(net);
  const box = enclosureFor(net.pots.length);
  const count = rows.filter((r) => r.qty).reduce((a, r) => a + r.qty, 0);
  const schem = schematicSvg(net, { title });
  const drill = drillSvg(net, title);
  const mine = entry.origin === 'original' ? '<p class="bs-note">This is Richard Heidrick\'s own design. His design notes are in the designs folder of the project on GitHub.</p>'
    : entry.origin === 'custom' ? '<p class="bs-note">You made this one in the Pedal Workshop.</p>' : '<p class="bs-note">A generic version of a classic circuit, written for this site.</p>';
  dialog.innerHTML = `
    <div class="bs-head" style="--pedal:${entry.color}">
      <span class="bs-swatch" aria-hidden="true"></span>
      <div><p class="eyebrow">Build it yourself</p><h3>${esc(title)}</h3><p class="dim">${count} parts · ${net.pots.length} knob${net.pots.length === 1 ? '' : 's'} · enclosure ${box.name} · ${net.supply < 0 ? 'negative supply (PNP germanium)' : '9 V DC, centre negative'}</p></div>
      <button class="info-close" data-act="close" aria-label="Close">×</button>
    </div>
    ${mine}
    <div class="seg bs-tabs" role="tablist" aria-label="Build sheet">
      ${['Parts', 'Schematic', 'Wiring', 'Drill template', 'Steps'].map((t, i) => `<button role="tab" data-tab="${i}" aria-selected="${i === 0}">${t}</button>`).join('')}
    </div>
    <section class="bs-pane" data-pane="0"><table class="bs-table"><thead><tr><th>Part</th><th>Qty</th><th>Where</th><th>Notes</th></tr></thead><tbody>
      ${rows.map((r, i) => `${i === 0 || rows[i - 1].group !== r.group ? `<tr class="bs-group"><td colspan="4">${esc(r.group)}</td></tr>` : ''}<tr><td><b>${esc(r.value)}</b></td><td>${r.qty || ''}</td><td class="mono">${esc(r.refs)}</td><td>${esc(r.note)}</td></tr>`).join('')}
    </tbody></table></section>
    <section class="bs-pane" data-pane="1" hidden><div class="bs-art">${schem}</div><p class="hint">Each part shows its name (R1, C2 …) and value. The small tags are net names: every pin with the same tag is connected. Resistors show the nearest value you can buy.</p></section>
    <section class="bs-pane" data-pane="2" hidden><div class="bs-art bs-wiring">${wiringSvg()}</div><ol class="bs-steps">${wiringSteps(net).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>
    <section class="bs-pane" data-pane="3" hidden><div class="bs-art">${drill}</div><p class="hint">Download it and print at 100% (actual size): the 50 mm ruler on the sheet should measure exactly 50 mm.</p></section>
    <section class="bs-pane" data-pane="4" hidden><ol class="bs-steps">${buildSteps(net).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>
    <div class="bs-downloads">
      <span class="dim">Download:</span>
      <button class="btn-secondary" data-dl="csv">Parts list (CSV)</button>
      <button class="btn-secondary" data-dl="schem">Schematic (SVG)</button>
      <button class="btn-secondary" data-dl="drill">Drill template (SVG)</button>
      <button class="btn-secondary" data-dl="cir">Circuit (netlist)</button>
      <button class="btn-primary" data-dl="print">Print the build sheet</button>
    </div>
    <p class="hint bs-safe">All files are made here in your browser: a spreadsheet file, pictures and a plain text circuit file. Nothing to install or run.</p>`;
  const tabs = dialog.querySelectorAll('.bs-tabs [data-tab]');
  tabs.forEach((b) => b.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    dialog.querySelectorAll('.bs-pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  dialog.querySelector('[data-act=close]').addEventListener('click', () => dialog.close());
  const base = slug(title);
  dialog.querySelector('[data-dl=csv]').addEventListener('click', () => download(`${base}-parts.csv`, `\ufeff${partsCsv(net)}`, 'text/csv;charset=utf-8'));
  dialog.querySelector('[data-dl=schem]').addEventListener('click', () => download(`${base}-schematic.svg`, schem, 'image/svg+xml'));
  dialog.querySelector('[data-dl=drill]').addEventListener('click', () => download(`${base}-drill-template.svg`, drill, 'image/svg+xml'));
  dialog.querySelector('[data-dl=cir]').addEventListener('click', () => download(`${base}.cir`, text, 'text/plain'));
  dialog.querySelector('[data-dl=print]').addEventListener('click', () => {
    dialog.querySelectorAll('.bs-pane').forEach((p) => { p.hidden = false; });
    document.body.classList.add('printing-sheet');
    const done = () => { document.body.classList.remove('printing-sheet'); tabs[0].click(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  });
  if (!dialog.open) dialog.showModal();
}
