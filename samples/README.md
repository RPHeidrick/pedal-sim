# Sample sounds

These are the guitar recordings visitors can play through the pedals without a guitar of their own. The best input for pedals is recorded **dry** (DI: straight from the pickups, no amp or effects), which is exactly what a pedal hears from a guitar plugged into it.

| File | What is played | Source | Good for hearing |
|---|---|---|---|
| `cc0-power-chords.wav` | Power chord riff, ringing hits and short staccato chords | FreePats, CC0 | How chords break up into crunch, distortion and fuzz |
| `cc0-single-notes.wav` | Slow A minor pentatonic notes, each left to ring | FreePats, CC0 | What one knob changes |
| `cc0-open-chords.wav` | G, C, D, Em strummed | FreePats, CC0 | Tone controls, clean versus dirty |

All three are built by `tools/build-cc0-riffs.py` from the FreePats **Electric Guitar FSBS (direct)** sound bank: a single coil electric guitar, bridge pickup, recorded straight into an audio interface. Every note in a riff is one of those real recordings, shifted by at most 2 semitones where the exact note was not sampled. The bank is dedicated to the public domain under **CC0 1.0** ([FreePats page](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html), `LICENSE.txt` in the download), so it may be published, changed and redistributed without permission. Credit is not required but is given here and in the sample picker.

## Subfolders

* **`mine/`**: your own recordings, up to 16 ([how to add one](mine/README.md)).
* **`notes/`**: single guitar notes for the Digital guitar, one take of each sampled note from the same CC0 FreePats bank, built by `tools/build-cc0-notes.py` and listed in `site/inputs/notes.js`.

## What may go in this folder

**Only recordings the site owner made, or material explicitly dedicated to the public domain (CC0).** Everything in this folder is served publicly: anyone can download the files from the site or from the GitHub repository.

Not allowed, however it was obtained:
* Sample-site loops, even "royalty free" (they are licensed for use inside your own music, not for re-publishing the sound itself).
* Files from paid courses or their downloads (course terms usually limit them to personal study).
* Anything whose licence you have not read.

`tests/content.test.js` fails if a file here is not listed in `site/inputs/samples.js` with `by` (the owner who recorded it) or `license: 'CC0'`.

## Recording a new sample

1. **Guitar straight into the audio interface's instrument (Hi-Z) input.** No amp, no amp simulator, no pedals, no plugins. Turn off any "monitor effects" in the recording software.
2. **Guitar volume knob fully up, tone knob fully up.** Note which pickup you used.
3. **Interface gain:** loudest notes should peak around -12 to -6 dB on the recording meter, never touching 0 dB (the red light).
4. **Record at 44.1 or 48 kHz, 24-bit** (16-bit is fine too). Mono.
5. **8 to 15 seconds.** Start playing right away (trim silence at the start) and let the last note or chord ring out to near silence, so the loop restarts cleanly.
6. Export as **WAV**, not MP3 (MP3 smears the pick attack, which is exactly what the pedals react to).

## Adding it to the site

Put the WAV in this folder, then add an entry to `SAMPLES` in `site/inputs/samples.js`:

```js
{ id: 'my-riff', group: 'electric', name: 'My riff', kind: 'Electric · DI', file: '../samples/my-riff.wav', gain: 1.6,
  by: 'Recorded by Ricky', good: 'Tone controls, and clean versus dirty.' },
```

`gain` brings the recording to the same loudness as the others (an average level of -21 dBFS, with peaks no higher than 0.8). Ask Claude to measure it. Add `seamless: true` if the file is a bar-exact loop.
