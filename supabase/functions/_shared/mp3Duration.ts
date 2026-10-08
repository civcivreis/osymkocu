/** Best-effort MPEG duration. Returns null if headers cannot be parsed. */
export function mp3DurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 16) return null;
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    offset = 10 + size;
  }
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const rates = [44100, 48000, 32000];
  let duration = 0;
  let frames = 0;
  while (offset + 4 < bytes.length && frames < 200000) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const b1 = bytes[offset + 1];
    const b2 = bytes[offset + 2];
    const version = (b1 >> 3) & 3;
    const layer = (b1 >> 1) & 3;
    const bitrateIndex = (b2 >> 4) & 0xf;
    const sampleIndex = (b2 >> 2) & 3;
    const padding = (b2 >> 1) & 1;
    if (layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
      offset += 1;
      continue;
    }
    const bitrate = bitrates[bitrateIndex] * 1000;
    const sampleRate = version === 3 ? rates[sampleIndex] : Math.round(rates[sampleIndex] / 2);
    if (!bitrate || !sampleRate) {
      offset += 1;
      continue;
    }
    const frameLength = Math.floor((144 * bitrate) / sampleRate) + padding;
    if (frameLength < 24) {
      offset += 1;
      continue;
    }
    duration += 1152 / sampleRate;
    offset += frameLength;
    frames += 1;
  }
  if (frames < 8) return null;
  return Math.round(duration * 1000);
}

export function estimateSpeechMs(text: string) {
  const chars = Math.max(text.trim().length, 1);
  return Math.round((chars / 14) * 1000);
}
