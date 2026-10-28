/**
 * A small JPEG copy of a picture the person attached, as base64 text without the "data:" prefix.
 *
 * It travels with the new image source (`image_preview`). The backend has a vision model read it and stores what it
 * saw as the source's text, so the film can use what the picture says (numbers in a chart, words in a screenshot).
 * The picture itself is uploaded separately, at full size, for showing in the video.
 *
 * The preview is drawn at most MAX_EDGE pixels on its longest side, on white (a transparent PNG has no colour to
 * become black), and shrunk further until it fits MAX_CHARS. The backend accepts up to 330,000 characters; this
 * stays well under that so several pictures and the rest of a request still fit.
 */
const MAX_EDGE = 1024;
const MAX_CHARS = 240_000;
const ATTEMPTS = 6;

const unreadable = () => new Error("Couldn't read that image. Try a JPEG or PNG.");

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Older browsers lack createImageBitmap for some types; an <img> element is the fallback.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw unreadable();
    }
  }
}

export async function imagePreviewBase64(file: File): Promise<string> {
  const picture = await decode(file);
  try {
    if (!(picture.width > 0 && picture.height > 0)) throw unreadable();
    let edge = MAX_EDGE;
    let quality = 0.8;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const scale = Math.min(1, edge / Math.max(picture.width, picture.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(picture.width * scale));
      canvas.height = Math.max(1, Math.round(picture.height * scale));
      const g = canvas.getContext("2d");
      if (!g) throw unreadable();
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(picture.source, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", quality);
      const base64 = url.slice(url.indexOf(",") + 1);
      if (url.startsWith("data:image/jpeg") && base64.length <= MAX_CHARS) return base64;
      edge = Math.round(edge * 0.8);
      quality = Math.max(0.5, quality - 0.1);
    }
    throw unreadable();
  } finally {
    picture.close();
  }
}
