/**
 * Fuente única de verdad para códigos de barras.
 *
 * Versión 2:
 * - Prefijo 8 para invalidar y regenerar los códigos anteriores con prefijo 9.
 * - 10 dígitos numéricos, optimizados para CODE128 en etiquetas de 30 × 20 mm.
 * - La identidad del producto usa su documentId inmutable cuando el código
 *   comercial no es estrictamente numérico.
 * - La identidad de la variante usa su id estable, no la posición del arreglo.
 */

const BARCODE_PREFIX = "8";
const PRODUCT_DIGITS = 7;
const VARIANT_DIGITS = 2;
const BARCODE_PATTERN = /^8\d{9}$/;

function safeText(value) {
  return String(value ?? "").trim();
}

function removeDiacritics(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hashToPositiveInteger(value) {
  const text = safeText(value);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeNumericProductKey({
  productId = "",
  productCode = "",
  storeId = "",
} = {}) {
  const normalizedCode = removeDiacritics(productCode)
    .toUpperCase()
    .replace(/\s+/g, "");

  /*
   * Solo usamos el código comercial directamente cuando es completamente
   * numérico. Antes se extraían los números de códigos alfanuméricos:
   * D-09 y 0009 terminaban convertidos en la misma identidad.
   */
  if (/^\d+$/.test(normalizedCode)) {
    return normalizedCode
      .slice(-PRODUCT_DIGITS)
      .padStart(PRODUCT_DIGITS, "0");
  }

  const source = [
    safeText(storeId),
    safeText(productId),
    normalizedCode,
  ].join(":");

  const maximum = 10 ** PRODUCT_DIGITS;
  const numericHash = hashToPositiveInteger(source) % maximum;

  return String(numericHash).padStart(PRODUCT_DIGITS, "0");
}

function getVariantSeed(variant, fallbackIndex = 0) {
  const stableId = safeText(variant?.id);

  if (stableId) {
    return stableId;
  }

  return [
    safeText(variant?.size),
    String(fallbackIndex),
  ].join(":");
}

function buildVariantSuffix(variant, fallbackIndex = 0) {
  const maximum = 10 ** VARIANT_DIGITS - 1;
  const seed = getVariantSeed(variant, fallbackIndex);
  const value = (hashToPositiveInteger(seed) % maximum) + 1;

  return String(value).padStart(VARIANT_DIGITS, "0");
}

export function normalizeScannerBarcode(value) {
  return removeDiacritics(value)
    .toUpperCase()
    .replace(/['’‘`´]/g, "-")
    .replace(/\s+/g, "")
    .replace(/_+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeBarcode(value) {
  return normalizeScannerBarcode(value).replace(/[^A-Z0-9-]/g, "");
}

export function isManagedVariantBarcode(value) {
  return BARCODE_PATTERN.test(normalizeBarcode(value));
}

export function buildVariantBarcode({
  productId = "",
  productCode = "",
  storeId = "",
  variant = null,
  variantIndex = 0,
  forcedSuffix = "",
} = {}) {
  const productKey = normalizeNumericProductKey({
    productId,
    productCode,
    storeId,
  });

  const variantKey =
    safeText(forcedSuffix) ||
    buildVariantSuffix(variant, variantIndex);

  return `${BARCODE_PREFIX}${productKey}${variantKey}`;
}

export function ensureVariantBarcodes(
  variants,
  {
    productId = "",
    productCode = "",
    storeId = "",
  } = {}
) {
  const source = Array.isArray(variants) ? variants : [];
  const used = new Set();

  return source.map((variant, index) => {
    const existing = normalizeBarcode(variant?.barcode);

    if (isManagedVariantBarcode(existing) && !used.has(existing)) {
      used.add(existing);

      return {
        ...variant,
        barcode: existing,
      };
    }

    let suffixNumber = Number(
      buildVariantSuffix(variant, index)
    );

    let barcode = buildVariantBarcode({
      productId,
      productCode,
      storeId,
      variant,
      variantIndex: index,
      forcedSuffix: String(suffixNumber).padStart(
        VARIANT_DIGITS,
        "0"
      ),
    });

    /*
     * Evita colisiones entre variantes del mismo producto.
     */
    let attempts = 0;

    while (used.has(barcode) && attempts < 99) {
      attempts += 1;
      suffixNumber = (suffixNumber % 99) + 1;

      barcode = buildVariantBarcode({
        productId,
        productCode,
        storeId,
        variant,
        variantIndex: index,
        forcedSuffix: String(suffixNumber).padStart(
          VARIANT_DIGITS,
          "0"
        ),
      });
    }

    used.add(barcode);

    return {
      ...variant,
      barcode,
    };
  });
}

export function buildLegacyVariantBarcode(productCode, size) {
  const cleanProductCode = removeDiacritics(productCode)
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-_]/g, "");

  const cleanSize = removeDiacritics(size)
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-_]/g, "");

  if (!cleanProductCode) return "";

  if (
    !cleanSize ||
    cleanSize === "TALLA-UNICA" ||
    cleanSize === "UNICA"
  ) {
    return `MC-${cleanProductCode}-UNICA`;
  }

  return `MC-${cleanProductCode}-${cleanSize}`;
}

export function getVariantBarcodeAliases(
  product,
  variant,
  variantIndex = 0
) {
  const actualBarcode = normalizeBarcode(
    resolveVariantBarcode(product, variant, variantIndex)
  );

  const legacyBarcode = normalizeBarcode(
    buildLegacyVariantBarcode(product?.code, variant?.size)
  );

  const compactLegacy = normalizeBarcode(
    `${product?.code || ""}-${variant?.size || ""}`
  );

  return [
    ...new Set(
      [actualBarcode, legacyBarcode, compactLegacy].filter(Boolean)
    ),
  ];
}

export function resolveVariantBarcode(
  product,
  variant,
  variantIndex = 0
) {
  const existing = normalizeBarcode(variant?.barcode);

  if (isManagedVariantBarcode(existing)) {
    return existing;
  }

  return buildVariantBarcode({
    productId: product?.id,
    productCode: product?.code,
    storeId: product?.storeId,
    variant,
    variantIndex,
  });
}

export function validateVariantBarcode(value) {
  const barcode = normalizeBarcode(value);

  if (!isManagedVariantBarcode(barcode)) {
    return {
      valid: false,
      barcode,
      message:
        "El código debe tener 10 dígitos y comenzar por 8.",
    };
  }

  return {
    valid: true,
    barcode,
    message: "",
  };
}
