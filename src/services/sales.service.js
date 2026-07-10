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

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

/* -------------------------------------------------------------------------- */
/*                                CONSTANTES                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_PAYMENT_METHOD = "efectivo";
const DEFAULT_SOURCE = "pos";

const VALID_PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "nequi",
  "daviplata",
  "tarjeta",
  "otro",
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

/* -------------------------------------------------------------------------- */
/*                                  VARIANTES                                  */
/* -------------------------------------------------------------------------- */

/**
 * Convierte tanto productos nuevos como antiguos a una estructura uniforme:
 *
 * [
 *   {
 *     id: "variant-m",
 *     size: "M",
 *     stock: 5
 *   }
 * ]
 */
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
/*                         NORMALIZACIÓN DE ÍTEMS DEL CARRITO                   */
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

    if (!productId) {
      throw new Error("Uno de los productos seleccionados no es válido.");
    }

    if (quantity <= 0) {
      throw new Error("La cantidad de cada producto debe ser mayor a cero.");
    }

    /**
     * Si existen dos líneas con el mismo producto y la misma talla,
     * se agrupan automáticamente.
     */
    const variantKey = variantId || normalizeSize(size || "Talla única");
    const groupKey = `${productId}__${variantKey}`;

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
/*                         NORMALIZACIÓN DE VENTAS LEÍDAS                       */
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

    imageUrl: normalizeText(
      item?.imageUrl || item?.coverImageUrl
    ),

    quantity,
    unitPrice,
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

    customerName: normalizeText(sale.customerName),
    customerDocument: normalizeText(sale.customerDocument),
    customerPhone: normalizeText(sale.customerPhone),

    paymentMethod:
      normalizeText(sale.paymentMethod) || DEFAULT_PAYMENT_METHOD,

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
/*                          CONSULTAS Y SUSCRIPCIONES                           */
/* -------------------------------------------------------------------------- */

export function subscribeSales(
  callback,
  onError,
  storeId = STORE_ID
) {
  const salesRef = collection(db, "sales");

  const salesQuery = query(
    salesRef,
    where("storeId", "==", storeId)
  );

  return onSnapshot(
    salesQuery,
    (snapshot) => {
      callback(mapSalesSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando ventas:", error);

      if (onError) {
        onError(error);
      }
    }
  );
}

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

/* -------------------------------------------------------------------------- */
/*                           CREAR VENTA MULTIPRODUCTO                          */
/* -------------------------------------------------------------------------- */

/**
 * Firma recomendada:
 *
 * createMultiItemSale({
 *   items: [
 *     {
 *       productId: "...",
 *       variantId: "...",
 *       size: "M",
 *       quantity: 2
 *     }
 *   ],
 *
 *   customerName: "",
 *   customerDocument: "",
 *   customerPhone: "",
 *
 *   paymentMethod: "efectivo",
 *   discount: 0,
 *   amountReceived: 100000,
 *
 *   notes: "",
 *   source: "pos",
 *   storeId: STORE_ID,
 *   seller: {}
 * })
 */
export async function createMultiItemSale({
  items,
  customerName = "",
  customerDocument = "",
  customerPhone = "",

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

  const saleRef = doc(collection(db, "sales"));

  const saleResult = await runTransaction(db, async (transaction) => {
    /**
     * Primero se leen el contador y todos los productos.
     * Después se realizan todas las escrituras.
     */
    const saleCounter = await getNextSaleNumber(transaction, storeId);

    const productSnapshots = new Map();

    for (const productId of groupedItems.keys()) {
      const productRef = doc(db, "products", productId);
      const productSnapshot = await transaction.get(productRef);

      productSnapshots.set(productId, {
        ref: productRef,
        snapshot: productSnapshot,
      });
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
        throw new Error(
          "Uno de los productos seleccionados ya no existe."
        );
      }

      const product = productSnapshot.data();

      if (product.storeId !== storeId) {
        throw new Error(
          `El producto "${product.name || productId}" no pertenece a esta tienda.`
        );
      }

      const workingVariants = normalizeProductVariants(
        productId,
        product
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

        const requestedQuantity = normalizeQuantity(
          requestedItem.quantity
        );

        const currentVariantStock = normalizeQuantity(
          selectedVariant.stock
        );

        if (currentVariantStock <= 0) {
          throw new Error(
            `La talla ${selectedVariant.size} de "${product.name}" está agotada.`
          );
        }

        if (requestedQuantity > currentVariantStock) {
          throw new Error(
            `No puedes vender ${requestedQuantity} unidad(es) de "${product.name}" talla ${selectedVariant.size}. Solo hay ${currentVariantStock} disponible(s).`
          );
        }

        /**
         * Se modifica la variante dentro del arreglo de trabajo.
         * Si hay varias líneas del mismo producto, todas afectan el mismo arreglo.
         */
        selectedVariant.stock =
          currentVariantStock - requestedQuantity;

        const unitPrice = normalizeMoney(product.salePrice);
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
          costPrice,

          subtotal: lineSubtotal,
          totalCost: lineTotalCost,
          profit: lineProfit,
        });
      }

      const productVariantPayload =
        buildProductVariantPayload(workingVariants);

      transaction.update(productRef, {
        ...productVariantPayload,

        updatedByUid: seller?.uid || "",
        updatedByName: seller?.name || "",
        updatedByEmail: seller?.email || "",

        updatedAt: serverTimestamp(),
      });
    }

    if (cleanDiscount > subtotal) {
      throw new Error(
        "El descuento no puede ser mayor al subtotal de la venta."
      );
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

    const profit = total - totalCost;

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

      customerName: normalizeText(customerName),
      customerDocument: normalizeText(customerDocument),
      customerPhone: normalizeText(customerPhone),

      paymentMethod: cleanPaymentMethod,
      amountReceived: finalAmountReceived,
      change,

      notes: normalizeText(notes),
      source: normalizeText(source) || DEFAULT_SOURCE,

      reservationId: reservationId || null,

      sellerUid: seller?.uid || "",
      sellerName: seller?.name || "",
      sellerEmail: seller?.email || "",

      /**
       * Datos útiles para impresión y auditoría.
       */
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

      customerName: normalizeText(customerName),
      customerDocument: normalizeText(customerDocument),
      customerPhone: normalizeText(customerPhone),

      notes: normalizeText(notes),
      source: normalizeText(source) || DEFAULT_SOURCE,

      sellerUid: seller?.uid || "",
      sellerName: seller?.name || "",
      sellerEmail: seller?.email || "",
    };
  });

  return saleResult;
}

/* -------------------------------------------------------------------------- */
/*                   COMPATIBILIDAD CON LA VENTA ANTERIOR                      */
/* -------------------------------------------------------------------------- */

/**
 * Esta función conserva temporalmente la firma anterior:
 *
 * createDirectSale({
 *   productId,
 *   quantity,
 *   ...
 * })
 *
 * Internamente crea una venta multítem con un solo producto.
 *
 * Se recomienda que el nuevo SalesPage utilice createMultiItemSale().
 */
export async function createDirectSale({
  productId,
  variantId = "",
  size = "",

  quantity,
  customerName = "",
  customerDocument = "",
  customerPhone = "",

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

    customerName,
    customerDocument,
    customerPhone,

    paymentMethod,
    amountReceived,
    discount,

    notes,
    source: "direct",

    storeId,
    seller,
  });

  /**
   * La implementación anterior devolvía únicamente saleId.
   * Se mantiene ese comportamiento para no romper SalesPage.jsx.
   */
  return result.id;
}