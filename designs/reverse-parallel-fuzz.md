# Reverse Parallel Fuzz: design notes

**Designer:** Richard Heidrick
**Files:** LTspice `circuits/ltspice/rp-fuzz-si.asc` and `rp-fuzz-ge.asc` (drawn by me), KiCad schematic (drawn by me), site netlists `circuits/rp-fuzz-si.cir` and `rp-fuzz-ge.cir`

## What it is

Two three transistor fuzz circuits of opposite polarity in one enclosure, selected by a switch:

* **Si side:** NPN silicon, three 2N3904
* **Ge side:** PNP germanium, three 2N1309

Both sides share the Gain, Mod and Volume pots (Mod 5k, Gain 1k, Volume 100k), so flipping the switch compares the two transistor types at the same knob settings.

## Based on

The classic 1960s British three transistor fuzz topology, which is widely published. The original is a PNP germanium circuit on a positive ground supply.

## What is different from the classic circuit

* **An NPN silicon version.** The Si side mirrors the circuit for NPN transistors on a standard negative ground 9 V supply.
* **Both polarities in one box,** with a switch and shared pots, instead of two separate pedals.
* **A Mod control on the first stage.** A 5k pot from the first transistor's emitter sets its gain and bias. Measured on the site (`npm run knobs`): turned down, the fuzz is thick and saturated with more bass; turned up, it is thinner and cleans up when you play softly.
* **My own part values,** listed below from the Si side netlist. The Ge side uses the same values mirrored for PNP, except a 1 µF output coupling capacitor.

| Part | Value | Where |
|---|---|---|
| Input coupling | 4.7 µF | into the first base |
| First stage bias | 470 kΩ to the supply, 100 kΩ to ground | first base |
| First stage collector | 10 kΩ | |
| Interstage coupling | 100 nF | first collector to second base |
| Second stage collector | 47 kΩ | |
| DC feedback | 100 kΩ | third emitter to second base |
| Third stage collector | 5.6 kΩ and 1 kΩ | the tap between them feeds the output |
| Gain bypass | 1 kΩ pot with 4.7 µF | third emitter |
| Output coupling | 100 nF | to the 100 kΩ Volume pot |

## Models

* 2N3904: standard public SPICE model
* 2N1309: from my LTspice component library (`standard.bjt`, the free model library for LTspice; see [LTwiki](https://ltwiki.org/index.php?title=Standard.bjt)). The site does not copy that model: it uses its own model, fitted to match my LTspice operating point and the manufacturer's datasheet (see `engine/parsers/library-models.js`); a test checks every transistor's collector current against the LTspice sim.

## History

* Drawn in LTspice and KiCad by me from my own understanding of the circuit, with my own values and layout.
