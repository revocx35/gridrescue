// Prepares an audio file for upload. Decoding happens here, on the admin's device, so the server only has to
// walk the structure of two simple formats. MP3 is kept as it is, because songs would be huge as WAV.
import { MAX_SOUND_BYTES } from './schema.js';

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const WAV_HEADER = 44;
// Best first; the first that fits the upload limit wins.
const QUALITY_STEPS = [[44100, 2], [44100, 1], [22050, 2], [22050, 1], [16000, 1], [11025, 1]];

export class SoundConversionError extends Error {}

function looksLikeMp3(head) {
  const tagged = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33; // "ID3"
  return tagged || (head[0] === 0xff && (head[1] & 0xe6) === 0xe2); // frame sync, Layer III
}

function encodeWav(rendered) {
  const channels = rendered.numberOfChannels;
  const frames = rendered.length;
  const buffer = new ArrayBuffer(WAV_HEADER + frames * channels * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rendered.sampleRate, true);
  view.setUint32(28, rendered.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, channel) => rendered.getChannelData(channel));
  let offset = WAV_HEADER;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, data[channel][frame])) * 32767), true);
      offset += 2;
    }
  }
  return buffer;
}

async function resample(decoded, rate, channels) {
  const context = new OfflineAudioContext(channels, Math.ceil(decoded.duration * rate), rate);
  const source = context.createBufferSource();
  source.buffer = decoded;
  source.connect(context.destination);
  source.start();
  return context.startRendering();
}

/** Returns { body, type } ready to upload, or throws SoundConversionError. */
export async function prepareSound(file) {
  if (file.size > MAX_INPUT_BYTES) throw new SoundConversionError('That file is too large. The limit is 100 MB.');
  const bytes = await file.arrayBuffer();
  if (file.size <= MAX_SOUND_BYTES && looksLikeMp3(new Uint8Array(bytes.slice(0, 4)))) return { body: bytes, type: 'audio/mpeg' };
  let decoded;
  try {
    decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
  } catch {
    throw new SoundConversionError('This device cannot open that file as audio. Try an MP3, WAV or OGG.');
  }
  for (const [rate, channels] of QUALITY_STEPS) {
    if (WAV_HEADER + Math.ceil(decoded.duration * rate) * channels * 2 > MAX_SOUND_BYTES) continue;
    return { body: encodeWav(await resample(decoded, rate, Math.min(channels, decoded.numberOfChannels))), type: 'audio/wav' };
  }
  throw new SoundConversionError('That sound is too long. Try a shorter file, or an MP3.');
}
