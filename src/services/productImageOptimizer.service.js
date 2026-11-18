/*
 * Optimización masiva de imágenes de productos (Fase 2).
 *
 * Reglas de seguridad (la app está en producción):
 * - NUNCA borra ni sobrescribe archivos existentes: las versiones optimizadas
 *   se suben a rutas nuevas. Las rutas viejas reemplazadas quedan anotadas en
 *   `imagesReplacedPaths` del producto para limpiarlas más adelante (aparte).
 * - En Firestore solo toca campos de imagen, dentro de una transacción que
 *   relee el producto: si alguien cambió las fotos mientras tanto, solo se
 *   aplican los cambios de las fotos que siguen igual. Stock, precios, ventas
 *   y demás campos no se tocan.
 * - Reanudable: cada producto terminado guarda una firma de sus imágenes; si
 *   la firma coincide, el producto se salta sin descargar nada.
 */

import {
  arrayUnion,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import {
  deleteObject,
  getBlob,
  getDownloadURL,
  getMetadata,
  ref,
  updateMetadata,
  uploadBytes,
} from "firebase/storage";

import { db, storage } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import {
  buildProductImagesPayload,
  getProductImages,
} from "./products.service";
import {
  createProductPlaceholder,
  createProductThumbnail,
  recompressProductImage,
} from "./productImageProcessing.service";

export const IMAGE_OPTIMIZATION_VERSION = 1;

const LONG_CACHE_CONTROL = "public,max-age=31536000,immutable";
const MIN_ACCEPTABLE_CACHE_SECONDS = 24 * 60 * 60;

/** Una imagen principal por encima de esto se recomprime. */
const MAIN_MAX_BYTES = 250 * 1024;
/** Una miniatura por encima de esto se vuelve a generar. */
const THUMB_MAX_BYTES = 70 * 1024;
/** Solo se reemplaza si la nueva versión ahorra al menos este porcentaje. */
const MIN_SAVING_RATIO = 0.15;

/**
 * Orígenes permitidos en la configuración CORS del bucket (ver cors.json).
 * Desde otro origen, getBlob() falla tras ~2 minutos de reintentos.
 */
export const IMAGE_DOWNLOAD_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://masterc.dalotech.site",
  "https://mastercaps.dalotech.site",
];

const ACCEPTED_SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/* -------------------------------------------------------------------------- */
/*                                  UTILIDADES                                */
/* -------------------------------------------------------------------------- */

function getImageKey(image) {
  return String(image?.path || image?.url || "").trim();
}

function getImagesSignature(images) {
  return (images || []).map(getImageKey).join("|");
}

export function isProductImagesOptimized(product) {
  const images = getProductImages(product);

  if (images.length === 0) return true;

  return (
    Number(product?.imagesOptimizedVersion || 0) >= IMAGE_OPTIMIZATION_VERSION &&
    product?.imagesOptimizedSignature === getImagesSignature(images)
  );
}

function getStorageRef(pathOrUrl) {
  return ref(storage, pathOrUrl);
}

async function readMetadata(pathOrUrl) {
  if (!pathOrUrl) return null;

  try {
    const metadata = await getMetadata(getStorageRef(pathOrUrl));

    return {
      size: Number(metadata.size || 0),
      contentType: String(metadata.contentType || ""),
      cacheControl: String(metadata.cacheControl || ""),
      fullPath: metadata.fullPath,
    };
  } catch (error) {
    if (error?.code === "storage/object-not-found") return null;
    throw error;
  }
}

function hasLongCache(cacheControl) {
  const value = String(cacheControl || "").toLowerCase();

  if (!value || value.includes("private") || value.includes("no-store")) {
    return false;
  }

  const match = value.match(/max-age=(\d+)/);
  return Boolean(match) && Number(match[1]) >= MIN_ACCEPTABLE_CACHE_SECONDS;
}

function safeName(value) {
  return (
    String(value || "producto")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9.\-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "producto"
  );
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function uploadOptimizedFile(file, path, metadata) {
  const fileRef = getStorageRef(path);

  await uploadBytes(fileRef, file, {
    contentType: file.type,
    cacheControl: LONG_CACHE_CONTROL,
    customMetadata: metadata,
  });

  return getDownloadURL(fileRef);
}

async function deleteQuietly(paths) {
  await Promise.all(
    [...new Set((paths || []).filter(Boolean))].map(async (path) => {
      try {
        await deleteObject(getStorageRef(path));
      } catch {
        // Si no se puede borrar, queda huérfano pero no afecta a nadie.
      }
    })
  );
}

async function runWithConcurrency(items, limit, worker, shouldStop) {
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      if (shouldStop?.()) return;
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => next())
  );
}

/* -------------------------------------------------------------------------- */
/*                                   ANÁLISIS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Solo lee metadatos de Storage (no descarga imágenes, no escribe nada).
 */
async function analyzeImage(image) {
  const main = await readMetadata(image.path || image.url);

  if (!main) {
    return { missing: true };
  }

  const thumb = image.thumbnailUrl || image.thumbnailPath
    ? await readMetadata(image.thumbnailPath || image.thumbnailUrl)
    : null;

  const needsMain =
    main.size > MAIN_MAX_BYTES || main.contentType === "image/png";

  const needsThumb =
    !thumb ||
    thumb.size > THUMB_MAX_BYTES ||
    thumb.contentType === "image/png";

  return {
    missing: false,
    main,
    thumb,
    needsMain,
    needsThumb,
    needsPlaceholder: !image.placeholder,
    needsMainCache: !hasLongCache(main.cacheControl),
    needsThumbCache: Boolean(thumb) && !hasLongCache(thumb.cacheControl),
  };
}

function createEmptySummary() {
  return {
    products: 0,
    productsWithImages: 0,
    alreadyOptimized: 0,
    productsNeedingWork: 0,
    images: 0,
    missingImages: 0,
    imagesToRecompress: 0,
    thumbnailsToCreate: 0,
    placeholdersToCreate: 0,
    cacheFixes: 0,
    mainBytes: 0,
    heavyMainBytes: 0,
    errors: 0,
  };
}

/**
 * Recorre los productos y estima el trabajo pendiente. No modifica nada.
 */
export async function analyzeProductImages(
  products,
  { onProgress, shouldStop, concurrency = 6 } = {}
) {
  const summary = createEmptySummary();
  const list = Array.isArray(products) ? products : [];
  let done = 0;

  summary.products = list.length;

  await runWithConcurrency(
    list,
    concurrency,
    async (product) => {
      const images = getProductImages(product);

      if (images.length > 0) {
        summary.productsWithImages += 1;

        if (isProductImagesOptimized(product)) {
          summary.alreadyOptimized += 1;
        } else {
          let productNeedsWork = false;

          for (const image of images) {
            summary.images += 1;

            try {
              const analysis = await analyzeImage(image);

              if (analysis.missing) {
                summary.missingImages += 1;
                continue;
              }

              summary.mainBytes += analysis.main.size;

              if (analysis.needsMain) {
                summary.imagesToRecompress += 1;
                summary.heavyMainBytes += analysis.main.size;
              }
              if (analysis.needsThumb) summary.thumbnailsToCreate += 1;
              if (analysis.needsPlaceholder) summary.placeholdersToCreate += 1;
              if (analysis.needsMainCache && !analysis.needsMain) summary.cacheFixes += 1;
              if (analysis.needsThumbCache && !analysis.needsThumb) summary.cacheFixes += 1;

              productNeedsWork = true;
            } catch (error) {
              summary.errors += 1;
              console.warn("No se pudo analizar la imagen:", image, error);
            }
          }

          if (productNeedsWork) summary.productsNeedingWork += 1;
        }
      }

      done += 1;
      onProgress?.({ done, total: list.length, summary: { ...summary } });
    },
    shouldStop
  );

  return summary;
}

/* -------------------------------------------------------------------------- */
/*                                 OPTIMIZACIÓN                               */
/* -------------------------------------------------------------------------- */

async function optimizeSingleImage(image, { storeId, productId }) {
  const result = {
    key: getImageKey(image),
    changes: null,
    uploadedPaths: [],
    replacedPaths: [],
    bytesBefore: 0,
    bytesAfter: 0,
    recompressed: false,
    thumbnailCreated: false,
    placeholderCreated: false,
    cacheFixed: 0,
    warning: "",
  };

  const analysis = await analyzeImage(image);

  if (analysis.missing) {
    result.warning = "Archivo original no encontrado en Storage";
    return result;
  }

  result.bytesBefore = analysis.main.size;
  result.bytesAfter = analysis.main.size;

  /* Caché: se corrige en el archivo existente solo si NO se va a reemplazar. */
  const cacheTargets = [];
  if (analysis.needsMainCache && !analysis.needsMain) {
    cacheTargets.push(image.path || image.url);
  }
  if (analysis.needsThumbCache && !analysis.needsThumb) {
    cacheTargets.push(image.thumbnailPath || image.thumbnailUrl);
  }

  for (const target of cacheTargets) {
    try {
      await updateMetadata(getStorageRef(target), {
        cacheControl: LONG_CACHE_CONTROL,
      });
      result.cacheFixed += 1;
    } catch (error) {
      console.warn("No se pudo corregir la caché de:", target, error);
    }
  }

  if (!analysis.needsMain && !analysis.needsThumb && !analysis.needsPlaceholder) {
    return result;
  }

  let blob;

  try {
    blob = await getBlob(getStorageRef(image.path || image.url));
  } catch (error) {
    if (error?.code === "storage/retry-limit-exceeded") {
      throw new Error(
        `No se pudo descargar la imagen. Si abriste la app desde ${window.location.origin}, ` +
          "Storage la bloquea (CORS): ábrela desde http://localhost:5173 o desde el dominio oficial.",
        { cause: error }
      );
    }
    throw error;
  }
  const sourceType = ACCEPTED_SOURCE_TYPES.includes(blob.type)
    ? blob.type
    : ACCEPTED_SOURCE_TYPES.includes(analysis.main.contentType)
      ? analysis.main.contentType
      : "image/jpeg";

  const sourceFile = new File([blob], safeName(image.name || "producto"), {
    type: sourceType,
  });

  const changes = {};
  const stamp = Date.now();
  const imageId = createId();
  let derivedSource = sourceFile;

  if (analysis.needsMain) {
    const optimized = await recompressProductImage(sourceFile);

    if (optimized.size <= analysis.main.size * (1 - MIN_SAVING_RATIO)) {
      const path = `products/${storeId}/${productId}/${stamp}-${imageId}-${safeName(optimized.name)}`;
      const url = await uploadOptimizedFile(optimized, path, {
        storeId,
        productId,
        imageType: image.type || "gallery",
        variant: "optimized",
      });

      result.uploadedPaths.push(path);
      if (image.path) result.replacedPaths.push(image.path);

      changes.url = url;
      changes.path = path;
      result.bytesAfter = optimized.size;
      result.recompressed = true;
      derivedSource = optimized;
    } else if (analysis.needsMainCache) {
      // No valió la pena reemplazarla: al menos arreglar su caché.
      try {
        await updateMetadata(getStorageRef(image.path || image.url), {
          cacheControl: LONG_CACHE_CONTROL,
        });
        result.cacheFixed += 1;
      } catch {
        // sin acción
      }
    }
  }

  if (analysis.needsThumb) {
    const thumbnail = await createProductThumbnail(derivedSource);
    const path = `products/${storeId}/${productId}/thumbs/${stamp}-${imageId}-${safeName(thumbnail.name)}`;
    const url = await uploadOptimizedFile(thumbnail, path, {
      storeId,
      productId,
      imageType: image.type || "gallery",
      variant: "catalog-thumbnail",
    });

    result.uploadedPaths.push(path);
    if (image.thumbnailPath) result.replacedPaths.push(image.thumbnailPath);

    changes.thumbnailUrl = url;
    changes.thumbnailPath = path;
    result.thumbnailCreated = true;
  }

  if (analysis.needsPlaceholder) {
    const placeholder = await createProductPlaceholder(derivedSource);

    if (placeholder) {
      changes.placeholder = placeholder;
      result.placeholderCreated = true;
    }
  }

  result.changes = Object.keys(changes).length > 0 ? changes : null;
  return result;
}

/**
 * Optimiza las imágenes de UN producto y guarda el resultado.
 * Devuelve un resumen; lanza error solo si falla la escritura en Firestore.
 */
export async function optimizeProductImages(product, { storeId = STORE_ID } = {}) {
  const productId = product?.id;
  const cleanStoreId = product?.storeId || storeId || STORE_ID;
  const images = getProductImages(product);

  const report = {
    productId,
    name: product?.name || product?.code || productId,
    status: "unchanged",
    images: images.length,
    bytesBefore: 0,
    bytesAfter: 0,
    recompressed: 0,
    thumbnails: 0,
    placeholders: 0,
    cacheFixed: 0,
    warnings: [],
  };

  if (!productId || images.length === 0) {
    report.status = "skipped";
    return report;
  }

  if (isProductImagesOptimized(product)) {
    report.status = "skipped";
    return report;
  }

  const imageResults = [];

  for (const image of images) {
    try {
      const result = await optimizeSingleImage(image, {
        storeId: cleanStoreId,
        productId,
      });
      imageResults.push(result);
      if (result.warning) report.warnings.push(result.warning);
    } catch (error) {
      console.warn("No se pudo optimizar una imagen de", productId, error);
      report.warnings.push(error?.message || "Error optimizando una imagen");
    }
  }

  const uploadedPaths = imageResults.flatMap((result) => result.uploadedPaths);
  const changesByKey = new Map(
    imageResults
      .filter((result) => result.changes)
      .map((result) => [result.key, result])
  );

  const productRef = doc(db, "products", productId);
  const appliedKeys = new Set();

  try {
    await runTransaction(db, async (transaction) => {
      appliedKeys.clear();

      const snapshot = await transaction.get(productRef);

      if (!snapshot.exists()) {
        throw new Error("El producto ya no existe.");
      }

      const currentImages = getProductImages({
        id: snapshot.id,
        ...snapshot.data(),
      });

      const nextImages = currentImages.map((image) => {
        const result = changesByKey.get(getImageKey(image));
        if (!result) return image;

        appliedKeys.add(result.key);
        return { ...image, ...result.changes };
      });

      const replacedPaths = imageResults
        .filter((result) => appliedKeys.has(result.key))
        .flatMap((result) => result.replacedPaths);

      /*
       * Solo se marca como optimizado si todas las fotos se procesaron y
       * nadie cambió las fotos del producto mientras tanto.
       */
      const canMarkOptimized =
        imageResults.length === images.length &&
        getImagesSignature(currentImages) === getImagesSignature(images);
      const payload = appliedKeys.size > 0 ? buildProductImagesPayload(nextImages) : {};

      transaction.update(productRef, {
        ...payload,
        ...(!canMarkOptimized
          ? {}
          : {
              imagesOptimizedVersion: IMAGE_OPTIMIZATION_VERSION,
              imagesOptimizedSignature: getImagesSignature(
                appliedKeys.size > 0 ? payload.images : currentImages
              ),
            }),
        imagesOptimizedAt: serverTimestamp(),
        ...(replacedPaths.length > 0
          ? { imagesReplacedPaths: arrayUnion(...replacedPaths) }
          : {}),
      });
    });
  } catch (error) {
    await deleteQuietly(uploadedPaths);
    throw error;
  }

  /* Archivos subidos para fotos que el admin cambió mientras tanto. */
  const orphanPaths = imageResults
    .filter((result) => !appliedKeys.has(result.key))
    .flatMap((result) => result.uploadedPaths);
  await deleteQuietly(orphanPaths);

  for (const result of imageResults) {
    const applied = appliedKeys.has(result.key);

    report.bytesBefore += result.bytesBefore;
    report.bytesAfter += applied ? result.bytesAfter : result.bytesBefore;
    report.cacheFixed += result.cacheFixed;

    if (applied) {
      if (result.recompressed) report.recompressed += 1;
      if (result.thumbnailCreated) report.thumbnails += 1;
      if (result.placeholderCreated) report.placeholders += 1;
    }
  }

  report.status =
    appliedKeys.size > 0 || report.cacheFixed > 0 ? "optimized" : "unchanged";

  return report;
}

/**
 * Procesa varios productos. Un error en un producto no detiene los demás.
 */
export async function optimizeAllProductImages(
  products,
  { storeId = STORE_ID, onProgress, shouldStop, concurrency = 2, limit } = {}
) {
  const pending = (Array.isArray(products) ? products : []).filter(
    (product) =>
      getProductImages(product).length > 0 && !isProductImagesOptimized(product)
  );

  const queue = Number.isFinite(limit) ? pending.slice(0, limit) : pending;

  const totals = {
    total: queue.length,
    done: 0,
    optimized: 0,
    unchanged: 0,
    failed: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    recompressed: 0,
    thumbnails: 0,
    placeholders: 0,
    cacheFixed: 0,
    errors: [],
  };

  await runWithConcurrency(
    queue,
    concurrency,
    async (product) => {
      let report = null;

      try {
        report = await optimizeProductImages(product, { storeId });

        if (report.status === "optimized") totals.optimized += 1;
        else totals.unchanged += 1;

        totals.bytesBefore += report.bytesBefore;
        totals.bytesAfter += report.bytesAfter;
        totals.recompressed += report.recompressed;
        totals.thumbnails += report.thumbnails;
        totals.placeholders += report.placeholders;
        totals.cacheFixed += report.cacheFixed;

        if (report.warnings.length > 0) {
          totals.errors.push({
            productId: product.id,
            name: report.name,
            message: report.warnings.join(" · "),
          });
        }
      } catch (error) {
        totals.failed += 1;
        totals.errors.push({
          productId: product.id,
          name: product?.name || product?.code || product.id,
          message: error?.message || "Error desconocido",
        });
        console.error("Error optimizando producto", product.id, error);
      }

      totals.done += 1;
      onProgress?.({ ...totals, errors: [...totals.errors], last: report });
    },
    shouldStop
  );

  return totals;
}
