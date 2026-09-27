# My recordings (16 slots)

This folder holds Richard Heidrick's own guitar recordings. They show up first in the site's sample list, with a "Ricky" badge, so visitors hear the pedals with your playing.

## Record one

1. **Guitar straight into the computer.** An audio interface's instrument (Hi-Z) input, or a **USB guitar cable** (it shows up as a USB microphone, often called something like "... Guitar Adapter"). No amp, no amp simulator, no pedals, no plugins.
2. **Guitar volume and tone knobs fully up.**
3. **Level:** your loudest notes should peak around -12 to -6 dB on the recording meter, never touching 0 dB. With a USB guitar cable, Windows sets its level in Sound settings, under Input, then Device properties.
4. **Record** in any program that saves WAV (Audacity is free). 44.1 or 48 kHz, 16 or 24-bit. Mono or stereo are both fine.
5. **8 to 20 seconds.** Start playing right away and let the last note ring out. The tool trims the silence at both ends.
6. **Export as WAV**, not MP3.

Good things to record, so visitors hear every kind of pedal: a chord riff, slow single notes, a lead line with bends, palm-muted chugs, open chords strummed, a clean arpeggio, a funky rhythm, a slow blues lick. Acoustic guitar (with a microphone) and bass work too.

## Add it to the site

**Windows:** drag the WAV file onto **`add-recording.cmd`** (in the main pedal-sim-public folder). It asks for a name, electric/acoustic/bass, what it is good for, and whether it should be the first sound visitors hear. Then refresh the site.

**Any computer:**

```
node tools/add-recording.js my-riff.wav --name "Crunchy riff" --kind electric --good "How chords break up into crunch"
node tools/add-recording.js --list          # see all 16 slots
node tools/add-recording.js --remove 3      # empty slot 3
```

The tool keeps your original file untouched. It writes a levelled copy here (`01-crunchy-riff.wav` …) and lists it in `recordings.js`. Levelled means the same loudness as every other sample: -21 dBFS on average, peaks no higher than 0.8.

## The rule for this folder

Only recordings **you played and recorded yourself**. The site and the GitHub repository make these files downloadable, so nothing from a course, a sample site, a backing track or another player goes here. A test (`npm test`) checks that every file here is listed in `recordings.js`.
