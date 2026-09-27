# Reverse Parallel Fuzz: design notes

**Designer:** Richard Heidrick
**Files:** LTspice `circuits/ltspice/rp-fuzz-si.asc` and `rp-fuzz-ge.asc` (drawn by me), KiCad schematic (drawn by me), site netlists `circuits/rp-fuzz-si.cir` and `rp-fuzz-ge.cir`

## What it is

Two three transistor fuzz circuits of opposite polarity in one enclosure, selected by a switch:

* **Si side:** NPN silicon, three 2N3904
* **Ge side:** PNP germanium, three 2N1309

Both sides share the Gain, Mod and Volume pots (Mod 5k, Gain 1k, Volume 100k).

## Based on

The classic 1960s British three transistor fuzz topology (the well known MkII style circuit, widely published).
Public reference I checked against: _TO BE ADDED (name and link of a public schematic or article)_

## What I changed and why

_TO BE ADDED by Richard:_
* Component values I chose differently from the classic circuit, and why
* The NPN silicon version (the classic circuit is PNP germanium)
* Putting both polarities in one box with a switch

## Models

* 2N3904: standard public SPICE model
* 2N1309: from my LTspice component library (`standard.bjt`, the free model library for LTspice; see [LTwiki](https://ltwiki.org/index.php?title=Standard.bjt)). The site does not copy that model: it uses its own model, fitted to match my LTspice operating point and the Central Semiconductor datasheet (see `engine/parsers/library-models.js`); a test checks every transistor's collector current against the LTspice sim.

## History

* Drawn in LTspice and KiCad by me from my own understanding of the circuit, with my own values and layout.
