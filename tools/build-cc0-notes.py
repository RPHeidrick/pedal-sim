"""
Build the note set for the Digital guitar from the FreePats "Electric Guitar FSBS (direct)"
CC0 recordings (a single coil electric guitar, bridge pickup, DI). One hard picked take per sampled note,
trimmed to the pick attack, shortened with a natural fade, peak normalised, 16-bit mono WAV.
The site shifts each note by at most 2 semitones to fill in the notes that were not sampled.

  python tools/build-cc0-notes.py "<FreePats folder>/samples/bridge" samples/notes
"""
import soundfile as sf, numpy as np, glob, os, re, sys, json
SRC, OUT = sys.argv[1], sys.argv[2]
NOTE = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
def midi(name):
    m = re.match(r'([A-G]#?)(\d)', name); return 12*(int(m.group(2))+1)+NOTE[m.group(1)]
LEN = 2.2   # seconds kept
FADE = 0.6  # seconds of fade at the end
out = []
for f in sorted(glob.glob(os.path.join(SRC, '*_01.flac'))):
    b = os.path.basename(f)[:-8]
    if 'soft' in b: continue
    name = b.split('_')[0]; m = midi(name)
    d, sr = sf.read(f)
    if d.ndim > 1: d = d.mean(axis=1)
    on = int(np.argmax(np.abs(d) > 0.02)); d = d[max(0, on - int(0.001*sr)):]
    n = int(LEN*sr); d = d[:n].copy()
    fl = int(FADE*sr); d[-fl:] *= np.linspace(1, 0, fl) ** 2
    d = d - d.mean(); d *= 0.5 / np.abs(d).max()
    fn = f'{name.replace("#", "s")}.wav'
    sf.write(os.path.join(OUT, fn), d.astype(np.float32), sr, subtype='PCM_16')
    out.append({'midi': m, 'file': fn})
out.sort(key=lambda x: x['midi'])
print(json.dumps(out))
