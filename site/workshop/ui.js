/**
 * The Pedal Workshop section: "Describe your sound" (words in, board out) and
 * "Build a pedal" (pick a circuit and the parts, name it, colour it, hear it, keep it).
 * Figma: "Phase 11 · Arcade" page, "Pedal Workshop" frames.
 */
import { describeSound, EXAMPLES } from './describe.js';
import { TEMPLATES, templateById, defaults } from './templates.js';
import { loadCreations, saveCreations, newId, creationEntry } from './store.js';

const COLORS = ['#ff7a1a', '#c9412f', '#d7b43c', '#3f9a5a', '#3a6fb5', '#8b4bb0', '#e0457b', '#2bb3a8', '#e8e2d6', '#26211d'];

/**
 * @param {HTMLElement} root  the #workshop section
 * @param {{ entryByKey, registerEntry, unregisterEntry, addPedal, replaceBoard, removeFromBoard, toast, afterChange, openBuild }} api
 */
export function mountWorkshop(root, api) {
  let creations = loadCreations();
  for (const c of creations) { try { api.registerEntry(creationEntry(c)); } catch { /* skip one bad creation, keep the page working */ } }

  root.innerHTML = `
    <div class="section-head">
      <p class="eyebrow">Pedal Workshop</p>
      <h2 class="section-title">Make your own sound</h2>
      <p class="dim">Describe the sound you want in plain words, or build your own pedal from real circuits: pick the transistors, the diodes and the chip, and hear it straight away.</p>
    </div>
    <div class="ws-tabs seg" role="tablist" aria-label="Pedal Workshop">
      <button role="tab" data-tab="describe" aria-selected="true">Describe your sound</button>
      <button role="tab" data-tab="build" aria-selected="false">Build a pedal</button>
      <button role="tab" data-tab="mine" aria-selected="false">My creations <span class="count" data-el="count"></span></button>
    </div>
    <div class="ws-pane" data-pane="describe">
      <form class="ws-describe" autocomplete="off">
        <label class="ws-say"><span class="sr-only">Describe your sound</span>
          <input type="text" maxlength="120" placeholder="Try: warm bluesy crunch with a little more bass" data-el="say">
        </label>
        <button class="btn-primary" type="submit">Build my board</button>
      </form>
      <div class="ws-examples" data-el="examples"></div>
      <div class="ws-result" data-el="result" hidden></div>
    </div>
    <div class="ws-pane" data-pane="build" hidden>
      <div class="ws-templates" role="radiogroup" aria-label="Kind of pedal"></div>
      <div class="ws-bench">
        <div class="ws-options" data-el="options"></div>
        <div class="ws-finish">
          <label class="ws-name">Name it<input type="text" maxlength="24" data-el="name"></label>
          <div class="ws-colors" role="radiogroup" aria-label="Colour"></div>
          <div class="ws-actions">
            <button class="btn-primary" data-act="try">Try it on the board</button>
            <button class="btn-secondary" data-act="save">Save to my library</button>
          </div>
          <p class="hint" data-el="note">Trying it adds it to the end of your board. Saved pedals appear in the library and stay in this browser.</p>
        </div>
      </div>
    </div>
    <div class="ws-pane" data-pane="mine" hidden><div class="ws-mine" data-el="mine"></div></div>`;
  const $ = (s) => root.querySelector(s);

  // ---- tabs
  const tabs = root.querySelectorAll('.ws-tabs [data-tab]');
  const show = (id) => {
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    root.querySelectorAll('.ws-pane').forEach((p) => { p.hidden = p.dataset.pane !== id; });
    if (id === 'mine') renderMine();
  };
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

  // ---- describe
  const say = $('[data-el=say]');
  for (const ex of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ws-chip'; b.textContent = ex;
    b.addEventListener('click', () => { say.value = ex; run(); });
    $('[data-el=examples]').append(b);
  }
  const result = $('[data-el=result]');
  let last = null;
  function run() {
    const text = say.value.trim();
    if (!text) { say.focus(); return; }
    last = describeSound(text);
    result.hidden = false;
    result.innerHTML = `<div class="ws-res-head"><h3></h3><div class="ws-res-pedals"></div></div><ul class="ws-why"></ul>
      <div class="ws-actions"><button class="btn-primary" data-act="load">Load this board</button><button class="btn-secondary" data-act="again">Change the words</button></div>`;
    result.querySelector('h3').textContent = `“${last.name}”`;
    const row = result.querySelector('.ws-res-pedals');
    for (const p of last.pedals) {
      const e = api.entryByKey(p.key);
      const c = document.createElement('div');
      c.className = 'ws-mini';
      c.style.setProperty('--pedal', e.color);
      c.innerHTML = '<b></b><small></small>';
      c.querySelector('b').textContent = e.variants.length > 1 ? `${e.name} (${p.variant ? 'Ge' : 'Si'})` : e.name;
      c.querySelector('small').textContent = Object.entries(p.values).map(([k, v]) => `${k} ${(v * 10).toFixed(1)}`).join(' · ');
      row.append(c);
    }
    result.querySelector('.ws-why').innerHTML = last.why.map((w) => `<li></li>`).join('');
    result.querySelectorAll('.ws-why li').forEach((li, i) => { li.textContent = last.why[i]; });
    result.querySelector('[data-act=load]').addEventListener('click', () => api.loadBoard(last));
    result.querySelector('[data-act=again]').addEventListener('click', () => { say.focus(); say.select(); });
  }
  $('.ws-describe').addEventListener('submit', (e) => { e.preventDefault(); run(); });

  // ---- build
  let tpl = TEMPLATES[1], opts = defaults(tpl), color = tpl.color, editing = null;
  const tplRow = $('.ws-templates');
  for (const t of TEMPLATES) {
    const b = document.createElement('button');
    b.className = 'ws-tpl'; b.dataset.id = t.id; b.setAttribute('role', 'radio');
    b.style.setProperty('--pedal', t.color);
    b.innerHTML = '<span class="ws-tpl-box" aria-hidden="true"></span><b></b><small></small>';
    b.querySelector('b').textContent = t.name; b.querySelector('small').textContent = t.blurb;
    b.addEventListener('click', () => { tpl = t; opts = defaults(t); color = t.color; editing = null; $('[data-el=name]').value = ''; paintBuild(); });
    tplRow.append(b);
  }
  const colorRow = root.querySelector('.ws-colors');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'ws-color'; b.style.background = c; b.dataset.c = c; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', `Colour ${c}`);
    b.addEventListener('click', () => { color = c; paintBuild(); });
    colorRow.append(b);
  }
  function paintBuild() {
    tplRow.querySelectorAll('.ws-tpl').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === tpl.id)));
    colorRow.querySelectorAll('.ws-color').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.c === color)));
    const box = $('[data-el=options]');
    box.replaceChildren();
    for (const o of tpl.options) {
      const g = document.createElement('div');
      g.className = 'ws-opt';
      g.innerHTML = '<h4></h4><p class="hint"></p><div class="ws-choices" role="radiogroup"></div>';
      g.querySelector('h4').textContent = o.name; g.querySelector('.hint').textContent = o.help;
      const row = g.querySelector('.ws-choices');
      row.setAttribute('aria-label', o.name);
      for (const c of o.choices) {
        const b = document.createElement('button');
        b.className = 'ws-choice'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(opts[o.id] === c.id));
        b.innerHTML = '<b></b><small></small>';
        b.querySelector('b').textContent = c.name; b.querySelector('small').textContent = c.note;
        b.addEventListener('click', () => { opts = { ...opts, [o.id]: c.id }; paintBuild(); });
        row.append(b);
      }
      box.append(g);
    }
    $('[data-el=name]').placeholder = `My ${tpl.name.toLowerCase()}`;
    root.querySelector('[data-act=save]').textContent = editing ? 'Save changes' : 'Save to my library';
  }
  paintBuild();
  const recipe = () => ({ id: editing ? editing.id : newId(), template: tpl.id, options: { ...opts }, color, name: ($('[data-el=name]').value.trim() || `My ${tpl.name.toLowerCase()}`).slice(0, 24) });
  root.querySelector('[data-act=try]').addEventListener('click', async () => {
    const c = { ...recipe(), id: 'trial' };
    api.unregisterEntry('custom:trial');
    api.removeFromBoard('custom:trial');
    const e = creationEntry(c);
    e.name = `${c.name} (trying)`;
    api.registerEntry(e, { hidden: true });
    await api.addPedal(e.key);
    api.toast(`${c.name} is on the board. Turn its knobs, then Save to my library to keep it.`);
  });
  root.querySelector('[data-act=save]').addEventListener('click', () => {
    const c = recipe();
    creations = creations.filter((x) => x.id !== c.id).concat(c);
    saveCreations(creations);
    api.unregisterEntry(`custom:${c.id}`);
    api.registerEntry(creationEntry(c));
    api.renameOnBoard('custom:trial', `custom:${c.id}`); // the pedal you were trying becomes the saved one
    api.unregisterEntry('custom:trial');
    editing = null;
    api.afterChange();
    api.toast(`Saved "${c.name}" to your library.`, { label: 'Add to board', run: () => api.addPedal(`custom:${c.id}`) });
    paintBuild();
    updateCount();
  });

  // ---- my creations
  const updateCount = () => { $('[data-el=count]').textContent = creations.length ? String(creations.length) : ''; };
  updateCount();
  function renderMine() {
    const box = $('[data-el=mine]');
    box.replaceChildren();
    if (!creations.length) { box.innerHTML = '<p class="lib-empty">Nothing here yet. Build a pedal and press Save to my library.</p>'; return; }
    for (const c of creations) {
      const e = api.entryByKey(`custom:${c.id}`);
      const card = document.createElement('article');
      card.className = 'lib-card'; card.style.setProperty('--pedal', e.color);
      card.innerHTML = `<div class="lib-swatch" aria-hidden="true"></div><div class="lib-body"><div class="lib-title"><h4></h4><span class="badge mine">My creation</span></div><p class="lib-blurb"></p></div>
        <div class="ws-card-actions"><button class="add" data-act="add">Add</button><button class="text-btn" data-act="build">Build it</button><button class="text-btn" data-act="edit">Edit</button><button class="text-btn" data-act="del">Delete</button></div>`;
      card.querySelector('h4').textContent = c.name; card.querySelector('.lib-blurb').textContent = e.blurb;
      card.querySelector('[data-act=add]').addEventListener('click', () => api.addPedal(e.key));
      if (api.openBuild) card.querySelector('[data-act=build]').addEventListener('click', () => api.openBuild(e));
      else card.querySelector('[data-act=build]').remove();
      card.querySelector('[data-act=edit]').addEventListener('click', () => {
        tpl = templateById(c.template); opts = { ...defaults(tpl), ...c.options }; color = c.color; editing = c;
        $('[data-el=name]').value = c.name; show('build'); paintBuild();
      });
      card.querySelector('[data-act=del]').addEventListener('click', () => {
        creations = creations.filter((x) => x !== c); saveCreations(creations);
        api.removeFromBoard(e.key); api.unregisterEntry(e.key); api.afterChange(); renderMine(); updateCount();
        api.toast(`Deleted "${c.name}".`);
      });
      box.append(card);
    }
  }
  return { show };
}
