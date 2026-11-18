/*
 * Índice agregado del catálogo público (Fase 3).
 *
 * Problema: el catálogo leía los ~1.500 productos completos en cada visita
 * (~1.500 lecturas y ~22 MB).
 *
 * Solución:
 * - El panel admin (que ya tiene todos los productos cargados) guarda una
 *   versión LIVIANA de los productos repartida en pocos documentos
 *   `catalogIndex/{storeId}__chunk_N`, más un documento `{storeId}__meta`.
 *   Solo reescribe los trozos que cambiaron.
 * - El catálogo lee el meta + los trozos (los que no cambiaron salen de la
 *   caché local del navegador, sin costo) y además escucha en tiempo real
 *   SOLO los productos con `updatedAt` posterior al índice. Así el stock se
 *   ve al día como antes.
 * - Si algo falla (no hay índice, versión distinta, error de red/reglas), el
 *   catálogo vuelve automáticamente a la lectura completa de siempre.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import {
  getProductImages,
  normalizeProductData,
  onProductsSnapshot,
  subscribeProducts,
} from "./products.service";

const COLLECTION = "catalogIndex";
const INDEX_VERSION = 1;

/** Tamaño objetivo por documento (Firestore permite 1 MiB). */
const MAX_CHUNK_CHARS = 650 * 1024;
const MAX_CHUNKS = 60;
/** Espera tras un cambio antes de reescribir el índice (agrupa ventas seguidas). */
const REBUILD_DELAY_MS = 45 * 1000;

/**
 * Campos que el catálogo no necesita: se recalculan al normalizar
 * (cover*, imageUrl, galleryImages), son internos (costos, auditoría,
 * etiquetas) o de la optimización de imágenes.
 */
const STRIPPED_FIELDS = new Set([
  "galleryImages",
  "coverImageUrl",
  "coverImagePath",
  "coverThumbnailUrl",
  "coverThumbnailPath",
  "coverPlaceholder",
  "imageUrl",
  "imagePath",
  "imagesReplacedPaths",
  "imagesOptimizedSignature",
  "imagesOptimizedAt",
  "imagesOptimizedVersion",
  "costPrice",
  "profitMargin",
  "profitPercent",
  "createdByUid",
  "createdByName",
  "createdByEmail",
  "updatedByUid",
  "updatedByName",
  "updatedByEmail",
]);

function isStrippedField(key) {
  return STRIPPED_FIELDS.has(key) || key.startsWith("lastLabelsPrinted");
}

function getMetaRef(storeId) {
  return doc(db, COLLECTION, `${storeId}__meta`);
}

function getChunkRef(storeId, index) {
  return doc(db, COLLECTION, `${storeId}__chunk_${index}`);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

/* Hash rápido (cyrb53) para saber si un trozo cambió. */
function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* -------------------------------------------------------------------------- */
/*                         CONSTRUCCIÓN (lado admin)                          */
/* -------------------------------------------------------------------------- */

function createSlimProduct(id, data) {
  const slim = { id };

  Object.entries(data || {}).forEach(([key, value]) => {
    if (key === "images" || isStrippedField(key) || value === undefined) return;
    slim[key] = value;
  });

  /*
   * Imágenes: solo URLs y orden. La vista previa difuminada se guarda solo
   * para la portada (es lo que se ve en la grilla).
   */
  slim.images = getProductImages({ id, ...data }).map((image, index) => {
    const record = {
      id: image.id,
      url: image.url,
      thumbnailUrl: image.thumbnailUrl,
      type: image.type,
      sortOrder: image.sortOrder,
    };

    if (!image.url && image.path) record.path = image.path;
    if (index === 0 && image.placeholder) record.placeholder = image.placeholder;

    return record;
  });

  return slim;
}

function buildChunks(docs) {
  const products = docs
    .map((docItem) => ({
      slim: createSlimProduct(docItem.id, docItem.data),
      createdAt: toMillis(docItem.data?.createdAt),
    }))
    /* Orden estable: los productos nuevos caen en el último trozo. */
    .sort((a, b) => a.createdAt - b.createdAt || a.slim.id.localeCompare(b.slim.id));

  const chunks = [];
  let current = [];
  let currentChars = 0;

  products.forEach(({ slim }) => {
    const size = JSON.stringify(slim).length;

    if (current.length > 0 && currentChars + size > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(slim);
    currentChars += size;
  });

  if (current.length > 0) chunks.push(current);

  return chunks.map((items) => ({
    products: items,
    hash: hashString(JSON.stringify(items)),
  }));
}

function getCoveredUntil(docs) {
  let max = 0;

  docs.forEach((docItem) => {
    max = Math.max(
      max,
      toMillis(docItem.data?.updatedAt),
      toMillis(docItem.data?.createdAt)
    );
  });

  return max > 0 ? Timestamp.fromMillis(max) : Timestamp.now();
}

/**
 * Escribe el índice a partir de los documentos crudos de productos.
 * Solo reescribe los trozos cuyo contenido cambió.
 */
export async function writeCatalogIndex(storeId, docs, previousMeta = null) {
  const chunks = buildChunks(docs);

  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`El índice del catálogo tendría ${chunks.length} trozos; se cancela.`);
  }

  const coveredUntil = getCoveredUntil(docs);
  const sameVersion = previousMeta?.version === INDEX_VERSION;
  const previousHashes = sameVersion && Array.isArray(previousMeta.chunkHashes)
    ? previousMeta.chunkHashes
    : [];

  let writtenChunks = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    if (previousHashes[index] === chunks[index].hash) continue;

    await setDoc(getChunkRef(storeId, index), {
      storeId,
      version: INDEX_VERSION,
      index,
      hash: chunks[index].hash,
      coveredUntil,
      products: chunks[index].products,
    });

    writtenChunks += 1;
  }

  const chunkHashes = chunks.map((chunk) => chunk.hash);
  const unchanged =
    writtenChunks === 0 &&
    previousHashes.length === chunkHashes.length &&
    toMillis(previousMeta?.coveredUntil) >= toMillis(coveredUntil);

  const meta = {
    storeId,
    version: INDEX_VERSION,
    chunkCount: chunks.length,
    chunkHashes,
    coveredUntil,
    productCount: docs.length,
  };

  if (!unchanged) {
    /* El meta va de último: quien lea antes sigue viendo un índice coherente. */
    await setDoc(getMetaRef(storeId), { ...meta, builtAt: serverTimestamp() });
  }

  /* Trozos sobrantes si el índice se achicó. */
  for (let index = chunks.length; index < previousHashes.length; index += 1) {
    try {
      await deleteDoc(getChunkRef(storeId, index));
    } catch {
      // Un trozo sobrante no se lee nunca (chunkCount manda).
    }
  }

  return { meta, writtenChunks, unchanged };
}

/* Mantenimiento automático mientras el panel admin está abierto. */
const maintenanceState = new Map();
let stopSnapshotHook = null;

async function runMaintenance(storeId) {
  const state = maintenanceState.get(storeId);
  if (!state || state.running || !state.latestSnapshot) return;

  state.running = true;
  state.timer = null;
  const snapshot = state.latestSnapshot;
  state.latestSnapshot = null;

  try {
    /*
     * Leer el meta del servidor en cada pasada (1 lectura) confirma que hay
     * conexión: sin internet no se escribe nada (evita encolar datos viejos).
     */
    const metaSnapshot = await getDocFromServer(getMetaRef(storeId));
    const previousMeta = metaSnapshot.exists() ? metaSnapshot.data() : null;

    const docs = snapshot.docs
      .map((docItem) => ({ id: docItem.id, data: docItem.data() }))
      .filter((docItem) => (docItem.data?.storeId || STORE_ID) === storeId);

    await writeCatalogIndex(storeId, docs, previousMeta);
  } catch (error) {
    console.warn("No se pudo actualizar el índice del catálogo:", error);
  } finally {
    state.running = false;

    /* Llegaron cambios mientras se escribía: programar otra pasada. */
    if (state.latestSnapshot && !state.timer && state.enabled) {
      state.timer = setTimeout(() => runMaintenance(storeId), REBUILD_DELAY_MS);
    }
  }
}

function handleProductsSnapshot(storeId, snapshot) {
  const state = maintenanceState.get(storeId);
  if (!state?.enabled) return;

  /*
   * Se ignoran snapshots con escrituras locales sin confirmar. Los que vienen
   * de la caché se aceptan: si el servidor tenía cambios, en los segundos de
   * espera llega un snapshot nuevo que reemplaza a este.
   */
  if (snapshot.metadata.hasPendingWrites) return;

  state.latestSnapshot = snapshot;

  if (!state.timer && !state.running) {
    state.timer = setTimeout(() => runMaintenance(storeId), REBUILD_DELAY_MS);
  }
}

/**
 * Activa el mantenimiento del índice para la tienda. Se llama desde el
 * layout del panel admin; usa el listener de productos que ya existe.
 */
export function startCatalogIndexMaintenance(storeId = STORE_ID) {
  if (!stopSnapshotHook) {
    stopSnapshotHook = onProductsSnapshot(handleProductsSnapshot);
  }

  const state = maintenanceState.get(storeId) || {
    enabled: false,
    running: false,
    timer: null,
    latestSnapshot: null,
  };

  state.enabled = true;
  maintenanceState.set(storeId, state);

  return () => {
    state.enabled = false;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  };
}

/* -------------------------------------------------------------------------- */
/*                          LECTURA (catálogo público)                        */
/* -------------------------------------------------------------------------- */

async function readChunk(storeId, index, expectedHash) {
  const ref = getChunkRef(storeId, index);

  /* Si el trozo en caché local coincide con el meta, no se gasta lectura. */
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists() && cached.data().hash === expectedHash) {
      return cached.data();
    }
  } catch {
    // no está en caché
  }

  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error(`Falta el trozo ${index} del índice.`);
  return snapshot.data();
}

function sortLikeRealtime(products) {
  return products.sort(
    (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
  );
}

/**
 * Misma firma que subscribeProducts(callback, onError, storeId).
 * Usa el índice + cambios recientes; si falla, cae a la lectura completa.
 */
export function subscribeCatalogProducts(callback, onError, storeId = STORE_ID) {
  let cancelled = false;
  let stopDelta = null;
  let stopFallback = null;

  function useFallback(reason) {
    if (cancelled || stopFallback) return;

    if (reason) {
      console.warn("Catálogo: se usa la lectura completa de productos.", reason);
    }

    stopDelta?.();
    stopDelta = null;
    stopFallback = subscribeProducts(callback, onError, storeId);
  }

  async function start() {
    const metaSnapshot = await getDoc(getMetaRef(storeId));

    if (!metaSnapshot.exists()) throw new Error("No hay índice del catálogo todavía.");

    const meta = metaSnapshot.data();

    if (
      meta.version !== INDEX_VERSION ||
      !Number.isInteger(meta.chunkCount) ||
      meta.chunkCount < 1 ||
      !Array.isArray(meta.chunkHashes)
    ) {
      throw new Error("Índice del catálogo con versión o formato distinto.");
    }

    const chunks = await Promise.all(
      Array.from({ length: meta.chunkCount }, (_, index) =>
        readChunk(storeId, index, meta.chunkHashes[index])
      )
    );

    /*
     * Si un trozo no coincide con el meta (dos equipos escribiendo a la vez),
     * se piden los cambios desde la fecha más antigua para no perder nada.
     */
    let deltaFrom = toMillis(meta.coveredUntil);

    chunks.forEach((chunk, index) => {
      if (chunk.version !== INDEX_VERSION) {
        throw new Error("Trozo del índice con versión distinta.");
      }
      if (chunk.hash !== meta.chunkHashes[index]) {
        deltaFrom = Math.min(deltaFrom, toMillis(chunk.coveredUntil));
      }
    });

    if (cancelled) return;

    const baseProducts = new Map();
    chunks.forEach((chunk) => {
      (chunk.products || []).forEach((product) => {
        if (product?.id) baseProducts.set(product.id, product);
      });
    });

    let recentProducts = new Map();

    function emit() {
      const merged = new Map(baseProducts);
      recentProducts.forEach((product, id) => merged.set(id, product));

      callback(
        sortLikeRealtime(
          [...merged.values()].map((product) => normalizeProductData(product))
        )
      );
    }

    emit();

    const recentQuery = query(
      collection(db, "products"),
      where("updatedAt", ">", Timestamp.fromMillis(deltaFrom))
    );

    stopDelta = onSnapshot(
      recentQuery,
      (snapshot) => {
        recentProducts = new Map();
        snapshot.docs.forEach((docItem) => {
          const data = docItem.data();
          if ((data?.storeId || STORE_ID) !== storeId) return;
          recentProducts.set(docItem.id, { id: docItem.id, ...data });
        });
        emit();
      },
      (error) => useFallback(error)
    );
  }

  start().catch((error) => useFallback(error));

  return () => {
    cancelled = true;
    stopDelta?.();
    stopFallback?.();
  };
}
