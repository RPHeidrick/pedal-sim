"""
Build sample riffs from the FreePats "Electric Guitar FSBS (direct)" CC0 note recordings:
a single coil electric guitar, bridge pickup, recorded straight into an audio interface (DI).
Each note in a riff is one of those recordings, lightly pitch shifted (at most 2 semitones)
when the exact note was not sampled. Loops are made seamless by wrapping tails to the start.
"""
import soundfile as sf, numpy as np, glob, os, re, sys
from fractions import Fraction
from scipy import signal
SRC = sys.argv[1]; OUT = sys.argv[2]
FS = 48000
NOTE = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
def midi(name):
    m = re.match(r'([A-G]#?)(\d)', name); return 12*(int(m.group(2))+1)+NOTE[m.group(1)]
bank = {}   # (midi, soft) -> [arrays]
for f in sorted(glob.glob(os.path.join(SRC, '*.flac'))):
    b = os.path.basename(f)[:-5]; parts = b.split('_')
    key = (midi(parts[0]), 'soft' in parts, parts[1])
    d, sr = sf.read(f); assert sr == FS
    on = int(np.argmax(np.abs(d) > 0.02)); d = d[max(0, on-48):]
    bank.setdefault(key, []).append(d)
keys = sorted(bank)
rr = {}
def note(m, soft=False, string=None):
    cands = [k for k in keys if k[1] == soft and (string is None or k[2] == string)] or [k for k in keys if k[1] == soft]
    k = min(cands, key=lambda k: (abs(k[0]-m), k[0] < m))
    shift = m - k[0]; assert abs(shift) <= 3, (m, k)
    i = rr.get(k, 0); rr[k] = i + 1
    x = bank[k][i % len(bank[k])]
    if shift:
        ratio = Fraction(2 ** (-shift/12)).limit_denominator(2000)   # fewer output samples = higher pitch
        x = signal.resample_poly(x[:FS*10], ratio.numerator, ratio.denominator)
    return x
def place(buf, t, x, dur, gain, fade=0.03):
    n0 = int(round(t*FS)); n = min(len(x), int(dur*FS))
    seg = x[:n].copy() * gain
    f = int(fade*FS); seg[-f:] *= np.linspace(1, 0, f)
    idx = (n0 + np.arange(n)) % len(buf)                 # wrap: seamless loop
    np.add.at(buf, idx, seg)
rng = np.random.default_rng(7)
human = lambda: rng.uniform(-0.006, 0.006)
vel = lambda a: a * rng.uniform(0.9, 1.08)
def finish(buf, name):
    buf = buf - buf.mean()
    rms = np.sqrt((buf**2).mean()); buf *= 10**(-21/20) / rms
    pk = np.abs(buf).max()
    if pk > 0.8: buf *= 0.8/pk
    sf.write(os.path.join(OUT, name), buf.astype(np.float32), FS, subtype='PCM_24')
    print(name, '%.2fs' % (len(buf)/FS), 'peak %.2f' % np.abs(buf).max())

N = lambda s: midi(s)
# 1. Slow single notes: A minor pentatonic, each left to ring
bpm = 76; beat = 60/bpm
buf = np.zeros(int(12*beat*FS)); t = 0
for n, b in [('A3',1),('C4',1),('D4',1),('E4',1),('G4',1),('E4',1),('A4',3),('G4',0.5),('E4',0.5),('D4',2)]:
    place(buf, t + human(), note(N(n)), b*beat + 0.25, vel(0.5)); t += b*beat
finish(buf, 'cc0-single-notes.wav')

# 2. Open chords, strummed: G C D Em (down, down, up, up, down)
OPEN = {'G': ['G2','B2','D3','G3','B3','G4'], 'C': ['C3','E3','G3','C4','E4'], 'D': ['D3','A3','D4','F#4'], 'Em': ['E2','B2','E3','G3','B3','E4']}
bpm = 96; beat = 60/bpm
buf = np.zeros(int(16*beat*FS)); t = 0
for ch in ['G','C','D','Em']:
    notes = [N(n) for n in OPEN[ch]]
    hits = [(0,0.34,False),(1,0.28,False),(1.5,0.2,True),(2.5,0.2,True),(3,0.28,False)]
    for i,(off,a,up) in enumerate(hits):
        nxt = hits[i+1][0] if i+1 < len(hits) else 4
        order = notes[::-1] if up else notes
        for j,m in enumerate(order):
            place(buf, t + off*beat + j*0.011 + human()*0.5, note(m, soft=up), (nxt-off)*beat + 0.04 - j*0.011, vel(a))
    t += 4*beat
finish(buf, 'cc0-open-chords.wav')

# 3. Power chord riff: ringing hits and short staccato chords
P5 = lambda r: [N(r), N(r)+7, N(r)+12]
bpm = 110; beat = 60/bpm
buf = np.zeros(int(16*beat*FS) + FS); t = 0
bar = [('E2',0.5,'stac'),('E2',0.5,'stac'),('G2',1,'ring'),('A2',1,'ring'),('E2',0.5,'stac'),('E2',0.5,'stac')]
for rep in range(2):
    for root, b, kind in bar + ([('D3',1,'ring'),('C3',1,'ring')] if rep else [('A2',1,'ring'),('G2',1,'ring')]):
        dur = 0.13 if kind == 'stac' else b*beat + 0.03
        for j,m in enumerate(P5(root)):
            place(buf, t + j*0.008 + human()*0.5, note(m), dur, vel(0.36), fade=0.02 if kind == 'stac' else 0.04)
        t += b*beat
buf = buf[:int(round(t*FS))]            # exactly 12 beats: loops on the beat
finish(buf, 'cc0-power-chords.wav')
