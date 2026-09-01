/**
 * Caché/precarga de imágenes de productos.
 *
 * Objetivos:
 * - No solicitar varias veces la misma URL durante la sesión.
 * - Dar prioridad a imágenes que el usuario está viendo.
 * - Precargar el resto cuando el navegador está libre.
 * - Limitar concurrencia para no saturar red ni CPU.
 * - Intentar decodificar antes de marcar una imagen como lista.
 *
 * La caché binaria real sigue siendo administrada por el navegador.
 * Esta capa mantiene el estado de "imagen caliente" durante la SPA.
 */

const MAX_CONCURRENT_PRELOADS = 4;
const DEFAULT_IMMEDIATE_COUNT = 12;
const MAX_REGISTRY_ENTRIES = 1000;
const RETRY_DELAY_MS = 30 * 1000;

const registry = new Map();
const highPriorityQueue = [];
const backgroundQueue = [];

let activeLoads = 0;
let backgroundScheduled = false;
let backgroundEnabled = false;

function normalizeUrl(value) {
  return String(value || "").trim();
}

function touch(entry) {
  if (entry) {
    entry.lastUsedAt = Date.now();
  }
}

function pruneRegistry() {
  if (registry.size <= MAX_REGISTRY_ENTRIES) {
    return;
  }

  const removable = Array.from(registry.entries())
    .filter(([, entry]) =>
      ["ready", "error"].includes(entry.status)
    )
    .sort(
      (a, b) =>
        Number(a[1].lastUsedAt || 0) -
        Number(b[1].lastUsedAt || 0)
    );

  const removeCount =
    registry.size - MAX_REGISTRY_ENTRIES;

  removable
    .slice(0, removeCount)
    .forEach(([url]) => {
      registry.delete(url);
    });
}

function scheduleBackgroundWork() {
  if (
    backgroundScheduled ||
    backgroundQueue.length === 0
  ) {
    return;
  }

  backgroundScheduled = true;

  const run = () => {
    backgroundScheduled = false;
    backgroundEnabled = true;

    processQueue();

    backgroundEnabled = false;

    if (backgroundQueue.length > 0) {
      scheduleBackgroundWork();
    }
  };

  if (
    typeof window !== "undefined" &&
    typeof window.requestIdleCallback === "function"
  ) {
    window.requestIdleCallback(run, {
      timeout: 1200,
    });

    return;
  }

  if (typeof window !== "undefined") {
    window.setTimeout(run, 80);
    return;
  }

  setTimeout(run, 80);
}

function finishEntry(entry, ready) {
  if (!entry || entry.finished) {
    return;
  }

  entry.finished = true;
  entry.status = ready ? "ready" : "error";
  entry.errorAt = ready ? 0 : Date.now();
  entry.lastUsedAt = Date.now();

  /*
   * Soltamos nuestra referencia al HTMLImageElement. El navegador conserva
   * su propia caché HTTP y caché de recursos/decodificación según memoria.
   */
  entry.image = null;

  if (typeof entry.resolve === "function") {
    entry.resolve(ready);
  }

  entry.resolve = null;

  activeLoads = Math.max(activeLoads - 1, 0);

  pruneRegistry();

  /*
   * Al terminar una carga, las visibles tienen prioridad.
   * El fondo vuelve a esperar tiempo ocioso.
   */
  processQueue();
  scheduleBackgroundWork();
}

function startLoad(entry) {
  if (
    typeof Image === "undefined" ||
    !entry?.url
  ) {
    finishEntry(entry, false);
    return;
  }

  activeLoads += 1;
  entry.status = "loading";
  entry.finished = false;
  entry.lastUsedAt = Date.now();

  const image = new Image();
  entry.image = image;

  try {
    image.decoding = "async";
  } catch {
    // Optimización opcional.
  }

  if (
    entry.priority === "high" &&
    "fetchPriority" in image
  ) {
    try {
      image.fetchPriority = "high";
    } catch {
      // Optimización opcional.
    }
  }

  image.onload = async () => {
    try {
      if (typeof image.decode === "function") {
        await image.decode();
      }
    } catch {
      /*
       * decode() puede fallar aun cuando onload fue correcto.
       * En ese caso la imagen sigue siendo utilizable.
       */
    }

    finishEntry(entry, true);
  };

  image.onerror = () => {
    finishEntry(entry, false);
  };

  image.src = entry.url;

  if (image.complete && image.naturalWidth > 0) {
    Promise.resolve().then(async () => {
      if (entry.status !== "loading") {
        return;
      }

      try {
        if (typeof image.decode === "function") {
          await image.decode();
        }
      } catch {
        // Ver comentario anterior.
      }

      if (entry.status === "loading") {
        finishEntry(entry, true);
      }
    });
  }
}

function processQueue() {
  while (activeLoads < MAX_CONCURRENT_PRELOADS) {
    let entry = highPriorityQueue.shift();

    if (!entry && backgroundEnabled) {
      entry = backgroundQueue.shift();
    }

    if (!entry) {
      break;
    }

    if (
      entry.status !== "queued" ||
      registry.get(entry.url) !== entry
    ) {
      continue;
    }

    startLoad(entry);
  }
}

function queueEntry(entry, priority) {
  entry.priority =
    priority === "high"
      ? "high"
      : "background";

  entry.status = "queued";
  entry.lastUsedAt = Date.now();

  if (entry.priority === "high") {
    highPriorityQueue.push(entry);
    processQueue();
    return;
  }

  backgroundQueue.push(entry);
  scheduleBackgroundWork();
}

/**
 * Retorna true si la URL ya fue descargada/decodificada en esta sesión.
 */
export function isProductImagePreloaded(imageUrl) {
  const url = normalizeUrl(imageUrl);

  if (!url) {
    return false;
  }

  const entry = registry.get(url);

  if (entry?.status === "ready") {
    touch(entry);
    return true;
  }

  return false;
}

/**
 * Precarga una URL. Varias llamadas para la misma URL comparten Promise.
 *
 * priority:
 * - "high": imagen visible o a punto de mostrarse.
 * - "background": calentamiento preventivo.
 */
export function preloadProductImage(
  imageUrl,
  {
    priority = "background",
  } = {}
) {
  const url = normalizeUrl(imageUrl);

  if (!url) {
    return Promise.resolve(false);
  }

  const existing = registry.get(url);

  if (existing) {
    touch(existing);

    if (existing.status === "ready") {
      return Promise.resolve(true);
    }

    if (
      ["queued", "loading"].includes(
        existing.status
      )
    ) {
      if (
        priority === "high" &&
        existing.status === "queued" &&
        existing.priority !== "high"
      ) {
        existing.priority = "high";

        const index =
          backgroundQueue.indexOf(existing);

        if (index >= 0) {
          backgroundQueue.splice(index, 1);
        }

        highPriorityQueue.push(existing);
        processQueue();
      }

      return existing.promise;
    }

    if (
      existing.status === "error" &&
      Date.now() -
        Number(existing.errorAt || 0) <
        RETRY_DELAY_MS
    ) {
      return Promise.resolve(false);
    }

    registry.delete(url);
  }

  let resolvePromise;

  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const entry = {
    url,
    priority:
      priority === "high"
        ? "high"
        : "background",
    status: "queued",
    promise,
    resolve: resolvePromise,
    image: null,
    finished: false,
    errorAt: 0,
    lastUsedAt: Date.now(),
  };

  registry.set(url, entry);
  queueEntry(entry, entry.priority);

  return promise;
}

/**
 * Calienta portadas de productos.
 *
 * getCoverUrl(product) debe retornar una URL o string vacío.
 * Las primeras portadas tienen prioridad alta y las demás se precargan
 * durante periodos ociosos del navegador.
 */
export function preloadProductCoverImages(
  products,
  getCoverUrl,
  {
    immediateCount = DEFAULT_IMMEDIATE_COUNT,
  } = {}
) {
  if (typeof getCoverUrl !== "function") {
    return 0;
  }

  const urls = [
    ...new Set(
      (Array.isArray(products) ? products : [])
        .map((product) =>
          normalizeUrl(getCoverUrl(product))
        )
        .filter(Boolean)
    ),
  ];

  urls.forEach((url, index) => {
    preloadProductImage(url, {
      priority:
        index < immediateCount
          ? "high"
          : "background",
    });
  });

  return urls.length;
}

/**
 * Limpieza opcional para logout/cambio de tienda.
 * No borra la caché HTTP del navegador.
 */
export function clearProductImagePreloadCache() {
  highPriorityQueue.length = 0;
  backgroundQueue.length = 0;

  registry.forEach((entry) => {
    if (entry?.image) {
      entry.image.onload = null;
      entry.image.onerror = null;
    }
  });

  registry.clear();
}
