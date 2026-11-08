// Turns any image the browser can open into a PNG before upload. Decoding happens here, on the admin's
// device, so the server only ever has to parse PNG and needs no image libraries.

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_PNG_BYTES = 2 * 1024 * 1024; // the server's upload limit
const SIDE_STEPS = [1024, 768, 512, 384, 256];
const FALLBACK_SIDE = 512; // for SVGs that declare no size

export class ImageConversionError extends Error {}

function decode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageConversionError('This device cannot open that file as an image. Try a JPG, PNG or WebP.'));
    };
    image.src = url;
  });
}

function encode(image, width, height, side) {
  const scale = Math.min(1, side / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Returns a PNG Blob within the server's limits, or throws ImageConversionError. */
export async function imageToPng(file) {
  if (file.size > MAX_INPUT_BYTES) throw new ImageConversionError('That file is too large. The limit is 50 MB.');
  const { image, url } = await decode(file);
  try {
    const width = image.naturalWidth || FALLBACK_SIDE;
    const height = image.naturalHeight || FALLBACK_SIDE;
    // Sprites are never drawn near 1024 px. Busy photos can need a smaller side to fit the upload limit.
    for (const side of SIDE_STEPS) {
      const png = await encode(image, width, height, side);
      if (png && png.size <= MAX_PNG_BYTES) return png;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  throw new ImageConversionError('That image could not be converted. Try a different file.');
}
