import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { db, storage } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import { ensureVariantBarcodes } from "./barcode.service";

/**
 * Cantidad máxima recomendada de imágenes por producto.
 * Incluye la imagen de portada.
 */
export const MAX_PRODUCT_IMAGES = 8;

/**
 * Cantidad máxima permitida por archivo.
 * Actualmente: 25 MB.
 */
export const MAX_PRODUCT_IMAGE_SIZE = 25 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
];

/* -------------------------------------------------------------------------- */
/*                              UTILIDADES GENERALES                           */
/* -------------------------------------------------------------------------- */

function safeFileName(fileName) {
  const normalizedName = String(fileName || "producto")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.\-_]/g, "");

  return normalizedName || "producto";
}

function createImageId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatAutomaticProductCode(number) {
  return String(number).padStart(4, "0");
}

export function normalizeProductCode(value) {
  const cleanValue = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[\/\\#?[\]]/g, "-");

  if (!cleanValue) return "";

  if (/^\d+$/.test(cleanValue)) {
    return cleanValue.padStart(4, "0");
  }

  return cleanValue;
}

export function normalizeProductSize(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    return "Talla única";
  }

  const normalizedValue = cleanValue.toUpperCase();

  const aliases = {
    "TALLA UNICA": "Talla única",
    "TALLA ÚNICA": "Talla única",
    UNICA: "Talla única",
    ÚNICA: "Talla única",
    UNIQUE: "Talla única",
  };

  return aliases[normalizedValue] || normalizedValue;
}

function normalizeStock(value) {
  const stock = Number(value || 0);

  if (!Number.isFinite(stock)) {
    return 0;
  }

  return Math.max(Math.trunc(stock), 0);
}

function normalizePrintedLabels(value, stock) {
  return Math.min(
    normalizeStock(value),
    normalizeStock(stock)
  );
}

function normalizeLabelPrintDate(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toISOString();
}

function getVariantOperationalKey(variant) {
  const id = String(variant?.id || "").trim();

  if (id) {
    return `id:${id}`;
  }

  return `size:${normalizeProductSize(
    variant?.size || variant?.name || variant?.label
  )}`;
}

function mergeVariantOperationalState(
  incomingVariants,
  previousVariants
) {
  const source = Array.isArray(incomingVariants)
    ? incomingVariants
    : [];

  const previous = Array.isArray(previousVariants)
    ? previousVariants
    : [];

  const previousByKey = new Map(
    previous.map((variant) => [
      getVariantOperationalKey(variant),
      variant,
    ])
  );

  const previousBySize = new Map(
    previous.map((variant) => [
      normalizeProductSize(variant?.size),
      variant,
    ])
  );

  return source.map((variant) => {
    const previousVariant =
      previousByKey.get(getVariantOperationalKey(variant)) ||
      previousBySize.get(normalizeProductSize(variant?.size)) ||
      null;

    if (!previousVariant) {
      return variant;
    }

    return {
      ...previousVariant,
      ...variant,
      barcode:
        String(variant?.barcode || "").trim() ||
        String(previousVariant?.barcode || "").trim(),
      printedLabels:
        variant?.printedLabels !== undefined
          ? variant.printedLabels
          : previousVariant?.printedLabels,
      labelPrintTotal:
        variant?.labelPrintTotal !== undefined
          ? variant.labelPrintTotal
          : previousVariant?.labelPrintTotal,
      labelReprintTotal:
        variant?.labelReprintTotal !== undefined
          ? variant.labelReprintTotal
          : previousVariant?.labelReprintTotal,
      lastLabelPrintedAt:
        variant?.lastLabelPrintedAt ||
        previousVariant?.lastLabelPrintedAt ||
        "",
      lastLabelPrintedByUid:
        variant?.lastLabelPrintedByUid ||
        previousVariant?.lastLabelPrintedByUid ||
        "",
      lastLabelPrintedByName:
        variant?.lastLabelPrintedByName ||
        previousVariant?.lastLabelPrintedByName ||
        "",
      lastLabelPrintedByEmail:
        variant?.lastLabelPrintedByEmail ||
        previousVariant?.lastLabelPrintedByEmail ||
        "",
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                                 VARIANTES                                   */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza variantes como:
 *
 * [
 *   {
 *     id: "variant-id",
 *     size: "S",
 *     stock: 5
 *   }
 * ]
 *
 * Si recibe un producto antiguo con size/stock, lo convierte automáticamente.
 */
export function normalizeProductVariants(
  variants,
  legacySize = "",
  legacyStock = 0,
  barcodeContext = {}
) {
  const sourceVariants =
    Array.isArray(variants) && variants.length > 0
      ? variants
      : [
          {
            size: legacySize || "Talla única",
            stock: legacyStock,
            barcode: "",
            printedLabels: 0,
          },
        ];

  const groupedVariants = new Map();

  sourceVariants.forEach((variant, index) => {
    const size = normalizeProductSize(
      variant?.size || variant?.name || variant?.label
    );

    const stock = normalizeStock(variant?.stock);
    const barcode = String(variant?.barcode || "").trim();
    const printedLabels = normalizePrintedLabels(
      variant?.printedLabels ?? variant?.labelsPrinted,
      stock
    );

    const normalizedVariant = {
      id:
        String(variant?.id || "").trim() ||
        `variant-${index}-${size
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-_]/g, "")}`,
      size,
      stock,
      barcode,
      printedLabels,
      labelPrintTotal: normalizeStock(variant?.labelPrintTotal),
      labelReprintTotal: normalizeStock(variant?.labelReprintTotal),
      lastLabelPrintedAt: normalizeLabelPrintDate(
        variant?.lastLabelPrintedAt
      ),
      lastLabelPrintedByUid: String(
        variant?.lastLabelPrintedByUid || ""
      ).trim(),
      lastLabelPrintedByName: String(
        variant?.lastLabelPrintedByName || ""
      ).trim(),
      lastLabelPrintedByEmail: String(
        variant?.lastLabelPrintedByEmail || ""
      ).trim(),
    };

    const existingVariant = groupedVariants.get(size);

    if (existingVariant) {
      const combinedStock =
        existingVariant.stock + normalizedVariant.stock;

      groupedVariants.set(size, {
        ...existingVariant,
        stock: combinedStock,
        barcode:
          existingVariant.barcode || normalizedVariant.barcode,
        printedLabels: Math.min(
          existingVariant.printedLabels +
            normalizedVariant.printedLabels,
          combinedStock
        ),
        labelPrintTotal:
          existingVariant.labelPrintTotal +
          normalizedVariant.labelPrintTotal,
        labelReprintTotal:
          existingVariant.labelReprintTotal +
          normalizedVariant.labelReprintTotal,
        lastLabelPrintedAt:
          normalizedVariant.lastLabelPrintedAt ||
          existingVariant.lastLabelPrintedAt,
        lastLabelPrintedByUid:
          normalizedVariant.lastLabelPrintedByUid ||
          existingVariant.lastLabelPrintedByUid,
        lastLabelPrintedByName:
          normalizedVariant.lastLabelPrintedByName ||
          existingVariant.lastLabelPrintedByName,
        lastLabelPrintedByEmail:
          normalizedVariant.lastLabelPrintedByEmail ||
          existingVariant.lastLabelPrintedByEmail,
      });

      return;
    }

    groupedVariants.set(size, normalizedVariant);
  });

  return ensureVariantBarcodes(
    Array.from(groupedVariants.values()),
    barcodeContext
  );
}

export function calculateProductTotalStock(variants) {
  return normalizeProductVariants(variants).reduce(
    (total, variant) => total + normalizeStock(variant.stock),
    0
  );
}

export function getProductAvailableSizes(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  )
    .filter((variant) => Number(variant.stock || 0) > 0)
    .map((variant) => variant.size);
}

export function getVariantBySize(product, size) {
  const normalizedSize = normalizeProductSize(size);

  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  ).find((variant) => variant.size === normalizedSize);
}

export function getVariantLabelPrintState(variant) {
  const stock = normalizeStock(variant?.stock);
  const printed = normalizePrintedLabels(
    variant?.printedLabels ?? variant?.labelsPrinted,
    stock
  );

  return {
    stock,
    printed,
    pending: Math.max(stock - printed, 0),
    fullyPrinted: stock > 0 && printed >= stock,
    partiallyPrinted: printed > 0 && printed < stock,
    lastPrintedAt: normalizeLabelPrintDate(
      variant?.lastLabelPrintedAt
    ),
    lastPrintedByName: String(
      variant?.lastLabelPrintedByName || ""
    ).trim(),
  };
}

export function getProductLabelPrintSummary(product) {
  const variants = normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock,
    {
      productId: product?.id,
      productCode: product?.code,
      storeId: product?.storeId || STORE_ID,
    }
  );

  const summary = variants.reduce(
    (result, variant) => {
      const state = getVariantLabelPrintState(variant);

      result.stock += state.stock;
      result.printed += state.printed;
      result.pending += state.pending;

      if (
        state.lastPrintedAt &&
        (!result.lastPrintedAt ||
          state.lastPrintedAt > result.lastPrintedAt)
      ) {
        result.lastPrintedAt = state.lastPrintedAt;
        result.lastPrintedByName =
          state.lastPrintedByName || "";
      }

      return result;
    },
    {
      stock: 0,
      printed: 0,
      pending: 0,
      lastPrintedAt: "",
      lastPrintedByName: "",
    }
  );

  return {
    ...summary,
    fullyPrinted:
      summary.stock > 0 && summary.pending === 0,
    partiallyPrinted:
      summary.printed > 0 && summary.pending > 0,
    neverPrinted: summary.printed === 0,
  };
}

function buildVariantsPayload(
  productData = {},
  barcodeContext = {},
  previousVariants = []
) {
  const variantsWithOperationalState =
    mergeVariantOperationalState(
      productData.variants,
      previousVariants
    );

  const variants = normalizeProductVariants(
    variantsWithOperationalState,
    productData.size,
    productData.stock,
    barcodeContext
  );

  const totalStock = variants.reduce(
    (total, variant) => total + normalizeStock(variant.stock),
    0
  );

  const sizes = variants.map((variant) => variant.size);

  let legacySize = "Talla única";

  if (sizes.length === 1) {
    legacySize = sizes[0];
  } else if (sizes.length > 1) {
    legacySize = "Varias tallas";
  }

  return {
    variants,
    sizes,
    size: legacySize,
    stock: totalStock,
    totalStock,
    hasVariants: variants.length > 1,
  };
}

/* -------------------------------------------------------------------------- */
/*                               CÓDIGOS ÚNICOS                                */
/* -------------------------------------------------------------------------- */

function getProductCodeIndexId(storeId, code) {
  return `${storeId}_${encodeURIComponent(code)}`;
}

function getProductCodeIndexRef(storeId, code) {
  return doc(db, "productCodeIndex", getProductCodeIndexId(storeId, code));
}

function getProductCounterRef(storeId) {
  return doc(db, "counters", `productCodes_${storeId}`);
}

export async function getNextProductCodePreview(storeId = STORE_ID) {
  const counterRef = getProductCounterRef(storeId);
  const counterSnap = await getDoc(counterRef);

  const lastNumber = Number(counterSnap.data()?.lastNumber || 0);

  let nextNumber = lastNumber + 1;
  let attempts = 0;

  while (attempts < 10000) {
    attempts += 1;

    const candidateCode = formatAutomaticProductCode(nextNumber);
    const candidateIndexRef = getProductCodeIndexRef(storeId, candidateCode);
    const candidateIndexSnap = await getDoc(candidateIndexRef);

    if (!candidateIndexSnap.exists()) {
      return candidateCode;
    }

    nextNumber += 1;
  }

  throw new Error("No se pudo obtener el siguiente código disponible.");
}

async function getNextAvailableProductCode(transaction, storeId) {
  const counterRef = getProductCounterRef(storeId);
  const counterSnap = await transaction.get(counterRef);

  const lastNumber = Number(counterSnap.data()?.lastNumber || 0);

  let nextNumber = lastNumber + 1;
  let selectedCode = "";
  let attempts = 0;

  while (!selectedCode) {
    attempts += 1;

    if (attempts > 10000) {
      throw new Error("No se pudo generar un código consecutivo disponible.");
    }

    const candidateCode = formatAutomaticProductCode(nextNumber);
    const candidateIndexRef = getProductCodeIndexRef(storeId, candidateCode);
    const candidateIndexSnap = await transaction.get(candidateIndexRef);

    if (!candidateIndexSnap.exists()) {
      selectedCode = candidateCode;
      break;
    }

    nextNumber += 1;
  }

  return {
    code: selectedCode,
    number: nextNumber,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  IMÁGENES                                   */
/* -------------------------------------------------------------------------- */

export function validateProductImage(file) {
  if (!file) {
    throw new Error("No se recibió una imagen válida.");
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(
      `La imagen "${file.name}" no tiene un formato permitido. Usa JPG, PNG, WEBP o AVIF.`
    );
  }

  if (Number(file.size || 0) > MAX_PRODUCT_IMAGE_SIZE) {
    throw new Error(
      `La imagen "${file.name}" supera el tamaño máximo de 25 MB.`
    );
  }

  return true;
}

function normalizeImageRecord(image, index = 0) {
  if (!image) return null;

  const url = String(image.url || image.imageUrl || "").trim();
  const path = String(image.path || image.imagePath || "").trim();

  if (!url && !path) {
    return null;
  }

  return {
    id: String(image.id || "").trim() || createImageId(),
    url,
    path,
    name: String(image.name || "").trim(),
    type: image.type === "cover" ? "cover" : "gallery",
    sortOrder: Number.isFinite(Number(image.sortOrder))
      ? Number(image.sortOrder)
      : index,
  };
}

/**
 * Convierte productos antiguos que solo tenían imageUrl/imagePath
 * al nuevo arreglo images.
 */
export function getProductImages(product) {
  const modernImages = Array.isArray(product?.images)
    ? product.images
        .map((image, index) => normalizeImageRecord(image, index))
        .filter(Boolean)
    : [];

  if (modernImages.length > 0) {
    const sortedImages = [...modernImages].sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );

    const coverIndex = sortedImages.findIndex(
      (image) => image.type === "cover"
    );

    if (coverIndex === -1) {
      sortedImages[0] = {
        ...sortedImages[0],
        type: "cover",
      };
    } else if (coverIndex > 0) {
      const [coverImage] = sortedImages.splice(coverIndex, 1);
      sortedImages.unshift(coverImage);
    }

    return sortedImages.map((image, index) => ({
      ...image,
      type: index === 0 ? "cover" : "gallery",
      sortOrder: index,
    }));
  }

  const legacyUrl = String(
    product?.coverImageUrl || product?.imageUrl || ""
  ).trim();

  const legacyPath = String(
    product?.coverImagePath || product?.imagePath || ""
  ).trim();

  if (!legacyUrl && !legacyPath) {
    return [];
  }

  return [
    {
      id: createImageId(),
      url: legacyUrl,
      path: legacyPath,
      name: "",
      type: "cover",
      sortOrder: 0,
    },
  ];
}

export function getProductCoverImage(product) {
  const images = getProductImages(product);

  return (
    images.find((image) => image.type === "cover") ||
    images[0] || {
      id: "",
      url: "",
      path: "",
      name: "",
      type: "cover",
      sortOrder: 0,
    }
  );
}

function normalizeMediaInput(mediaInput) {
  if (!mediaInput) {
    return {
      coverFile: null,
      galleryFiles: [],
      retainedImages: null,
      removedImagePaths: [],
    };
  }

  /**
   * Compatibilidad con la firma antigua:
   * createProduct(productData, imageFile, ...)
   */
  if (
    typeof File !== "undefined" &&
    mediaInput instanceof File
  ) {
    return {
      coverFile: mediaInput,
      galleryFiles: [],
      retainedImages: null,
      removedImagePaths: [],
    };
  }

  /**
   * También permite pasar directamente un arreglo de imágenes.
   * La primera se toma como portada.
   */
  if (Array.isArray(mediaInput)) {
    return {
      coverFile: mediaInput[0] || null,
      galleryFiles: mediaInput.slice(1),
      retainedImages: null,
      removedImagePaths: [],
    };
  }

  return {
    coverFile: mediaInput.coverFile || mediaInput.imageFile || null,

    galleryFiles: Array.isArray(mediaInput.galleryFiles)
      ? mediaInput.galleryFiles
      : Array.isArray(mediaInput.additionalFiles)
        ? mediaInput.additionalFiles
        : [],

    retainedImages: Array.isArray(mediaInput.retainedImages)
      ? mediaInput.retainedImages
          .map((image, index) => normalizeImageRecord(image, index))
          .filter(Boolean)
      : null,

    removedImagePaths: Array.isArray(mediaInput.removedImagePaths)
      ? mediaInput.removedImagePaths.filter(Boolean)
      : [],
  };
}

async function uploadSingleProductImage(
  imageFile,
  storeId,
  productId,
  imageType,
  sortOrder
) {
  validateProductImage(imageFile);

  const imageId = createImageId();
  const fileName = `${Date.now()}-${imageId}-${safeFileName(imageFile.name)}`;

  const imagePath = `products/${storeId}/${productId}/${fileName}`;
  const imageRef = ref(storage, imagePath);

  await uploadBytes(imageRef, imageFile, {
    contentType: imageFile.type,
    customMetadata: {
      storeId,
      productId,
      imageType,
    },
  });

  const imageUrl = await getDownloadURL(imageRef);

  return {
    id: imageId,
    url: imageUrl,
    path: imagePath,
    name: imageFile.name || fileName,
    type: imageType,
    sortOrder,
  };
}

async function uploadProductImages({
  coverFile,
  galleryFiles,
  storeId,
  productId,
  initialSortOrder = 0,
}) {
  const files = [
    ...(coverFile
      ? [
          {
            file: coverFile,
            type: "cover",
          },
        ]
      : []),

    ...galleryFiles.map((file) => ({
      file,
      type: "gallery",
    })),
  ];

  if (files.length === 0) {
    return [];
  }

  if (files.length > MAX_PRODUCT_IMAGES) {
    throw new Error(
      `Puedes subir máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`
    );
  }

  const uploadedImages = [];

  try {
    for (let index = 0; index < files.length; index += 1) {
      const imageItem = files[index];

      const uploadedImage = await uploadSingleProductImage(
        imageItem.file,
        storeId,
        productId,
        imageItem.type,
        initialSortOrder + index
      );

      uploadedImages.push(uploadedImage);
    }

    return uploadedImages;
  } catch (error) {
    await deleteProductImages(
      uploadedImages.map((image) => image.path),
      false
    );

    throw error;
  }
}

async function deleteProductImage(imagePath, showWarning = true) {
  if (!imagePath) return;

  try {
    const imageRef = ref(storage, imagePath);
    await deleteObject(imageRef);
  } catch (error) {
    if (error?.code === "storage/object-not-found") {
      return;
    }

    if (showWarning) {
      console.warn("No se pudo eliminar la imagen:", imagePath, error);
    }
  }
}

async function deleteProductImages(imagePaths, showWarning = true) {
  const uniquePaths = [...new Set((imagePaths || []).filter(Boolean))];

  await Promise.all(
    uniquePaths.map((imagePath) =>
      deleteProductImage(imagePath, showWarning)
    )
  );
}

function buildImagesPayload(images) {
  const cleanImages = (images || [])
    .map((image, index) => normalizeImageRecord(image, index))
    .filter(Boolean);

  if (cleanImages.length === 0) {
    return {
      images: [],
      galleryImages: [],
      coverImageUrl: "",
      coverImagePath: "",

      /**
       * Campos antiguos conservados para que Inventario,
       * Ventas y Catálogo sigan funcionando durante la migración.
       */
      imageUrl: "",
      imagePath: "",
    };
  }

  let orderedImages = [...cleanImages].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
  );

  const currentCoverIndex = orderedImages.findIndex(
    (image) => image.type === "cover"
  );

  if (currentCoverIndex > 0) {
    const [coverImage] = orderedImages.splice(currentCoverIndex, 1);
    orderedImages.unshift(coverImage);
  }

  orderedImages = orderedImages.map((image, index) => ({
    ...image,
    type: index === 0 ? "cover" : "gallery",
    sortOrder: index,
  }));

  const coverImage = orderedImages[0];
  const galleryImages = orderedImages.slice(1);

  return {
    images: orderedImages,
    galleryImages,
    coverImageUrl: coverImage?.url || "",
    coverImagePath: coverImage?.path || "",

    /**
     * Compatibilidad con el código anterior.
     */
    imageUrl: coverImage?.url || "",
    imagePath: coverImage?.path || "",
  };
}

/* -------------------------------------------------------------------------- */
/*                            NORMALIZACIÓN DE PRODUCTOS                        */
/* -------------------------------------------------------------------------- */

function normalizeProductDocument(product) {
  const variantsPayload = buildVariantsPayload(product, {
    productId: product?.id,
    productCode: product?.code,
    storeId: product?.storeId || STORE_ID,
  });
  const imagesPayload = buildImagesPayload(getProductImages(product));

  return {
    ...product,

    ...variantsPayload,
    ...imagesPayload,
  };
}

function mapProductsSnapshot(snapshot) {
  return snapshot.docs
    .map((docItem) =>
      normalizeProductDocument({
        id: docItem.id,
        ...docItem.data(),
      })
    )
    .sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;

      return dateB - dateA;
    });
}

/* -------------------------------------------------------------------------- */
/*                          CONSULTAS Y SUSCRIPCIONES                           */
/* -------------------------------------------------------------------------- */

/**
 * Registro compartido de productos por tienda.
 *
 * Objetivos:
 * - Mantener un único onSnapshot real por storeId durante la sesión.
 * - Evitar abrir listeners duplicados desde Inventario, Ventas, Apartados, etc.
 * - Conservar el último snapshot normalizado en memoria para entregarlo
 *   inmediatamente a nuevos consumidores.
 *
 * La caché persistente de Firestore (IndexedDB) sigue siendo responsabilidad
 * de firebase.js. Esta capa únicamente evita duplicar listeners dentro de la
 * misma ejecución de la aplicación.
 */
const productsRealtimeRegistry = new Map();

function normalizeStoreId(storeId = STORE_ID) {
  const cleanStoreId = String(storeId || STORE_ID).trim();

  return cleanStoreId || STORE_ID;
}

function createProductsRealtimeEntry(storeId) {
  return {
    storeId,
    subscribers: new Set(),
    products: [],
    hasSnapshot: false,
    unsubscribeFirestore: null,
    lastError: null,
  };
}

function getProductsRealtimeEntry(storeId = STORE_ID) {
  const cleanStoreId = normalizeStoreId(storeId);

  if (!productsRealtimeRegistry.has(cleanStoreId)) {
    productsRealtimeRegistry.set(
      cleanStoreId,
      createProductsRealtimeEntry(cleanStoreId)
    );
  }

  return productsRealtimeRegistry.get(cleanStoreId);
}

function notifyProductsSubscribers(entry) {
  const products = entry.products;

  entry.subscribers.forEach((subscriber) => {
    try {
      subscriber.callback(products);
    } catch (error) {
      /*
       * Un error dentro de un consumidor no debe romper el listener global
       * ni impedir que los demás módulos reciban actualizaciones.
       */
      console.error(
        "Error entregando productos a un suscriptor:",
        error
      );
    }
  });
}

function notifyProductsSubscribersError(entry, error) {
  entry.subscribers.forEach((subscriber) => {
    if (typeof subscriber.onError !== "function") {
      return;
    }

    try {
      subscriber.onError(error);
    } catch (subscriberError) {
      console.error(
        "Error ejecutando el manejador de error de productos:",
        subscriberError
      );
    }
  });
}

function ensureProductsRealtimeListener(entry) {
  if (entry.unsubscribeFirestore) {
    return;
  }

  const productsRef = collection(db, "products");

  const productsQuery = query(
    productsRef,
    where("storeId", "==", entry.storeId)
  );

  entry.unsubscribeFirestore = onSnapshot(
    productsQuery,
    (snapshot) => {
      entry.products = mapProductsSnapshot(snapshot);
      entry.hasSnapshot = true;
      entry.lastError = null;

      notifyProductsSubscribers(entry);
    },
    (error) => {
      console.error(
        `Error escuchando productos de la tienda "${entry.storeId}":`,
        error
      );

      entry.lastError = error;

      /*
       * Firestore no continuará enviando eventos después de un error fatal
       * del listener. Dejamos la referencia limpia para permitir que una
       * futura suscripción vuelva a inicializarlo.
       */
      entry.unsubscribeFirestore = null;

      notifyProductsSubscribersError(entry, error);
    }
  );
}

/**
 * Suscripción pública compatible con la implementación anterior.
 *
 * Cada llamada registra un consumidor, pero todas las llamadas del mismo
 * storeId comparten un único listener de Firestore.
 *
 * El listener real permanece activo durante la sesión de la SPA para evitar
 * ciclos repetidos de conectar/desconectar al navegar entre módulos. El
 * navegador cierra la conexión al descargar la página.
 */
export function subscribeProducts(
  callback,
  onError,
  storeId = STORE_ID
) {
  if (typeof callback !== "function") {
    throw new TypeError(
      "subscribeProducts necesita una función callback."
    );
  }

  const entry = getProductsRealtimeEntry(storeId);

  const subscriber = {
    callback,
    onError:
      typeof onError === "function"
        ? onError
        : null,
  };

  entry.subscribers.add(subscriber);

  /*
   * Si ya existe información en memoria, el nuevo módulo la recibe de forma
   * inmediata sin esperar otro snapshot ni otra consulta a Firestore.
   */
  if (entry.hasSnapshot) {
    try {
      callback(entry.products);
    } catch (error) {
      console.error(
        "Error entregando productos almacenados en memoria:",
        error
      );
    }
  }

  ensureProductsRealtimeListener(entry);

  /*
   * Mantiene la misma API de onSnapshot: el consumidor recibe una función
   * unsubscribe. Solo retiramos ese consumidor; no destruimos el listener
   * compartido de la sesión.
   */
  let active = true;

  return () => {
    if (!active) {
      return;
    }

    active = false;
    entry.subscribers.delete(subscriber);
  };
}

/**
 * Lectura puntual conservada para compatibilidad.
 *
 * No se sustituye automáticamente por la caché en memoria porque algunos
 * flujos pueden depender explícitamente de ejecutar una consulta puntual.
 * La persistencia configurada en firebase.js sigue permitiendo a Firestore
 * aprovechar su caché local cuando corresponda.
 */
export async function getProducts(storeId = STORE_ID) {
  const cleanStoreId = normalizeStoreId(storeId);
  const productsRef = collection(db, "products");

  const productsQuery = query(
    productsRef,
    where("storeId", "==", cleanStoreId)
  );

  const snapshot = await getDocs(productsQuery);

  return mapProductsSnapshot(snapshot);
}

/**
 * Limpieza opcional de listeners/caché en memoria.
 *
 * No es necesaria durante la navegación normal. Puede utilizarse al cerrar
 * sesión o al cambiar de tienda si en el futuro la aplicación lo requiere.
 */
export function clearProductsRealtimeCache(storeId) {
  if (storeId !== undefined && storeId !== null) {
    const cleanStoreId = normalizeStoreId(storeId);
    const entry = productsRealtimeRegistry.get(cleanStoreId);

    if (!entry) {
      return;
    }

    if (typeof entry.unsubscribeFirestore === "function") {
      entry.unsubscribeFirestore();
    }

    entry.subscribers.clear();
    productsRealtimeRegistry.delete(cleanStoreId);
    return;
  }

  productsRealtimeRegistry.forEach((entry) => {
    if (typeof entry.unsubscribeFirestore === "function") {
      entry.unsubscribeFirestore();
    }

    entry.subscribers.clear();
  });

  productsRealtimeRegistry.clear();
}

/* -------------------------------------------------------------------------- */
/*                              CREAR PRODUCTO                                 */
/* -------------------------------------------------------------------------- */

/**
 * Nueva firma recomendada:
 *
 * createProduct(
 *   productData,
 *   {
 *     coverFile,
 *     galleryFiles
 *   },
 *   storeId,
 *   actor
 * )
 *
 * También continúa soportando la firma anterior:
 *
 * createProduct(productData, imageFile, storeId, actor)
 */
export async function createProduct(
  productData,
  mediaInput,
  storeId = STORE_ID,
  actor = null
) {
  const productsRef = collection(db, "products");
  const productRef = doc(productsRef);

  const normalizedMedia = normalizeMediaInput(mediaInput);

  const totalNewImages =
    Number(Boolean(normalizedMedia.coverFile)) +
    normalizedMedia.galleryFiles.length;

  if (totalNewImages > MAX_PRODUCT_IMAGES) {
    throw new Error(
      `Puedes subir máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`
    );
  }

  const uploadedImages = await uploadProductImages({
    coverFile: normalizedMedia.coverFile,
    galleryFiles: normalizedMedia.galleryFiles,
    storeId,
    productId: productRef.id,
  });

  const imagesPayload = buildImagesPayload(uploadedImages);

  try {
    await runTransaction(db, async (transaction) => {
      let finalCode = normalizeProductCode(productData?.code);

      if (finalCode) {
        const codeIndexRef = getProductCodeIndexRef(storeId, finalCode);
        const codeIndexSnap = await transaction.get(codeIndexRef);

        if (codeIndexSnap.exists()) {
          throw new Error(
            `El código ${finalCode} ya está usado por otro producto.`
          );
        }

        transaction.set(codeIndexRef, {
          storeId,
          code: finalCode,
          productId: productRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const nextCode = await getNextAvailableProductCode(
          transaction,
          storeId
        );

        finalCode = nextCode.code;

        const counterRef = getProductCounterRef(storeId);
        const codeIndexRef = getProductCodeIndexRef(storeId, finalCode);

        transaction.set(
          counterRef,
          {
            storeId,
            lastNumber: nextCode.number,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        transaction.set(codeIndexRef, {
          storeId,
          code: finalCode,
          productId: productRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const variantsPayload = buildVariantsPayload(productData, {
        productId: productRef.id,
        productCode: finalCode,
        storeId,
      });

      transaction.set(productRef, {
        ...productData,

        storeId,
        code: finalCode,

        ...variantsPayload,
        ...imagesPayload,

        status:
          variantsPayload.totalStock > 0
            ? "available"
            : "out_of_stock",

        createdByUid: actor?.uid || "",
        createdByName: actor?.name || "",
        createdByEmail: actor?.email || "",

        updatedByUid: actor?.uid || "",
        updatedByName: actor?.name || "",
        updatedByEmail: actor?.email || "",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    return productRef.id;
  } catch (error) {
    await deleteProductImages(
      uploadedImages.map((image) => image.path),
      false
    );

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*                            ACTUALIZAR PRODUCTO                              */
/* -------------------------------------------------------------------------- */

/**
 * Nueva firma recomendada:
 *
 * updateProduct(
 *   productId,
 *   productData,
 *   {
 *     coverFile,
 *     galleryFiles,
 *     retainedImages,
 *     removedImagePaths
 *   },
 *   currentProduct,
 *   actor
 * )
 *
 * Sigue admitiendo la firma antigua:
 *
 * updateProduct(
 *   productId,
 *   productData,
 *   imageFile,
 *   oldImagePath,
 *   actor
 * )
 */
export async function updateProduct(
  productId,
  productData,
  mediaInput,
  oldMedia,
  actor = null
) {
  if (!productId) {
    throw new Error("No se encontró el producto.");
  }

  const storeId = productData?.storeId || STORE_ID;
  const normalizedMedia = normalizeMediaInput(mediaInput);

  const productRef = doc(db, "products", productId);
  const productSnapshot = await getDoc(productRef);

  if (!productSnapshot.exists()) {
    throw new Error("El producto no existe.");
  }

  const currentProduct = {
    id: productSnapshot.id,
    ...productSnapshot.data(),
  };

  const currentImages = getProductImages(currentProduct);

  /**
   * Si se usa el formato nuevo, retainedImages indica qué imágenes
   * permanecen después de editar.
   *
   * Si no se envía retainedImages, se conservan todas las actuales.
   */
  let retainedImages = normalizedMedia.retainedImages
    ? normalizedMedia.retainedImages
    : currentImages;

  const pathsToDelete = new Set(normalizedMedia.removedImagePaths);

  /**
   * Compatibilidad con la firma antigua:
   * oldMedia era oldImagePath.
   */
  if (typeof oldMedia === "string" && oldMedia) {
    if (normalizedMedia.coverFile) {
      pathsToDelete.add(oldMedia);

      retainedImages = retainedImages.filter(
        (image) => image.path !== oldMedia
      );
    }
  }

  /**
   * Si llega una portada nueva, se reemplaza la portada anterior.
   */
  if (normalizedMedia.coverFile) {
    const previousCover = retainedImages.find(
      (image) => image.type === "cover"
    );

    if (previousCover?.path) {
      pathsToDelete.add(previousCover.path);
    }

    retainedImages = retainedImages.filter(
      (image) => image.id !== previousCover?.id
    );
  }

  retainedImages = retainedImages.filter(
    (image) => !pathsToDelete.has(image.path)
  );

  const newImagesCount =
    Number(Boolean(normalizedMedia.coverFile)) +
    normalizedMedia.galleryFiles.length;

  if (retainedImages.length + newImagesCount > MAX_PRODUCT_IMAGES) {
    throw new Error(
      `Puedes conservar y subir máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`
    );
  }

  const uploadedImages = await uploadProductImages({
    coverFile: normalizedMedia.coverFile,
    galleryFiles: normalizedMedia.galleryFiles,
    storeId,
    productId,
    initialSortOrder: retainedImages.length,
  });

  let finalImages = [];

  if (normalizedMedia.coverFile) {
    const uploadedCover = uploadedImages.find(
      (image) => image.type === "cover"
    );

    const uploadedGallery = uploadedImages.filter(
      (image) => image.type !== "cover"
    );

    finalImages = [
      ...(uploadedCover ? [uploadedCover] : []),
      ...retainedImages.map((image) => ({
        ...image,
        type: "gallery",
      })),
      ...uploadedGallery,
    ];
  } else {
    finalImages = [...retainedImages, ...uploadedImages];
  }

  const imagesPayload = buildImagesPayload(finalImages);

  try {
    await runTransaction(db, async (transaction) => {
      const transactionProductSnap = await transaction.get(productRef);

      if (!transactionProductSnap.exists()) {
        throw new Error("El producto no existe.");
      }

      const transactionProduct = transactionProductSnap.data();

      const oldCode = normalizeProductCode(transactionProduct.code);
      let newCode = normalizeProductCode(productData?.code);

      /*
       * En edición no generamos un código nuevo si el campo llega vacío.
       * Esto evita que al actualizar imágenes, precios o tallas se cambie
       * accidentalmente el código del producto.
       */
      if (!newCode) {
        newCode = oldCode;
      }

      if (newCode && newCode !== oldCode) {
        const newCodeIndexRef = getProductCodeIndexRef(
          storeId,
          newCode
        );

        const newCodeIndexSnap = await transaction.get(
          newCodeIndexRef
        );

        if (newCodeIndexSnap.exists()) {
          const existingProductId =
            newCodeIndexSnap.data()?.productId;

          if (existingProductId !== productId) {
            throw new Error(
              `El código ${newCode} ya está usado por otro producto.`
            );
          }
        }

        if (oldCode) {
          const oldCodeIndexRef = getProductCodeIndexRef(
            storeId,
            oldCode
          );

          transaction.delete(oldCodeIndexRef);
        }

        transaction.set(newCodeIndexRef, {
          storeId,
          code: newCode,
          productId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const variantsPayload = buildVariantsPayload(
        {
          ...transactionProduct,
          ...productData,
          code: newCode,
        },
        {
          productId,
          productCode: newCode,
          storeId,
        },
        transactionProduct.variants
      );

      transaction.update(productRef, {
        ...productData,

        storeId,
        code: newCode,

        ...variantsPayload,
        ...imagesPayload,

        status:
          variantsPayload.totalStock > 0
            ? "available"
            : "out_of_stock",

        updatedByUid: actor?.uid || "",
        updatedByName: actor?.name || "",
        updatedByEmail: actor?.email || "",

        updatedAt: serverTimestamp(),
      });
    });

    await deleteProductImages([...pathsToDelete], true);
  } catch (error) {
    await deleteProductImages(
      uploadedImages.map((image) => image.path),
      false
    );

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*                      REGISTRO DE IMPRESIÓN DE ETIQUETAS                     */
/* -------------------------------------------------------------------------- */

/**
 * Registra etiquetas realmente impresas.
 *
 * entries:
 * [
 *   {
 *     productId: "product-id",
 *     variantId: "variant-id",
 *     quantity: 3
 *   }
 * ]
 *
 * La cantidad pendiente se calcula contra el stock actual. Si quantity
 * supera las pendientes, el excedente se registra como reimpresión sin
 * aumentar la cantidad de unidades marcadas como etiquetadas.
 */
export async function registerLabelPrintBatch(
  entries,
  actor = null
) {
  const cleanEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      productId: String(entry?.productId || "").trim(),
      variantId: String(entry?.variantId || "").trim(),
      quantity: normalizeStock(entry?.quantity),
    }))
    .filter(
      (entry) =>
        entry.productId &&
        entry.variantId &&
        entry.quantity > 0
    );

  if (cleanEntries.length === 0) {
    throw new Error(
      "No se recibieron etiquetas válidas para registrar."
    );
  }

  const entriesByProduct = new Map();

  cleanEntries.forEach((entry) => {
    const current =
      entriesByProduct.get(entry.productId) || [];

    current.push(entry);
    entriesByProduct.set(entry.productId, current);
  });

  const printedAt = new Date().toISOString();

  await runTransaction(db, async (transaction) => {
    const productRecords = [];

    for (const [
      productId,
      productEntries,
    ] of entriesByProduct.entries()) {
      const productRef = doc(db, "products", productId);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) {
        throw new Error(
          "Uno de los productos seleccionados ya no existe."
        );
      }

      productRecords.push({
        productId,
        productRef,
        productEntries,
        product: {
          id: productSnap.id,
          ...productSnap.data(),
        },
      });
    }

    productRecords.forEach(
      ({
        productRef,
        productEntries,
        product,
      }) => {
        const variants = normalizeProductVariants(
          product.variants,
          product.size,
          product.stock,
          {
            productId: product.id,
            productCode: product.code,
            storeId: product.storeId || STORE_ID,
          }
        );

        const requestedByVariant = new Map();

        productEntries.forEach((entry) => {
          requestedByVariant.set(
            entry.variantId,
            (requestedByVariant.get(entry.variantId) || 0) +
              entry.quantity
          );
        });

        let totalPrintedNow = 0;
        let totalReprintedNow = 0;

        const nextVariants = variants.map((variant) => {
          const requested = normalizeStock(
            requestedByVariant.get(variant.id)
          );

          if (requested <= 0) {
            return variant;
          }

          const state = getVariantLabelPrintState(variant);
          const newlyPrinted = Math.min(
            requested,
            state.pending
          );
          const reprinted = Math.max(
            requested - newlyPrinted,
            0
          );

          totalPrintedNow += newlyPrinted;
          totalReprintedNow += reprinted;

          return {
            ...variant,
            printedLabels: Math.min(
              state.stock,
              state.printed + newlyPrinted
            ),
            labelPrintTotal:
              normalizeStock(variant.labelPrintTotal) +
              requested,
            labelReprintTotal:
              normalizeStock(variant.labelReprintTotal) +
              reprinted,
            lastLabelPrintedAt: printedAt,
            lastLabelPrintedByUid: actor?.uid || "",
            lastLabelPrintedByName: actor?.name || "",
            lastLabelPrintedByEmail: actor?.email || "",
          };
        });

        const summary = nextVariants.reduce(
          (result, variant) => {
            const state =
              getVariantLabelPrintState(variant);

            result.printed += state.printed;
            result.pending += state.pending;

            return result;
          },
          {
            printed: 0,
            pending: 0,
          }
        );

        transaction.update(productRef, {
          variants: nextVariants,
          labelsPrintedTotal: summary.printed,
          labelsPendingTotal: summary.pending,
          lastLabelsPrintedAt: serverTimestamp(),
          lastLabelsPrintedIso: printedAt,
          lastLabelsPrintedByUid: actor?.uid || "",
          lastLabelsPrintedByName: actor?.name || "",
          lastLabelsPrintedByEmail: actor?.email || "",
          lastLabelPrintNewQuantity: totalPrintedNow,
          lastLabelReprintQuantity: totalReprintedNow,
          updatedAt: serverTimestamp(),
        });
      }
    );
  });

  return {
    printedAt,
    entries: cleanEntries,
  };
}

/* -------------------------------------------------------------------------- */
/*                              ELIMINAR PRODUCTO                              */
/* -------------------------------------------------------------------------- */

/**
 * La nueva llamada recomendada es:
 *
 * deleteProduct(product.id)
 *
 * También acepta temporalmente:
 *
 * deleteProduct(product.id, product.imagePath)
 */
export async function deleteProduct(productId, legacyImagePath = "") {
  if (!productId) {
    throw new Error("No se encontró el producto.");
  }

  const productRef = doc(db, "products", productId);
  const productSnapshot = await getDoc(productRef);

  if (!productSnapshot.exists()) {
    return;
  }

  const currentProduct = {
    id: productSnapshot.id,
    ...productSnapshot.data(),
  };

  const imagePaths = getProductImages(currentProduct)
    .map((image) => image.path)
    .filter(Boolean);

  if (legacyImagePath) {
    imagePaths.push(legacyImagePath);
  }

  await runTransaction(db, async (transaction) => {
    const transactionProductSnap = await transaction.get(productRef);

    if (!transactionProductSnap.exists()) {
      return;
    }

    const product = transactionProductSnap.data();
    const productStoreId = product.storeId || STORE_ID;
    const code = normalizeProductCode(product.code);

    if (code) {
      const codeIndexRef = getProductCodeIndexRef(
        productStoreId,
        code
      );

      transaction.delete(codeIndexRef);
    }

    transaction.delete(productRef);
  });

  await deleteProductImages(imagePaths, true);
}