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
  "otro",
];

export const ADDI_PAYMENT_METHOD = "addi";
export const ADDI_STATUS_PENDING = "pending";
export const ADDI_STATUS_SETTLED = "settled";

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

function getRequiredCashSessionId(storeId, sellerUid, businessDate) {
  const cleanStoreId = safeCashId(storeId);
  const cleanSellerUid = safeCashId(sellerUid);

  if (!cleanStoreId || !cleanSellerUid || !businessDate) {
    return "";
  }

  return `${cleanStoreId}__${cleanSellerUid}__${businessDate}`;
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

  const parsedDate = new Date(value);

  return Number.isNaN(parsedDate.getTime())
    ? null
    : Timestamp.fromDate(parsedDate);
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

  items.forEach((item) => {
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

    paymentStatus:
      normalizeText(sale.paymentStatus) ||
      (normalizeText(sale.paymentMethod) === ADDI_PAYMENT_METHOD
        ? "pending_settlement"
        : "paid"),

    addiStatus:
      normalizeText(sale.addiStatus) ||
      (normalizeText(sale.paymentMethod) === ADDI_PAYMENT_METHOD
        ? ADDI_STATUS_PENDING
        : ""),

    addiExpectedAmount:
      sale.addiExpectedAmount !== undefined
        ? normalizeMoney(sale.addiExpectedAmount)
        : normalizeText(sale.paymentMethod) === ADDI_PAYMENT_METHOD
          ? total
          : 0,

    addiSettledAmount:
      sale.addiSettledAmount !== undefined
        ? normalizeMoney(sale.addiSettledAmount)
        : 0,

    addiSettledAt: sale.addiSettledAt || null,
    addiReference: normalizeText(sale.addiReference),
    addiNotes: normalizeText(sale.addiNotes),

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

export function subscribeAddiSales(
  callback,
  onError,
  storeId = STORE_ID
) {
  return subscribeSales(
    (sales) => {
      callback(
        sales.filter((sale) => {
          if (sale.paymentMethod === ADDI_PAYMENT_METHOD) {
            return true;
          }

          return Array.isArray(sale.payments)
            ? sale.payments.some(
                (payment) =>
                  normalizeText(payment?.method) === ADDI_PAYMENT_METHOD &&
                  normalizeMoney(payment?.amount) > 0
              )
            : false;
        })
      );
    },
    onError,
    storeId
  );
}

export async function getAddiSales(storeId = STORE_ID) {
  const sales = await getSales(storeId);

  return sales.filter((sale) => {
    if (sale.paymentMethod === ADDI_PAYMENT_METHOD) {
      return true;
    }

    return Array.isArray(sale.payments)
      ? sale.payments.some(
          (payment) =>
            normalizeText(payment?.method) === ADDI_PAYMENT_METHOD &&
            normalizeMoney(payment?.amount) > 0
        )
      : false;
  });
}

/* -------------------------------------------------------------------------- */
/*                                ADDI                                         */
/* -------------------------------------------------------------------------- */

export async function settleAddiSale({
  saleId,
  settledAmount = null,
  settledAt = null,
  reference = "",
  notes = "",
  actor = null,
}) {
  const cleanSaleId = normalizeText(saleId);

  if (!cleanSaleId) {
    throw new Error("No se encontró la venta de Addi.");
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

    const addiPayment = Array.isArray(currentSale.payments)
      ? currentSale.payments.find(
          (payment) =>
            normalizeText(payment?.method) === ADDI_PAYMENT_METHOD &&
            normalizeMoney(payment?.amount) > 0
        )
      : null;

    const isAddiSale =
      currentSale.paymentMethod === ADDI_PAYMENT_METHOD || Boolean(addiPayment);

    if (!isAddiSale) {
      throw new Error("Esta venta no corresponde a un pago por Addi.");
    }

    if (currentSale.addiStatus === ADDI_STATUS_SETTLED) {
      throw new Error("Este desembolso de Addi ya fue confirmado.");
    }

    const expectedAmount = normalizeMoney(
      currentSale.addiExpectedAmount ||
        addiPayment?.amount ||
        currentSale.total
    );

    const finalSettledAmount =
      settledAmount === null ||
      settledAmount === undefined ||
      settledAmount === ""
        ? expectedAmount
        : normalizeMoney(settledAmount);

    if (finalSettledAmount <= 0) {
      throw new Error("El valor recibido de Addi debe ser mayor a cero.");
    }

    const explicitSettlementDate = normalizeSettlementDate(settledAt);

    transaction.update(saleRef, {
      paymentStatus: "paid",

      addiStatus: ADDI_STATUS_SETTLED,
      addiExpectedAmount: expectedAmount,
      addiSettledAmount: finalSettledAmount,
      addiSettledAt: explicitSettlementDate || serverTimestamp(),
      addiReference: normalizeText(reference),
      addiNotes: normalizeText(notes),

      addiSettledByUid: actor?.uid || "",
      addiSettledByName: actor?.name || "",
      addiSettledByEmail: actor?.email || "",

      updatedAt: serverTimestamp(),
    });

    return {
      saleId: cleanSaleId,
      saleNumber: currentSale.saleNumber,
      expectedAmount,
      settledAmount: finalSettledAmount,
      status: ADDI_STATUS_SETTLED,
    };
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

  const expectedCustomerId = cleanCustomerDocument
    ? getCustomerDocumentId(cleanCustomerDocument, storeId)
    : "";

  if (
    cleanCustomerDocument &&
    normalizeText(customerId) &&
    normalizeText(customerId) !== expectedCustomerId
  ) {
    throw new Error(
      "La cédula seleccionada no coincide con el cliente de la venta."
    );
  }

  const cleanSource = normalizeText(source) || DEFAULT_SOURCE;
  const requiresOpenCash = cleanSource === "pos";
  const businessDate = requiresOpenCash ? getBogotaBusinessDate() : "";
  const cashSessionId = requiresOpenCash
    ? getRequiredCashSessionId(storeId, seller?.uid, businessDate)
    : "";

  if (requiresOpenCash && !cashSessionId) {
    throw new Error(
      "No se pudo identificar la caja del vendedor. Vuelve a iniciar sesión e inténtalo nuevamente."
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

      if (
        normalizeText(cashSession.operatorUid) !==
        normalizeText(seller?.uid)
      ) {
        throw new Error("La caja abierta pertenece a otro operador.");
      }
    }

    let customerRef = null;
    let customerSnapshot = null;

    if (cleanCustomerDocument) {
      customerRef = doc(db, "customers", expectedCustomerId);
      customerSnapshot = await transaction.get(customerRef);
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

    let finalCustomerId = "";
    let finalCustomerName = cleanCustomerName;
    let finalCustomerDocument = cleanCustomerDocument;
    let finalCustomerPhone = cleanCustomerPhone;
    let finalCustomerEmail = cleanCustomerEmail;
    let shouldCreateCustomer = false;

    if (cleanCustomerDocument) {
      finalCustomerId = expectedCustomerId;

      if (customerSnapshot?.exists()) {
        const existingCustomer = customerSnapshot.data();

        if (existingCustomer.storeId !== storeId) {
          throw new Error("El cliente encontrado no pertenece a esta tienda.");
        }

        finalCustomerName =
          normalizeText(existingCustomer.fullName) || cleanCustomerName;
        finalCustomerPhone =
          normalizeCustomerPhone(existingCustomer.phone) || cleanCustomerPhone;
        finalCustomerEmail =
          normalizeText(existingCustomer.email) || cleanCustomerEmail;
      } else {
        if (!cleanCustomerName) {
          throw new Error(
            "Completa el nombre del cliente para registrar esta cédula."
          );
        }

        shouldCreateCustomer = true;
      }
    }

    const saleItems = [];

    let subtotal = 0;
    let totalCost = 0;
    let totalItems = 0;

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

    const finalAmountReceived =
      amountReceived === null ||
      amountReceived === undefined ||
      amountReceived === ""
        ? total
        : normalizeMoney(amountReceived);

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

    const isAddiPayment = cleanPaymentMethod === ADDI_PAYMENT_METHOD;
    const paymentStatus = isAddiPayment ? "pending_settlement" : "paid";
    const addiStatus = isAddiPayment ? ADDI_STATUS_PENDING : "";
    const addiExpectedAmount = isAddiPayment ? total : 0;
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
      amountReceived: finalAmountReceived,
      change,

      paymentStatus,
      addiStatus,
      addiExpectedAmount,
      addiSettledAmount: 0,
      addiSettledAt: null,
      addiReference: "",
      addiNotes: "",

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
      amountReceived: finalAmountReceived,
      change,

      paymentStatus,
      addiStatus,
      addiExpectedAmount,
      addiSettledAmount: 0,
      addiSettledAt: null,

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
    amountReceived,
    discount,

    notes,
    source: "direct",

    storeId,
    seller,
  });

  return result.id;
}
