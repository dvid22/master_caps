import {
  preload,
  removeBackground,
} from "@imgly/background-removal";

export const PRODUCT_IMAGE_OUTPUT = {
  width: 1200,
  height: 1200,
  quality: 0.9,
  mimeType: "image/webp",
  extension: "webp",
};

const MAX_SOURCE_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_INFERENCE_SIDE = 1024;
const MODEL_CONFIG = {
  device: "cpu",
  model: "isnet_quint8",
  debug: false,
  output: {
    format: "image/png",
    quality: 1,
    type: "foreground",
  },
};

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];

let preloadPromise = null;

function cleanFileName(value) {
  return (
    String(value || "producto")
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "producto"
  );
}

function validateSourceImage(file) {
  if (!(file instanceof File)) {
    throw new Error("La imagen seleccionada no es válida.");
  }

  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(
      "La imagen debe estar en formato JPG, PNG, WEBP o AVIF."
    );
  }

  if (file.size > MAX_SOURCE_IMAGE_SIZE) {
    throw new Error("La imagen no puede superar los 15 MB.");
  }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("No se pudo leer la imagen seleccionada."));

    image.decoding = "async";
    image.src = source;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("No se pudo generar la imagen final."));
      },
      mimeType,
      quality
    );
  });
}

function calculateContainSize(
  sourceWidth,
  sourceHeight,
  maxWidth,
  maxHeight
) {
  const ratio = Math.min(
    maxWidth / sourceWidth,
    maxHeight / sourceHeight
  );

  return {
    width: Math.max(Math.round(sourceWidth * ratio), 1),
    height: Math.max(Math.round(sourceHeight * ratio), 1),
  };
}

async function resizeForInference(file) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);

    const originalWidth = image.naturalWidth || image.width;
    const originalHeight = image.naturalHeight || image.height;

    if (
      originalWidth <= MAX_INFERENCE_SIDE &&
      originalHeight <= MAX_INFERENCE_SIDE
    ) {
      return file;
    }

    const resized = calculateContainSize(
      originalWidth,
      originalHeight,
      MAX_INFERENCE_SIDE,
      MAX_INFERENCE_SIDE
    );

    const canvas = document.createElement("canvas");
    canvas.width = resized.width;
    canvas.height = resized.height;

    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    if (!context) {
      throw new Error("No se pudo preparar la imagen.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
      image,
      0,
      0,
      resized.width,
      resized.height
    );

    const blob = await canvasToBlob(
      canvas,
      "image/jpeg",
      0.88
    );

    return new File(
      [blob],
      `${cleanFileName(file.name)}-inference.jpg`,
      {
        type: "image/jpeg",
        lastModified: Date.now(),
      }
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function cleanAlphaEdges(imageData) {
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];

    if (alpha <= 10) {
      data[index + 3] = 0;
      continue;
    }

    if (alpha >= 245) {
      data[index + 3] = 255;
      continue;
    }

    const normalized = alpha / 255;
    const softened =
      normalized * normalized * (3 - 2 * normalized);

    data[index + 3] = Math.round(softened * 255);
  }

  return imageData;
}

function findVisibleBounds(imageData, width, height) {
  const { data } = imageData;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];

      if (alpha > 14) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      x: 0,
      y: 0,
      width,
      height,
    };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

async function composeWhiteStudioImage(
  foregroundBlob,
  {
    width,
    height,
    quality,
    mimeType,
    paddingRatio,
  }
) {
  const foregroundUrl = URL.createObjectURL(foregroundBlob);

  try {
    const image = await loadImage(foregroundUrl);

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth || image.width;
    sourceCanvas.height = image.naturalHeight || image.height;

    const sourceContext = sourceCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!sourceContext) {
      throw new Error("No se pudo analizar el recorte del producto.");
    }

    sourceContext.clearRect(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height
    );
    sourceContext.drawImage(image, 0, 0);

    let imageData = sourceContext.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height
    );

    imageData = cleanAlphaEdges(imageData);
    sourceContext.putImageData(imageData, 0, 0);

    const bounds = findVisibleBounds(
      imageData,
      sourceCanvas.width,
      sourceCanvas.height
    );

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = width;
    outputCanvas.height = height;

    const outputContext = outputCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    if (!outputContext) {
      throw new Error("No se pudo crear la imagen final.");
    }

    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, width, height);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";

    const padding = Math.round(
      Math.min(width, height) *
        Math.max(Number(paddingRatio || 0), 0)
    );

    const availableWidth = Math.max(width - padding * 2, 1);
    const availableHeight = Math.max(height - padding * 2, 1);

    const rendered = calculateContainSize(
      bounds.width,
      bounds.height,
      availableWidth,
      availableHeight
    );

    const x = Math.round((width - rendered.width) / 2);
    const y = Math.round((height - rendered.height) / 2);

    outputContext.drawImage(
      sourceCanvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      x,
      y,
      rendered.width,
      rendered.height
    );

    return canvasToBlob(outputCanvas, mimeType, quality);
  } finally {
    URL.revokeObjectURL(foregroundUrl);
  }
}

export function preloadProductImageProcessor() {
  if (!preloadPromise) {
    preloadPromise = preload(MODEL_CONFIG).catch((error) => {
      preloadPromise = null;
      console.warn(
        "La precarga no pudo completarse; se cargará al procesar la imagen:",
        error
      );
      return false;
    });
  }

  return preloadPromise;
}

export async function standardizeProductImage(
  file,
  {
    width = PRODUCT_IMAGE_OUTPUT.width,
    height = PRODUCT_IMAGE_OUTPUT.height,
    quality = PRODUCT_IMAGE_OUTPUT.quality,
    mimeType = PRODUCT_IMAGE_OUTPUT.mimeType,
    paddingRatio = 0.08,
    onProgress,
  } = {}
) {
  validateSourceImage(file);

  onProgress?.({
    stage: "preparing",
    progress: 4,
    message: "Preparando imagen...",
  });

  const inferenceFile = await resizeForInference(file);

  onProgress?.({
    stage: "loading-model",
    progress: 10,
    message: "Preparando inteligencia artificial...",
  });

  await preloadProductImageProcessor();

  onProgress?.({
    stage: "removing-background",
    progress: 18,
    message: "Quitando fondo...",
  });

  let transparentBlob;

  try {
    transparentBlob = await removeBackground(
      inferenceFile,
      {
        ...MODEL_CONFIG,
        progress: (key, current, total) => {
          const safeTotal = Number(total || 0);

          if (safeTotal <= 0) return;

          const modelProgress = Math.min(
            Math.round(
              (Number(current || 0) / safeTotal) * 48
            ),
            48
          );

          onProgress?.({
            stage: "removing-background",
            progress: 18 + modelProgress,
            message: "Quitando fondo...",
            key,
          });
        },
      }
    );
  } catch (error) {
    console.error("Error del eliminador de fondo:", error);

    throw new Error(
      "No se pudo iniciar el procesador de imágenes en este navegador. Reinicia Vite y vuelve a intentarlo."
    );
  }

  onProgress?.({
    stage: "refining",
    progress: 72,
    message: "Perfeccionando bordes...",
  });

  const finalBlob = await composeWhiteStudioImage(
    transparentBlob,
    {
      width,
      height,
      quality,
      mimeType,
      paddingRatio,
    }
  );

  onProgress?.({
    stage: "completed",
    progress: 100,
    message: "Imagen lista",
  });

  return new File(
    [finalBlob],
    `${cleanFileName(file.name)}-master-caps.${PRODUCT_IMAGE_OUTPUT.extension}`,
    {
      type: mimeType,
      lastModified: Date.now(),
    }
  );
}

export async function standardizeProductImages(
  files,
  {
    onFileStart,
    onFileProgress,
    onFileComplete,
    onFileError,
    ...options
  } = {}
) {
  const inputFiles = Array.from(files || []);
  const results = [];

  await preloadProductImageProcessor();

  for (let index = 0; index < inputFiles.length; index += 1) {
    const file = inputFiles[index];

    try {
      onFileStart?.({
        file,
        index,
        total: inputFiles.length,
      });

      const processed = await standardizeProductImage(file, {
        ...options,
        onProgress: (progress) =>
          onFileProgress?.({
            ...progress,
            file,
            index,
            total: inputFiles.length,
          }),
      });

      results.push(processed);

      onFileComplete?.({
        file,
        processed,
        index,
        total: inputFiles.length,
      });
    } catch (error) {
      onFileError?.({
        file,
        error,
        index,
        total: inputFiles.length,
      });

      throw error;
    }
  }

  return results;
}

function scheduleAutomaticPreload() {
  if (typeof window === "undefined") return;

  const start = () => {
    preloadProductImageProcessor().catch(() => {});
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, {
      timeout: 2500,
    });
    return;
  }

  window.setTimeout(start, 1200);
}

scheduleAutomaticPreload();