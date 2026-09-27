/**
 * Write samples as a WAV file (32-bit float, mono), for the "Save a test clip" button.
 * Float keeps the raw signal exactly as the browser received it, noise and all.
 */
export function encodeWavFloat(samples, sampleRate) {
  const n = samples.length, bytes = 44 + n * 4;
  const buf = new ArrayBuffer(bytes), v = new DataView(buf);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, bytes - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);                 // format 3 = IEEE float
  v.setUint16(22, 1, true);                 // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);    // bytes per second
  v.setUint16(32, 4, true);                 // bytes per sample frame
  v.setUint16(34, 32, true);                // bits per sample
  text(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) v.setFloat32(44 + i * 4, samples[i], true);
  return buf;
}
