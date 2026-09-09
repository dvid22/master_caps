import {
  Timestamp,
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

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import {
  getCustomerDocumentId,
  normalizeCustomerDocument,
  normalizeCustomerPhone,
} from "./customers.service";

/* -------------------------------------------------------------------------- */
/*                                CONSTANTES                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_PAYMENT_METHOD = "efectivo";
const DEFAULT_SOURCE = "pos";
const CASH_TIME_ZONE = "America/Bogota";

const VALID_PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "nequi",
  "daviplata",
  "tarjeta",
  "addi",
  "sistecredito",
  "mixto",
  "otro",
];

const VALID_MIXED_PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "nequi",
  "daviplata",
  "tarjeta",
  "otro",
];

export const ADDI_PAYMENT_METHOD = "addi";
export const SISTECREDITO_PAYMENT_METHOD = "sistecredito";

export const SETTLEMENT_STATUS_PENDING = "pending";
export const SETTLEMENT_STATUS_SETTLED = "settled";

// Alias legacy para no romper el módulo actual de Addi mientras se migra la UI.
export const ADDI_STATUS_PENDING = SETTLEMENT_STATUS_PENDING;
export const ADDI_STATUS_SETTLED = SETTLEMENT_STATUS_SETTLED;

export const DEFERRED_PAYMENT_METHODS = [
  ADDI_PAYMENT_METHOD,
  SISTECREDITO_PAYMENT_METHOD,
];

/* -------------------------------------------------------------------------- */
/*                              UTILIDADES GENERALES                           */
/* -------------------------------------------------------------------------- */

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeMoney(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(number, 0);
}

function normalizeManualItem(item = {}, index = 0) {
  const productName = normalizeText(
    item.productName || item.name
  );

  if (!productName) {
    throw new Error(
      `Escribe el nombre del producto rápido de la línea ${index + 1}.`
    );
  }

  const quantity = normalizeQuantity(item.quantity);

  if (quantity <= 0) {
    throw new Error(
      `La cantidad del producto rápido "${productName}" debe ser mayor a cero.`
    );
  }

  const unitPrice = normalizeMoney(item.unitPrice);

  if (unitPrice <= 0) {
    throw new Error(
      `El precio de venta de "${productName}" debe ser mayor a cero.`
    );
  }

  const costPrice = normalizeMoney(item.costPrice);

  return {
    isManual: true,
    manualLineId:
      normalizeText(item.manualLineId) ||
      `manual-${Date.now()}-${index + 1}`,
    productId: "",
    productName,
    productCode: normalizeText(item.productCode || item.code),
    variantId: "",
    size: normalizeSize(item.size || "Talla única"),
    quantity,
    unitPrice,
    costPrice,
    categoryId: "",
    categoryName:
      normalizeText(item.categoryName) || "Venta rápida",
    imageUrl: "",
    note: normalizeText(item.note),
    isPromotion: false,
  };
}

function normalizePayments({
  paymentMethod,
  payments,
  total,
}) {
  const cleanTotal = normalizeMoney(total);

  if (paymentMethod !== "mixto") {
    return [
      {
        method: paymentMethod,
        amount: cleanTotal,
      },
    ];
  }

  if (!Array.isArray(payments) || payments.length < 2) {
    throw new Error(
      "El pago mixto debe tener al menos dos métodos de pago."
    );
  }

  const normalized = payments
    .map((payment) => ({
      method: normalizeText(payment?.method),
      amount: normalizeMoney(payment?.amount),
    }))
    .filter((payment) => payment.amount > 0);

  if (normalized.length < 2) {
    throw new Error(
      "Distribuye el pago mixto entre al menos dos métodos."
    );
  }

  normalized.forEach((payment) => {
    if (!VALID_MIXED_PAYMENT_METHODS.includes(payment.method)) {
      if (DEFERRED_PAYMENT_METHODS.includes(payment.method)) {
        throw new Error(
          `${getPaymentMethodLabel(payment.method)} no puede combinarse dentro de un pago mixto porque su desembolso se confirma por separado.`
        );
      }

      throw new Error(
        `El método "${payment.method || "sin método"}" no es válido para pago mixto.`
      );
    }
  });

  const usedMethods = new Set();

  normalized.forEach((payment) => {
    if (usedMethods.has(payment.method)) {
      throw new Error(
        "No repitas el mismo método dentro del pago mixto. Suma el valor en una sola línea."
      );
    }

    usedMethods.add(payment.method);
  });

  const distributed = normalized.reduce(
    (sum, payment) => sum + payment.amount,
    0
  );

  if (Math.abs(distributed - cleanTotal) > 0.5) {
    throw new Error(
      `El pago mixto debe sumar exactamente el total de la venta (${cleanTotal.toLocaleString(
        "es-CO"
      )}). Actualmente suma ${distributed.toLocaleString("es-CO")}.`
    );
  }

  return normalized;
}

function getPaymentAmount(payments = [], method) {
  return payments.reduce(
    (total, payment) =>
      normalizeText(payment?.method) === method
        ? total + normalizeMoney(payment?.amount)
        : total,
    0
  );
}

function normalizeQuantity(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(Math.trunc(number), 0);
}

function normalizeSize(value) {
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

function safeCashId(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getBogotaBusinessDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CASH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value || "0000";
  const month = parts.find((item) => item.type === "month")?.value || "00";
  const day = parts.find((item) => item.type === "day")?.value || "00";

  return `${year}-${month}-${day}`;
}

function getRequiredCashSessionId(storeId, businessDate) {
  const cleanStoreId = safeCashId(storeId);

  if (!cleanStoreId || !businessDate) {
    return "";
  }

  return `${cleanStoreId}__${businessDate}`;
}

function normalizeSettlementDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value?.toDate === "function") {
    return value;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : Timestamp.fromDate(value);
  }

  const cleanValue = normalizeText(value);

  // Evita que YYYY-MM-DD se interprete como UTC y caiga en el día anterior
  // en Colombia. El mediodía -05:00 mantiene estable la fecha de negocio.
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanValue)
    ? new Date(`${cleanValue}T12:00:00-05:00`)
    : new Date(cleanValue);

  return Number.isNaN(parsedDate.getTime())
    ? null
    : Timestamp.fromDate(parsedDate);
}

function getPaymentMethodLabel(method) {
  return (
    {
      addi: "Addi",
      sistecredito: "Sistecrédito",
    }[normalizeText(method)] || normalizeText(method) || "Financiación"
  );
}

export function isDeferredPaymentMethod(method) {
  return DEFERRED_PAYMENT_METHODS.includes(normalizeText(method));
}

function getDeferredPaymentFromSale(sale = {}) {
  const explicitProvider = normalizeText(sale.settlementProvider);

  if (isDeferredPaymentMethod(explicitProvider)) {
    return {
      provider: explicitProvider,
      amount: normalizeMoney(
        sale.settlementExpectedAmount ?? sale.total
      ),
    };
  }

  const directMethod = normalizeText(sale.paymentMethod);

  if (isDeferredPaymentMethod(directMethod)) {
    return {
      provider: directMethod,
      amount: normalizeMoney(sale.total),
    };
  }

  const payment = Array.isArray(sale.payments)
    ? sale.payments.find(
        (item) =>
          isDeferredPaymentMethod(item?.method) &&
          normalizeMoney(item?.amount) > 0
      )
    : null;

  return payment
    ? {
        provider: normalizeText(payment.method),
        amount: normalizeMoney(payment.amount),
      }
    : { provider: "", amount: 0 };
}

function getLegacySettlementFields(sale = {}, provider = "") {
  if (provider === ADDI_PAYMENT_METHOD) {
    return {
      status: normalizeText(sale.addiStatus),
      expectedAmount: normalizeMoney(sale.addiExpectedAmount),
      settledAmount: normalizeMoney(sale.addiSettledAmount),
      settledAt: sale.addiSettledAt || null,
      reference: normalizeText(sale.addiReference),
      notes: normalizeText(sale.addiNotes),
      settledByUid: normalizeText(sale.addiSettledByUid),
      settledByName: normalizeText(sale.addiSettledByName),
      settledByEmail: normalizeText(sale.addiSettledByEmail),
    };
  }

  if (provider === SISTECREDITO_PAYMENT_METHOD) {
    return {
      status: normalizeText(sale.sistecreditoStatus),
      expectedAmount: normalizeMoney(sale.sistecreditoExpectedAmount),
      settledAmount: normalizeMoney(sale.sistecreditoSettledAmount),
      settledAt: sale.sistecreditoSettledAt || null,
      reference: normalizeText(sale.sistecreditoReference),
      notes: normalizeText(sale.sistecreditoNotes),
      settledByUid: normalizeText(sale.sistecreditoSettledByUid),
      settledByName: normalizeText(sale.sistecreditoSettledByName),
      settledByEmail: normalizeText(sale.sistecreditoSettledByEmail),
    };
  }

  return {
    status: "",
    expectedAmount: 0,
    settledAmount: 0,
    settledAt: null,
    reference: "",
    notes: "",
    settledByUid: "",
    settledByName: "",
    settledByEmail: "",
  };
}

export function getSaleRecognitionDate(sale = {}) {
  const deferred = getDeferredPaymentFromSale(sale);

  if (!deferred.provider) {
    return sale.recognizedAt || sale.createdAt || null;
  }

  const legacy = getLegacySettlementFields(sale, deferred.provider);
  const status =
    normalizeText(sale.settlementStatus) || legacy.status;

  if (status !== SETTLEMENT_STATUS_SETTLED) {
    return null;
  }

  return (
    sale.recognizedAt ||
    sale.settlementSettledAt ||
    legacy.settledAt ||
    null
  );
}

export function isDeferredSale(sale = {}) {
  return Boolean(getDeferredPaymentFromSale(sale).provider);
}

/* -------------------------------------------------------------------------- */
/*                                  VARIANTES                                  */
/* -------------------------------------------------------------------------- */

function createFallbackVariantId(productId, size) {
  return `variant-${String(productId || "product")}-${normalizeSize(size)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")}`;
}

function normalizeProductVariants(productId, product = {}) {
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants.map((variant, index) => {
      const size = normalizeSize(
        variant?.size || variant?.name || variant?.label
      );

      return {
        id:
          normalizeText(variant?.id) ||
          createFallbackVariantId(productId, `${size}-${index}`),
        size,
        stock: normalizeQuantity(variant?.stock),
      };
    });
  }

  const legacySize = normalizeSize(product.size);
  const legacyStock = normalizeQuantity(product.stock);

  return [
    {
      id: createFallbackVariantId(productId, legacySize),
      size: legacySize,
      stock: legacyStock,
    },
  ];
}

function calculateTotalStock(variants) {
  return variants.reduce(
    (total, variant) => total + normalizeQuantity(variant.stock),
    0
  );
}

function buildProductVariantPayload(variants) {
  const normalizedVariants = variants.map((variant) => ({
    id: normalizeText(variant.id),
    size: normalizeSize(variant.size),
    stock: normalizeQuantity(variant.stock),
  }));

  const totalStock = calculateTotalStock(normalizedVariants);
  const sizes = normalizedVariants.map((variant) => variant.size);

  let legacySize = "Talla única";

  if (sizes.length === 1) {
    legacySize = sizes[0];
  } else if (sizes.length > 1) {
    legacySize = "Varias tallas";
  }

  return {
    variants: normalizedVariants,
    sizes,
    size: legacySize,
    stock: totalStock,
    totalStock,
    hasVariants: normalizedVariants.length > 1,
    status: totalStock > 0 ? "available" : "out_of_stock",
  };
}

function findRequestedVariant(variants, item) {
  const requestedVariantId = normalizeText(item.variantId);
  const requestedSize = normalizeText(item.size || item.productSize);

  if (requestedVariantId) {
    const variantById = variants.find(
      (variant) => variant.id === requestedVariantId
    );

    if (variantById) {
      return variantById;
    }
  }

  if (requestedSize) {
    const normalizedRequestedSize = normalizeSize(requestedSize);

    const variantBySize = variants.find(
      (variant) => normalizeSize(variant.size) === normalizedRequestedSize
    );

    if (variantBySize) {
      return variantBySize;
    }
  }

  if (variants.length === 1) {
    return variants[0];
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*                               PROMOCIONES                                   */
/* -------------------------------------------------------------------------- */

function normalizePromotionVariants(product = {}, variants = []) {
  const source = Array.isArray(product.promotionVariants)
    ? product.promotionVariants
    : [];

  return source
    .map((item) => {
      const requestedId = normalizeText(item?.variantId || item?.id);
      const requestedSize = normalizeSize(item?.size);

      const variant =
        variants.find(
          (candidate) =>
            (requestedId && candidate.id === requestedId) ||
            normalizeSize(candidate.size) === requestedSize
        ) || null;

      if (!variant) {
        return null;
      }

      const quantity = Math.min(
        normalizeQuantity(item?.quantity ?? item?.stock),
        normalizeQuantity(variant.stock)
      );

      if (quantity <= 0) {
        return null;
      }

      return {
        variantId: variant.id,
        size: variant.size,
        quantity,
      };
    })
    .filter(Boolean);
}

function getPromotionStockForVariant(promotionVariants, variant) {
  const match = promotionVariants.find(
    (item) =>
      item.variantId === variant?.id ||
      normalizeSize(item.size) === normalizeSize(variant?.size)
  );

  return normalizeQuantity(match?.quantity);
}

function getPromotionTotalStock(promotionVariants) {
  return promotionVariants.reduce(
    (total, item) => total + normalizeQuantity(item.quantity),
    0
  );
}

/* -------------------------------------------------------------------------- */
/*                              NÚMERO DE VENTA                                */
/* -------------------------------------------------------------------------- */

function getSaleCounterRef(storeId) {
  return doc(db, "counters", `sales_${storeId}`);
}

function formatSaleNumber(number) {
  return `V-${String(number).padStart(6, "0")}`;
}

async function getNextSaleNumber(transaction, storeId) {
  const counterRef = getSaleCounterRef(storeId);
  const counterSnapshot = await transaction.get(counterRef);

  const lastNumber = Number(counterSnapshot.data()?.lastNumber || 0);
  const nextNumber = lastNumber + 1;

  return {
    counterRef,
    number: nextNumber,
    saleNumber: formatSaleNumber(nextNumber),
  };
}

/* -------------------------------------------------------------------------- */
/*                         NORMALIZACIÓN DE ÍTEMS                              */
/* -------------------------------------------------------------------------- */

function normalizeRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agrega al menos un producto a la venta.");
  }

  const groupedItems = new Map();

  items.forEach((item, index) => {
    const isManual = Boolean(
      item?.isManual ||
        item?.manualItem ||
        normalizeText(item?.source) === "manual"
    );

    if (isManual) {
      const manualItem = normalizeManualItem(item, index);
      const manualKey = `manual__${manualItem.manualLineId}`;
      groupedItems.set(manualKey, manualItem);
      return;
    }

    const productId = normalizeText(item?.productId);
    const variantId = normalizeText(item?.variantId);
    const size = normalizeText(item?.size || item?.productSize);
    const quantity = normalizeQuantity(item?.quantity);
    const isPromotion =
      Boolean(item?.isPromotion) ||
      normalizeText(item?.pricingMode) === "promotion";

    if (!productId) {
      throw new Error("Uno de los productos seleccionados no es válido.");
    }

    if (quantity <= 0) {
      throw new Error("La cantidad de cada producto debe ser mayor a cero.");
    }

    const variantKey = variantId || normalizeSize(size || "Talla única");
    const modeKey = isPromotion ? "promo" : "normal";
    const groupKey = `${productId}__${variantKey}__${modeKey}`;
    const existingItem = groupedItems.get(groupKey);

    if (existingItem) {
      groupedItems.set(groupKey, {
        ...existingItem,
        quantity: existingItem.quantity + quantity,
      });
      return;
    }

    groupedItems.set(groupKey, {
      isManual: false,
      productId,
      variantId,
      size,
      quantity,
      isPromotion,
    });
  });

  return Array.from(groupedItems.values());
}

function groupItemsByProduct(items) {
  return items.reduce((groups, item) => {
    if (item.isManual) {
      return groups;
    }

    const productItems = groups.get(item.productId) || [];
    productItems.push(item);
    groups.set(item.productId, productItems);
    return groups;
  }, new Map());
}

/* -------------------------------------------------------------------------- */
/*                         NORMALIZACIÓN DE VENTAS LEÍDAS                      */
/* -------------------------------------------------------------------------- */

function normalizeLegacySaleItem(sale) {
  return {
    isManual: Boolean(sale.isManual),
    inventoryTracked:
      sale.inventoryTracked !== undefined
        ? Boolean(sale.inventoryTracked)
        : !Boolean(sale.isManual),

    productId: normalizeText(sale.productId),
    productName: normalizeText(sale.productName),
    productCode: normalizeText(sale.productCode),

    variantId: normalizeText(sale.variantId),
    size: normalizeSize(sale.productSize || sale.size),

    categoryId: normalizeText(sale.categoryId),
    categoryName: normalizeText(sale.categoryName),

    imageUrl: normalizeText(sale.imageUrl),

    quantity: normalizeQuantity(sale.quantity),
    unitPrice: normalizeMoney(sale.unitPrice),

    regularUnitPrice:
      sale.regularUnitPrice !== undefined
        ? normalizeMoney(sale.regularUnitPrice)
        : normalizeMoney(sale.unitPrice),
    isPromotion: Boolean(sale.isPromotion),
    promotionPrice: normalizeMoney(sale.promotionPrice),
    promotionNote: normalizeText(sale.promotionNote),

    costPrice: normalizeMoney(sale.costPrice),

    subtotal: normalizeMoney(sale.total),
    totalCost: normalizeMoney(sale.totalCost),
    profit: normalizeMoney(sale.profit),
  };
}

function normalizeSaleItem(item, index = 0) {
  const quantity = normalizeQuantity(item?.quantity);
  const unitPrice = normalizeMoney(item?.unitPrice);
  const costPrice = normalizeMoney(item?.costPrice);

  const subtotal =
    item?.subtotal !== undefined
      ? normalizeMoney(item.subtotal)
      : unitPrice * quantity;

  const totalCost =
    item?.totalCost !== undefined
      ? normalizeMoney(item.totalCost)
      : costPrice * quantity;

  const profit =
    item?.profit !== undefined
      ? Number(item.profit || 0)
      : subtotal - totalCost;

  return {
    lineId: normalizeText(item?.lineId) || `line-${index + 1}`,

    isManual: Boolean(item?.isManual),
    inventoryTracked:
      item?.inventoryTracked !== undefined
        ? Boolean(item.inventoryTracked)
        : !Boolean(item?.isManual),

    productId: normalizeText(item?.productId),
    productName: normalizeText(item?.productName),
    productCode: normalizeText(item?.productCode),

    variantId: normalizeText(item?.variantId),
    size: normalizeSize(item?.size || item?.productSize),

    categoryId: normalizeText(item?.categoryId),
    categoryName: normalizeText(item?.categoryName),

    imageUrl: normalizeText(item?.imageUrl || item?.coverImageUrl),

    quantity,
    unitPrice,

    regularUnitPrice:
      item?.regularUnitPrice !== undefined
        ? normalizeMoney(item.regularUnitPrice)
        : unitPrice,
    isPromotion: Boolean(item?.isPromotion),
    promotionPrice: normalizeMoney(item?.promotionPrice),
    promotionNote: normalizeText(item?.promotionNote),

    costPrice,
    subtotal,
    totalCost,
    profit,
  };
}

function normalizeSaleDocument(sale) {
  const modernItems =
    Array.isArray(sale.items) && sale.items.length > 0
      ? sale.items.map((item, index) => normalizeSaleItem(item, index))
      : [normalizeLegacySaleItem(sale)];

  const calculatedTotalItems = modernItems.reduce(
    (total, item) => total + normalizeQuantity(item.quantity),
    0
  );

  const calculatedSubtotal = modernItems.reduce(
    (total, item) => total + normalizeMoney(item.subtotal),
    0
  );

  const calculatedTotalCost = modernItems.reduce(
    (total, item) => total + normalizeMoney(item.totalCost),
    0
  );

  const calculatedProfit = modernItems.reduce(
    (total, item) => total + Number(item.profit || 0),
    0
  );

  const discount = normalizeMoney(sale.discount);

  const subtotal =
    sale.subtotal !== undefined
      ? normalizeMoney(sale.subtotal)
      : calculatedSubtotal;

  const total =
    sale.total !== undefined
      ? normalizeMoney(sale.total)
      : Math.max(subtotal - discount, 0);

  const amountReceived =
    sale.amountReceived !== undefined
      ? normalizeMoney(sale.amountReceived)
      : total;

  const change =
    sale.change !== undefined
      ? normalizeMoney(sale.change)
      : Math.max(amountReceived - total, 0);

  return {
    ...sale,

    saleNumber:
      normalizeText(sale.saleNumber) ||
      normalizeText(sale.receiptNumber) ||
      "",

    items: modernItems,

    totalItems:
      sale.totalItems !== undefined
        ? normalizeQuantity(sale.totalItems)
        : calculatedTotalItems,

    uniqueItems:
      sale.uniqueItems !== undefined
        ? normalizeQuantity(sale.uniqueItems)
        : modernItems.length,

    subtotal,
    discount,
    total,

    totalCost:
      sale.totalCost !== undefined
        ? normalizeMoney(sale.totalCost)
        : calculatedTotalCost,

    profit:
      sale.profit !== undefined
        ? Number(sale.profit || 0)
        : calculatedProfit,

    amountReceived,
    change,

    customerId: normalizeText(sale.customerId),
    customerName: normalizeText(sale.customerName),
    customerDocument: normalizeCustomerDocument(sale.customerDocument),
    customerPhone: normalizeCustomerPhone(sale.customerPhone),
    customerEmail: normalizeText(sale.customerEmail),

    paymentMethod:
      normalizeText(sale.paymentMethod) || DEFAULT_PAYMENT_METHOD,

    payments: Array.isArray(sale.payments)
      ? sale.payments
          .map((payment) => ({
            method: normalizeText(payment?.method),
            amount: normalizeMoney(payment?.amount),
          }))
          .filter((payment) => payment.method && payment.amount > 0)
      : [
          {
            method:
              normalizeText(sale.paymentMethod) ||
              DEFAULT_PAYMENT_METHOD,
            amount: total,
          },
        ],

    cashAmount:
      sale.cashAmount !== undefined
        ? normalizeMoney(sale.cashAmount)
        : normalizeText(sale.paymentMethod) === "efectivo"
          ? total
          : 0,

    ...(() => {
      const deferred = getDeferredPaymentFromSale(sale);
      const provider = deferred.provider;
      const legacy = getLegacySettlementFields(sale, provider);
      const settlementStatus =
        normalizeText(sale.settlementStatus) ||
        legacy.status ||
        (provider ? SETTLEMENT_STATUS_PENDING : "");
      const settlementExpectedAmount =
        sale.settlementExpectedAmount !== undefined
          ? normalizeMoney(sale.settlementExpectedAmount)
          : legacy.expectedAmount || deferred.amount;
      const settlementSettledAmount =
        sale.settlementSettledAmount !== undefined
          ? normalizeMoney(sale.settlementSettledAmount)
          : legacy.settledAmount;
      const settlementSettledAt =
        sale.settlementSettledAt || legacy.settledAt || null;
      const settlementReference =
        normalizeText(sale.settlementReference) || legacy.reference;
      const settlementNotes =
        normalizeText(sale.settlementNotes) || legacy.notes;
      const settlementSettledByUid =
        normalizeText(sale.settlementSettledByUid) ||
        legacy.settledByUid;
      const settlementSettledByName =
        normalizeText(sale.settlementSettledByName) ||
        legacy.settledByName;
      const settlementSettledByEmail =
        normalizeText(sale.settlementSettledByEmail) ||
        legacy.settledByEmail;

      return {
        paymentStatus:
          normalizeText(sale.paymentStatus) ||
          (provider
            ? settlementStatus === SETTLEMENT_STATUS_SETTLED
              ? "paid"
              : "pending_settlement"
            : "paid"),

        settlementProvider: provider,
        settlementStatus,
        settlementExpectedAmount,
        settlementSettledAmount,
        settlementSettledAt,
        settlementReference,
        settlementNotes,
        settlementSettledByUid,
        settlementSettledByName,
        settlementSettledByEmail,
        settlementCashSessionId: normalizeText(
          sale.settlementCashSessionId
        ),
        settlementDestination:
          normalizeText(sale.settlementDestination) ||
          (provider ? "transferencia" : ""),

        recognizedAt:
          sale.recognizedAt ||
          (provider && settlementStatus === SETTLEMENT_STATUS_SETTLED
            ? settlementSettledAt
            : provider
              ? null
              : sale.createdAt || null),
        recognizedBusinessDate: normalizeText(
          sale.recognizedBusinessDate
        ),

        // Compatibilidad Addi existente.
        addiStatus:
          provider === ADDI_PAYMENT_METHOD
            ? settlementStatus
            : normalizeText(sale.addiStatus),
        addiExpectedAmount:
          provider === ADDI_PAYMENT_METHOD
            ? settlementExpectedAmount
            : normalizeMoney(sale.addiExpectedAmount),
        addiSettledAmount:
          provider === ADDI_PAYMENT_METHOD
            ? settlementSettledAmount
            : normalizeMoney(sale.addiSettledAmount),
        addiSettledAt:
          provider === ADDI_PAYMENT_METHOD
            ? settlementSettledAt
            : sale.addiSettledAt || null,
        addiReference:
          provider === ADDI_PAYMENT_METHOD
            ? settlementReference
            : normalizeText(sale.addiReference),
        addiNotes:
          provider === ADDI_PAYMENT_METHOD
            ? settlementNotes
            : normalizeText(sale.addiNotes),

        // Campos específicos de Sistecrédito para lectura humana/compatibilidad.
        sistecreditoStatus:
          provider === SISTECREDITO_PAYMENT_METHOD
            ? settlementStatus
            : normalizeText(sale.sistecreditoStatus),
        sistecreditoExpectedAmount:
          provider === SISTECREDITO_PAYMENT_METHOD
            ? settlementExpectedAmount
            : normalizeMoney(sale.sistecreditoExpectedAmount),
        sistecreditoSettledAmount:
          provider === SISTECREDITO_PAYMENT_METHOD
            ? settlementSettledAmount
            : normalizeMoney(sale.sistecreditoSettledAmount),
        sistecreditoSettledAt:
          provider === SISTECREDITO_PAYMENT_METHOD
            ? settlementSettledAt
            : sale.sistecreditoSettledAt || null,
        sistecreditoReference:
          provider === SISTECREDITO_PAYMENT_METHOD
            ? settlementReference
            : normalizeText(sale.sistecreditoReference),
        sistecreditoNotes:
          provider === SISTECREDITO_PAYMENT_METHOD
            ? settlementNotes
            : normalizeText(sale.sistecreditoNotes),
      };
    })(),

    cashSessionId: normalizeText(sale.cashSessionId),

    notes: normalizeText(sale.notes),
    source: normalizeText(sale.source) || "direct",
  };
}

function mapSalesSnapshot(snapshot) {
  return snapshot.docs
    .map((docItem) =>
      normalizeSaleDocument({
        id: docItem.id,
        ...docItem.data(),
      })
    )
    .sort((a, b) => {
      const dateA =
        a.createdAt?.seconds ||
        a.createdAt?.toMillis?.() ||
        0;

      const dateB =
        b.createdAt?.seconds ||
        b.createdAt?.toMillis?.() ||
        0;

      return dateB - dateA;
    });
}

/* -------------------------------------------------------------------------- */
/*                  LISTENER COMPARTIDO + CACHÉ EN MEMORIA                    */
/* -------------------------------------------------------------------------- */

const salesRealtimeRegistry = new Map();

function normalizeStoreId(storeId = STORE_ID) {
  const cleanStoreId = normalizeText(storeId || STORE_ID);
  return cleanStoreId || STORE_ID;
}

function getSalesRealtimeEntry(storeId = STORE_ID) {
  const cleanStoreId = normalizeStoreId(storeId);

  if (!salesRealtimeRegistry.has(cleanStoreId)) {
    salesRealtimeRegistry.set(cleanStoreId, {
      storeId: cleanStoreId,
      subscribers: new Set(),
      sales: [],
      hasSnapshot: false,
      unsubscribeFirestore: null,
      lastError: null,
    });
  }

  return salesRealtimeRegistry.get(cleanStoreId);
}

function notifySalesSubscribers(entry) {
  entry.subscribers.forEach((subscriber) => {
    try {
      subscriber.callback(entry.sales);
    } catch (error) {
      console.error("Error entregando ventas a un suscriptor:", error);
    }
  });
}

function notifySalesSubscribersError(entry, error) {
  entry.subscribers.forEach((subscriber) => {
    if (typeof subscriber.onError !== "function") return;

    try {
      subscriber.onError(error);
    } catch (subscriberError) {
      console.error(
        "Error ejecutando el manejador de ventas:",
        subscriberError
      );
    }
  });
}

function ensureSalesRealtimeListener(entry) {
  if (entry.unsubscribeFirestore) return;

  const salesRef = collection(db, "sales");
  const salesQuery = query(
    salesRef,
    where("storeId", "==", entry.storeId)
  );

  entry.unsubscribeFirestore = onSnapshot(
    salesQuery,
    (snapshot) => {
      entry.sales = mapSalesSnapshot(snapshot);
      entry.hasSnapshot = true;
      entry.lastError = null;
      notifySalesSubscribers(entry);
    },
    (error) => {
      console.error("Error escuchando ventas:", error);
      entry.lastError = error;
      entry.unsubscribeFirestore = null;
      notifySalesSubscribersError(entry, error);
    }
  );
}

export function subscribeSales(
  callback,
  onError,
  storeId = STORE_ID
) {
  if (typeof callback !== "function") {
    throw new TypeError("subscribeSales necesita una función callback.");
  }

  const entry = getSalesRealtimeEntry(storeId);
  const subscriber = {
    callback,
    onError: typeof onError === "function" ? onError : null,
  };

  entry.subscribers.add(subscriber);

  if (entry.hasSnapshot) {
    try {
      callback(entry.sales);
    } catch (error) {
      console.error("Error entregando ventas desde caché:", error);
    }
  }

  ensureSalesRealtimeListener(entry);

  let active = true;

  return () => {
    if (!active) return;

    active = false;
    entry.subscribers.delete(subscriber);

    if (
      entry.subscribers.size === 0 &&
      typeof entry.unsubscribeFirestore === "function"
    ) {
      entry.unsubscribeFirestore();
      entry.unsubscribeFirestore = null;
    }
  };
}

export function clearSalesRealtimeCache(storeId) {
  if (storeId !== undefined && storeId !== null) {
    const cleanStoreId = normalizeStoreId(storeId);
    const entry = salesRealtimeRegistry.get(cleanStoreId);

    if (!entry) return;

    entry.unsubscribeFirestore?.();
    entry.subscribers.clear();
    salesRealtimeRegistry.delete(cleanStoreId);
    return;
  }

  salesRealtimeRegistry.forEach((entry) => {
    entry.unsubscribeFirestore?.();
    entry.subscribers.clear();
  });

  salesRealtimeRegistry.clear();
}

/* -------------------------------------------------------------------------- */
/*                          CONSULTAS PUNTUALES                                */
/* -------------------------------------------------------------------------- */

export async function getSales(storeId = STORE_ID) {
  const salesRef = collection(db, "sales");

  const salesQuery = query(
    salesRef,
    where("storeId", "==", storeId)
  );

  const snapshot = await getDocs(salesQuery);

  return mapSalesSnapshot(snapshot);
}

export async function getSaleById(saleId) {
  if (!saleId) {
    throw new Error("No se encontró la venta.");
  }

  const saleRef = doc(db, "sales", saleId);
  const saleSnapshot = await getDoc(saleRef);

  if (!saleSnapshot.exists()) {
    throw new Error("La venta no existe.");
  }

  return normalizeSaleDocument({
    id: saleSnapshot.id,
    ...saleSnapshot.data(),
  });
}

export function subscribeDeferredSales(
  callback,
  onError,
  storeId = STORE_ID
) {
  return subscribeSales(
    (sales) => {
      callback(sales.filter((sale) => isDeferredSale(sale)));
    },
    onError,
    storeId
  );
}

export async function getDeferredSales(storeId = STORE_ID) {
  const sales = await getSales(storeId);
  return sales.filter((sale) => isDeferredSale(sale));
}

export function subscribeAddiSales(
  callback,
  onError,
  storeId = STORE_ID
) {
  return subscribeDeferredSales(
    (sales) =>
      callback(
        sales.filter(
          (sale) =>
            getDeferredPaymentFromSale(sale).provider ===
            ADDI_PAYMENT_METHOD
        )
      ),
    onError,
    storeId
  );
}

export async function getAddiSales(storeId = STORE_ID) {
  const sales = await getDeferredSales(storeId);
  return sales.filter(
    (sale) =>
      getDeferredPaymentFromSale(sale).provider === ADDI_PAYMENT_METHOD
  );
}

export function subscribeSistecreditoSales(
  callback,
  onError,
  storeId = STORE_ID
) {
  return subscribeDeferredSales(
    (sales) =>
      callback(
        sales.filter(
          (sale) =>
            getDeferredPaymentFromSale(sale).provider ===
            SISTECREDITO_PAYMENT_METHOD
        )
      ),
    onError,
    storeId
  );
}

export async function getSistecreditoSales(storeId = STORE_ID) {
  const sales = await getDeferredSales(storeId);
  return sales.filter(
    (sale) =>
      getDeferredPaymentFromSale(sale).provider ===
      SISTECREDITO_PAYMENT_METHOD
  );
}

/* -------------------------------------------------------------------------- */
/*                    FINANCIACIONES / DESEMBOLSOS DIFERIDOS                  */
/* -------------------------------------------------------------------------- */

export async function settleDeferredSale({
  saleId,
  provider = "",
  settledAmount = null,
  settledAt = null,
  reference = "",
  notes = "",
  actor = null,
}) {
  const cleanSaleId = normalizeText(saleId);

  if (!cleanSaleId) {
    throw new Error("No se encontró la venta financiada.");
  }

  const saleRef = doc(db, "sales", cleanSaleId);

  return runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef);

    if (!saleSnapshot.exists()) {
      throw new Error("La venta no existe.");
    }

    const currentSale = normalizeSaleDocument({
      id: saleSnapshot.id,
      ...saleSnapshot.data(),
    });

    const deferred = getDeferredPaymentFromSale(currentSale);
    const cleanProvider = normalizeText(provider) || deferred.provider;

    if (!isDeferredPaymentMethod(cleanProvider)) {
      throw new Error(
        "Esta venta no corresponde a Addi ni a Sistecrédito."
      );
    }

    if (deferred.provider && deferred.provider !== cleanProvider) {
      throw new Error(
        `Esta venta corresponde a ${getPaymentMethodLabel(
          deferred.provider
        )}, no a ${getPaymentMethodLabel(cleanProvider)}.`
      );
    }

    if (currentSale.settlementStatus === SETTLEMENT_STATUS_SETTLED) {
      throw new Error(
        `Este desembolso de ${getPaymentMethodLabel(
          cleanProvider
        )} ya fue confirmado.`
      );
    }

    const expectedAmount = normalizeMoney(
      currentSale.settlementExpectedAmount ||
        deferred.amount ||
        currentSale.total
    );

    const finalSettledAmount =
      settledAmount === null ||
      settledAmount === undefined ||
      settledAmount === ""
        ? expectedAmount
        : normalizeMoney(settledAmount);

    if (finalSettledAmount <= 0) {
      throw new Error(
        `El valor recibido de ${getPaymentMethodLabel(
          cleanProvider
        )} debe ser mayor a cero.`
      );
    }

    const settlementTimestamp =
      normalizeSettlementDate(settledAt) || Timestamp.now();
    const settlementDate = settlementTimestamp.toDate();
    const settlementBusinessDate = getBogotaBusinessDate(
      settlementDate
    );
    const settlementCashSessionId = getRequiredCashSessionId(
      currentSale.storeId || STORE_ID,
      settlementBusinessDate
    );
    const settlementCashSessionRef = doc(
      db,
      "cashSessions",
      settlementCashSessionId
    );
    const settlementCashSessionSnapshot = await transaction.get(
      settlementCashSessionRef
    );

    if (!settlementCashSessionSnapshot.exists()) {
      throw new Error(
        `Debes abrir la caja del ${settlementBusinessDate} antes de confirmar este desembolso.`
      );
    }

    const settlementCashSession = settlementCashSessionSnapshot.data();

    if (settlementCashSession.status !== "open") {
      throw new Error(
        "La caja correspondiente a la fecha de recepción ya está cerrada. No se puede registrar el desembolso en esa caja."
      );
    }

    if (settlementCashSession.businessDate !== settlementBusinessDate) {
      throw new Error(
        "La caja abierta no corresponde a la fecha de recepción seleccionada."
      );
    }

    const settlementReference = normalizeText(reference);
    const settlementNotes = normalizeText(notes);

    const updatePayload = {
      paymentStatus: "paid",

      settlementProvider: cleanProvider,
      settlementStatus: SETTLEMENT_STATUS_SETTLED,
      settlementExpectedAmount: expectedAmount,
      settlementSettledAmount: finalSettledAmount,
      settlementSettledAt: settlementTimestamp,
      settlementReference,
      settlementNotes,
      settlementDestination: "transferencia",
      settlementCashSessionId,
      settlementSettledByUid: actor?.uid || "",
      settlementSettledByName: actor?.name || "",
      settlementSettledByEmail: actor?.email || "",

      recognizedAt: settlementTimestamp,
      recognizedBusinessDate: settlementBusinessDate,

      updatedAt: serverTimestamp(),
    };

    if (cleanProvider === ADDI_PAYMENT_METHOD) {
      Object.assign(updatePayload, {
        addiStatus: ADDI_STATUS_SETTLED,
        addiExpectedAmount: expectedAmount,
        addiSettledAmount: finalSettledAmount,
        addiSettledAt: settlementTimestamp,
        addiReference: settlementReference,
        addiNotes: settlementNotes,
        addiSettledByUid: actor?.uid || "",
        addiSettledByName: actor?.name || "",
        addiSettledByEmail: actor?.email || "",
      });
    }

    if (cleanProvider === SISTECREDITO_PAYMENT_METHOD) {
      Object.assign(updatePayload, {
        sistecreditoStatus: SETTLEMENT_STATUS_SETTLED,
        sistecreditoExpectedAmount: expectedAmount,
        sistecreditoSettledAmount: finalSettledAmount,
        sistecreditoSettledAt: settlementTimestamp,
        sistecreditoReference: settlementReference,
        sistecreditoNotes: settlementNotes,
        sistecreditoSettledByUid: actor?.uid || "",
        sistecreditoSettledByName: actor?.name || "",
        sistecreditoSettledByEmail: actor?.email || "",
      });
    }

    transaction.update(saleRef, updatePayload);

    transaction.update(settlementCashSessionRef, {
      lastActivityByUid: actor?.uid || "",
      lastActivityByName: actor?.name || "",
      lastActivityByEmail: actor?.email || "",
      updatedAt: serverTimestamp(),
    });

    return {
      saleId: cleanSaleId,
      saleNumber: currentSale.saleNumber,
      provider: cleanProvider,
      expectedAmount,
      settledAmount: finalSettledAmount,
      settledAt: settlementTimestamp,
      businessDate: settlementBusinessDate,
      cashSessionId: settlementCashSessionId,
      status: SETTLEMENT_STATUS_SETTLED,
    };
  });
}

export async function settleAddiSale(payload) {
  return settleDeferredSale({
    ...payload,
    provider: ADDI_PAYMENT_METHOD,
  });
}

export async function settleSistecreditoSale(payload) {
  return settleDeferredSale({
    ...payload,
    provider: SISTECREDITO_PAYMENT_METHOD,
  });
}

/* -------------------------------------------------------------------------- */
/*                           CREAR VENTA MULTIPRODUCTO                         */
/* -------------------------------------------------------------------------- */

export async function createMultiItemSale({
  items,
  customerId = "",
  customerName = "",
  customerDocument = "",
  customerPhone = "",
  customerEmail = "",

  paymentMethod = DEFAULT_PAYMENT_METHOD,
  payments = [],
  discount = 0,
  amountReceived = null,

  notes = "",
  source = DEFAULT_SOURCE,
  reservationId = null,

  storeId = STORE_ID,
  seller = null,
}) {
  const requestedItems = normalizeRequestedItems(items);
  const groupedItems = groupItemsByProduct(requestedItems);

  const cleanPaymentMethod = VALID_PAYMENT_METHODS.includes(paymentMethod)
    ? paymentMethod
    : "otro";

  const cleanDiscount = normalizeMoney(discount);

  const cleanCustomerDocument = normalizeCustomerDocument(customerDocument);
  const cleanCustomerName = normalizeText(customerName);
  const cleanCustomerPhone = normalizeCustomerPhone(customerPhone);
  const cleanCustomerEmail = normalizeText(customerEmail);

  const requestedCustomerId =
    normalizeText(customerId);

  const expectedCustomerId =
    cleanCustomerDocument
      ? getCustomerDocumentId(
          cleanCustomerDocument,
          storeId
        )
      : "";

  if (
    cleanCustomerDocument &&
    requestedCustomerId &&
    requestedCustomerId !==
      expectedCustomerId
  ) {
    throw new Error(
      "La cédula seleccionada no coincide con el cliente de la venta."
    );
  }

  const cleanSource = normalizeText(source) || DEFAULT_SOURCE;
  const requiresOpenCash = cleanSource === "pos";
  const businessDate = getBogotaBusinessDate();
  const cashSessionId = requiresOpenCash
    ? getRequiredCashSessionId(storeId, businessDate)
    : "";

  if (requiresOpenCash && !cashSessionId) {
    throw new Error(
      "No se pudo identificar la caja de la tienda. Recarga la página e inténtalo nuevamente."
    );
  }

  const cashSessionRef = cashSessionId
    ? doc(db, "cashSessions", cashSessionId)
    : null;

  const saleRef = doc(collection(db, "sales"));

  const saleResult = await runTransaction(db, async (transaction) => {
    const saleCounter = await getNextSaleNumber(transaction, storeId);

    if (cashSessionRef) {
      const cashSessionSnapshot = await transaction.get(cashSessionRef);

      if (!cashSessionSnapshot.exists()) {
        throw new Error("Debes abrir la caja de hoy antes de registrar ventas.");
      }

      const cashSession = cashSessionSnapshot.data();

      if (cashSession.storeId !== storeId) {
        throw new Error("La caja abierta no pertenece a esta tienda.");
      }

      if (cashSession.status !== "open") {
        throw new Error(
          "La caja de hoy ya está cerrada. No se pueden registrar más ventas en esta sesión."
        );
      }

      if (cashSession.businessDate !== businessDate) {
        throw new Error(
          "La caja abierta pertenece a otro día. Abre la caja de hoy antes de vender."
        );
      }

    }

    let customerRef = null;
    let customerSnapshot = null;

    const customerLookupId =
      expectedCustomerId ||
      requestedCustomerId;

    if (customerLookupId) {
      customerRef = doc(
        db,
        "customers",
        customerLookupId
      );
      customerSnapshot =
        await transaction.get(customerRef);
    }

    const productSnapshots = new Map();

    for (const productId of groupedItems.keys()) {
      const productRef = doc(db, "products", productId);
      const productSnapshot = await transaction.get(productRef);

      productSnapshots.set(productId, {
        ref: productRef,
        snapshot: productSnapshot,
      });
    }

    let finalCustomerId =
      requestedCustomerId || "";
    let finalCustomerName =
      cleanCustomerName;
    let finalCustomerDocument =
      cleanCustomerDocument;
    let finalCustomerPhone =
      cleanCustomerPhone;
    let finalCustomerEmail =
      cleanCustomerEmail;
    let shouldCreateCustomer = false;

    if (customerSnapshot?.exists()) {
      const existingCustomer =
        customerSnapshot.data();

      if (
        existingCustomer.storeId !==
        storeId
      ) {
        throw new Error(
          "El cliente encontrado no pertenece a esta tienda."
        );
      }

      finalCustomerId =
        customerSnapshot.id;

      finalCustomerName =
        normalizeText(
          existingCustomer.fullName
        ) || cleanCustomerName;

      finalCustomerDocument =
        normalizeCustomerDocument(
          existingCustomer.documentNumber ||
            existingCustomer.normalizedDocument ||
            cleanCustomerDocument
        );

      finalCustomerPhone =
        normalizeCustomerPhone(
          existingCustomer.phone
        ) || cleanCustomerPhone;

      finalCustomerEmail =
        normalizeText(
          existingCustomer.email
        ) || cleanCustomerEmail;
    } else if (cleanCustomerDocument) {
      finalCustomerId =
        expectedCustomerId;

      if (!cleanCustomerName) {
        throw new Error(
          "Completa el nombre del cliente para registrar esta cédula."
        );
      }

      shouldCreateCustomer = true;
    } else {
      /*
       * Si no hay cédula, la venta puede conservar nombre y teléfono
       * aunque todavía no exista un documento maestro en `customers`.
       * Si el POS encontró un cliente por teléfono, `customerId`
       * viene informado y el bloque anterior lo enlaza normalmente.
       */
      finalCustomerId = "";
    }

    const saleItems = [];

    let subtotal = 0;
    let totalCost = 0;
    let totalItems = 0;

    const manualItems = requestedItems.filter(
      (item) => item.isManual
    );

    manualItems.forEach((item) => {
      const lineSubtotal =
        item.unitPrice * item.quantity;
      const lineTotalCost =
        item.costPrice * item.quantity;
      const lineProfit =
        lineSubtotal - lineTotalCost;

      subtotal += lineSubtotal;
      totalCost += lineTotalCost;
      totalItems += item.quantity;

      saleItems.push({
        lineId: `line-${saleItems.length + 1}`,

        isManual: true,
        inventoryTracked: false,

        productId: "",
        productName: item.productName,
        productCode: item.productCode,

        variantId: "",
        size: item.size,

        categoryId: "",
        categoryName:
          item.categoryName || "Venta rápida",

        imageUrl: "",

        quantity: item.quantity,

        unitPrice: item.unitPrice,
        regularUnitPrice: item.unitPrice,
        isPromotion: false,
        promotionPrice: 0,
        promotionNote: "",

        costPrice: item.costPrice,

        subtotal: lineSubtotal,
        totalCost: lineTotalCost,
        profit: lineProfit,

        manualNote: item.note || "",
      });
    });

    for (const [productId, productSaleItems] of groupedItems.entries()) {
      const productEntry = productSnapshots.get(productId);
      const productSnapshot = productEntry?.snapshot;
      const productRef = productEntry?.ref;

      if (!productSnapshot?.exists()) {
        throw new Error("Uno de los productos seleccionados ya no existe.");
      }

      const product = productSnapshot.data();

      if (product.storeId !== storeId) {
        throw new Error(
          `El producto "${product.name || productId}" no pertenece a esta tienda.`
        );
      }

      const workingVariants = normalizeProductVariants(productId, product);
      let workingPromotionVariants = normalizePromotionVariants(
        product,
        workingVariants
      );

      for (const requestedItem of productSaleItems) {
        const selectedVariant = findRequestedVariant(
          workingVariants,
          requestedItem
        );

        if (!selectedVariant) {
          throw new Error(
            `Selecciona una talla válida para "${product.name || "el producto"}".`
          );
        }

        const requestedQuantity = normalizeQuantity(requestedItem.quantity);
        const currentVariantStock = normalizeQuantity(selectedVariant.stock);

        const promotionAvailable = getPromotionStockForVariant(
          workingPromotionVariants,
          selectedVariant
        );

        const normalAvailable = Math.max(
          currentVariantStock - promotionAvailable,
          0
        );

        const promotionActive = Boolean(requestedItem.isPromotion);
        const availableForMode = promotionActive
          ? promotionAvailable
          : normalAvailable;

        if (requestedQuantity > availableForMode) {
          throw new Error(
            promotionActive
              ? `Solo hay ${availableForMode} unidad(es) en promoción de "${product.name}" talla ${selectedVariant.size}.`
              : `Solo hay ${availableForMode} unidad(es) normales de "${product.name}" talla ${selectedVariant.size}.`
          );
        }

        if (
          promotionActive &&
          (!Boolean(product.isPromotion) ||
            normalizeMoney(product.promotionPrice) <= 0)
        ) {
          throw new Error(`La promoción de "${product.name}" ya no está disponible.`);
        }

        selectedVariant.stock = currentVariantStock - requestedQuantity;

        if (promotionActive) {
          workingPromotionVariants = workingPromotionVariants
            .map((item) =>
              item.variantId === selectedVariant.id ||
              normalizeSize(item.size) === normalizeSize(selectedVariant.size)
                ? {
                    ...item,
                    quantity: item.quantity - requestedQuantity,
                  }
                : item
            )
            .filter((item) => item.quantity > 0);
        }

        const regularUnitPrice = normalizeMoney(product.salePrice);

        const promotionPrice = promotionActive
          ? normalizeMoney(product.promotionPrice)
          : 0;

        const promotionNote = promotionActive
          ? normalizeText(product.promotionNote)
          : "";

        const unitPrice = promotionActive
          ? promotionPrice
          : regularUnitPrice;

        const costPrice = normalizeMoney(product.costPrice);

        const lineSubtotal = unitPrice * requestedQuantity;
        const lineTotalCost = costPrice * requestedQuantity;
        const lineProfit = lineSubtotal - lineTotalCost;

        subtotal += lineSubtotal;
        totalCost += lineTotalCost;
        totalItems += requestedQuantity;

        saleItems.push({
          lineId: `line-${saleItems.length + 1}`,

          isManual: false,
          inventoryTracked: true,

          productId,
          productName: normalizeText(product.name),
          productCode: normalizeText(product.code),

          variantId: selectedVariant.id,
          size: selectedVariant.size,

          categoryId: normalizeText(product.categoryId),
          categoryName: normalizeText(product.categoryName),

          imageUrl: normalizeText(
            product.coverImageUrl || product.imageUrl
          ),

          quantity: requestedQuantity,

          unitPrice,
          regularUnitPrice,
          isPromotion: promotionActive,
          promotionPrice,
          promotionNote,

          costPrice,

          subtotal: lineSubtotal,
          totalCost: lineTotalCost,
          profit: lineProfit,
        });
      }

      const productVariantPayload = buildProductVariantPayload(workingVariants);
      const promotionStock = getPromotionTotalStock(workingPromotionVariants);

      transaction.update(productRef, {
        ...productVariantPayload,

        promotionVariants: workingPromotionVariants,
        promotionStock,

        updatedByUid: seller?.uid || "",
        updatedByName: seller?.name || "",
        updatedByEmail: seller?.email || "",

        updatedAt: serverTimestamp(),
      });
    }

    if (cleanDiscount > subtotal) {
      throw new Error("El descuento no puede ser mayor al subtotal de la venta.");
    }

    const total = Math.max(subtotal - cleanDiscount, 0);

    const normalizedPayments = normalizePayments({
      paymentMethod: cleanPaymentMethod,
      payments,
      total,
    });

    const finalAmountReceived =
      cleanPaymentMethod === "efectivo"
        ? amountReceived === null ||
          amountReceived === undefined ||
          amountReceived === ""
          ? total
          : normalizeMoney(amountReceived)
        : total;

    if (
      cleanPaymentMethod === "efectivo" &&
      finalAmountReceived < total
    ) {
      throw new Error(
        "El dinero recibido no puede ser menor al total de la venta."
      );
    }

    const change =
      cleanPaymentMethod === "efectivo"
        ? Math.max(finalAmountReceived - total, 0)
        : 0;

    const isDeferredPayment = isDeferredPaymentMethod(
      cleanPaymentMethod
    );
    const settlementProvider = isDeferredPayment
      ? cleanPaymentMethod
      : "";
    const settlementStatus = isDeferredPayment
      ? SETTLEMENT_STATUS_PENDING
      : "";
    const settlementExpectedAmount = isDeferredPayment
      ? total
      : 0;
    const paymentStatus = isDeferredPayment
      ? "pending_settlement"
      : "paid";

    const addiStatus =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? ADDI_STATUS_PENDING
        : "";
    const addiExpectedAmount =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementExpectedAmount
        : 0;

    const sistecreditoStatus =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? SETTLEMENT_STATUS_PENDING
        : "";
    const sistecreditoExpectedAmount =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementExpectedAmount
        : 0;
    const cashAmount = getPaymentAmount(
      normalizedPayments,
      "efectivo"
    );
    const profit = total - totalCost;

    if (shouldCreateCustomer && customerRef) {
      transaction.set(customerRef, {
        storeId,

        documentNumber: finalCustomerDocument,
        normalizedDocument: finalCustomerDocument,

        firstName: "",
        lastName: "",
        fullName: finalCustomerName,

        phone: finalCustomerPhone,
        email: finalCustomerEmail,
        address: "",
        notes: "",

        isActive: true,

        createdByUid: seller?.uid || "",
        createdByName: seller?.name || "",
        createdByEmail: seller?.email || "",

        updatedByUid: seller?.uid || "",
        updatedByName: seller?.name || "",
        updatedByEmail: seller?.email || "",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.set(
      saleCounter.counterRef,
      {
        storeId,
        lastNumber: saleCounter.number,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    transaction.set(saleRef, {
      storeId,

      saleNumber: saleCounter.saleNumber,
      receiptNumber: saleCounter.saleNumber,

      items: saleItems,
      totalItems,
      uniqueItems: saleItems.length,

      subtotal,
      discount: cleanDiscount,
      total,

      totalCost,
      profit,

      customerId: finalCustomerId,
      customerName: finalCustomerName,
      customerDocument: finalCustomerDocument,
      customerPhone: finalCustomerPhone,
      customerEmail: finalCustomerEmail,

      paymentMethod: cleanPaymentMethod,
      payments: normalizedPayments,
      cashAmount,
      amountReceived: finalAmountReceived,
      change,

      paymentStatus,

      settlementProvider,
      settlementStatus,
      settlementExpectedAmount,
      settlementSettledAmount: 0,
      settlementSettledAt: null,
      settlementReference: "",
      settlementNotes: "",
      settlementSettledByUid: "",
      settlementSettledByName: "",
      settlementSettledByEmail: "",
      settlementDestination: isDeferredPayment ? "transferencia" : "",
      settlementCashSessionId: "",

      recognizedAt: isDeferredPayment ? null : serverTimestamp(),
      recognizedBusinessDate: isDeferredPayment ? "" : businessDate,

      // Compatibilidad con ventas Addi existentes.
      addiStatus,
      addiExpectedAmount,
      addiSettledAmount: 0,
      addiSettledAt: null,
      addiReference: "",
      addiNotes: "",
      addiSettledByUid: "",
      addiSettledByName: "",
      addiSettledByEmail: "",

      sistecreditoStatus,
      sistecreditoExpectedAmount,
      sistecreditoSettledAmount: 0,
      sistecreditoSettledAt: null,
      sistecreditoReference: "",
      sistecreditoNotes: "",
      sistecreditoSettledByUid: "",
      sistecreditoSettledByName: "",
      sistecreditoSettledByEmail: "",

      notes: normalizeText(notes),
      source: cleanSource,
      cashSessionId,

      reservationId: reservationId || null,

      sellerUid: seller?.uid || "",
      sellerName: seller?.name || "",
      sellerEmail: seller?.email || "",

      receiptPrinted: false,
      receiptPrintCount: 0,
      lastReceiptPrintedAt: null,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      id: saleRef.id,
      saleNumber: saleCounter.saleNumber,

      items: saleItems,
      totalItems,
      uniqueItems: saleItems.length,

      subtotal,
      discount: cleanDiscount,
      total,

      totalCost,
      profit,

      paymentMethod: cleanPaymentMethod,
      payments: normalizedPayments,
      cashAmount,
      amountReceived: finalAmountReceived,
      change,

      paymentStatus,
      settlementProvider,
      settlementStatus,
      settlementExpectedAmount,
      settlementSettledAmount: 0,
      settlementSettledAt: null,
      settlementCashSessionId: "",
      recognizedAt: isDeferredPayment ? null : new Date(),
      recognizedBusinessDate: isDeferredPayment ? "" : businessDate,

      addiStatus,
      addiExpectedAmount,
      addiSettledAmount: 0,
      addiSettledAt: null,

      sistecreditoStatus,
      sistecreditoExpectedAmount,
      sistecreditoSettledAmount: 0,
      sistecreditoSettledAt: null,

      customerId: finalCustomerId,
      customerName: finalCustomerName,
      customerDocument: finalCustomerDocument,
      customerPhone: finalCustomerPhone,
      customerEmail: finalCustomerEmail,

      notes: normalizeText(notes),
      source: cleanSource,
      cashSessionId,

      sellerUid: seller?.uid || "",
      sellerName: seller?.name || "",
      sellerEmail: seller?.email || "",
    };
  });

  return saleResult;
}

/* -------------------------------------------------------------------------- */
/*                   COMPATIBILIDAD CON LA VENTA ANTERIOR                     */
/* -------------------------------------------------------------------------- */

export async function createDirectSale({
  productId,
  variantId = "",
  size = "",

  quantity,
  customerId = "",
  customerName = "",
  customerDocument = "",
  customerPhone = "",
  customerEmail = "",

  paymentMethod = DEFAULT_PAYMENT_METHOD,
  payments = [],
  amountReceived = null,
  discount = 0,

  notes = "",
  storeId = STORE_ID,
  seller = null,
}) {
  if (!productId) {
    throw new Error("Debes seleccionar un producto.");
  }

  const result = await createMultiItemSale({
    items: [
      {
        productId,
        variantId,
        size,
        quantity,
      },
    ],

    customerId,
    customerName,
    customerDocument,
    customerPhone,
    customerEmail,

    paymentMethod,
    payments,
    amountReceived,
    discount,

    notes,
    source: "direct",

    storeId,
    seller,
  });

  return result.id;
}
