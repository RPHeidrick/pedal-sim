# Blues OD: design notes

**Designer:** Richard Heidrick
**Files:** LTspice `circuits/ltspice/blues-od.asc` (drawn by me), site netlist `circuits/blues-od.cir`

## What it is

An overdrive with two op amp stages and a diode clipper, on a 9 V supply with a 4.5 V reference:

* Op amp: **TL072** (some versions of this circuit use a TL082)
* Clipping: four 1N4148 silicon diodes, two in series each way, in the feedback of the second stage
* Controls: Gain (100k) and Tone (100k)
* Reverse polarity protection: 1N4007

## Based on

The classic 1990s two stage op amp "blues" overdrive topology, which is widely published.

## How it is laid out (from my schematic)

1. **Input:** 10 nF coupling, 1 MΩ bias to the reference.
2. **First stage:** non-inverting, with the Gain pot in the feedback and a frequency shaping network (4.7 kΩ, 3.2 kΩ, two 10 nF) in the feedback leg, so the gain it adds depends on frequency.
3. **Second stage:** inverting, 10 kΩ in and 220 kΩ in feedback (a gain of 22), with the diode clipper (in series with 6.9 kΩ) across the feedback. The diodes round off the peaks: soft clipping.
4. **Tone and output:** 1 kΩ and 1 µF out of the second stage, into a network of 22 nF, 22 kΩ, 10 kΩ and 2.2 nF around the Tone pot.

## What the knobs do (measured)

Measured on the site with `npm run knobs`:

* **Gain:** from almost clean (about 2.5% distortion) to a thick growl (about 36%), getting about 10 dB louder on the way.
* **Tone:** sets how much low end reaches the output (about +10 dB at 100 Hz from bottom to top), while the treble stays about the same. Up is fuller and warmer, down is thinner and tighter.

## History

* Drawn in LTspice by me from my own understanding of the circuit, with my own values and layout.
