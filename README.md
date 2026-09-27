# Pedal Sim

Guitar pedal circuits simulated in the browser, from LTspice schematic to sound.

**Live demo:** https://rpheidrick.github.io/pedal-sim/

Pedal Sim reads an LTspice schematic (`.asc`) or a SPICE netlist (`.cir`), builds a modified nodal analysis model of the circuit, and solves it sample by sample with Newton iteration. The result is audio that comes from the actual circuit, not from a generic effect. Transistors, JFETs, diodes and op amps use physical device models, so bias points, clipping and tone come from the component values.

## Pedalboard

* **Made for beginners**: a step by step guide that goes at the visitor's pace (click anywhere or press any key for the next step, Esc to skip; opens on the first visit, or press "Start the guide"), plain-words help on every pedal (the i button) and every knob (point at it), and a short intro to each kind of effect
* **Safe, quiet start**: sound fades in at a low volume, a sound check shows where to turn it up (device, site, speakers) with tips for headphones, Bluetooth, laptop speakers, computer speakers, studio monitors and home stereos, and a safety cap keeps everything below -12 dB for headphone listeners
* **Starter boards**: finished sounds, from clean to heavy, load with one click with their knobs set and their loudness matched. The site shows the boards that suit the sample being played (electric or acoustic). Undo puts your own board back
* **Simple by default**: the Output panel shows just what you need (where you listen, Volume, safety cap, sound check); speaker, level match, scope, quality and engine sit under "More sound settings"
* **Sample sounds**: real electric guitar, recorded direct (DI), so anyone can hear the pedals without a guitar. Built from the public domain (CC0) FreePats note recordings; see [samples/README.md](samples/README.md)
* **Knob names, decoded**: Gain, Drive and Fuzz (how dirty) versus Volume and Level (how loud) explained in the library, in every knob's help and on each pedal's info card
* **Three ways to play**:
  * **Your guitar**: "Plug in your guitar" walks through it in four steps: pick the interface or cable (USB guitar cables are recognised), a noise and level check, tune up with the built in tuner, and check the delay with tips to lower it
  * **Clean guitar input**: the noise check records 3 seconds of silence and 4 of playing, then sets the input level and a cleanup stage that runs before the pedals: a 25 Hz high pass, an adaptive hum canceller locked to the measured mains frequency and harmonics (it removes hum without notching out nearby notes), a 10 kHz hiss filter and a smooth noise gate. "Save a test clip" records the raw signal as a WAV for closer study
  * **Digital guitar**: no guitar needed. Twelve chord pads (keys 1 to =), Auto strum with five rhythms and four chord progressions, palm mute, and a 15 fret fretboard, all playing real recorded guitar notes (CC0)
  * **Recordings**: the sample list, including up to **16 of my own recordings**, or your own file. **Record a riff** (Guitar tab) records up to 60 seconds of cleaned-up guitar as a WAV; drag it onto `add-recording.cmd` to put it on the site (see [samples/mine/README.md](samples/mine/README.md))
* **Chain pedals** in any order: **drag a pedal** to a new spot (the others slide aside), or use the arrows. Click-free footswitch bypass and a "Hear without pedals" button to compare
* **Feels physical**: pedals drop onto the board with a bounce, pop off in a puff of sparks, dip when stomped, and the patch cables glow and pulse with the signal. All motion is skipped when "reduce motion" is on
* **Paint shop**: restyle any pedal on the board (painted, brushed aluminium, candy orange, hammertone, matte black, relic) and write your own name on the box. Saved with the board
* **Looks**: switch the whole site between design phases from the header (Arcade, Tube amp, Workshop, Classic). Every earlier look is kept. In Tube amp the tubes glow brighter as you play; in Arcade a TILT light comes on when the safety limiter works
* **Pedal Workshop**:
  * **Describe your sound** in plain words ("warm bluesy crunch", "heavy scooped metal with lots of bass", "a little dark overdrive") and get a board with the pedals and knobs set, plus a short explanation of why. Built in: it works offline and sends nothing anywhere
  * **Build a pedal** from four real circuits (clean boost, overdrive, distortion, two transistor fuzz), choosing the parts a builder would: transistors, clipping diodes, op amp, how much low end. Name it, colour it, try it on the board, save it to your library. Every combination is a real circuit the engine simulates, and a test checks every one
* **Build it yourself**: every pedal (library, my designs, and yours from the Workshop) has a build sheet: parts list with buyable values and notes, a schematic drawn from the simulated circuit, footswitch and jack wiring, a real size drill template for the enclosure, and step by step instructions with safety notes. Download the parts list (CSV), schematic and drill template (SVG) and the circuit, or print the whole sheet. Everything is made in the browser
* **Add pedal slot** at the end of the board picks a pedal without scrolling to the library
* **Save and share boards**: save the current board under a name (it appears first in the starter boards), or get a link that opens your exact board, knobs, paint and Workshop pedals included, on any computer. Nothing is uploaded: the board travels inside the link
* **Knobs with sliders**: every knob has a slider underneath and shows its value (0 to 10); both move together
* **Zoom the chain** with the − / + / Fit buttons or Ctrl + scroll, and fold the Input and Output panels to give the chain the whole width
* **Speaker cabinet** (1×12 open back, 4×12 closed back, or off) at the Amp end of the chain, level matched so switching does not jump in volume
* **Auto quality**: runs 4× oversampled so fuzz stays free of aliasing fizz, stepping down to 2× then 1× only if a chain needs more than the computer can give. Passive pedals skip oversampling
* **High fidelity audio path**: runs at the sound card's own rate (44.1 or 48 kHz) so nothing is resampled, 32-bit float throughout, a 1.5 ms look-ahead peak limiter that eases down before a peak instead of clipping it, and **Match level** to even out loudness between pedals
* Input and output meters, input level shown in volts at the first pedal, engine load and latency readouts. Settings are remembered between visits

The circuits run on the browser's real-time audio thread (AudioWorklet). By default they use the C++ engine compiled to WebAssembly, which is about 2x faster than the JavaScript engine; the Engine menu switches between them live.

## What the engine bench shows

* **DC operating point** for every node and device (region, Vbe, Vce, Ic, beta)
* **Transfer curves**: DC sweep and large signal response
* **Transient render** of a sine, pluck or chord through the circuit, with playback of dry and processed audio
* **Live knobs** mapped to the pots in the netlist (linear and log tapers)
* **Import your own design**: drop in an LTspice `.asc` schematic or a `.cir` netlist. Schematics are converted automatically, and `.step param` sweeps on resistors become live knobs

## Engine

* LTspice `.asc` import: symbol geometry, rotations and mirroring, T junctions, named nets
* Modified nodal analysis with a compiled sparse LU solver
* Trapezoidal integration, Newton Raphson per sample
* Polyphase FIR oversampling (1x to 8x) to control aliasing
* No dependencies; runs in a Web Worker (bench) and in an AudioWorklet (pedalboard)
* **C++ port** in `engine/cpp/`, compiled to WebAssembly. Verified sample for sample against the JavaScript engine on every library pedal. See [engine/cpp/README.md](engine/cpp/README.md) for how it works and how to build it

## Pedal library

**My designs**, drawn by me in LTspice and KiCad. The site imports the LTspice schematics directly. Design notes (what each is based on, what I changed and why) are in [designs/](designs/).

| Pedal | Circuit |
|---|---|
| Reverse Parallel Fuzz | Two three transistor fuzz circuits of opposite polarity in one box, switch selected: silicon NPN (2N3904) or germanium PNP (2N1309) |
| Blues OD | Two TL072 op amp stages into a 1N4148 diode clipper |

**Classic reference circuits**, written as SPICE netlists from the well-known public topologies:

| Pedal | Circuit |
|---|---|
| Germanium Fuzz | Two germanium PNP transistors, classic 60s fuzz |
| Op Amp Drive | Op amp soft clipper with diodes in the feedback loop |
| JFET Boost | J201 common source clean boost |
| Tone Stack | Passive treble / bass / middle tone stack |

To try your own circuit, open the [engine bench](bench.html) and load an LTspice `.asc` schematic or a `.cir` netlist from your computer. Nothing you load is uploaded; it stays in your browser.

## Content and licences

* Code, circuits, designs and recordings: © Richard Heidrick, all rights reserved, provided as is (see [LICENSE](LICENSE)). You are welcome to view and try everything here; ask if you would like to reuse something.
* No product or brand names: circuits are named for what they are (Germanium Fuzz, Op Amp Drive), and guitar inputs for what they are (audio interface, USB guitar cable).
* My designs (Reverse Parallel Fuzz, Blues OD): my own LTspice and KiCad drawings, component values and choices, based on classic public circuits. Sources in [designs/](designs/).
* Classic reference circuits: generic textbook versions of well-known topologies (no third-party schematic files).
* Sample audio and the Digital guitar's notes: FreePats "Electric Guitar FSBS (direct)", [CC0 1.0 public domain](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html). `samples/mine/`: recordings I made myself. `samples/` may only hold recordings the site owner made or CC0 material; a test enforces it.
* Fonts: Inter, JetBrains Mono, Big Shoulders Display, Barlow Condensed, Oswald and Yellowtail from Google Fonts (SIL Open Font License).

## Project map

Every folder, and where to start reading. Each code file begins with a comment saying what it does.

```
pedal-sim/
├── index.html            the website (one page)
├── bench.html            the engine bench page
├── run-local.cmd         double-click: run the site on your computer
├── add-recording.cmd     drag a WAV onto it: add one of your recordings
│
├── circuits/             the pedals, as SPICE netlists (.cir) + index.js (names, colours, knob help)
│   └── ltspice/          my LTspice schematics (.asc), imported directly
├── designs/              design notes for my own pedals
│
├── engine/               the circuit simulator (the "back end")
│   ├── cpp/              C++ engine: the one the site uses. Start with cpp/README.md
│   ├── wasm/             the compiled C++ (pedal-engine.wasm) and the bridge JavaScript uses to call it
│   ├── js/               the same engine in JavaScript: backup, bench page and tests
│   └── parsers/          reads .cir netlists and LTspice .asc files into a list of parts
│
├── site/                 everything on the page (the "front end")
│   ├── main.js           start here: connects all the parts below and starts up
│   ├── core.js           shared helpers ($, audio, settings, messages)
│   ├── layout.js         folding side panels
│   ├── board/            the pedal chain, library, info cards, starter boards, save and share, zoom
│   ├── inputs/           Input panel: samples, live guitar setup, noise check (input-check.js), tuner, digital guitar
│   ├── audio/            Output panel, power, meters; audio.js (browser audio), pedal-worklet.js (audio thread),
│   │                     input-cleanup.js (hum, hiss and noise removal for a live guitar)
│   ├── looks/            themes, paint shop, motion effects, knobs
│   ├── help/             guided tour and tooltips
│   ├── workshop/         Pedal Workshop (describe your sound, build a pedal)
│   ├── build/            "Build it yourself" sheets (parts, schematic, wiring, drill template)
│   └── bench/            the engine bench page
├── styles/               CSS: tokens.css (colours, sizes), themes.css (the looks), one file per area
├── samples/              audio: CC0 riffs, notes/ for the digital guitar, mine/ for my recordings
│
├── tests/                automatic tests (npm test), browser/ (npm run test:browser)
├── tools/                scripts: local server, speed test, soak test, recording importer
└── design/FIGMA.md       how the Figma file maps to the code
```

**How a sound gets made:** `site/inputs` picks the input → `site/audio/audio.js` sends it to the audio thread → a live guitar is cleaned up first (`site/audio/input-cleanup.js`) → `site/audio/pedal-worklet.js` runs each pedal through the C++ engine (`engine/cpp`, compiled to `engine/wasm`) → speaker cabinet, volume and limiter → your speakers.

## Run locally

Requires Node 20 or newer. Double-click `run-local.cmd` (Windows), or:

```
npm start               # http://localhost:8080
npm test                # 111 automatic tests: engine, devices, parser, LTspice import, C++ vs JS,
                        # audio chain, guitar input cleanup, damaged files and links, every pedal pushed to its limits
npm run test:browser    # 26 checks that click through the real site in a hidden Chrome
                        # (first time only: npm install, then npx playwright install chromium)
npm run bench           # speed of every pedal, C++ vs JavaScript
npm run soak            # every pedal and every Workshop combination for a minute each, knobs sweeping
```

See [WORKFLOW.md](WORKFLOW.md) for the branch-per-phase workflow and how to publish, and [design/FIGMA.md](design/FIGMA.md) for the Figma design system.

## Roadmap

1. Modulation circuits (chorus, phaser, tremolo)
2. Stripboard layouts on the build sheets

Designed and built by Richard Heidrick.
