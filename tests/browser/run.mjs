#!/usr/bin/env node
/**
 * Browser tests: opens the real site in a (hidden) Chrome and clicks through it like a
 * visitor, checking the RESULT of each action, not just that nothing crashed:
 * the board that is saved, the order the audio thread hears, the meters moving, etc.
 *
 *   npm run test:browser            (first time only: npm install, then npx playwright install chromium)
 *
 * It starts its own copy of tools/serve.js on a spare port, so run-local.cmd can stay open.
 * Each check gets a fresh browser tab with empty storage (except where it says otherwise).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 8600 + Math.floor(Math.random() * 300);
const URL_ = `http://localhost:${PORT}/`;
const QUIET = { tourSeen: true, soundCheckSeen: true }; // skip the first visit guide and sound check

// ---------------------------------------------------------------------------------------
// tiny test harness
const checks = [];
const check = (name, fn, opts = {}) => checks.push({ name, fn, opts });
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fresh tab. Page errors are collected and fail the check. */
async function openPage(browser, { prefs = QUIET, storage = {}, viewport = { width: 1440, height: 1000 }, url = URL_, mobile = false, ready = '#chain .pedal, #chain .chain-empty' } = {}) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|ERR_NAME|ERR_INTERNET|ERR_PROXY/.test(m.text())) page.errors.push(m.text()); });
  await page.addInitScript(([p, s]) => {
    if (sessionStorage.getItem('seeded')) return; // only before the first load, so reloads keep what the page saved
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    if (p) localStorage.setItem('pedal-sim.prefs', JSON.stringify(p));
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, [prefs, storage]);
  await page.goto(url);
  await page.waitForSelector(ready);
  await sleep(300);
  return page;
}
const names = (page) => page.$$eval('#chain .pedal .pedal-name', (els) => els.map((e) => e.textContent));
const savedBoard = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pedal-sim.board') || '[]'));
const powerOn = async (page) => { await page.click('#power'); await page.waitForFunction(() => document.getElementById('power').getAttribute('aria-pressed') === 'true', null, { timeout: 8000 }); };
const outLevel = (page) => page.evaluate(() => parseFloat(document.getElementById('out-meter').style.width) || 0);

// ---------------------------------------------------------------------------------------
// the checks

check('page loads with the default pedal and the library', async (b) => {
  const p = await openPage(b);
  expect((await names(p)).length === 1, 'expected one pedal on a first visit');
  const cards = await p.$$eval('#lib-cols .lib-card', (e) => e.length);
  expect(cards >= 6, `library shows ${cards} cards`);
  return p;
});

check('power on: sound flows through the C++ engine', async (b) => {
  const p = await openPage(b);
  await powerOn(p);
  await sleep(2500);
  expect(await p.$eval('#engine', (e) => e.value) === 'wasm', 'engine is not the C++ (wasm) one');
  expect(await outLevel(p) > 5, 'output meter did not move');
  expect(/\d+%/.test(await p.textContent('#cpu-val')), 'no engine load reading');
  await p.click('#power');
  await p.waitForFunction(() => document.getElementById('power').getAttribute('aria-pressed') === 'false');
  return p;
});

check('the JavaScript engine also makes sound', async (b) => {
  const p = await openPage(b);
  await powerOn(p);
  await p.click('#more-out summary');
  await p.selectOption('#engine', 'js');
  await sleep(2500);
  expect(await outLevel(p) > 5, 'no output with the JavaScript engine');
  return p;
});

check('add a pedal from the library and from the + slot', async (b) => {
  const p = await openPage(b);
  await p.click('#lib-cols .lib-card:has-text("Blues OD") .add');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  await p.click('#chain .add-slot');
  await p.click('.pick-pop .pick-opt:has-text("JFET Boost")');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 3);
  const keys = (await savedBoard(p)).map((x) => x.key);
  expect(keys.join() === 'reverse-parallel-fuzz,blues-od,jfet-boost', `saved board is ${keys}`);
  return p;
});

check('knob, footswitch and variant switch are saved', async (b) => {
  const p = await openPage(b);
  const before = (await savedBoard(p))[0];
  await p.focus('#chain .pedal .knob svg');
  for (let i = 0; i < 5; i++) await p.keyboard.press('ArrowUp');
  await p.click('#chain .pedal .footswitch');
  await p.click('#chain .pedal .pedal-variant button:has-text("Ge")');
  await sleep(700);
  const after = (await savedBoard(p))[0];
  expect(after.values[0] > (before ? before.values[0] : 0), 'knob change was not saved');
  expect(after.bypass === true, 'bypass was not saved');
  expect(after.variant === 1, 'variant switch was not saved');
  expect(await p.$eval('#chain .pedal', (e) => e.classList.contains('off')), 'pedal does not look switched off');
  return p;
});

check('move buttons and remove', async (b) => {
  const p = await openPage(b);
  await p.click('.preset[data-preset="lead"]');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  const start = await names(p);
  await p.click('#chain .pedal >> nth=0 >> [data-act=right]');
  await sleep(500);
  expect((await names(p)).join() === [...start].reverse().join(), 'move right did not swap the pedals');
  await p.click('#chain .pedal >> nth=0 >> [data-act=remove]');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 1);
  expect((await savedBoard(p)).length === 1, 'removed pedal is still saved');
  return p;
});

check('drag and drop reorders the board and the sound', async (b) => {
  const p = await openPage(b);
  await p.click('.preset[data-preset="lead"]');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  await p.evaluate(() => document.querySelector('#chain').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await sleep(700);
  const start = await names(p);
  const a = await p.locator('#chain .pedal').nth(0).boundingBox();
  const c = await p.locator('#chain .pedal').nth(1).boundingBox();
  const x0 = a.x + 40, y0 = a.y + 10;
  await p.mouse.move(x0, y0); await p.mouse.down();
  for (let i = 1; i <= 20; i++) { await p.mouse.move(x0 + ((c.x + c.width - a.x) * i) / 20, y0); await sleep(16); }
  await p.mouse.up(); await sleep(500);
  expect((await names(p)).join() === [...start].reverse().join(), 'the pedals did not change places');
  const saved = (await savedBoard(p)).map((x) => x.key);
  expect(saved[0] === 'blues-od', `the saved (and heard) order did not change: ${saved}`);
  expect(!(await p.$('.pedal.dragging')), 'the pedal stayed lifted after the drop');
  return p;
});

check('pedal info card opens and closes', async (b) => {
  const p = await openPage(b);
  await p.click('#chain .pedal .pedal-info');
  expect(await p.isVisible('.info-pop'), 'info card did not open');
  expect((await p.$$('.info-pop dt')).length >= 2, 'info card lists no knobs');
  await p.keyboard.press('Escape');
  expect(!(await p.$('.info-pop')), 'Escape did not close the info card');
  return p;
});

check('starter board loads, Undo puts the old board back', async (b) => {
  const p = await openPage(b);
  const start = await names(p);
  await p.click('.preset[data-preset="lead"]');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  await p.click('#toast-action');
  await p.waitForFunction((n) => document.querySelectorAll('#chain .pedal').length === n, start.length);
  expect((await names(p)).join() === start.join(), 'Undo did not restore the board');
  return p;
});

check('two quick board clicks never mix two boards', async (b) => {
  const p = await openPage(b);
  const ids = await p.$$eval('.preset[data-preset]', (els) => els.map((e) => e.dataset.preset));
  await p.evaluate(([x, y]) => { document.querySelector(`.preset[data-preset="${x}"]`).click(); document.querySelector(`.preset[data-preset="${y}"]`).click(); }, [ids[0], ids[1]]);
  await sleep(2500);
  const n = (await names(p)).length;
  expect(n <= 4, `board has ${n} pedals: two boards were merged`);
  return p;
});

check('save a board, it survives a reload, and loads again', async (b) => {
  const p = await openPage(b);
  await p.click('.preset[data-preset="lead"]');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  await p.click('#board-save');
  await p.fill('.menu-pop input', 'Test board');
  await p.click('.menu-pop [data-act=ok]');
  await p.reload(); await p.waitForSelector('#chain .pedal'); await sleep(500);
  expect(await p.isVisible('.mine-board:has-text("Test board")'), 'saved board is missing after reload');
  await p.click('#chain .pedal >> nth=0 >> [data-act=remove]');
  await p.click('.mine-board:has-text("Test board")');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  return p;
});

check('a share link rebuilds the same board in a new tab', async (b) => {
  const p = await openPage(b);
  await p.click('.preset[data-preset="lead"]');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  await p.click('#chain .pedal .footswitch');
  await p.click('#board-share');
  const link = await p.inputValue('.menu-pop input');
  expect(link.includes('#b='), 'no board link');
  const q = await openPage(b, { url: link.replace(/^https?:\/\/[^/]+\//, URL_) });
  await q.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  expect((await names(q)).join() === (await names(p)).join(), 'shared board has different pedals');
  expect((await savedBoard(q))[0].bypass === true, 'shared board lost the footswitch setting');
  expect(!q.url().includes('#b='), 'the link was not tidied from the address bar');
  return q;
});

check('a damaged share link shows a message instead of breaking', async (b) => {
  const p = await openPage(b, { url: `${URL_}#b=not-a-real-board` });
  expect(!(await p.isHidden('#toast')), 'no message for a bad link');
  expect((await names(p)).length >= 1, 'page did not recover with a board');
  return p;
});

check('picking an acoustic sample offers acoustic boards', async (b) => {
  const p = await openPage(b);
  const acoustic = await p.$('.sample-group:has-text("Acoustic")');
  if (!acoustic) { p.skip = 'no acoustic recordings yet'; return p; }
  await p.click('#sample-list .sample-group:has-text("Acoustic") + .sample');
  await sleep(1500);
  expect((await p.textContent('#presets-for')).includes('acoustic'), 'starter boards did not switch to acoustic');
  return p;
});

check('zoom, fold panels and change the look', async (b) => {
  const p = await openPage(b);
  const z0 = await p.textContent('#zoom-level');
  await p.click('[data-zoom=in]');
  expect((await p.textContent('#zoom-level')) !== z0, 'zoom did not change');
  await p.click('#rack-in .rack-toggle');
  expect(await p.$eval('#rack-in', (e) => e.classList.contains('collapsed')), 'input panel did not fold');
  const look0 = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.click('#look');
  await p.click(`.look-opt:not([aria-checked="true"]) >> nth=0`);
  const look1 = await p.evaluate(() => document.documentElement.dataset.theme);
  expect(look1 !== look0, 'look did not change');
  await p.reload(); await p.waitForSelector('#chain .pedal');
  expect(await p.evaluate(() => document.documentElement.dataset.theme) === look1, 'look was not remembered');
  return p;
});

check('the guided tour runs from start to end', async (b) => {
  const p = await openPage(b, { prefs: { soundCheckSeen: true } });
  await p.waitForSelector('.tour-card', { timeout: 5000 });
  for (let i = 0; i < 12 && await p.$('.tour-card'); i++) {
    const next = p.locator('.tour-card .tour-next');
    if (!(await next.isVisible())) break;
    await next.click(); await sleep(250);
  }
  expect(!(await p.$('.tour-card')), 'tour did not finish');
  return p;
});

check('Workshop: build a pedal, save it, use it, delete it', async (b) => {
  const p = await openPage(b);
  await p.click('#workshop [data-tab=build]');
  await p.fill('#workshop [data-el=name]', 'Test Fuzz');
  await p.click('#workshop [data-act=try]');
  await p.waitForFunction(() => document.querySelectorAll('#chain .pedal').length === 2);
  await p.click('#workshop [data-act=save]');
  await sleep(300);
  expect(await p.isVisible('#lib-cols .lib-card:has-text("Test Fuzz")'), 'creation is not in the library');
  expect((await savedBoard(p)).some((x) => x.key.startsWith('custom:') && x.key !== 'custom:trial'), 'the pedal on the board did not become the saved one');
  await p.click('#workshop [data-tab=mine]');
  await p.click('#workshop .ws-mine [data-act=del]');
  await sleep(300);
  expect(!(await p.isVisible('#lib-cols .lib-card:has-text("Test Fuzz")')), 'deleted creation is still in the library');
  expect((await names(p)).length === 1, 'deleted creation is still on the board');
  return p;
});

check('Workshop: describe a sound builds a board', async (b) => {
  const p = await openPage(b);
  await p.fill('#workshop [data-el=say]', 'warm bluesy crunch');
  await p.click('#workshop .ws-describe button[type=submit]');
  await p.click('#workshop [data-act=load]');
  await sleep(1500);
  expect((await names(p)).length >= 1, 'no board after describing a sound');
  return p;
});

check('build sheet opens with a parts list', async (b) => {
  const p = await openPage(b);
  await p.click('#lib-cols .lib-card:has-text("Blues OD") .text-btn');
  await p.waitForSelector('#build-sheet[open]');
  const rows = await p.$$eval('#build-sheet .bs-table tbody tr', (e) => e.length);
  expect(rows > 5, `parts list has ${rows} rows`);
  await p.click('#build-sheet [data-act=close]');
  return p;
});

check('digital guitar pads make sound', async (b) => {
  const p = await openPage(b);
  await p.click('.seg [data-src=digital]');
  await p.click('#digital-deck .pad >> nth=0');
  await sleep(1500);
  expect(await outLevel(p) > 5, 'pads made no sound');
  return p;
});

check('live input (fake microphone) goes through the pedals', async (b) => {
  const p = await openPage(b);
  await powerOn(p);
  await p.click('.seg [data-src=live]');
  // the fake microphone beeps once a second, so watch the meters for a few seconds
  let peakIn = 0;
  for (let i = 0; i < 30; i++) { peakIn = Math.max(peakIn, parseFloat(await p.$eval('#in-meter', (e) => e.style.width)) || 0); await sleep(100); }
  expect(peakIn > 0, `input meter did not move (message: ${await p.textContent('#toast-text')})`);
  return p;
}, { fakeMic: true });

/**
 * A fake guitar for the browser's fake microphone: 60 Hz hum with harmonics and hiss all
 * the time, and a strummed chord every other second, at a quiet USB cable level.
 */
function writeFakeGuitar() {
  const fs_ = 48000, n = fs_ * 8, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(fs_, 24);
  data.writeUInt32LE(fs_ * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  let seed = 3;
  for (let i = 0; i < n; i++) {
    const t = i / fs_, beat = t % 2;
    let x = 3e-3 * Math.sin(2 * Math.PI * 60 * t) + 1.5e-3 * Math.sin(2 * Math.PI * 180 * t) + ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 6e-4;
    if (beat < 1) for (const f of [82.41, 123.47, 164.81, 207.65]) x += 0.012 * Math.exp(-3 * beat) * Math.sin(2 * Math.PI * f * t);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2);
  }
  const file = path.join(os.tmpdir(), 'pedal-sim-fake-guitar.wav');
  fs.writeFileSync(file, data);
  return file;
}

check('guitar noise check: measures hum, sets the level and the cleanup, and it is remembered', async (b) => {
  const p = await openPage(b);
  await p.click('.seg [data-src=live]');
  await p.click('#gs-open');
  await p.click('#guitar-setup .gs-cable[data-id=usbcable]');
  await p.click('#guitar-setup [data-act=find]');
  await sleep(800);
  await p.click('#guitar-setup [data-act=next]');           // connect
  await p.waitForSelector('#guitar-setup [data-act=measure]', { timeout: 10000 });
  await p.click('#guitar-setup [data-act=measure]');
  await p.waitForSelector('#guitar-setup .gs-results', { timeout: 15000 });
  const report = await p.textContent('#guitar-setup .gs-results');
  expect(/60\.\d\d Hz/.test(report), `hum not found: ${report}`);
  const gain = Number(await p.inputValue('#in-gain'));
  expect(gain > 10, `input level only ${gain} dB for a quiet cable`);
  expect((await p.textContent('#cleanup-summary')).includes('Hz hum'), 'panel does not show the hum canceller');
  expect((await p.inputValue('#cleanup-gate')) !== 'off', 'noise gate not switched on');
  // the settings survive a reload, and the Guitar tab comes back
  await p.click('#guitar-setup [data-act=close]');
  await sleep(500);
  await p.reload(); await p.waitForSelector('#chain .pedal'); await sleep(600);
  expect(await p.getAttribute('.seg [data-src=live]', 'aria-selected') === 'true', 'Guitar tab not restored after reload');
  expect((await p.textContent('#cleanup-summary')).includes('Hz hum'), 'cleanup forgotten after reload');
  expect(Number(await p.inputValue('#in-gain')) === gain, 'input level forgotten after reload');
  // with the sound on, the gate light follows the playing
  await powerOn(p);
  let open = false, closed = false;
  for (let i = 0; i < 40; i++) { const on = await p.$eval('#gate-led', (e) => e.classList.contains('open')); open ||= on; closed ||= !on; await sleep(100); }
  expect(open && closed, `gate light never ${open ? 'closed' : 'opened'}`);
  return p;
}, { fakeFile: true });

check('Record a riff: start, stop, and it downloads the recording', async (b) => {
  const p = await openPage(b);
  await p.click('.seg [data-src=live]');
  await p.click('#riff-rec');
  await p.waitForFunction(() => document.getElementById('riff-rec').getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
  await sleep(3000);
  expect(/Stop recording \(0:0[2-4]\)/.test(await p.textContent('#riff-rec')), 'no running time shown');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#riff-rec')]);
  expect(/^my-riff-\d+\.wav$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const size = fs.statSync(await dl.path()).size;
  expect(size > 48000 * 4 * 2.5 && size < 48000 * 4 * 5, `recording is ${size} bytes for about 3 seconds`);
  expect(await p.getAttribute('#riff-rec', 'aria-pressed') === 'false', 'button still says recording');
  return p;
}, { fakeFile: true });

check('Save a test clip downloads a WAV of the raw guitar', async (b) => {
  const p = await openPage(b);
  await p.click('.seg [data-src=live]');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#cleanup-clip')]);
  expect(/^guitar-test-clip-\d+\.wav$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const size = fs.statSync(await dl.path()).size;
  expect(size > 1_500_000, `clip is only ${size} bytes`);
  return p;
}, { fakeFile: true });

check('Hear without pedals switches the chain off and on', async (b) => {
  const p = await openPage(b);
  await p.click('#compare');
  expect(await p.$eval('#chain', (e) => e.classList.contains('dry')), 'chain not marked dry');
  await p.click('#compare');
  expect(!(await p.$eval('#chain', (e) => e.classList.contains('dry'))), 'chain still dry');
  return p;
});

check('phone width: nothing sticks out sideways, in every look', async (b) => {
  let last;
  for (const look of ['arcade', 'tube', 'workshop', 'classic']) {
    last = await openPage(b, { prefs: { ...QUIET, look }, viewport: { width: 390, height: 844 }, mobile: true });
    const over = await last.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over <= 0, `${look}: page is ${over}px too wide`);
    if (look !== 'classic') await last.context().close();
  }
  return last;
});

check('engine bench page opens and lists the circuits', async (b) => {
  const p = await openPage(b, { url: `${URL_}bench.html`, ready: 'body' });
  await sleep(3000);
  expect((await p.textContent('body')).includes('Blues OD'), 'bench page has no circuits');
  return p;
});

// ---------------------------------------------------------------------------------------
// run them
const server = spawn(process.execPath, ['tools/serve.js', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* not up yet */ } await sleep(100); }
let fakeGuitar = null;
const launch = ({ fakeMic, fakeFile } = {}) => chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required',
  ...(fakeMic || fakeFile ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []),
  ...(fakeFile ? [`--use-file-for-fake-audio-capture=${fakeGuitar || (fakeGuitar = writeFakeGuitar())}`] : [])] });
let failed = 0;
const only = process.argv[2];
for (const c of checks) {
  if (only && !c.name.includes(only)) continue;
  const browser = await launch(c.opts);
  const t0 = Date.now();
  try {
    const page = await c.fn(browser);
    if (page && page.errors.length) throw new Error(`page errors: ${page.errors.join(' | ')}`);
    if (page && page.skip) console.log(`  skip  ${c.name}  (${page.skip})`);
    else console.log(`  ok    ${c.name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${c.name}\n        ${String(err.message || err).split("\n").slice(0, process.env.VERBOSE ? 12 : 1).join("\n        ")}`);
  } finally { await browser.close(); }
}
server.kill();
console.log(failed ? `\n${failed} browser check(s) failed` : '\nAll browser checks passed');
process.exit(failed ? 1 : 0);
