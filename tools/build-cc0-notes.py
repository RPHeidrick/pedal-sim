"""
Build the note set for the Digital guitar from the FreePats "Electric Guitar FSBS (direct)"
CC0 recordings (a single coil electric guitar, bridge pickup, DI).

For each sampled note it keeps:
  - three hard picked takes (NAME.wav, NAME-2.wav, NAME-3.wav): the guitar picks a different
    one each time, so repeated strums are never the identical recording (the "machine gun"
    sound that makes sampled guitars feel electronic)
  - one soft picked take (NAME-soft.wav), where the bank has one, for lighter strums
Each is trimmed to the pick attack, shortened with a natural fade, and 16-bit mono.
Hard takes are peak normalised together per note; the soft take keeps its natural level
relative to them, so a soft strum really is softer and darker.
The site shifts each note by at most 2 semitones to fill in the notes that were not sampled.

  python tools/build-cc0-notes.py "<FreePats folder>/samples/bridge" samples/notes
Prints the NOTES list for site/inputs/notes.js.
"""
import soundfile as sf, numpy as np, glob, os, re, sys, json
SRC, OUT = sys.argv[1], sys.argv[2]
NOTE = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
def midi(name):
    m = re.match(r'([A-G]#?)(\d)', name); return 12*(int(m.group(2))+1)+NOTE[m.group(1)]
LEN, FADE = 2.2, 0.6          # hard takes: seconds kept, seconds of fade
SOFT_LEN, SOFT_FADE = 1.8, 0.6
HARD_TAKES = 3

def load(f, length, fade):
    d, sr = sf.read(f)
    if d.ndim > 1: d = d.mean(axis=1)
    on = int(np.argmax(np.abs(d) > 0.02)); d = d[max(0, on - int(0.001*sr)):]
    d = d[:int(length*sr)].copy()
    fl = int(fade*sr); d[-fl:] *= np.linspace(1, 0, fl) ** 2
    return d - d.mean(), sr

out = []
names = sorted({os.path.basename(f).split('_')[0] for f in glob.glob(os.path.join(SRC, '*_01.flac'))})
for name in names:
    stem = glob.glob(os.path.join(SRC, f'{name}_s*_01.flac'))
    stem = [s for s in stem if '_soft_' not in s][0][:-len('_01.flac')]
    hard = sorted(glob.glob(stem + '_[0-9][0-9].flac'))[:HARD_TAKES]
    soft = sorted(glob.glob(stem + '_soft_[0-9][0-9].flac'))[:1]
    takes = [load(f, LEN, FADE) for f in hard]
    softs = [load(f, SOFT_LEN, SOFT_FADE) for f in soft]
    peak = max(np.abs(d).max() for d, _ in takes)
    g = 0.5 / peak
    base = name.replace('#', 's')
    files = []
    for i, (d, sr) in enumerate(takes):
        fn = f'{base}.wav' if i == 0 else f'{base}-{i+1}.wav'
        sf.write(os.path.join(OUT, fn), (d * g).astype(np.float32), sr, subtype='PCM_16'); files.append(fn)
    entry = {'midi': midi(name), 'file': files[0], 'takes': files}
    if softs:
        d, sr = softs[0]
        fn = f'{base}-soft.wav'
        sf.write(os.path.join(OUT, fn), np.clip(d * g, -1, 1).astype(np.float32), sr, subtype='PCM_16')
        entry['soft'] = fn
    out.append(entry)
out.sort(key=lambda x: x['midi'])
print(json.dumps(out))
