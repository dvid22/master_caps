import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import {
  ADDI_PAYMENT_METHOD,
  SISTECREDITO_PAYMENT_METHOD,
  SETTLEMENT_STATUS_PENDING,
  SETTLEMENT_STATUS_SETTLED,
  getSales,
  isDeferredPaymentMethod,
} from "./sales.service";
import {
  getEffectiveProductPromotion,
} from "./products.service";
import {
  buildCashSessionSummary,
  getCashMovements,
} from "./cash.service";
import {
  getCustomerDocumentId,
  normalizeCustomerDocument,
  normalizeCustomerPhone,
} from "./customers.service";

const VALID_PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "nequi",
  "daviplata",
  "tarjeta",
  "addi",
  "sistecredito",
  "otro",
  "mixto",
];

function normalizeText(value) {
  return String(value || "").trim();
}

const CASH_TIME_ZONE = "America/Bogota";

function safeId(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getBogotaBusinessDate(value) {
  const date = toDate(value);
  if (!date) return "";

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

function inferCashSessionId(sale, storeId) {
  const explicitId = normalizeText(sale?.cashSessionId);
  if (explicitId) return explicitId;

  const businessDate = getBogotaBusinessDate(sale?.createdAt);

  if (!businessDate) return "";

  return `${safeId(storeId)}__${businessDate}`;
}

function normalizeMoney(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(number, 0);
}

function normalizePaymentBreakdown({
  payments,
  fallbackMethod = "efectivo",
  total = 0,
  amountReceived = null,
  allowDeferredMixed = false,
}) {
  const cleanTotal = normalizeMoney(total);
  const rawPayments = Array.isArray(payments) ? payments : [];

  let source = rawPayments
    .map((payment) => ({
      method: VALID_PAYMENT_METHODS.includes(normalizeText(payment?.method)) &&
        normalizeText(payment?.method) !== "mixto"
        ? normalizeText(payment.method)
        : "otro",
      amount: normalizeMoney(payment?.amount),
      receivedAmount:
        payment?.receivedAmount === null ||
        payment?.receivedAmount === undefined ||
        payment?.receivedAmount === ""
          ? normalizeMoney(payment?.amount)
          : normalizeMoney(payment.receivedAmount),
    }))
    .filter((payment) => payment.amount > 0);

  if (source.length === 0) {
    const method =
      VALID_PAYMENT_METHODS.includes(fallbackMethod) &&
      fallbackMethod !== "mixto"
        ? fallbackMethod
        : "otro";

    source = [
      {
        method,
        amount: cleanTotal,
        receivedAmount:
          method === "efectivo"
            ? amountReceived === null ||
              amountReceived === undefined ||
              amountReceived === ""
              ? cleanTotal
              : normalizeMoney(amountReceived)
            : cleanTotal,
      },
    ];
  }

  const grouped = new Map();

  source.forEach((payment) => {
    const current = grouped.get(payment.method) || {
      method: payment.method,
      amount: 0,
      receivedAmount: 0,
    };

    current.amount += payment.amount;
    current.receivedAmount +=
      payment.method === "efectivo"
        ? Math.max(payment.receivedAmount, payment.amount)
        : payment.amount;

    grouped.set(payment.method, current);
  });

  const normalized = Array.from(grouped.values());
  const allocatedTotal = normalized.reduce(
    (sum, payment) => sum + payment.amount,
    0
  );

  if (Math.abs(allocatedTotal - cleanTotal) > 0.001) {
    throw new Error(
      `La distribución de pagos debe sumar exactamente ${cleanTotal.toLocaleString("es-CO")}. Actualmente suma ${allocatedTotal.toLocaleString("es-CO")}.`
    );
  }

  const deferredPayments = normalized.filter((payment) =>
    isDeferredPaymentMethod(payment.method)
  );

  if (deferredPayments.length > 1) {
    throw new Error(
      "Una venta solo puede tener un proveedor de financiación: Addi o Sistecrédito."
    );
  }

  if (deferredPayments.length === 1 && normalized.length > 1 && !allowDeferredMixed) {
    throw new Error(
      "Addi y Sistecrédito deben registrarse como pago único en ventas directas. Las combinaciones con abonos previos solo se conservan para ventas originadas desde Apartados."
    );
  }

  normalized.forEach((payment) => {
    if (payment.method === "efectivo" && payment.receivedAmount < payment.amount) {
      throw new Error(
        "El efectivo recibido no puede ser menor al valor asignado a efectivo."
      );
    }
  });

  const change = normalized.reduce(
    (sum, payment) =>
      payment.method === "efectivo"
        ? sum + Math.max(payment.receivedAmount - payment.amount, 0)
        : sum,
    0
  );

  return {
    payments: normalized,
    paymentMethod:
      normalized.length === 1 ? normalized[0].method : "mixto",
    amountReceived: cleanTotal + change,
    change,
  };
}

function paymentSignatureFromSale(sale = {}) {
  const total = normalizeMoney(sale.total);
  const source = Array.isArray(sale.payments) && sale.payments.length > 0
    ? sale.payments
    : [
        {
          method: normalizeText(sale.paymentMethod) || "efectivo",
          amount: total,
        },
      ];

  return source
    .map((payment) => ({
      method: normalizeText(payment?.method) || "otro",
      amount: normalizeMoney(payment?.amount),
    }))
    .filter((payment) => payment.amount > 0)
    .sort((a, b) => a.method.localeCompare(b.method))
    .map((payment) => `${payment.method}:${payment.amount}`)
    .join("|");
}

function paymentSignatureFromBreakdown(payments = []) {
  return payments
    .map((payment) => ({
      method: normalizeText(payment?.method) || "otro",
      amount: normalizeMoney(payment?.amount),
    }))
    .filter((payment) => payment.amount > 0)
    .sort((a, b) => a.method.localeCompare(b.method))
    .map((payment) => `${payment.method}:${payment.amount}`)
    .join("|");
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
        ...variant,
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
  const normalizedVariants = variants.map((variant) => {
    const stock = normalizeQuantity(variant.stock);

    return {
      ...variant,
      id: normalizeText(variant.id),
      size: normalizeSize(variant.size),
      stock,
      ...(variant.printedLabels !== undefined
        ? {
            printedLabels: Math.min(
              normalizeQuantity(variant.printedLabels),
              stock
            ),
          }
        : {}),
    };
  });

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
        ...item,
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

function addPromotionStock(promotionVariants, variant, quantity) {
  const next = [...promotionVariants];
  const index = next.findIndex(
    (item) =>
      item.variantId === variant?.id ||
      normalizeSize(item.size) === normalizeSize(variant?.size)
  );

  if (index >= 0) {
    next[index] = {
      ...next[index],
      variantId: variant.id,
      size: variant.size,
      quantity:
        normalizeQuantity(next[index].quantity) +
        normalizeQuantity(quantity),
    };

    return next;
  }

  return [
    ...next,
    {
      variantId: variant.id,
      size: variant.size,
      quantity: normalizeQuantity(quantity),
    },
  ];
}

function subtractPromotionStock(
  promotionVariants,
  variant,
  quantity
) {
  return promotionVariants
    .map((item) => {
      const matches =
        item.variantId === variant?.id ||
        normalizeSize(item.size) === normalizeSize(variant?.size);

      if (!matches) {
        return item;
      }

      return {
        ...item,
        quantity: Math.max(
          normalizeQuantity(item.quantity) -
            normalizeQuantity(quantity),
          0
        ),
      };
    })
    .filter((item) => normalizeQuantity(item.quantity) > 0);
}

function findRequestedVariant(variants, item) {
  const requestedVariantId = normalizeText(item?.variantId);
  const requestedSize = normalizeText(
    item?.size || item?.productSize
  );

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
      (variant) =>
        normalizeSize(variant.size) === normalizedRequestedSize
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

function normalizeRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      "La venta debe conservar al menos un producto."
    );
  }

  const groupedItems = new Map();

  items.forEach((item, index) => {
    const isManual = Boolean(
      item?.isManual ||
        item?.manualItem ||
        item?.inventoryTracked === false
    );

    const quantity = normalizeQuantity(item?.quantity);

    if (quantity <= 0) {
      throw new Error(
        "La cantidad de cada producto debe ser mayor a cero."
      );
    }

    if (isManual) {
      const productName = normalizeText(
        item?.productName || item?.name
      );

      if (!productName) {
        throw new Error(
          "Uno de los productos rápidos no tiene nombre."
        );
      }

      const manualLineId =
        normalizeText(item?.manualLineId) ||
        normalizeText(item?.lineId) ||
        `manual-${index + 1}`;

      groupedItems.set(`manual__${manualLineId}`, {
        isManual: true,
        inventoryTracked: false,
        manualLineId,
        productId: "",
        productName,
        productCode: normalizeText(item?.productCode),
        variantId: "",
        size: normalizeSize(item?.size || "Talla única"),
        quantity,
        unitPrice: normalizeMoney(item?.unitPrice),
        costPrice: normalizeMoney(item?.costPrice),
        note: normalizeText(item?.note || item?.manualNote),
        isPromotion: false,
      });

      return;
    }

    const productId = normalizeText(item?.productId);
    const variantId = normalizeText(item?.variantId);
    const size = normalizeText(item?.size || item?.productSize);
    const isPromotion =
      Boolean(item?.isPromotion) ||
      normalizeText(item?.pricingMode) === "promotion";

    if (!productId) {
      throw new Error(
        "Uno de los productos de la venta no es válido."
      );
    }

    const variantKey =
      variantId || normalizeSize(size || "Talla única");

    const groupKey = `${productId}__${variantKey}__${
      isPromotion ? "promo" : "normal"
    }`;

    const current = groupedItems.get(groupKey);

    if (current) {
      groupedItems.set(groupKey, {
        ...current,
        quantity: current.quantity + quantity,
      });
      return;
    }

    groupedItems.set(groupKey, {
      isManual: false,
      inventoryTracked: true,
      productId,
      variantId,
      size,
      quantity,
      isPromotion,
    });
  });

  return Array.from(groupedItems.values());
}

function normalizeStoredItems(sale = {}) {
  if (Array.isArray(sale.items) && sale.items.length > 0) {
    return sale.items.map((item, index) => ({
      lineId: normalizeText(item?.lineId) || `line-${index + 1}`,
      isManual: Boolean(
        item?.isManual ||
          item?.inventoryTracked === false
      ),
      inventoryTracked:
        item?.inventoryTracked !== undefined
          ? Boolean(item.inventoryTracked)
          : !Boolean(item?.isManual),
      manualLineId:
        normalizeText(item?.manualLineId) ||
        normalizeText(item?.lineId) ||
        `line-${index + 1}`,
      manualNote: normalizeText(
        item?.manualNote || item?.note
      ),
      productId: normalizeText(item?.productId),
      productName: normalizeText(item?.productName),
      productCode: normalizeText(item?.productCode),
      variantId: normalizeText(item?.variantId),
      size: normalizeSize(item?.size || item?.productSize),
      categoryId: normalizeText(item?.categoryId),
      categoryName: normalizeText(item?.categoryName),
      imageUrl: normalizeText(item?.imageUrl || item?.coverImageUrl),
      quantity: normalizeQuantity(item?.quantity),
      unitPrice: normalizeMoney(item?.unitPrice),
      regularUnitPrice:
        item?.regularUnitPrice !== undefined
          ? normalizeMoney(item.regularUnitPrice)
          : normalizeMoney(item?.unitPrice),
      isPromotion: Boolean(item?.isPromotion),
      promotionPrice: normalizeMoney(item?.promotionPrice),
      promotionPercentage: normalizeMoney(item?.promotionPercentage),
      promotionSource: normalizeText(item?.promotionSource),
      promotionNote: normalizeText(item?.promotionNote),
      regularSubtotal:
        item?.regularSubtotal !== undefined
          ? normalizeMoney(item.regularSubtotal)
          : normalizeMoney(
              item?.regularUnitPrice !== undefined
                ? item.regularUnitPrice
                : item?.unitPrice
            ) * normalizeQuantity(item?.quantity),
      promotionDiscount:
        item?.promotionDiscount !== undefined
          ? normalizeMoney(item.promotionDiscount)
          : Math.max(
              (normalizeMoney(
                item?.regularUnitPrice !== undefined
                  ? item.regularUnitPrice
                  : item?.unitPrice
              ) - normalizeMoney(item?.unitPrice)) *
                normalizeQuantity(item?.quantity),
              0
            ),
      costPrice: normalizeMoney(item?.costPrice),
      subtotal:
        item?.subtotal !== undefined
          ? normalizeMoney(item.subtotal)
          : normalizeMoney(item?.unitPrice) *
            normalizeQuantity(item?.quantity),
      totalCost:
        item?.totalCost !== undefined
          ? normalizeMoney(item.totalCost)
          : normalizeMoney(item?.costPrice) *
            normalizeQuantity(item?.quantity),
      profit: Number(
        item?.profit ??
          (normalizeMoney(item?.unitPrice) -
            normalizeMoney(item?.costPrice)) *
            normalizeQuantity(item?.quantity)
      ),
    }));
  }

  if (!sale.productId) {
    return [];
  }

  return [
    {
      lineId: "line-1",
      isManual: Boolean(
        sale.isManual ||
          sale.inventoryTracked === false
      ),
      inventoryTracked:
        sale.inventoryTracked !== undefined
          ? Boolean(sale.inventoryTracked)
          : !Boolean(sale.isManual),
      manualLineId:
        normalizeText(sale.manualLineId) ||
        "line-1",
      manualNote: normalizeText(
        sale.manualNote || sale.note
      ),
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
      promotionPercentage: normalizeMoney(sale.promotionPercentage),
      promotionSource: normalizeText(sale.promotionSource),
      promotionNote: normalizeText(sale.promotionNote),
      regularSubtotal:
        sale.regularSubtotal !== undefined
          ? normalizeMoney(sale.regularSubtotal)
          : normalizeMoney(
              sale.regularUnitPrice !== undefined
                ? sale.regularUnitPrice
                : sale.unitPrice
            ) * normalizeQuantity(sale.quantity),
      promotionDiscount:
        sale.promotionDiscount !== undefined
          ? normalizeMoney(sale.promotionDiscount)
          : Math.max(
              (normalizeMoney(
                sale.regularUnitPrice !== undefined
                  ? sale.regularUnitPrice
                  : sale.unitPrice
              ) - normalizeMoney(sale.unitPrice)) *
                normalizeQuantity(sale.quantity),
              0
            ),
      costPrice: normalizeMoney(sale.costPrice),
      subtotal: normalizeMoney(sale.total),
      totalCost: normalizeMoney(sale.totalCost),
      profit: Number(sale.profit || 0),
    },
  ];
}

function getLineKey(item, resolvedVariant = null) {
  const productId = normalizeText(item?.productId);
  const variantKey =
    normalizeText(resolvedVariant?.id) ||
    normalizeText(item?.variantId) ||
    normalizeSize(item?.size || item?.productSize);

  return `${productId}__${variantKey}__${
    item?.isPromotion ? "promo" : "normal"
  }`;
}

function getCurrentSaleTotal(sale = {}) {
  if (sale.total !== undefined) {
    return normalizeMoney(sale.total);
  }

  const items = normalizeStoredItems(sale);
  const subtotal = items.reduce(
    (total, item) => total + normalizeMoney(item.subtotal),
    0
  );

  return Math.max(
    subtotal - normalizeMoney(sale.discount),
    0
  );
}

function getDeferredProviderFromSale(sale = {}) {
  const explicit = normalizeText(sale.settlementProvider);

  if (isDeferredPaymentMethod(explicit)) return explicit;

  const direct = normalizeText(sale.paymentMethod);

  if (isDeferredPaymentMethod(direct)) return direct;

  const payment = Array.isArray(sale.payments)
    ? sale.payments.find((item) => isDeferredPaymentMethod(item?.method))
    : null;

  return normalizeText(payment?.method);
}

function getSettlementStatusFromSale(sale = {}, provider = "") {
  const explicit = normalizeText(sale.settlementStatus);
  if (explicit) return explicit;

  if (provider === ADDI_PAYMENT_METHOD) {
    return normalizeText(sale.addiStatus);
  }

  if (provider === SISTECREDITO_PAYMENT_METHOD) {
    return normalizeText(sale.sistecreditoStatus);
  }

  return "";
}

function getDeferredPaymentFromBreakdown(payments = []) {
  return payments.find((payment) =>
    isDeferredPaymentMethod(payment?.method)
  ) || null;
}

function getDeferredProviderLabel(provider) {
  if (provider === ADDI_PAYMENT_METHOD) return "Addi";
  if (provider === SISTECREDITO_PAYMENT_METHOD) return "Sistecrédito";
  return "la financiación";
}

/**
 * Edita una venta SIN borrarla.
 *
 * La operación es atómica:
 * 1. Lee la venta actual.
 * 2. Devuelve al inventario lo que esa venta había descontado.
 * 3. Valida y descuenta la nueva composición.
 * 4. Recalcula totales.
 * 5. Actualiza la venta y registra quién hizo la modificación.
 *
 * Si cualquier validación falla, Firestore revierte toda la transacción.
 */
export async function updateSale({
  saleId,
  items,

  customerId = "",
  customerName = "",
  customerDocument = "",
  customerPhone = "",
  customerEmail = "",

  paymentMethod = "efectivo",
  payments = null,
  discount = 0,
  amountReceived = null,

  notes = "",
  storeId = STORE_ID,
  actor = null,
}) {
  const cleanSaleId = normalizeText(saleId);

  if (!cleanSaleId) {
    throw new Error("No se encontró la venta a editar.");
  }

  const requestedItems = normalizeRequestedItems(items);

  const requestedPaymentMethod = VALID_PAYMENT_METHODS.includes(
    paymentMethod
  )
    ? paymentMethod
    : "otro";

  const cleanDiscount = normalizeMoney(discount);

  const cleanCustomerDocument = normalizeCustomerDocument(
    customerDocument
  );
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

  const saleRef = doc(db, "sales", cleanSaleId);

  return runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef);

    if (!saleSnapshot.exists()) {
      throw new Error("La venta ya no existe.");
    }

    const currentSale = {
      id: saleSnapshot.id,
      ...saleSnapshot.data(),
    };

    const currentStoreId =
      normalizeText(currentSale.storeId) || storeId;

    if (currentStoreId !== storeId) {
      throw new Error(
        "La venta no pertenece a la tienda actual."
      );
    }

    /*
     * Las ventas nuevas pueden guardar cashSessionId explícitamente.
     * Para ventas anteriores a Caja, la sesión se puede reconstruir sin
     * migraciones usando tienda + vendedor + fecha de la venta.
     */
    let linkedCashSession = null;
    const linkedCashSessionId = inferCashSessionId(
      currentSale,
      currentStoreId
    );

    if (linkedCashSessionId) {
      const cashSessionRef = doc(
        db,
        "cashSessions",
        linkedCashSessionId
      );
      const cashSessionSnapshot = await transaction.get(cashSessionRef);

      if (cashSessionSnapshot.exists()) {
        linkedCashSession = {
          id: cashSessionSnapshot.id,
          ...cashSessionSnapshot.data(),
        };
      }
    }

    const currentDeferredProvider = getDeferredProviderFromSale(currentSale);
    const currentSettlementStatus = getSettlementStatusFromSale(
      currentSale,
      currentDeferredProvider
    );
    const currentIsPendingDeferred =
      Boolean(currentDeferredProvider) &&
      currentSettlementStatus !== SETTLEMENT_STATUS_SETTLED;
    const currentWasSettledDeferred =
      Boolean(currentDeferredProvider) &&
      currentSettlementStatus === SETTLEMENT_STATUS_SETTLED;

    const todayBusinessDate = getBogotaBusinessDate(new Date());
    const todayCashSessionId = todayBusinessDate
      ? `${safeId(storeId)}__${todayBusinessDate}`
      : "";
    const todayCashSessionRef = todayCashSessionId
      ? doc(db, "cashSessions", todayCashSessionId)
      : null;
    let todayCashSession = null;

    if (todayCashSessionRef) {
      const todayCashSnapshot = await transaction.get(todayCashSessionRef);

      if (todayCashSnapshot.exists()) {
        todayCashSession = {
          id: todayCashSnapshot.id,
          ...todayCashSnapshot.data(),
        };
      }
    }

    const oldItems = normalizeStoredItems(currentSale);

    if (oldItems.length === 0) {
      throw new Error(
        "La venta actual no contiene productos válidos para reconstruir el inventario."
      );
    }

    let customerRef = null;
    let customerSnapshot = null;

    if (cleanCustomerDocument) {
      customerRef = doc(
        db,
        "customers",
        expectedCustomerId
      );

      customerSnapshot = await transaction.get(
        customerRef
      );
    }

    const affectedProductIds = new Set([
      ...oldItems
        .filter((item) => !item.isManual)
        .map((item) => item.productId),
      ...requestedItems
        .filter((item) => !item.isManual)
        .map((item) => item.productId),
    ]);

    const productEntries = new Map();

    for (const productId of affectedProductIds) {
      if (!productId) {
        continue;
      }

      const productRef = doc(db, "products", productId);
      const productSnapshot = await transaction.get(
        productRef
      );

      if (!productSnapshot.exists()) {
        throw new Error(
          "Uno de los productos de la venta ya no existe. No se puede editar esta venta hasta corregir ese producto."
        );
      }

      const product = productSnapshot.data();

      if (
        normalizeText(product.storeId) &&
        normalizeText(product.storeId) !== storeId
      ) {
        throw new Error(
          `El producto "${product.name || productId}" no pertenece a esta tienda.`
        );
      }

      const variants = normalizeProductVariants(
        productId,
        product
      );

      productEntries.set(productId, {
        ref: productRef,
        product,
        variants,
        promotionVariants: normalizePromotionVariants(
          product,
          variants
        ),
      });
    }

    /*
     * PASO 1: devolver al inventario todo lo que descontó la venta original.
     */
    for (const oldItem of oldItems) {
      if (oldItem.isManual) {
        continue;
      }

      const entry = productEntries.get(oldItem.productId);

      if (!entry) {
        throw new Error(
          "No se pudo reconstruir el inventario de la venta original."
        );
      }

      const variant = findRequestedVariant(
        entry.variants,
        oldItem
      );

      if (!variant) {
        throw new Error(
          `La talla "${oldItem.size}" de "${oldItem.productName || "un producto"}" ya no existe.`
        );
      }

      const previousStock =
        normalizeQuantity(variant.stock);
      const previousPrinted =
        variant.printedLabels !== undefined
          ? normalizeQuantity(
              variant.printedLabels
            )
          : null;
      const wasFullyPrinted =
        previousPrinted !== null &&
        previousStock > 0 &&
        previousPrinted >= previousStock;
      const restoredQuantity =
        normalizeQuantity(oldItem.quantity);

      variant.stock =
        previousStock + restoredQuantity;

      if (
        previousPrinted !== null &&
        wasFullyPrinted
      ) {
        variant.printedLabels =
          Math.min(
            previousPrinted +
              restoredQuantity,
            variant.stock
          );
      }

    }

    const oldLineByKey = new Map();

    oldItems.forEach((item) => {
      if (item.isManual) {
        oldLineByKey.set(
          `manual__${item.manualLineId || item.lineId}`,
          item
        );
        return;
      }

      const entry = productEntries.get(item.productId);
      const variant = entry
        ? findRequestedVariant(entry.variants, item)
        : null;

      oldLineByKey.set(
        getLineKey(item, variant),
        item
      );
    });

    /*
     * PASO 2: construir y descontar la nueva composición.
     *
     * Desde la migración de promociones por producto ya no existe una bolsa
     * separada de stock promocional. El stock físico es único.
     *
     * - Las líneas que ya existían conservan SIEMPRE su precio histórico.
     * - Las líneas nuevas toman automáticamente la promoción vigente del producto.
     * - Cambiar o retirar hoy una promoción nunca altera una venta histórica.
     */
    const newSaleItems = [];

    let regularSubtotal = 0;
    let promotionDiscount = 0;
    let promotionUnits = 0;
    let promotionLineCount = 0;

    let subtotal = 0;
    let totalCost = 0;
    let totalItems = 0;

    for (const requestedItem of requestedItems) {
      if (requestedItem.isManual) {
        const historicalLine = oldLineByKey.get(
          `manual__${requestedItem.manualLineId}`
        );

        const unitPrice = historicalLine
          ? normalizeMoney(historicalLine.unitPrice)
          : normalizeMoney(requestedItem.unitPrice);

        const costPrice = historicalLine
          ? normalizeMoney(historicalLine.costPrice)
          : normalizeMoney(requestedItem.costPrice);

        if (unitPrice <= 0) {
          throw new Error(
            `El producto rápido "${requestedItem.productName}" debe tener un precio de venta válido.`
          );
        }

        const quantity = normalizeQuantity(
          requestedItem.quantity
        );
        const lineSubtotal = unitPrice * quantity;
        const lineTotalCost = costPrice * quantity;

        regularSubtotal += lineSubtotal;
        subtotal += lineSubtotal;
        totalCost += lineTotalCost;
        totalItems += quantity;

        newSaleItems.push({
          lineId:
            historicalLine?.lineId ||
            requestedItem.manualLineId ||
            `line-${newSaleItems.length + 1}`,

          isManual: true,
          inventoryTracked: false,
          manualLineId:
            requestedItem.manualLineId ||
            historicalLine?.manualLineId ||
            historicalLine?.lineId ||
            `manual-${newSaleItems.length + 1}`,

          productId: "",
          productName:
            historicalLine?.productName ||
            requestedItem.productName,
          productCode:
            historicalLine?.productCode ||
            requestedItem.productCode ||
            "",

          variantId: "",
          size:
            historicalLine?.size ||
            requestedItem.size ||
            "Talla única",

          categoryId: "",
          categoryName: "Venta rápida",
          imageUrl: "",

          quantity,
          unitPrice,
          regularUnitPrice: unitPrice,
          isPromotion: false,
          promotionPrice: 0,
          promotionPercentage: 0,
          promotionSource: "",
          promotionNote: "",

          regularSubtotal: lineSubtotal,
          promotionDiscount: 0,

          costPrice,
          subtotal: lineSubtotal,
          totalCost: lineTotalCost,
          profit: lineSubtotal - lineTotalCost,

          manualNote:
            requestedItem.note ||
            historicalLine?.manualNote ||
            "",
        });

        continue;
      }

      const entry = productEntries.get(
        requestedItem.productId
      );

      if (!entry) {
        throw new Error(
          "Uno de los productos seleccionados no existe."
        );
      }

      const variant = findRequestedVariant(
        entry.variants,
        requestedItem
      );

      if (!variant) {
        throw new Error(
          `Selecciona una talla válida para "${entry.product.name || "el producto"}".`
        );
      }

      const quantity = normalizeQuantity(
        requestedItem.quantity
      );
      const physicalStock = normalizeQuantity(
        variant.stock
      );

      if (quantity > physicalStock) {
        throw new Error(
          `Solo hay ${physicalStock} unidad(es) disponibles de "${entry.product.name || "el producto"}" talla ${variant.size}.`
        );
      }

      const historicalLine = oldLineByKey.get(
        getLineKey(requestedItem, variant)
      );

      const priceHistoryLine =
        historicalLine || null;

      const effectivePromotion =
        getEffectiveProductPromotion(
          entry.product
        );

      /*
       * Si la misma referencia/talla ya formaba parte de la venta, la
       * corrección conserva el precio que quedó congelado en esa operación.
       * Solo una línea completamente nueva usa el precio/promoción de hoy.
       */
      const linePromotionActive = priceHistoryLine
        ? Boolean(priceHistoryLine.isPromotion)
        : Boolean(effectivePromotion.active);

      const regularUnitPrice = priceHistoryLine
        ? normalizeMoney(
            priceHistoryLine.regularUnitPrice ||
              priceHistoryLine.unitPrice
          )
        : normalizeMoney(
            effectivePromotion.regularPrice ??
              entry.product.salePrice
          );

      const promotionPrice = linePromotionActive
        ? priceHistoryLine
          ? normalizeMoney(
              priceHistoryLine.promotionPrice ||
                priceHistoryLine.unitPrice
            )
          : normalizeMoney(
              effectivePromotion.price
            )
        : 0;

      const promotionPercentage =
        linePromotionActive
          ? priceHistoryLine
            ? normalizeMoney(
                priceHistoryLine.promotionPercentage
              ) ||
              (
                regularUnitPrice > 0
                  ? Math.round(
                      (1 -
                        normalizeMoney(
                          priceHistoryLine.unitPrice
                        ) /
                          regularUnitPrice) *
                        10000
                    ) / 100
                  : 0
              )
            : normalizeMoney(
                effectivePromotion.percentage
              )
          : 0;

      const promotionSource =
        linePromotionActive
          ? priceHistoryLine
            ? normalizeText(
                priceHistoryLine.promotionSource
              ) || "historical"
            : normalizeText(
                effectivePromotion.source
              )
          : "";

      const promotionNote =
        linePromotionActive
          ? priceHistoryLine
            ? normalizeText(
                priceHistoryLine.promotionNote
              )
            : normalizeText(
                effectivePromotion.note
              )
          : "";

      const unitPrice = linePromotionActive
        ? promotionPrice
        : regularUnitPrice;

      const costPrice = priceHistoryLine
        ? normalizeMoney(
            priceHistoryLine.costPrice
          )
        : normalizeMoney(
            entry.product.costPrice
          );

      variant.stock =
        physicalStock - quantity;

      const lineRegularSubtotal =
        regularUnitPrice * quantity;
      const lineSubtotal =
        unitPrice * quantity;
      const linePromotionDiscount =
        Math.max(
          lineRegularSubtotal - lineSubtotal,
          0
        );
      const lineTotalCost =
        costPrice * quantity;
      const lineProfit =
        lineSubtotal - lineTotalCost;

      regularSubtotal += lineRegularSubtotal;
      promotionDiscount += linePromotionDiscount;

      if (linePromotionActive) {
        promotionUnits += quantity;
        promotionLineCount += 1;
      }

      subtotal += lineSubtotal;
      totalCost += lineTotalCost;
      totalItems += quantity;

      newSaleItems.push({
        lineId:
          priceHistoryLine?.lineId ||
          `line-${newSaleItems.length + 1}`,

        isManual: false,
        inventoryTracked: true,

        productId: requestedItem.productId,
        productName: normalizeText(
          entry.product.name
        ),
        productCode: normalizeText(
          entry.product.code
        ),

        variantId: variant.id,
        size: variant.size,

        categoryId: normalizeText(
          entry.product.categoryId
        ),
        categoryName: normalizeText(
          entry.product.categoryName
        ),

        imageUrl: normalizeText(
          entry.product.coverImageUrl ||
            entry.product.imageUrl
        ),

        quantity,

        unitPrice,
        regularUnitPrice,
        isPromotion: linePromotionActive,
        promotionPrice,
        promotionPercentage,
        promotionSource,
        promotionNote,

        regularSubtotal: lineRegularSubtotal,
        promotionDiscount:
          linePromotionDiscount,

        costPrice,

        subtotal: lineSubtotal,
        totalCost: lineTotalCost,
        profit: lineProfit,
      });
    }

    if (cleanDiscount > subtotal) {
      throw new Error(
        "El descuento no puede ser mayor al subtotal de la venta."
      );
    }

    const promotionSubtotal = subtotal;
    const manualDiscount = cleanDiscount;
    const totalDiscount =
      promotionDiscount + manualDiscount;
    const hasPromotion =
      promotionDiscount > 0 || promotionUnits > 0;

    const total = Math.max(
      subtotal - manualDiscount,
      0
    );

    const currentPayments = Array.isArray(currentSale.payments) && currentSale.payments.length > 0
      ? currentSale.payments
      : [
          {
            method: normalizeText(currentSale.paymentMethod) || "efectivo",
            amount: getCurrentSaleTotal(currentSale),
          },
        ];
    const currentHasDeferredMixed =
      currentPayments.length > 1 &&
      currentPayments.some((payment) =>
        isDeferredPaymentMethod(payment?.method)
      );

    const paymentBreakdown = normalizePaymentBreakdown({
      payments,
      fallbackMethod: requestedPaymentMethod,
      total,
      amountReceived,
      allowDeferredMixed: currentHasDeferredMixed,
    });

    const cleanPaymentMethod = paymentBreakdown.paymentMethod;
    const finalPayments = paymentBreakdown.payments;
    const finalAmountReceived = paymentBreakdown.amountReceived;
    const change = paymentBreakdown.change;
    const cashAmount = finalPayments.reduce(
      (sum, payment) =>
        payment.method === "efectivo"
          ? sum + normalizeMoney(payment.amount)
          : sum,
      0
    );

    const totalChanged =
      Math.abs(normalizeMoney(currentSale.total) - total) > 0.001;
    const paymentsChanged =
      paymentSignatureFromSale(currentSale) !==
      paymentSignatureFromBreakdown(finalPayments);

    if (
      linkedCashSession?.status === "closed" &&
      !currentIsPendingDeferred &&
      (totalChanged || paymentsChanged)
    ) {
      throw new Error(
        "Esta venta pertenece a una caja ya cerrada. Para proteger el cierre, no puedes cambiar su total ni la distribución del pago; registra después un movimiento de caja si el dinero cambió de lugar."
      );
    }

    if (currentHasDeferredMixed && paymentsChanged) {
      throw new Error(
        "Esta venta conserva abonos previos y una financiación de Apartados. Su distribución histórica de pagos no se puede modificar."
      );
    }

    if (currentWasSettledDeferred && (totalChanged || paymentsChanged)) {
      throw new Error(
        `El desembolso de ${getDeferredProviderLabel(
          currentDeferredProvider
        )} ya fue conciliado. Para proteger la contabilidad, la venta debe conservar exactamente el mismo total y la misma distribución de pagos.`
      );
    }

    /*
     * Cliente de la venta.
     * Si la cédula existe, usamos el registro real.
     * Si no existe, se crea igual que en el POS.
     */
    let finalCustomerId = "";
    let finalCustomerName =
      cleanCustomerName;
    let finalCustomerDocument =
      cleanCustomerDocument;
    let finalCustomerPhone =
      cleanCustomerPhone;
    let finalCustomerEmail =
      cleanCustomerEmail;
    let shouldCreateCustomer = false;

    if (cleanCustomerDocument) {
      finalCustomerId =
        expectedCustomerId;

      if (customerSnapshot?.exists()) {
        const existingCustomer =
          customerSnapshot.data();

        if (
          normalizeText(
            existingCustomer.storeId
          ) !== storeId
        ) {
          throw new Error(
            "El cliente encontrado no pertenece a esta tienda."
          );
        }

        finalCustomerName =
          normalizeText(
            existingCustomer.fullName
          ) || cleanCustomerName;

        finalCustomerPhone =
          normalizeCustomerPhone(
            existingCustomer.phone
          ) || cleanCustomerPhone;

        finalCustomerEmail =
          normalizeText(
            existingCustomer.email
          ) || cleanCustomerEmail;
      } else {
        if (!cleanCustomerName) {
          throw new Error(
            "Escribe el nombre del cliente para registrar esta nueva cédula."
          );
        }

        shouldCreateCustomer = true;
      }
    }

    const nextDeferredPayment = getDeferredPaymentFromBreakdown(finalPayments);
    const nextDeferredProvider = normalizeText(nextDeferredPayment?.method);
    const nextIsDeferred = isDeferredPaymentMethod(nextDeferredProvider);
    const nextDeferredExpectedAmount = nextIsDeferred
      ? normalizeMoney(nextDeferredPayment.amount)
      : 0;

    if (hasPromotion && nextIsDeferred) {
      throw new Error(
        "Las promociones no pueden financiarse con Addi ni Sistecrédito. Selecciona un método de pago inmediato."
      );
    }

    let paymentStatus = "paid";
    let settlementProvider = "";
    let settlementStatus = "";
    let settlementExpectedAmount = 0;
    let settlementSettledAmount = 0;
    let settlementSettledAt = null;
    let settlementReference = "";
    let settlementNotes = "";
    let settlementSettledByUid = "";
    let settlementSettledByName = "";
    let settlementSettledByEmail = "";
    let settlementCashSessionId = "";
    let settlementDestination = "";

    let recognizedAt = currentSale.recognizedAt || null;
    let recognizedBusinessDate = normalizeText(
      currentSale.recognizedBusinessDate
    );
    let finalCashSessionId = normalizeText(currentSale.cashSessionId);

    if (currentWasSettledDeferred) {
      paymentStatus = "paid";
      settlementProvider = currentDeferredProvider;
      settlementStatus = SETTLEMENT_STATUS_SETTLED;
      settlementExpectedAmount = normalizeMoney(
        currentSale.settlementExpectedAmount ||
          nextDeferredExpectedAmount ||
          currentSale.total
      );
      settlementSettledAmount = normalizeMoney(
        currentSale.settlementSettledAmount ||
          (currentDeferredProvider === ADDI_PAYMENT_METHOD
            ? currentSale.addiSettledAmount
            : currentSale.sistecreditoSettledAmount) ||
          settlementExpectedAmount
      );
      settlementSettledAt =
        currentSale.settlementSettledAt ||
        (currentDeferredProvider === ADDI_PAYMENT_METHOD
          ? currentSale.addiSettledAt
          : currentSale.sistecreditoSettledAt) ||
        null;
      settlementReference = normalizeText(
        currentSale.settlementReference ||
          (currentDeferredProvider === ADDI_PAYMENT_METHOD
            ? currentSale.addiReference
            : currentSale.sistecreditoReference)
      );
      settlementNotes = normalizeText(
        currentSale.settlementNotes ||
          (currentDeferredProvider === ADDI_PAYMENT_METHOD
            ? currentSale.addiNotes
            : currentSale.sistecreditoNotes)
      );
      settlementSettledByUid = normalizeText(
        currentSale.settlementSettledByUid ||
          (currentDeferredProvider === ADDI_PAYMENT_METHOD
            ? currentSale.addiSettledByUid
            : currentSale.sistecreditoSettledByUid)
      );
      settlementSettledByName = normalizeText(
        currentSale.settlementSettledByName ||
          (currentDeferredProvider === ADDI_PAYMENT_METHOD
            ? currentSale.addiSettledByName
            : currentSale.sistecreditoSettledByName)
      );
      settlementSettledByEmail = normalizeText(
        currentSale.settlementSettledByEmail ||
          (currentDeferredProvider === ADDI_PAYMENT_METHOD
            ? currentSale.addiSettledByEmail
            : currentSale.sistecreditoSettledByEmail)
      );
      settlementCashSessionId = normalizeText(
        currentSale.settlementCashSessionId
      );
      settlementDestination =
        normalizeText(currentSale.settlementDestination) || "transferencia";
      recognizedAt =
        currentSale.recognizedAt || settlementSettledAt || null;
      recognizedBusinessDate =
        normalizeText(currentSale.recognizedBusinessDate) ||
        getBogotaBusinessDate(recognizedAt);
    } else if (nextIsDeferred) {
      paymentStatus = "pending_settlement";
      settlementProvider = nextDeferredProvider;
      settlementStatus = SETTLEMENT_STATUS_PENDING;
      settlementExpectedAmount = nextDeferredExpectedAmount;
      settlementDestination = "transferencia";
      recognizedAt = null;
      recognizedBusinessDate = "";
    } else if (currentIsPendingDeferred) {
      if (
        !todayCashSession ||
        todayCashSession.status !== "open" ||
        todayCashSession.businessDate !== todayBusinessDate
      ) {
        throw new Error(
          "Para cambiar una financiación pendiente a un método ya pagado debes tener abierta la caja de hoy. El ingreso se reconocerá en la fecha de esta corrección."
        );
      }

      paymentStatus = "paid";
      recognizedAt = serverTimestamp();
      recognizedBusinessDate = todayBusinessDate;
      finalCashSessionId = todayCashSessionId;
    } else {
      paymentStatus = "paid";
      recognizedAt = currentSale.recognizedAt || currentSale.createdAt || null;
      recognizedBusinessDate =
        normalizeText(currentSale.recognizedBusinessDate) ||
        getBogotaBusinessDate(recognizedAt);
    }

    const addiStatus =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementStatus
        : "";
    const addiExpectedAmount =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementExpectedAmount
        : 0;
    const addiSettledAmount =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementSettledAmount
        : 0;
    const addiSettledAt =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementSettledAt
        : null;
    const addiReference =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementReference
        : "";
    const addiNotes =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementNotes
        : "";
    const addiSettledByUid =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementSettledByUid
        : "";
    const addiSettledByName =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementSettledByName
        : "";
    const addiSettledByEmail =
      settlementProvider === ADDI_PAYMENT_METHOD
        ? settlementSettledByEmail
        : "";

    const sistecreditoStatus =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementStatus
        : "";
    const sistecreditoExpectedAmount =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementExpectedAmount
        : 0;
    const sistecreditoSettledAmount =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementSettledAmount
        : 0;
    const sistecreditoSettledAt =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementSettledAt
        : null;
    const sistecreditoReference =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementReference
        : "";
    const sistecreditoNotes =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementNotes
        : "";
    const sistecreditoSettledByUid =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementSettledByUid
        : "";
    const sistecreditoSettledByName =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementSettledByName
        : "";
    const sistecreditoSettledByEmail =
      settlementProvider === SISTECREDITO_PAYMENT_METHOD
        ? settlementSettledByEmail
        : "";

    const profit = total - totalCost;

    /*
     * Ya se hicieron TODAS las lecturas.
     * Desde aquí únicamente hay escrituras.
     */
    for (const entry of productEntries.values()) {
      const variantPayload =
        buildProductVariantPayload(
          entry.variants
        );

      const currentPromotion =
        getEffectiveProductPromotion(
          entry.product
        );

      transaction.update(entry.ref, {
        ...variantPayload,

        // La promoción ya no maneja una bolsa separada de inventario.
        promotionVariants: [],
        promotionStock:
          currentPromotion.active
            ? variantPayload.totalStock
            : 0,

        updatedByUid:
          actor?.uid || "",
        updatedByName:
          actor?.name || "",
        updatedByEmail:
          actor?.email || "",

        updatedAt:
          serverTimestamp(),
      });
    }

    if (
      shouldCreateCustomer &&
      customerRef
    ) {
      transaction.set(customerRef, {
        storeId,

        documentNumber:
          finalCustomerDocument,
        normalizedDocument:
          finalCustomerDocument,

        firstName: "",
        lastName: "",
        fullName:
          finalCustomerName,

        phone:
          finalCustomerPhone,
        email:
          finalCustomerEmail,
        address: "",
        notes: "",

        isActive: true,

        createdByUid:
          actor?.uid || "",
        createdByName:
          actor?.name || "",
        createdByEmail:
          actor?.email || "",

        updatedByUid:
          actor?.uid || "",
        updatedByName:
          actor?.name || "",
        updatedByEmail:
          actor?.email || "",

        createdAt:
          serverTimestamp(),
        updatedAt:
          serverTimestamp(),
      });
    }

    transaction.update(saleRef, {
      items: newSaleItems,
      totalItems,
      uniqueItems:
        newSaleItems.length,

      regularSubtotal,
      promotionDiscount,
      promotionSubtotal,
      manualDiscount,
      totalDiscount,
      hasPromotion,
      promotionUnits,
      promotionLineCount,

      subtotal,
      discount:
        manualDiscount,
      total,

      totalCost,
      profit,

      customerId:
        finalCustomerId,
      customerName:
        finalCustomerName,
      customerDocument:
        finalCustomerDocument,
      customerPhone:
        finalCustomerPhone,
      customerEmail:
        finalCustomerEmail,

      paymentMethod:
        cleanPaymentMethod,
      payments:
        finalPayments,
      cashAmount,
      amountReceived:
        finalAmountReceived,
      change,

      paymentStatus,

      settlementProvider,
      settlementStatus,
      settlementExpectedAmount,
      settlementSettledAmount,
      settlementSettledAt,
      settlementReference,
      settlementNotes,
      settlementSettledByUid,
      settlementSettledByName,
      settlementSettledByEmail,
      settlementCashSessionId,
      settlementDestination,

      recognizedAt,
      recognizedBusinessDate,
      cashSessionId: finalCashSessionId,

      addiStatus,
      addiExpectedAmount,
      addiSettledAmount,
      addiSettledAt,
      addiReference,
      addiNotes,
      addiSettledByUid,
      addiSettledByName,
      addiSettledByEmail,

      sistecreditoStatus,
      sistecreditoExpectedAmount,
      sistecreditoSettledAmount,
      sistecreditoSettledAt,
      sistecreditoReference,
      sistecreditoNotes,
      sistecreditoSettledByUid,
      sistecreditoSettledByName,
      sistecreditoSettledByEmail,

      notes:
        normalizeText(notes),

      editCount:
        normalizeQuantity(
          currentSale.editCount
        ) + 1,

      lastEditedByUid:
        actor?.uid || "",
      lastEditedByName:
        actor?.name || "",
      lastEditedByEmail:
        actor?.email || "",
      lastEditedAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp(),
    });

    return {
      id: cleanSaleId,
      saleNumber:
        normalizeText(
          currentSale.saleNumber
        ),

      items: newSaleItems,
      totalItems,
      uniqueItems:
        newSaleItems.length,

      regularSubtotal,
      promotionDiscount,
      promotionSubtotal,
      manualDiscount,
      totalDiscount,
      hasPromotion,
      promotionUnits,
      promotionLineCount,

      subtotal,
      discount:
        manualDiscount,
      total,
      totalCost,
      profit,

      customerId:
        finalCustomerId,
      customerName:
        finalCustomerName,
      customerDocument:
        finalCustomerDocument,
      customerPhone:
        finalCustomerPhone,
      customerEmail:
        finalCustomerEmail,

      paymentMethod:
        cleanPaymentMethod,
      payments:
        finalPayments,
      cashAmount,
      amountReceived:
        finalAmountReceived,
      change,

      paymentStatus,
      settlementProvider,
      settlementStatus,
      settlementExpectedAmount,
      settlementSettledAmount,
      settlementSettledAt,
      recognizedAt,
      recognizedBusinessDate,
      cashSessionId: finalCashSessionId,

      notes:
        normalizeText(notes),

      sellerUid:
        normalizeText(
          currentSale.sellerUid
        ),
      sellerName:
        normalizeText(
          currentSale.sellerName
        ),
      sellerEmail:
        normalizeText(
          currentSale.sellerEmail
        ),

      lastEditedByUid:
        actor?.uid || "",
      lastEditedByName:
        actor?.name || "",
      lastEditedByEmail:
        actor?.email || "",
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                    ELIMINAR / REVERSAR VENTA COMPLETA                      */
/* -------------------------------------------------------------------------- */

function getSaleReservationGroupId(sale = {}) {
  return normalizeText(
    sale.reservationGroupId ||
      sale.reservationId ||
      ""
  );
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function buildClosedCashSnapshotPayload(
  session,
  summary,
  actor = null,
  saleNumber = ""
) {
  const countedCash =
    session?.countedCash === null ||
    session?.countedCash === undefined
      ? null
      : normalizeMoney(session.countedCash);

  const difference =
    countedCash === null
      ? null
      : countedCash -
        normalizeMoney(summary.expectedCash);

  return {
    expectedCash: normalizeMoney(summary.expectedCash),
    difference,

    closingTotalSales: normalizeMoney(summary.totalSales),
    closingSaleCount: normalizeQuantity(summary.saleCount),
    closingBalances: summary.balances,
    closingSalesByMethod: summary.salesByMethod,
    closingPendingByProvider: summary.pendingByProvider,
    closingSettledByProvider: summary.settledByProvider,
    closingSettledReceivedByProvider:
      summary.settledReceivedByProvider,

    closingRegularSalesTotal:
      normalizeMoney(summary.regularSalesTotal),
    closingPromotionDiscountTotal:
      normalizeMoney(summary.promotionDiscountTotal),
    closingManualDiscountTotal:
      normalizeMoney(summary.manualDiscountTotal),
    closingTotalDiscountTotal:
      normalizeMoney(summary.totalDiscountTotal),
    closingPromotionSaleCount:
      normalizeQuantity(summary.promotionSaleCount),
    closingPromotionUnits:
      normalizeQuantity(summary.promotionUnits),

    closingPendingAddi:
      normalizeMoney(summary.pendingAddi),
    closingPendingSistecredito:
      normalizeMoney(summary.pendingSistecredito),

    lastCorrectionType: "sale_deleted",
    lastCorrectedSaleNumber:
      normalizeText(saleNumber),
    lastCorrectedByUid: actor?.uid || "",
    lastCorrectedByName: actor?.name || "",
    lastCorrectedByEmail: actor?.email || "",
    lastCorrectedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Elimina una venta como operación comercial, pero deja una auditoría interna.
 *
 * Reversa en una sola operación:
 * - inventario por variante,
 * - documento de venta,
 * - relación con Apartados (si la venta nació allí),
 * - movimientos de caja de esos apartados,
 * - snapshots de cajas cerradas afectadas.
 *
 * Dashboard, Clientes, Financiaciones, reportes y ventas del día se corrigen
 * automáticamente porque consumen la colección `sales`.
 */
export async function deleteSaleCompletely({
  saleId,
  storeId = STORE_ID,
  actor = null,
  reason = "",
} = {}) {
  const cleanSaleId = normalizeText(saleId);

  if (!cleanSaleId) {
    throw new Error("No se encontró la venta a eliminar.");
  }

  if (
    actor?.role &&
    normalizeText(actor.role).toLowerCase() !== "admin"
  ) {
    throw new Error(
      "Solo un administrador puede eliminar una venta."
    );
  }

  const saleRef = doc(db, "sales", cleanSaleId);
  const previewSnapshot = await getDoc(saleRef);

  if (!previewSnapshot.exists()) {
    throw new Error("La venta ya no existe.");
  }

  const previewSale = {
    id: previewSnapshot.id,
    ...previewSnapshot.data(),
  };

  const currentStoreId =
    normalizeText(previewSale.storeId) ||
    normalizeText(storeId) ||
    STORE_ID;

  if (
    normalizeText(storeId) &&
    currentStoreId !== normalizeText(storeId)
  ) {
    throw new Error(
      "La venta no pertenece a la tienda actual."
    );
  }

  /*
   * Primero localizamos referencias auxiliares. Las lecturas definitivas de
   * los documentos que se modificarán vuelven a hacerse dentro de la
   * transacción.
   */
  const reservationLinesQuery = query(
    collection(db, "reservations"),
    where("saleId", "==", cleanSaleId)
  );

  const reservationLinesSnapshot =
    await getDocs(reservationLinesQuery);

  const reservationLineDocs =
    reservationLinesSnapshot.docs.map((item) => ({
      ref: item.ref,
      id: item.id,
      data: item.data(),
    }));

  const reservationGroupId =
    getSaleReservationGroupId(previewSale) ||
    normalizeText(
      reservationLineDocs[0]?.data?.reservationGroupId
    );

  const reservationGroupRef = reservationGroupId
    ? doc(db, "reservationGroups", reservationGroupId)
    : null;

  if (reservationGroupRef) {
    const groupPreviewSnapshot =
      await getDoc(reservationGroupRef);

    if (groupPreviewSnapshot.exists()) {
      const groupReservationIds = Array.isArray(
        groupPreviewSnapshot.data()?.reservationIds
      )
        ? groupPreviewSnapshot
            .data()
            .reservationIds
            .map(normalizeText)
            .filter(Boolean)
        : [];

      const knownLineIds = new Set(
        reservationLineDocs.map((item) => item.id)
      );

      for (const reservationId of groupReservationIds) {
        if (knownLineIds.has(reservationId)) {
          continue;
        }

        const lineRef = doc(
          db,
          "reservations",
          reservationId
        );
        const lineSnapshot =
          await getDoc(lineRef);

        if (!lineSnapshot.exists()) {
          continue;
        }

        reservationLineDocs.push({
          ref: lineRef,
          id: lineSnapshot.id,
          data: lineSnapshot.data(),
        });
        knownLineIds.add(reservationId);
      }
    }
  }

  let reservationMovementDocs = [];

  if (reservationGroupId) {
    const movementSnapshot = await getDocs(
      query(
        collection(db, "cashMovements"),
        where(
          "reservationGroupId",
          "==",
          reservationGroupId
        )
      )
    );

    reservationMovementDocs =
      movementSnapshot.docs.map((item) => ({
        ref: item.ref,
        id: item.id,
        data: item.data(),
      }));
  }

  const originCashSessionId =
    normalizeText(previewSale.cashSessionId) ||
    inferCashSessionId(
      previewSale,
      currentStoreId
    );

  const settlementCashSessionId =
    normalizeText(
      previewSale.settlementCashSessionId
    );

  const movementSessionIds =
    reservationMovementDocs.map((item) =>
      normalizeText(item.data?.sessionId)
    );

  const affectedSessionIds = uniqueStrings([
    originCashSessionId,
    settlementCashSessionId,
    ...movementSessionIds,
  ]);

  /*
   * Las cajas abiertas se recalculan solas porque escuchan ventas/movimientos
   * en tiempo real. Las cajas cerradas sí tienen snapshots congelados; para
   * ellas preparamos el resumen exacto que quedará tras la eliminación.
   */
  const closedCashRecalculations = new Map();
  const allStoreSales =
    affectedSessionIds.length > 0
      ? await getSales(currentStoreId)
      : [];

  const movementIdsToDelete = new Set(
    reservationMovementDocs.map((item) => item.id)
  );

  for (const sessionId of affectedSessionIds) {
    const sessionSnapshot = await getDoc(
      doc(db, "cashSessions", sessionId)
    );

    if (!sessionSnapshot.exists()) {
      continue;
    }

    const session = {
      id: sessionSnapshot.id,
      ...sessionSnapshot.data(),
    };

    if (session.status !== "closed") {
      continue;
    }

    const sessionMovements =
      await getCashMovements(sessionId);

    const remainingSales = allStoreSales.filter(
      (sale) => sale.id !== cleanSaleId
    );

    const remainingMovements =
      sessionMovements.filter(
        (movement) =>
          !movementIdsToDelete.has(movement.id)
      );

    closedCashRecalculations.set(
      sessionId,
      buildCashSessionSummary(
        session,
        remainingSales,
        remainingMovements
      )
    );
  }

  const auditRef = doc(
    collection(db, "saleDeletionAudit")
  );

  return runTransaction(db, async (transaction) => {
    const saleSnapshot =
      await transaction.get(saleRef);

    if (!saleSnapshot.exists()) {
      throw new Error(
        "La venta ya fue eliminada."
      );
    }

    const currentSale = {
      id: saleSnapshot.id,
      ...saleSnapshot.data(),
    };

    const saleStoreId =
      normalizeText(currentSale.storeId) ||
      currentStoreId;

    if (saleStoreId !== currentStoreId) {
      throw new Error(
        "La venta cambió de tienda mientras se procesaba la eliminación."
      );
    }

    const saleItems =
      normalizeStoredItems(currentSale);

    if (saleItems.length === 0) {
      throw new Error(
        "La venta no contiene información suficiente para restaurar el inventario."
      );
    }

    const inventoryItems = saleItems.filter(
      (item) =>
        !item.isManual &&
        item.inventoryTracked !== false &&
        item.productId
    );

    const productIds = uniqueStrings(
      inventoryItems.map((item) => item.productId)
    );

    const productEntries = new Map();

    for (const productId of productIds) {
      const productRef = doc(
        db,
        "products",
        productId
      );
      const productSnapshot =
        await transaction.get(productRef);

      if (!productSnapshot.exists()) {
        throw new Error(
          `No se puede eliminar la venta porque el producto ${productId} ya no existe. Restáuralo primero para poder devolver su stock correctamente.`
        );
      }

      const product = productSnapshot.data();

      if (
        normalizeText(product.storeId) &&
        normalizeText(product.storeId) !==
          currentStoreId
      ) {
        throw new Error(
          `El producto "${product.name || productId}" pertenece a otra tienda.`
        );
      }

      productEntries.set(productId, {
        ref: productRef,
        product,
        variants: normalizeProductVariants(
          productId,
          product
        ),
      });
    }

    let currentReservationGroup = null;

    if (reservationGroupRef) {
      const groupSnapshot =
        await transaction.get(
          reservationGroupRef
        );

      if (groupSnapshot.exists()) {
        currentReservationGroup = {
          id: groupSnapshot.id,
          ...groupSnapshot.data(),
        };
      }
    }

    const currentReservationLines = [];

    for (const line of reservationLineDocs) {
      const snapshot =
        await transaction.get(line.ref);

      if (snapshot.exists()) {
        currentReservationLines.push({
          ref: line.ref,
          id: snapshot.id,
          data: snapshot.data(),
        });
      }
    }

    const currentReservationMovements = [];

    for (const movement of reservationMovementDocs) {
      const snapshot =
        await transaction.get(
          movement.ref
        );

      if (snapshot.exists()) {
        currentReservationMovements.push({
          ref: movement.ref,
          id: snapshot.id,
          data: snapshot.data(),
        });
      }
    }

    const cashSessionEntries = new Map();

    for (const sessionId of affectedSessionIds) {
      const sessionRef = doc(
        db,
        "cashSessions",
        sessionId
      );
      const sessionSnapshot =
        await transaction.get(sessionRef);

      if (sessionSnapshot.exists()) {
        cashSessionEntries.set(
          sessionId,
          {
            ref: sessionRef,
            session: {
              id: sessionSnapshot.id,
              ...sessionSnapshot.data(),
            },
          }
        );
      }
    }

    /*
     * RESTAURAR INVENTARIO.
     *
     * La unidad vuelve al stock físico actual. No se revive una promoción
     * histórica: si el producto sigue hoy en promoción, el stock restaurado
     * queda disponible con la promoción actual; si no, vuelve a precio normal.
     */
    for (const item of inventoryItems) {
      const entry =
        productEntries.get(item.productId);

      if (!entry) {
        throw new Error(
          "No se pudo reconstruir uno de los productos de la venta."
        );
      }

      let variant = findRequestedVariant(
        entry.variants,
        item
      );

      if (!variant) {
        const restoredVariant = {
          id:
            normalizeText(item.variantId) ||
            createFallbackVariantId(
              item.productId,
              item.size
            ),
          size: normalizeSize(item.size),
          stock: 0,
          printedLabels: 0,
        };

        entry.variants.push(
          restoredVariant
        );
        variant = restoredVariant;
      }

      const previousStock =
        normalizeQuantity(variant.stock);
      const previousPrinted =
        variant.printedLabels !== undefined
          ? normalizeQuantity(
              variant.printedLabels
            )
          : null;
      const wasFullyPrinted =
        previousPrinted !== null &&
        previousStock > 0 &&
        previousPrinted >= previousStock;

      const restoredQuantity =
        normalizeQuantity(item.quantity);

      variant.stock =
        previousStock + restoredQuantity;

      /*
       * Si todo el stock restante estaba etiquetado, asumimos que la unidad
       * que regresa también conserva su etiqueta física y evitamos crear un
       * falso pendiente de impresión.
       */
      if (
        previousPrinted !== null &&
        wasFullyPrinted
      ) {
        variant.printedLabels =
          Math.min(
            previousPrinted +
              restoredQuantity,
            variant.stock
          );
      }
    }

    for (const entry of productEntries.values()) {
      const variantPayload =
        buildProductVariantPayload(
          entry.variants
        );

      const currentPromotion =
        getEffectiveProductPromotion(
          entry.product
        );

      transaction.update(entry.ref, {
        ...variantPayload,
        promotionVariants: [],
        promotionStock:
          currentPromotion.active
            ? variantPayload.totalStock
            : 0,

        updatedByUid:
          actor?.uid || "",
        updatedByName:
          actor?.name || "",
        updatedByEmail:
          actor?.email || "",
        updatedAt: serverTimestamp(),
      });
    }

    /*
     * Si la venta nació de un apartado, al borrar la venta se elimina también
     * ese apartado ya finalizado y sus abonos de caja. Esto permite devolver
     * la mercancía a stock como una unidad corriente sin dejar referencias
     * huérfanas ni dinero histórico asociado a una operación inexistente.
     */
    currentReservationLines.forEach(
      (line) => {
        transaction.delete(line.ref);
      }
    );

    currentReservationMovements.forEach(
      (movement) => {
        transaction.delete(
          movement.ref
        );
      }
    );

    if (
      reservationGroupRef &&
      currentReservationGroup
    ) {
      transaction.delete(
        reservationGroupRef
      );
    }

    /*
     * Reparar snapshots de cajas ya cerradas. El efectivo contado físicamente
     * se conserva; únicamente cambia el esperado y, por tanto, la diferencia.
     */
    for (const [
      sessionId,
      summary,
    ] of closedCashRecalculations.entries()) {
      const entry =
        cashSessionEntries.get(sessionId);

      if (
        !entry ||
        entry.session.status !== "closed"
      ) {
        continue;
      }

      transaction.update(
        entry.ref,
        buildClosedCashSnapshotPayload(
          entry.session,
          summary,
          actor,
          currentSale.saleNumber
        )
      );
    }

    transaction.set(auditRef, {
      storeId: currentStoreId,
      originalSaleId: cleanSaleId,
      saleNumber:
        normalizeText(
          currentSale.saleNumber ||
            currentSale.receiptNumber
        ),
      reason:
        normalizeText(reason) ||
        "Venta eliminada desde Historial de ventas",

      total:
        normalizeMoney(currentSale.total),
      totalItems:
        normalizeQuantity(
          currentSale.totalItems
        ),
      customerId:
        normalizeText(
          currentSale.customerId
        ),
      customerName:
        normalizeText(
          currentSale.customerName
        ),
      customerDocument:
        normalizeCustomerDocument(
          currentSale.customerDocument
        ),
      sellerUid:
        normalizeText(
          currentSale.sellerUid
        ),
      sellerName:
        normalizeText(
          currentSale.sellerName
        ),

      source:
        normalizeText(
          currentSale.source
        ),
      reservationGroupId,
      restoredUnits:
        inventoryItems.reduce(
          (sum, item) =>
            sum +
            normalizeQuantity(
              item.quantity
            ),
          0
        ),

      affectedCashSessionIds: affectedSessionIds,
      deletedReservationLineIds:
        currentReservationLines.map(
          (line) => line.id
        ),
      deletedCashMovementIds:
        currentReservationMovements.map(
          (movement) => movement.id
        ),

      saleSnapshot: currentSale,

      deletedByUid:
        actor?.uid || "",
      deletedByName:
        actor?.name || "",
      deletedByEmail:
        actor?.email || "",
      deletedAt: serverTimestamp(),
    });

    transaction.delete(saleRef);

    return {
      id: cleanSaleId,
      saleNumber:
        normalizeText(
          currentSale.saleNumber
        ),
      restoredUnits:
        inventoryItems.reduce(
          (sum, item) =>
            sum +
            normalizeQuantity(
              item.quantity
            ),
          0
        ),
      reservationRemoved:
        Boolean(
          currentReservationGroup ||
            currentReservationLines.length > 0
        ),
      cashMovementCount:
        currentReservationMovements.length,
      auditId: auditRef.id,
    };
  });
}

