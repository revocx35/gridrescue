// Strict parsers for uploaded sounds. Nothing is decoded here: each file is walked structurally and
// rebuilt from its audio data alone, so metadata and anything hidden around the audio is dropped.

export class InvalidAudio extends Error {}

const WAV_PCM = 1;
const WAV_MIN_RATE = 8000;
const WAV_MAX_RATE = 96000;
const WAV_HEADER = 44;

function fail(reason) {
  throw new InvalidAudio(reason);
}

function sanitizeWav(buffer) {
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WAVE') fail('not a wav file');
  let format = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buffer.length && !(format && data)) {
    const id = buffer.toString('latin1', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) fail('chunk runs past the end');
    if (id === 'fmt ') {
      if (size < 16) fail('short format chunk');
      format = {
        code: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        rate: buffer.readUInt32LE(start + 4),
        align: buffer.readUInt16LE(start + 12),
        bits: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(start, start + size);
    }
    offset = start + size + (size % 2); // chunks are padded to even lengths
  }
  if (!format || !data?.length) fail('missing format or data');
  const { code, channels, rate, bits, align } = format;
  if (code !== WAV_PCM || ![1, 2].includes(channels) || ![8, 16, 24].includes(bits)) fail('unsupported encoding');
  if (rate < WAV_MIN_RATE || rate > WAV_MAX_RATE) fail('unsupported sample rate');
  if (align !== (channels * bits) / 8 || data.length % align) fail('misaligned samples');

  const out = Buffer.alloc(WAV_HEADER + data.length);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVEfmt ', 8, 'latin1');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(WAV_PCM, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * align, 28);
  out.writeUInt16LE(align, 32);
  out.writeUInt16LE(bits, 34);
  out.write('data', 36, 'latin1');
  out.writeUInt32LE(data.length, 40);
  data.copy(out, WAV_HEADER);
  return out;
}

const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const MP3_MIN_FRAMES = 2;

/** The byte length of the MPEG Layer III frame at offset, or 0 if there is no valid frame there. */
function mp3FrameLength(buffer, offset) {
  if (offset + 4 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return 0;
  const version = (buffer[offset + 1] >> 3) & 3;
  const layer = (buffer[offset + 1] >> 1) & 3;
  const bitrateIndex = buffer[offset + 2] >> 4;
  const rateIndex = (buffer[offset + 2] >> 2) & 3;
  const padding = (buffer[offset + 2] >> 1) & 1;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return 0;
  const bitrate = (version === 3 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIndex] * 1000;
  return Math.floor(((version === 3 ? 144 : 72) * bitrate) / MP3_RATES[version][rateIndex]) + padding;
}

function id3Length(buffer) {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') return 0;
  const [a, b, c, d] = [buffer[6], buffer[7], buffer[8], buffer[9]];
  if ((a | b | c | d) & 0x80) fail('bad tag size');
  return 10 + ((a << 21) | (b << 14) | (c << 7) | d);
}

function sanitizeMp3(buffer) {
  const start = id3Length(buffer);
  let offset = start;
  let frames = 0;
  for (let length = mp3FrameLength(buffer, offset); length && offset + length <= buffer.length; length = mp3FrameLength(buffer, offset)) {
    offset += length;
    frames += 1;
  }
  if (frames < MP3_MIN_FRAMES) fail('no audio frames');
  return Buffer.from(buffer.subarray(start, offset)); // anything after the last frame stays behind
}

const SANITIZERS = {
  'audio/wav': { extension: 'wav', sanitize: sanitizeWav },
  'audio/mpeg': { extension: 'mp3', sanitize: sanitizeMp3 },
};

export const AUDIO_TYPES = Object.keys(SANITIZERS);

/** Returns { bytes, extension } rebuilt from the upload, or throws InvalidAudio. */
export function sanitizeAudio(type, buffer) {
  const format = SANITIZERS[type];
  if (!format) fail('unsupported type');
  return { bytes: format.sanitize(buffer), extension: format.extension };
}
