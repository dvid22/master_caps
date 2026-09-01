import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
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
  "otro",
  "mixto",
];

const ADDI_PAYMENT_METHOD = "addi";
const ADDI_STATUS_PENDING = "pending";
const ADDI_STATUS_SETTLED = "settled";

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

  const sellerUid = safeId(sale?.sellerUid);
  const businessDate = getBogotaBusinessDate(sale?.createdAt);

  if (!sellerUid || !businessDate) return "";

  return `${safeId(storeId)}__${sellerUid}__${businessDate}`;
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

  if (normalized.some((payment) => payment.method === ADDI_PAYMENT_METHOD) && normalized.length > 1) {
    throw new Error(
      "Por ahora Addi debe registrarse como pago único. No lo mezcles con efectivo, transferencia u otros medios."
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

  items.forEach((item) => {
    const productId = normalizeText(item?.productId);
    const variantId = normalizeText(item?.variantId);
    const size = normalizeText(item?.size || item?.productSize);
    const quantity = normalizeQuantity(item?.quantity);
    const isPromotion =
      Boolean(item?.isPromotion) ||
      normalizeText(item?.pricingMode) === "promotion";

    if (!productId) {
      throw new Error(
        "Uno de los productos de la venta no es válido."
      );
    }

    if (quantity <= 0) {
      throw new Error(
        "La cantidad de cada producto debe ser mayor a cero."
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
      promotionNote: normalizeText(item?.promotionNote),
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
      ...oldItems.map((item) => item.productId),
      ...requestedItems.map((item) => item.productId),
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

      variant.stock =
        normalizeQuantity(variant.stock) +
        normalizeQuantity(oldItem.quantity);

      const currentPromotionEnabled =
        Boolean(entry.product.isPromotion) &&
        normalizeMoney(entry.product.promotionPrice) > 0;

      /*
       * Si la promoción sigue activa, la unidad vuelve a la bolsa promocional.
       * Si la promoción ya terminó, vuelve únicamente al stock físico normal;
       * de esta forma no revivimos promociones antiguas.
       */
      if (
        oldItem.isPromotion &&
        currentPromotionEnabled
      ) {
        entry.promotionVariants = addPromotionStock(
          entry.promotionVariants,
          variant,
          oldItem.quantity
        );
      }
    }

    const oldLineByKey = new Map();

    oldItems.forEach((item) => {
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
     * Presupuesto de reclasificación Promoción -> Normal.
     *
     * Si una venta histórica tenía 2 unidades promocionales y ahora se
     * corrige a 1 promo + 1 normal, esa unidad que deja de ser promo puede
     * salir de la bolsa promocional para convertirse en stock normal.
     * Esto evita fallos falsos cuando no existe otro stock normal disponible.
     */
    const oldPromoByVariant = new Map();
    const newPromoByVariant = new Map();

    oldItems.forEach((item) => {
      if (!item.isPromotion) return;

      const entry = productEntries.get(item.productId);
      const variant = entry
        ? findRequestedVariant(entry.variants, item)
        : null;

      if (!variant) return;

      const key = `${item.productId}__${variant.id}`;
      oldPromoByVariant.set(
        key,
        (oldPromoByVariant.get(key) || 0) +
          normalizeQuantity(item.quantity)
      );
    });

    requestedItems.forEach((item) => {
      if (!item.isPromotion) return;

      const entry = productEntries.get(item.productId);
      const variant = entry
        ? findRequestedVariant(entry.variants, item)
        : null;

      if (!variant) return;

      const key = `${item.productId}__${variant.id}`;
      newPromoByVariant.set(
        key,
        (newPromoByVariant.get(key) || 0) +
          normalizeQuantity(item.quantity)
      );
    });

    const promoToNormalBudget = new Map();

    oldPromoByVariant.forEach((oldQuantity, key) => {
      promoToNormalBudget.set(
        key,
        Math.max(
          oldQuantity -
            normalizeQuantity(newPromoByVariant.get(key)),
          0
        )
      );
    });

    /*
     * PASO 2: construir y descontar la nueva composición.
     */
    const newSaleItems = [];

    let subtotal = 0;
    let totalCost = 0;
    let totalItems = 0;

    for (const requestedItem of requestedItems) {
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

      const historicalLine = oldLineByKey.get(
        getLineKey(requestedItem, variant)
      );

      const oppositeHistoricalLine = oldLineByKey.get(
        getLineKey(
          {
            ...requestedItem,
            isPromotion: !requestedItem.isPromotion,
          },
          variant
        )
      );

      const currentPromotionEnabled =
        Boolean(entry.product.isPromotion) &&
        normalizeMoney(entry.product.promotionPrice) > 0;

      let promotionStock =
        getPromotionStockForVariant(
          entry.promotionVariants,
          variant
        );

      const physicalStock =
        normalizeQuantity(variant.stock);

      let availableForMode = 0;

      if (requestedItem.isPromotion) {
        if (currentPromotionEnabled) {
          availableForMode = promotionStock;
        } else if (
          historicalLine?.isPromotion
        ) {
          /*
           * Permite conservar o reducir una promoción histórica aunque
           * la promoción del producto ya haya terminado. No permite
           * aumentar esa promoción antigua.
           */
          availableForMode = Math.min(
            physicalStock,
            normalizeQuantity(
              historicalLine.quantity
            )
          );
        } else {
          throw new Error(
            `La promoción de "${entry.product.name}" ya no está disponible.`
          );
        }
      } else {
        let normalAvailable = Math.max(
          physicalStock - promotionStock,
          0
        );

        const variantKey =
          `${requestedItem.productId}__${variant.id}`;
        const conversionBudget = normalizeQuantity(
          promoToNormalBudget.get(variantKey)
        );
        const neededFromFormerPromo = Math.max(
          quantity - normalAvailable,
          0
        );

        if (neededFromFormerPromo > 0) {
          const convertible = Math.min(
            neededFromFormerPromo,
            conversionBudget,
            promotionStock
          );

          if (convertible > 0) {
            entry.promotionVariants = subtractPromotionStock(
              entry.promotionVariants,
              variant,
              convertible
            );

            promoToNormalBudget.set(
              variantKey,
              conversionBudget - convertible
            );

            promotionStock -= convertible;
            normalAvailable += convertible;
          }
        }

        availableForMode = normalAvailable;
      }

      if (quantity > availableForMode) {
        throw new Error(
          requestedItem.isPromotion
            ? `Solo hay ${availableForMode} unidad(es) disponibles en promoción de "${entry.product.name}" talla ${variant.size}.`
            : `Solo hay ${availableForMode} unidad(es) normales disponibles de "${entry.product.name}" talla ${variant.size}.`
        );
      }

      variant.stock = physicalStock - quantity;

      if (
        requestedItem.isPromotion &&
        currentPromotionEnabled
      ) {
        entry.promotionVariants = subtractPromotionStock(
          entry.promotionVariants,
          variant,
          quantity
        );
      }

      /*
       * Una línea que ya existía conserva el precio histórico de la venta.
       * Un producto/talla nuevo usa el precio actual del inventario.
       */
      const priceHistoryLine =
        historicalLine ||
        oppositeHistoricalLine ||
        null;

      const regularUnitPrice = priceHistoryLine
        ? normalizeMoney(
            priceHistoryLine.regularUnitPrice ||
              (!priceHistoryLine.isPromotion
                ? priceHistoryLine.unitPrice
                : 0)
          ) || normalizeMoney(entry.product.salePrice)
        : normalizeMoney(
            entry.product.salePrice
          );

      const promotionPrice =
        requestedItem.isPromotion
          ? historicalLine?.isPromotion
            ? normalizeMoney(
                historicalLine.promotionPrice ||
                  historicalLine.unitPrice
              )
            : normalizeMoney(
                entry.product.promotionPrice
              )
          : 0;

      const unitPrice = historicalLine
        ? normalizeMoney(
            historicalLine.unitPrice
          )
        : requestedItem.isPromotion
          ? promotionPrice
          : regularUnitPrice;

      const costPrice = priceHistoryLine
        ? normalizeMoney(
            priceHistoryLine.costPrice
          )
        : normalizeMoney(
            entry.product.costPrice
          );

      const lineSubtotal = unitPrice * quantity;
      const lineTotalCost = costPrice * quantity;
      const lineProfit =
        lineSubtotal - lineTotalCost;

      subtotal += lineSubtotal;
      totalCost += lineTotalCost;
      totalItems += quantity;

      newSaleItems.push({
        lineId:
          historicalLine?.lineId ||
          oppositeHistoricalLine?.lineId ||
          `line-${newSaleItems.length + 1}`,

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
        isPromotion: Boolean(
          requestedItem.isPromotion
        ),
        promotionPrice,
        promotionNote:
          requestedItem.isPromotion
            ? historicalLine
              ? normalizeText(
                  historicalLine.promotionNote
                )
              : normalizeText(
                  entry.product.promotionNote
                )
            : "",

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

    const total = Math.max(
      subtotal - cleanDiscount,
      0
    );

    const paymentBreakdown = normalizePaymentBreakdown({
      payments,
      fallbackMethod: requestedPaymentMethod,
      total,
      amountReceived,
    });

    const cleanPaymentMethod = paymentBreakdown.paymentMethod;
    const finalPayments = paymentBreakdown.payments;
    const finalAmountReceived = paymentBreakdown.amountReceived;
    const change = paymentBreakdown.change;

    if (linkedCashSession?.status === "closed") {
      const totalChanged =
        Math.abs(normalizeMoney(currentSale.total) - total) > 0.001;
      const paymentsChanged =
        paymentSignatureFromSale(currentSale) !==
        paymentSignatureFromBreakdown(finalPayments);

      if (totalChanged || paymentsChanged) {
        throw new Error(
          "Esta venta pertenece a una caja ya cerrada. Para proteger el cierre, no puedes cambiar su total ni la distribución del pago; registra después un movimiento de caja si el dinero cambió de lugar."
        );
      }
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

    /*
     * Addi ya desembolsado no se puede alterar contablemente.
     * Se puede corregir texto/cliente/productos únicamente si el total final
     * sigue siendo exactamente el mismo y continúa siendo Addi.
     */
    const currentWasSettledAddi =
      normalizeText(
        currentSale.paymentMethod
      ) === ADDI_PAYMENT_METHOD &&
      normalizeText(
        currentSale.addiStatus
      ) === ADDI_STATUS_SETTLED;

    if (
      currentWasSettledAddi &&
      (
        cleanPaymentMethod !==
          ADDI_PAYMENT_METHOD ||
        total !==
          getCurrentSaleTotal(
            currentSale
          )
      )
    ) {
      throw new Error(
        "Esta venta de Addi ya fue desembolsada. Para proteger la contabilidad, debe conservar el método Addi y el mismo total."
      );
    }

    let paymentStatus = "paid";
    let addiStatus = "";
    let addiExpectedAmount = 0;
    let addiSettledAmount = 0;
    let addiSettledAt = null;
    let addiReference = "";
    let addiNotes = "";
    let addiSettledByUid = "";
    let addiSettledByName = "";
    let addiSettledByEmail = "";

    if (
      cleanPaymentMethod ===
      ADDI_PAYMENT_METHOD
    ) {
      addiExpectedAmount = total;

      if (currentWasSettledAddi) {
        paymentStatus = "paid";
        addiStatus =
          ADDI_STATUS_SETTLED;
        addiSettledAmount =
          normalizeMoney(
            currentSale.addiSettledAmount
          );
        addiSettledAt =
          currentSale.addiSettledAt ||
          null;
        addiReference =
          normalizeText(
            currentSale.addiReference
          );
        addiNotes =
          normalizeText(
            currentSale.addiNotes
          );
        addiSettledByUid =
          normalizeText(
            currentSale.addiSettledByUid
          );
        addiSettledByName =
          normalizeText(
            currentSale.addiSettledByName
          );
        addiSettledByEmail =
          normalizeText(
            currentSale.addiSettledByEmail
          );
      } else {
        paymentStatus =
          "pending_settlement";
        addiStatus =
          ADDI_STATUS_PENDING;
      }
    }

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

      const promotionStock =
        getPromotionTotalStock(
          entry.promotionVariants
        );

      transaction.update(entry.ref, {
        ...variantPayload,

        promotionVariants:
          entry.promotionVariants,
        promotionStock,

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

      subtotal,
      discount:
        cleanDiscount,
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
      amountReceived:
        finalAmountReceived,
      change,

      paymentStatus,
      addiStatus,
      addiExpectedAmount,
      addiSettledAmount,
      addiSettledAt,
      addiReference,
      addiNotes,
      addiSettledByUid,
      addiSettledByName,
      addiSettledByEmail,

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

      subtotal,
      discount:
        cleanDiscount,
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
      amountReceived:
        finalAmountReceived,
      change,

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
