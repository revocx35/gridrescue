// Strict PNG validation. Uploaded files are parsed chunk by chunk and rebuilt from an allowlist,
// so metadata, trailing data and polyglot payloads never reach the sprite store.
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'gAMA', 'sRGB', 'IDAT', 'IEND']);
const VALID_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export const MAX_SPRITE_BYTES = 2 * 1024 * 1024;
export const MAX_SPRITE_DIMENSION = 2048;

export class InvalidPng extends Error {}

function fail(reason) {
  throw new InvalidPng(reason);
}

/** Returns a cleaned PNG buffer, or throws InvalidPng. */
export function sanitizePng(input, { maxDimension = MAX_SPRITE_DIMENSION } = {}) {
  if (!Buffer.isBuffer(input) || input.length < SIGNATURE.length + 12) fail('too short');
  if (!input.subarray(0, 8).equals(SIGNATURE)) fail('bad signature');

  const kept = [SIGNATURE];
  const idat = [];
  let header = null;
  let sawEnd = false;
  let offset = 8;

  while (offset < input.length) {
    if (sawEnd) fail('data after IEND');
    if (offset + 12 > input.length) fail('truncated chunk');
    const length = input.readUInt32BE(offset);
    if (length > input.length - offset - 12) fail('chunk overruns file');
    const type = input.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) fail('bad chunk type');
    const end = offset + 12 + length;
    const crc = input.readUInt32BE(end - 4);
    if (zlib.crc32(input.subarray(offset + 4, end - 4)) !== crc) fail('bad chunk checksum');
    const data = input.subarray(offset + 8, end - 4);

    if (!header) {
      if (type !== 'IHDR' || length !== 13) fail('IHDR must come first');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
      if (!header.width || !header.height) fail('empty image');
      if (header.width > maxDimension || header.height > maxDimension) fail('image too large');
      if (!VALID_DEPTHS[header.colorType]?.includes(header.depth)) fail('bad colour format');
      if (data[10] !== 0 || data[11] !== 0 || header.interlace > 1) fail('bad compression settings');
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') sawEnd = true;
    if (KEEP.has(type)) kept.push(input.subarray(offset, end));
    offset = end;
  }

  if (!sawEnd) fail('missing IEND');
  if (!idat.length) fail('no image data');

  // Inflate with a hard ceiling: proves the pixels decode and refuses decompression bombs.
  const bytesPerPixel = Math.ceil((CHANNELS[header.colorType] * header.depth) / 8);
  const ceiling = (header.width * bytesPerPixel + 1) * header.height * 2 + 4096;
  try {
    zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: ceiling });
  } catch {
    fail('image data does not decode');
  }
  return Buffer.concat(kept);
}
