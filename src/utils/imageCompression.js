/*
 * Compresión liviana de fotos antes de subirlas a Storage.
 *
 * - Reduce a un máximo de `maxSide` px por lado.
 * - Intenta WebP; si el navegador no lo soporta (Safari devuelve PNG sin
 *   avisar), usa JPEG. Nunca entrega un PNG pesado.
 * - Si algo falla, devuelve el archivo original para no bloquear al usuario.
 */

export const IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable";

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la imagen."));
    };

    image.decoding = "async";
    image.src = objectUrl;
  });
}

function encodeCanvas(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export async function compressImageFile(
  file,
  { maxSide = 1200, quality = 0.82 } = {}
) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    return file;
  }

  try {
    const image = await loadImageFromFile(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

    if (!sourceWidth || !sourceHeight) return file;

    const scale = Math.min(maxSide / Math.max(sourceWidth, sourceHeight), 1);
    const width = Math.max(Math.round(sourceWidth * scale), 1);
    const height = Math.max(Math.round(sourceHeight * scale), 1);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return file;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    let blob = await encodeCanvas(canvas, "image/webp", quality);

    if (!blob || blob.type !== "image/webp") {
      blob = await encodeCanvas(canvas, "image/jpeg", quality);
    }

    // Si la "compresión" no ahorra nada, se conserva el original.
    if (!blob || blob.size >= file.size) return file;

    const extension = blob.type === "image/webp" ? "webp" : "jpg";
    const baseName =
      String(file.name || "imagen").replace(/\.[^.]+$/, "") || "imagen";

    return new File([blob], `${baseName}.${extension}`, {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
