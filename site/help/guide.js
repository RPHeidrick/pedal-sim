/**
 * The guided tour's steps (the machinery that shows them is tour.js).
 *
 * Each step: a title, some text, what to point at (`target`), optionally something to do
 * first (`before`), and optionally an action to wait for (`waitFor`, sent by didThing()).
 */
import { $, audio, guide, savePrefs } from '../core.js';
import { Tour } from './tour.js';
import { hideTip } from './tips.js';
import { ensureRack } from '../layout.js';
import { selectSource } from '../inputs/input-rack.js';
import { closeInfo } from '../board/info-card.js';

const firstPedal = () => document.querySelector('#chain .pedal');

const TOUR_STEPS = [
  { title: 'Welcome to Pedal Sim',
    body: 'Guitar effects pedals change the sound of a guitar on its way to the amp. This guide goes one small step at a time, and you can take as long as you like on each one. You do not need a guitar.',
    target: null },
  { title: 'Turn the sound on',
    body: 'Press Power on. Browsers only play sound after you click something. It starts quietly on purpose, and fades in over a couple of seconds.',
    target: () => $('power'), waitFor: 'power',
    doneText: 'The sound is on. If you cannot hear anything yet, that is fine: the next two steps set the levels.' },
  { title: 'Check the input level',
    body: 'Input level is how hard the guitar hits the first pedal, like picking harder or softer. The samples already start at a typical guitar level (0 dB), so you can leave it. Turn it up and the pedals get dirtier; turn it down and they clean up. Keep the meter out of the red.',
    target: () => $('input-group'), before: () => ensureRack('in'), waitFor: 'input',
    waitHint: 'Your turn: try the Input level slider, or leave it at 0 dB and press Next.',
    doneText: 'Good. Put it back near 0 dB for now if the sound got harsh. Next, the volume.' },
  { title: 'Set a comfortable volume',
    body: 'First pick what you are listening on. Then turn up slowly, in this order: your computer or phone volume, then the Volume slider here, then the knob on your speakers or headphone amp if you have one. Stop when the guitar is comfortable, not loud.',
    target: () => $('rack-out').querySelector('.listen-group'), before: () => ensureRack('out'), waitFor: 'volume',
    waitHint: 'Your turn: choose what you are listening on, or move the Volume slider.',
    doneText: 'Good. Keep adjusting until it sounds comfortable, then press Next.' },
  { title: 'Pick a sound',
    body: 'These are real guitar recordings for the pedals to play with. The one you pick plays on a loop, through the pedals, until you pick another.',
    target: () => $('sample-list'), before: () => { ensureRack('in'); if (audio.sourceKind !== 'sample') selectSource('sample'); }, waitFor: 'sample',
    doneText: 'Listen to it for a few seconds. What you hear is the guitar going through the pedal below.' },
  { title: 'This is a pedal',
    body: 'Each box is a pedal. Your guitar goes in on the left, through each circuit in turn, and out to the amp on the right. Press the i on a pedal to read what it does.',
    target: firstPedal },
  { title: 'Turn a knob',
    body: 'Drag a knob, or the slider under it, and listen. Gain (called Drive or Fuzz on some pedals) decides how dirty the sound is. Volume (called Level on some) only decides how loud. Point at any knob to see what it does; double-click puts it back.',
    target: () => document.querySelector('#chain .pedal .pedal-knobs'), waitFor: 'knob',
    doneText: 'Hear the change? Try turning it slowly all the way down, then all the way up. Press Next when you are ready.' },
  { title: 'Switch it off and on',
    body: 'Click the footswitch, the silver button, to turn the pedal off and hear the plain guitar. Click again to bring it back. Switching back and forth is the best way to hear what a pedal really does.',
    target: () => document.querySelector('#chain .pedal .footswitch'), waitFor: 'bypass',
    doneText: 'Try it a few times: off, on, off, on. Press Next when you have heard the difference.' },
  { title: 'Try a starter board',
    body: 'Each of these loads a finished sound with the knobs already set, at about the same loudness. Pick one, listen, then change anything you like. You can also add pedals one by one from the library further down.',
    target: () => $('preset-row'), waitFor: 'preset',
    doneText: 'Listen for a while, and try another board too. Undo in the message at the bottom puts your old board back.' },
  { title: 'More ways to play',
    body: 'Up here you choose what goes into the pedals. Your guitar: plug in a real guitar (a USB guitar cable works) and record a riff. Digital guitar: strum chords and play a fretboard right on the page. Audio file: play any recording of your own through the board.',
    target: () => document.querySelector('#rack-in .seg'), before: () => ensureRack('in') },
  { title: 'Make your own',
    body: 'In the Pedal Workshop, describe a sound in plain words and get a board for it, or build your own pedal from real circuits.',
    target: () => $('workshop') },
  { title: 'You are ready',
    body: 'Chain pedals in any order: a boost before a fuzz sounds different from after it. "Hear without pedals" switches everything off at once. Sound check in the Output panel has listening tips for your speakers or headphones.',
    target: () => $('compare') },
];

export function startTour() {
  if (guide.tour && guide.tour.active) return;
  closeInfo(); hideTip();
  guide.tour = new Tour(TOUR_STEPS, { onEnd: () => { savePrefs({ tourSeen: true }); } });
  guide.tour.start();
}
$('tour-start').addEventListener('click', startTour);
