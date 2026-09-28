/**
 * The "Pedal library" section below the board: one card per pedal, in columns by kind,
 * plus the "New to effects?" explainer cards.
 */
import { $, didThing, hooks, tourActive } from '../core.js';
import { EFFECT_TYPES, KNOB_ROLES } from '../../circuits/index.js';
import { entries, typeName, isDigital } from './library.js';
import { addPedal, markDirty } from './chain.js';

const COLUMNS = [
  { cat: 'gain', title: 'Gain & fuzz' },
  { cat: 'modulation', title: 'Modulation' },
  { cat: 'time', title: 'Delay & reverb' },
  { cat: 'filter', title: 'Filter & tone' },
];

/** Draw (or redraw, after a Workshop change) every library card. */
export function renderLibrary() {
  const root = $('lib-cols');
  root.replaceChildren();
  for (const col of COLUMNS) {
    const sec = document.createElement('div');
    sec.className = 'lib-col';
    const items = entries.filter((e) => e.category === col.cat && !e.hidden);
    sec.innerHTML = `<h3>${col.title} <span class="count">${items.length}</span></h3>`;
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'lib-empty';
      empty.textContent = 'More coming soon.';
      sec.append(empty);
    }
    for (const e of items) sec.append(libraryCard(e));
    root.append(sec);
  }
}

function libraryCard(e) {
  const card = document.createElement('article');
  card.className = 'lib-card';
  card.style.setProperty('--pedal', e.color);
  card.innerHTML = `
    <div class="lib-swatch" aria-hidden="true"></div>
    <div class="lib-body">
      <div class="lib-title"><h4></h4><span class="fx-chip"></span><span class="badge"></span></div>
      <p class="lib-sounds"></p>
      <details class="lib-more"><summary>More</summary><p class="lib-blurb"></p></details>
    </div>
    <div class="lib-actions"></div>`;
  card.querySelector('h4').textContent = e.name;
  const badge = card.querySelector('.badge');
  badge.textContent = e.origin === 'original' ? 'My design' : e.origin === 'custom' ? 'My creation' : isDigital(e) ? 'Digital model' : 'Classic';
  badge.classList.toggle('mine', e.origin === 'original' || e.origin === 'custom');
  badge.classList.toggle('digital', isDigital(e));
  card.querySelector('.fx-chip').textContent = typeName(e.type);
  card.querySelector('.lib-sounds').textContent = e.sounds || '';
  card.querySelector('.lib-blurb').textContent = e.blurb;
  // pedals without a one line sound description show their blurb straight away
  if (!e.sounds) { const more = card.querySelector('.lib-more'); more.replaceWith(more.querySelector('.lib-blurb')); }

  const addBtn = document.createElement('button');
  addBtn.className = 'add';
  addBtn.textContent = 'Add';
  addBtn.setAttribute('aria-label', `Add ${e.name} to the chain`);
  addBtn.addEventListener('click', () => addPedal(e.key).then(() => {
    markDirty();
    didThing('pedal');
    if (!tourActive()) $('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const build = document.createElement('button');
  build.className = 'text-btn';
  build.textContent = 'Build it';
  build.title = `Parts list, schematic, wiring and drill template for ${e.name}`;
  build.addEventListener('click', () => hooks.openBuild(e, 0));
  card.querySelector('.lib-actions').append(addBtn);
  if (!isDigital(e)) card.querySelector('.lib-actions').append(build); // a digital model has no circuit to build
  return card;
}

/** "What do effects do?": one plain-words card per effect family, then the knob names. */
export function renderTypes() {
  const root = $('fx-types');
  root.replaceChildren();
  const cardRow = (items, extraClass = '') => {
    const row = document.createElement('div');
    row.className = `fx-type-row${extraClass}`;
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'fx-type';
      d.innerHTML = '<h4></h4><p></p>';
      d.querySelector('h4').textContent = it.title;
      d.querySelector('p').textContent = it.text;
      row.append(d);
    }
    return row;
  };
  const h = document.createElement('h3');
  h.textContent = 'New to effects? The main kinds';
  const h2 = document.createElement('h3');
  h2.textContent = 'Knob names, decoded';
  const note = document.createElement('p');
  note.className = 'fx-note';
  note.textContent = 'Different pedals use different words for the same knob. The biggest one to know: Gain changes how dirty the sound is, Volume only changes how loud.';
  root.append(h, cardRow(EFFECT_TYPES.map((t) => ({ title: t.name, text: t.text }))), h2, note, cardRow(KNOB_ROLES, ' knob-roles'));
}
