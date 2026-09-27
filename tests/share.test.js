/**
 * Save and share: a board survives the trip through a link, and a hand-made or damaged
 * link can never produce anything unsafe (values clamped, text shortened, bad links refused).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
globalThis.location ??= { origin: 'https://example.test', pathname: '/pedal-sim/' };
const { encodeBoard, decodeBoard, boardLink } = await import('../site/board/share.js');

test('share: a board round-trips through a link', () => {
  const snaps = [
    { key: 'reverse-parallel-fuzz', variant: 1, labels: ['Gain', 'Mod', 'Volume'], values: [0.85, 0.6, 0.6], bypass: false, finish: 'candy', label: 'Fuzz Ö' },
    { key: 'custom:abc1234', variant: 0, labels: ['Gain', 'Volume'], values: [0.5, 0.6], bypass: true },
  ];
  const code = encodeBoard(snaps, 6, [{ id: 'abc1234', template: 'boost', options: { fet: 'J201' }, color: '#ff7a1a', name: 'Kicker' }], 'My rig');
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'safe in a URL');
  assert.ok(boardLink(code).endsWith(`#b=${code}`));
  const d = decodeBoard(code);
  assert.equal(d.name, 'My rig'); assert.equal(d.trim, 6);
  assert.deepEqual(d.board.map((p) => [p.key, p.variant, p.bypass, p.finish, p.label]), [['reverse-parallel-fuzz', 1, false, 'candy', 'Fuzz Ö'], ['custom:abc1234', 0, true, undefined, undefined]]);
  assert.deepEqual(d.board[0].values, [0.85, 0.6, 0.6]);
  assert.equal(d.creations[0].name, 'Kicker');
});

test('share: damaged or hostile links are refused or made safe', () => {
  assert.throws(() => decodeBoard('not-a-board'));
  const evil = Buffer.from(JSON.stringify({ v: 1, t: 999, p: [['op-amp-drive', 0, ['Drive'], [7, -3], 1, 'x'.repeat(500), '<img onerror=alert(1)>'.repeat(5)]], c: [['id', 'fuzz', {}, 'red;background:url(x)', 'n']] })).toString('base64url');
  const d = decodeBoard(evil);
  assert.equal(d.trim, 24);
  assert.deepEqual(d.board[0].values, [1, 0]);
  assert.ok(d.board[0].finish.length <= 40 && d.board[0].label.length <= 22);
  assert.equal(d.creations[0].color, undefined, 'only #rrggbb colours pass');
});
