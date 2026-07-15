import {
  preload,
  removeBackground,
} from "@imgly/background-removal";

export const PRODUCT_IMAGE_OUTPUT = {
  width: 1200,
  height: 1200,
  quality: 0.95,
  mimeType: "image/webp",
  extension: "webp",
};

export const BACKGROUND_PROCESSING_MODES = {
  REMOVE: "remove",
  KEEP: "keep",
};

const MAX_SOURCE_IMAGE_SIZE = 25 * 1024 * 1024;
const MAX_INFERENCE_SIDE = 1536;
const MAX_CHROMA_SIDE = 2600;

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

const GREEN_SCREEN_CONFIG = {
  borderThicknessRatio: 0.075,
  minBorderThickness: 22,
  maxBorderThickness: 120,
  sampleStep: 4,

  minGreenSamples: 70,
  minGreenRatio: 0.055,

  minRemovedAreaRatio: 0.025,

  edgeSoftRadius: 2,
  spillRadius: 4,

  removeSmallInteriorGreenHoles: true,
  maxInteriorHoleAreaRatio: 0.018,
  maxInteriorHoleWidthRatio: 0.28,
  maxInteriorHoleHeightRatio: 0.28,
};

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
    throw new Error("La imagen debe estar en formato JPG, PNG, WEBP o AVIF.");
  }

  if (file.size > MAX_SOURCE_IMAGE_SIZE) {
    throw new Error("La imagen no puede superar los 25 MB.");
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

function calculateContainSize(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);

  return {
    width: Math.max(Math.round(sourceWidth * ratio), 1),
    height: Math.max(Math.round(sourceHeight * ratio), 1),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPixelIndex(width, x, y) {
  return (y * width + x) * 4;
}

function colorDistanceRGB(a, b) {
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;

  return Math.sqrt(red * red + green * green + blue * blue);
}

function getLuminance(color) {
  return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

function getPixelColor(data, width, height, x, y) {
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const index = getPixelIndex(width, safeX, safeY);

  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
  };
}

function rgbToHsv(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

function hueDistance(a, b) {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

function isLikelyGreenPixel(color) {
  const hsv = rgbToHsv(color);
  const maxNonGreen = Math.max(color.r, color.b);
  const greenDominance = color.g - maxNonGreen;

  return (
    hsv.h >= 55 &&
    hsv.h <= 175 &&
    hsv.s >= 0.15 &&
    hsv.v >= 0.1 &&
    color.g >= 42 &&
    greenDominance >= 7
  );
}

function isGreenBackgroundPixel(color, keyColor, keyHsv) {
  const hsv = rgbToHsv(color);
  const maxNonGreen = Math.max(color.r, color.b);
  const greenDominance = color.g - maxNonGreen;

  const distance = colorDistanceRGB(color, keyColor);
  const hueGap = hueDistance(hsv.h, keyHsv.h);

  const closeToKey =
    distance <= 128 &&
    hueGap <= 82 &&
    hsv.s >= 0.1 &&
    color.g >= maxNonGreen + 3;

  const strongGreen =
    isLikelyGreenPixel(color) &&
    distance <= 160 &&
    hueGap <= 92 &&
    greenDominance >= 7;

  const darkGreenShadow =
    hsv.h >= 55 &&
    hsv.h <= 175 &&
    hsv.s >= 0.14 &&
    hsv.v >= 0.06 &&
    greenDominance >= 4 &&
    distance <= 170;

  return closeToKey || strongGreen || darkGreenShadow;
}

function isStrongGreenPixel(color, keyColor, keyHsv) {
  const hsv = rgbToHsv(color);
  const maxNonGreen = Math.max(color.r, color.b);
  const greenDominance = color.g - maxNonGreen;

  const distance = colorDistanceRGB(color, keyColor);
  const hueGap = hueDistance(hsv.h, keyHsv.h);

  return (
    distance <= 112 &&
    hueGap <= 68 &&
    hsv.s >= 0.16 &&
    color.g >= 45 &&
    greenDominance >= 8
  );
}

function sampleGreenKeyFromBorders(imageData, width, height) {
  const { data } = imageData;

  const borderThickness = Math.round(
    clamp(
      Math.min(width, height) * GREEN_SCREEN_CONFIG.borderThicknessRatio,
      GREEN_SCREEN_CONFIG.minBorderThickness,
      GREEN_SCREEN_CONFIG.maxBorderThickness
    )
  );

  const step = GREEN_SCREEN_CONFIG.sampleStep;
  const greenSamples = [];
  let totalSamples = 0;

  function sample(x, y) {
    totalSamples += 1;

    const color = getPixelColor(data, width, height, x, y);

    if (isLikelyGreenPixel(color)) {
      greenSamples.push(color);
    }
  }

  for (let y = 0; y < borderThickness; y += step) {
    for (let x = 0; x < width; x += step) {
      sample(x, y);
      sample(x, height - 1 - y);
    }
  }

  for (let x = 0; x < borderThickness; x += step) {
    for (let y = 0; y < height; y += step) {
      sample(x, y);
      sample(width - 1 - x, y);
    }
  }

  const greenRatio = greenSamples.length / Math.max(totalSamples, 1);

  if (
    greenSamples.length < GREEN_SCREEN_CONFIG.minGreenSamples ||
    greenRatio < GREEN_SCREEN_CONFIG.minGreenRatio
  ) {
    return {
      detected: false,
      greenRatio,
      greenSamples: greenSamples.length,
      totalSamples,
      keyColor: null,
      keyHsv: null,
    };
  }

  const sorted = [...greenSamples].sort(
    (a, b) => getLuminance(a) - getLuminance(b)
  );

  const start = Math.floor(sorted.length * 0.08);
  const end = Math.ceil(sorted.length * 0.92);
  const trimmed = sorted.slice(start, end);

  const average = trimmed.reduce(
    (acc, color) => {
      acc.r += color.r;
      acc.g += color.g;
      acc.b += color.b;
      return acc;
    },
    { r: 0, g: 0, b: 0 }
  );

  const keyColor = {
    r: average.r / Math.max(trimmed.length, 1),
    g: average.g / Math.max(trimmed.length, 1),
    b: average.b / Math.max(trimmed.length, 1),
  };

  return {
    detected: true,
    greenRatio,
    greenSamples: greenSamples.length,
    totalSamples,
    keyColor,
    keyHsv: rgbToHsv(keyColor),
  };
}

function getMaskComponents(mask, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;

      if (!mask[startIndex] || visited[startIndex]) continue;

      const stack = [[x, y]];
      visited[startIndex] = 1;

      let area = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      while (stack.length > 0) {
        const [currentX, currentY] = stack.pop();
        area += 1;

        if (currentX < minX) minX = currentX;
        if (currentY < minY) minY = currentY;
        if (currentX > maxX) maxX = currentX;
        if (currentY > maxY) maxY = currentY;

        const neighbors = [
          [currentX + 1, currentY],
          [currentX - 1, currentY],
          [currentX, currentY + 1],
          [currentX, currentY - 1],
        ];

        neighbors.forEach(([nextX, nextY]) => {
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            return;
          }

          const nextIndex = nextY * width + nextX;

          if (!mask[nextIndex] || visited[nextIndex]) return;

          visited[nextIndex] = 1;
          stack.push([nextX, nextY]);
        });
      }

      components.push({
        area,
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
      });
    }
  }

  return components;
}

function floodFillGreenBackground(imageData, width, height, keyColor, keyHsv) {
  const { data } = imageData;
  const mask = new Uint8Array(width * height);
  const queue = [];

  function tryAdd(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;

    const maskIndex = y * width + x;

    if (mask[maskIndex]) return;

    const color = getPixelColor(data, width, height, x, y);

    if (!isGreenBackgroundPixel(color, keyColor, keyHsv)) return;

    mask[maskIndex] = 1;
    queue.push([x, y]);
  }

  for (let x = 0; x < width; x += 1) {
    tryAdd(x, 0);
    tryAdd(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    tryAdd(0, y);
    tryAdd(width - 1, y);
  }

  let cursor = 0;

  while (cursor < queue.length) {
    const [x, y] = queue[cursor];
    cursor += 1;

    tryAdd(x + 1, y);
    tryAdd(x - 1, y);
    tryAdd(x, y + 1);
    tryAdd(x, y - 1);

    tryAdd(x + 1, y + 1);
    tryAdd(x - 1, y - 1);
    tryAdd(x + 1, y - 1);
    tryAdd(x - 1, y + 1);
  }

  return mask;
}

function buildStrongGreenMask(imageData, width, height, keyColor, keyHsv) {
  const { data } = imageData;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const dataIndex = index * 4;

      const color = {
        r: data[dataIndex],
        g: data[dataIndex + 1],
        b: data[dataIndex + 2],
      };

      if (isStrongGreenPixel(color, keyColor, keyHsv)) {
        mask[index] = 1;
      }
    }
  }

  return mask;
}

function mergeSmallInteriorGreenHoles(backgroundMask, greenMask, width, height) {
  if (!GREEN_SCREEN_CONFIG.removeSmallInteriorGreenHoles) {
    return backgroundMask;
  }

  const output = new Uint8Array(backgroundMask);
  const components = getMaskComponents(greenMask, width, height);
  const totalPixels = width * height;

  components.forEach((component) => {
    let alreadyConnectedToBackground = false;

    for (let y = component.minY; y <= component.maxY; y += 1) {
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const index = y * width + x;

        if (!greenMask[index]) continue;

        if (backgroundMask[index]) {
          alreadyConnectedToBackground = true;
          break;
        }
      }

      if (alreadyConnectedToBackground) break;
    }

    if (alreadyConnectedToBackground) return;

    const areaRatio = component.area / totalPixels;
    const widthRatio = component.width / width;
    const heightRatio = component.height / height;

    const looksLikeGreenHole =
      areaRatio <= GREEN_SCREEN_CONFIG.maxInteriorHoleAreaRatio &&
      widthRatio <= GREEN_SCREEN_CONFIG.maxInteriorHoleWidthRatio &&
      heightRatio <= GREEN_SCREEN_CONFIG.maxInteriorHoleHeightRatio;

    if (!looksLikeGreenHole) return;

    for (let y = component.minY; y <= component.maxY; y += 1) {
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const index = y * width + x;

        if (greenMask[index]) {
          output[index] = 1;
        }
      }
    }
  });

  return output;
}

function hasMaskedNeighbor(mask, width, height, x, y, radius = 1) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;

      const nx = x + offsetX;
      const ny = y + offsetY;

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      if (mask[ny * width + nx]) {
        return true;
      }
    }
  }

  return false;
}

function reduceGreenSpill(data, index, strength = 0.72) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];

  const maxNonGreen = Math.max(r, b);
  const greenExcess = g - maxNonGreen;

  if (greenExcess <= 4) return;

  data[index + 1] = clamp(Math.round(g - greenExcess * strength), 0, 255);
}

function applyGreenScreenMask(imageData, width, height, keyColor, keyHsv) {
  const { data } = imageData;

  const borderConnectedMask = floodFillGreenBackground(
    imageData,
    width,
    height,
    keyColor,
    keyHsv
  );

  const strongGreenMask = buildStrongGreenMask(
    imageData,
    width,
    height,
    keyColor,
    keyHsv
  );

  const finalMask = mergeSmallInteriorGreenHoles(
    borderConnectedMask,
    strongGreenMask,
    width,
    height
  );

  let removedPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const maskIndex = y * width + x;
      const dataIndex = maskIndex * 4;

      if (finalMask[maskIndex]) {
        data[dataIndex + 3] = 0;
        removedPixels += 1;
        continue;
      }

      const nearGreenBackground = hasMaskedNeighbor(
        finalMask,
        width,
        height,
        x,
        y,
        GREEN_SCREEN_CONFIG.edgeSoftRadius
      );

      const nearGreenSpill = hasMaskedNeighbor(
        finalMask,
        width,
        height,
        x,
        y,
        GREEN_SCREEN_CONFIG.spillRadius
      );

      const color = {
        r: data[dataIndex],
        g: data[dataIndex + 1],
        b: data[dataIndex + 2],
      };

      if (nearGreenBackground && isStrongGreenPixel(color, keyColor, keyHsv)) {
        data[dataIndex + 3] = 0;
        removedPixels += 1;
        continue;
      }

      if (nearGreenBackground) {
        data[dataIndex + 3] = Math.min(data[dataIndex + 3], 246);
      }

      if (nearGreenSpill) {
        reduceGreenSpill(data, dataIndex, 0.74);
      }
    }
  }

  return {
    imageData,
    mask: finalMask,
    removedPixels,
    removedAreaRatio: removedPixels / Math.max(width * height, 1),
  };
}

function cleanAlphaEdges(imageData) {
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];

    if (alpha <= 5) {
      data[index + 3] = 0;
      continue;
    }

    if (alpha >= 250) {
      data[index + 3] = 255;
      continue;
    }

    const normalized = alpha / 255;
    const softened = normalized * normalized * (3 - 2 * normalized);

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
      const alpha = data[getPixelIndex(width, x, y) + 3];

      if (alpha > 8) {
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
      empty: true,
    };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    empty: false,
  };
}

function expandBounds(bounds, width, height, marginRatio = 0.012) {
  if (bounds.empty) return bounds;

  const marginX = Math.round(width * marginRatio);
  const marginY = Math.round(height * marginRatio);

  const x = clamp(bounds.x - marginX, 0, width - 1);
  const y = clamp(bounds.y - marginY, 0, height - 1);
  const maxX = clamp(bounds.x + bounds.width - 1 + marginX, 0, width - 1);
  const maxY = clamp(bounds.y + bounds.height - 1 + marginY, 0, height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
    empty: false,
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
    context.drawImage(image, 0, 0, resized.width, resized.height);

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.94);

    return new File([blob], `${cleanFileName(file.name)}-inference.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function composeCanvasToWhiteStudio(
  sourceCanvas,
  bounds,
  {
    width,
    height,
    quality,
    mimeType,
    paddingRatio,
  }
) {
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
    Math.min(width, height) * Math.max(Number(paddingRatio || 0), 0)
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
}

async function composeOriginalCatalogImage(
  file,
  {
    width,
    height,
    quality,
    mimeType,
    keepPaddingRatio,
  }
) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

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
      Math.min(width, height) * Math.max(Number(keepPaddingRatio || 0), 0)
    );

    const availableWidth = Math.max(width - padding * 2, 1);
    const availableHeight = Math.max(height - padding * 2, 1);

    const rendered = calculateContainSize(
      sourceWidth,
      sourceHeight,
      availableWidth,
      availableHeight
    );

    const x = Math.round((width - rendered.width) / 2);
    const y = Math.round((height - rendered.height) / 2);

    outputContext.drawImage(image, x, y, rendered.width, rendered.height);

    return canvasToBlob(outputCanvas, mimeType, quality);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function composeFromTransparentForeground(
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

    sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = "high";
    sourceContext.drawImage(image, 0, 0);

    let imageData = sourceContext.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height
    );

    imageData = cleanAlphaEdges(imageData);
    sourceContext.putImageData(imageData, 0, 0);

    const rawBounds = findVisibleBounds(
      imageData,
      sourceCanvas.width,
      sourceCanvas.height
    );

    if (rawBounds.empty) {
      throw new Error("El procesador no detectó el producto en la imagen.");
    }

    const bounds = expandBounds(
      rawBounds,
      sourceCanvas.width,
      sourceCanvas.height,
      0.012
    );

    return composeCanvasToWhiteStudio(sourceCanvas, bounds, {
      width,
      height,
      quality,
      mimeType,
      paddingRatio,
    });
  } finally {
    URL.revokeObjectURL(foregroundUrl);
  }
}

async function composeGreenScreenImage(
  file,
  {
    width,
    height,
    quality,
    mimeType,
    paddingRatio,
  }
) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

    const resized = calculateContainSize(
      sourceWidth,
      sourceHeight,
      MAX_CHROMA_SIDE,
      MAX_CHROMA_SIDE
    );

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = resized.width;
    sourceCanvas.height = resized.height;

    const sourceContext = sourceCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!sourceContext) {
      throw new Error("No se pudo preparar la imagen con fondo verde.");
    }

    sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = "high";
    sourceContext.drawImage(image, 0, 0, resized.width, resized.height);

    let imageData = sourceContext.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height
    );

    const keyResult = sampleGreenKeyFromBorders(
      imageData,
      sourceCanvas.width,
      sourceCanvas.height
    );

    if (!keyResult.detected) {
      return {
        used: false,
        reason: "green-not-detected",
        blob: null,
      };
    }

    const maskResult = applyGreenScreenMask(
      imageData,
      sourceCanvas.width,
      sourceCanvas.height,
      keyResult.keyColor,
      keyResult.keyHsv
    );

    if (maskResult.removedAreaRatio < GREEN_SCREEN_CONFIG.minRemovedAreaRatio) {
      return {
        used: false,
        reason: "not-enough-green-removed",
        blob: null,
      };
    }

    imageData = cleanAlphaEdges(maskResult.imageData);
    sourceContext.putImageData(imageData, 0, 0);

    const rawBounds = findVisibleBounds(
      imageData,
      sourceCanvas.width,
      sourceCanvas.height
    );

    if (rawBounds.empty) {
      return {
        used: false,
        reason: "empty-green-result",
        blob: null,
      };
    }

    const bounds = expandBounds(
      rawBounds,
      sourceCanvas.width,
      sourceCanvas.height,
      0.012
    );

    const blob = await composeCanvasToWhiteStudio(sourceCanvas, bounds, {
      width,
      height,
      quality,
      mimeType,
      paddingRatio,
    });

    return {
      used: true,
      reason: "green-screen",
      blob,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
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
    paddingRatio = 0.1,
    keepPaddingRatio = 0.02,
    backgroundMode = BACKGROUND_PROCESSING_MODES.KEEP,
    onProgress,
  } = {}
) {
  validateSourceImage(file);

  const safeBackgroundMode = Object.values(BACKGROUND_PROCESSING_MODES).includes(
    backgroundMode
  )
    ? backgroundMode
    : BACKGROUND_PROCESSING_MODES.KEEP;

  onProgress?.({
    stage: "preparing",
    progress: 4,
    message: "Preparando imagen...",
  });

  if (safeBackgroundMode === BACKGROUND_PROCESSING_MODES.KEEP) {
    onProgress?.({
      stage: "keeping-background",
      progress: 46,
      message: "Conservando imagen original...",
      engine: "keep-background",
    });

    const originalBlob = await composeOriginalCatalogImage(file, {
      width,
      height,
      quality,
      mimeType,
      keepPaddingRatio,
    });

    onProgress?.({
      stage: "completed",
      progress: 100,
      message: "Imagen lista",
      engine: "keep-background",
    });

    return new File(
      [originalBlob],
      `${cleanFileName(file.name)}-master-caps.${PRODUCT_IMAGE_OUTPUT.extension}`,
      {
        type: mimeType,
        lastModified: Date.now(),
      }
    );
  }

  onProgress?.({
    stage: "detecting-green-background",
    progress: 14,
    message: "Detectando fondo verde...",
  });

  const greenResult = await composeGreenScreenImage(file, {
    width,
    height,
    quality,
    mimeType,
    paddingRatio,
  });

  if (greenResult.used) {
    onProgress?.({
      stage: "completed",
      progress: 100,
      message: "Imagen lista",
      engine: "green-screen",
    });

    return new File(
      [greenResult.blob],
      `${cleanFileName(file.name)}-master-caps.${PRODUCT_IMAGE_OUTPUT.extension}`,
      {
        type: mimeType,
        lastModified: Date.now(),
      }
    );
  }

  const inferenceFile = await resizeForInference(file);

  onProgress?.({
    stage: "loading-model",
    progress: 22,
    message: "Preparando inteligencia artificial...",
  });

  await preloadProductImageProcessor();

  onProgress?.({
    stage: "removing-background",
    progress: 32,
    message: "Quitando fondo...",
  });

  let transparentBlob;

  try {
    transparentBlob = await removeBackground(inferenceFile, {
      ...MODEL_CONFIG,
      progress: (key, current, total) => {
        const safeTotal = Number(total || 0);

        if (safeTotal <= 0) return;

        const modelProgress = Math.min(
          Math.round((Number(current || 0) / safeTotal) * 42),
          42
        );

        onProgress?.({
          stage: "removing-background",
          progress: 32 + modelProgress,
          message: "Quitando fondo...",
          key,
        });
      },
    });
  } catch (error) {
    console.error("Error del eliminador de fondo:", error);

    throw new Error(
      "No se pudo iniciar el procesador de imágenes. Reinicia la página y vuelve a intentarlo."
    );
  }

  onProgress?.({
    stage: "refining",
    progress: 78,
    message: "Perfeccionando bordes...",
  });

  const finalBlob = await composeFromTransparentForeground(transparentBlob, {
    width,
    height,
    quality,
    mimeType,
    paddingRatio,
  });

  onProgress?.({
    stage: "completed",
    progress: 100,
    message: "Imagen lista",
    engine: "imgly-background-removal",
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
