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
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

const RESERVATION_DAYS = 7;

function safeString(value) {
  return String(value || "").trim();
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSize(value) {
  const cleanValue = safeString(value);

  if (!cleanValue) return "Talla única";

  const normalized = cleanValue.toUpperCase();

  if (
    normalized === "TALLA UNICA" ||
    normalized === "TALLA ÚNICA" ||
    normalized === "UNICA" ||
    normalized === "ÚNICA"
  ) {
    return "Talla única";
  }

  return cleanValue;
}

function normalizeVariants(product = {}) {
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants.map((variant, index) => ({
      id: safeString(variant.id) || `variant-${index + 1}`,
      size: normalizeSize(variant.size),
      stock: Math.max(Math.trunc(safeNumber(variant.stock)), 0),
      barcode: safeString(variant.barcode),
    }));
  }

  return [
    {
      id: "legacy-variant",
      size: normalizeSize(product.size),
      stock: Math.max(Math.trunc(safeNumber(product.stock)), 0),
      barcode: safeString(product.barcode),
    },
  ];
}

function calculateTotalStock(variants = []) {
  return variants.reduce(
    (total, variant) => total + Math.max(safeNumber(variant.stock), 0),
    0
  );
}

function getProductCoverUrl(product = {}) {
  if (Array.isArray(product.images) && product.images.length > 0) {
    const cover =
      product.images.find((image) => image?.type === "cover") ||
      product.images[0];

    return safeString(cover?.url);
  }

  return safeString(product.imageUrl);
}

function mapReservationsSnapshot(snapshot) {
  return snapshot.docs
    .map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }))
    .sort((a, b) => {
      const dateA = a.reservedAt?.seconds || a.createdAt?.seconds || 0;
      const dateB = b.reservedAt?.seconds || b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
}

function createReservationGroupNumber(groupRef) {
  return `AP-${groupRef.id.slice(0, 8).toUpperCase()}`;
}

function normalizeCartItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agrega al menos un producto al carrito.");
  }

  return items.map((item, index) => {
    const productId = safeString(item.productId);
    const variantId = safeString(item.variantId);
    const size = normalizeSize(item.size || item.productSize);
    const quantity = Math.trunc(safeNumber(item.quantity, 1));

    if (!productId) {
      throw new Error(`El producto de la línea ${index + 1} no es válido.`);
    }

    if (!variantId) {
      throw new Error(
        `La variante de la línea ${index + 1} no es válida.`
      );
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(
        `La cantidad de la línea ${index + 1} debe ser un entero mayor a cero.`
      );
    }

    return {
      productId,
      variantId,
      size,
      quantity,
    };
  });
}

function validateCustomer({
  customerName,
  customerDocument,
  customerPhone = "",
}) {
  const cleanName = safeString(customerName);
  const cleanDocument = safeString(customerDocument);
  const cleanPhone = safeString(customerPhone);

  if (!cleanName) {
    throw new Error("Debes escribir tu nombre.");
  }

  if (!cleanDocument) {
    throw new Error("Debes escribir tu cédula.");
  }

  return {
    customerName: cleanName,
    customerDocument: cleanDocument,
    customerPhone: cleanPhone,
  };
}

function buildUpdatedProductStock(product, variantId, quantityDelta) {
  const variants = normalizeVariants(product);
  const variantIndex = variants.findIndex(
    (variant) => variant.id === variantId
  );

  if (variantIndex < 0) {
    throw new Error("La talla seleccionada ya no existe.");
  }

  const currentVariant = variants[variantIndex];
  const nextStock = currentVariant.stock + quantityDelta;

  if (nextStock < 0) {
    throw new Error(
      `No hay suficiente stock para la talla ${currentVariant.size}.`
    );
  }

  const updatedVariants = variants.map((variant, index) =>
    index === variantIndex
      ? {
          ...variant,
          stock: nextStock,
        }
      : variant
  );

  return {
    variant: currentVariant,
    variants: updatedVariants,
    totalStock: calculateTotalStock(updatedVariants),
  };
}

export function subscribeReservations(callback, onError, storeId = STORE_ID) {
  const reservationsRef = collection(db, "reservations");
  const q = query(reservationsRef, where("storeId", "==", storeId));

  return onSnapshot(
    q,
    (snapshot) => {
      callback(mapReservationsSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando apartados:", error);
      if (onError) onError(error);
    }
  );
}

export async function createReservationCart({
  items = [],
  customerName,
  customerDocument,
  customerPhone = "",
  storeId = STORE_ID,
  source = "catalog-cart",
}) {
  const cleanStoreId = safeString(storeId) || STORE_ID;
  const normalizedItems = normalizeCartItems(items);
  const customer = validateCustomer({
    customerName,
    customerDocument,
    customerPhone,
  });

  const now = new Date();
  const expiresAtDate = new Date(
    now.getTime() + RESERVATION_DAYS * 24 * 60 * 60 * 1000
  );

  const result = await runTransaction(db, async (transaction) => {
    const groupRef = doc(collection(db, "reservationGroups"));
    const groupNumber = createReservationGroupNumber(groupRef);

    const productRefs = normalizedItems.map((item) =>
      doc(db, "products", item.productId)
    );

    const productSnapshots = [];

    for (const productRef of productRefs) {
      productSnapshots.push(await transaction.get(productRef));
    }

    const productStates = new Map();
    const reservationLines = [];

    for (let index = 0; index < normalizedItems.length; index += 1) {
      const requestedItem = normalizedItems[index];
      const productSnap = productSnapshots[index];

      if (!productSnap.exists()) {
        throw new Error(
          `El producto de la línea ${index + 1} ya no existe.`
        );
      }

      const product = productSnap.data();

      if (safeString(product.storeId) !== cleanStoreId) {
        throw new Error(
          `El producto "${product.name || "sin nombre"}" no pertenece a esta tienda.`
        );
      }

      const productStateKey = requestedItem.productId;

      let currentProductState = productStates.get(productStateKey);

      if (!currentProductState) {
        currentProductState = {
          productRef: productRefs[index],
          product,
          variants: normalizeVariants(product),
        };

        productStates.set(productStateKey, currentProductState);
      }

      const variantIndex = currentProductState.variants.findIndex(
        (variant) => variant.id === requestedItem.variantId
      );

      if (variantIndex < 0) {
        throw new Error(
          `La talla ${requestedItem.size} de "${product.name}" ya no existe.`
        );
      }

      const variant = currentProductState.variants[variantIndex];

      if (requestedItem.quantity > variant.stock) {
        throw new Error(
          `Solo hay ${variant.stock} unidad(es) disponibles de "${product.name}" talla ${variant.size}.`
        );
      }

      currentProductState.variants = currentProductState.variants.map(
        (currentVariant, currentIndex) =>
          currentIndex === variantIndex
            ? {
                ...currentVariant,
                stock: currentVariant.stock - requestedItem.quantity,
              }
            : currentVariant
      );

      const reservationRef = doc(collection(db, "reservations"));
      const unitPrice = Math.max(safeNumber(product.salePrice), 0);
      const costPrice = Math.max(safeNumber(product.costPrice), 0);
      const lineTotal = unitPrice * requestedItem.quantity;

      reservationLines.push({
        reservationRef,
        product,
        variant,
        requestedItem,
        unitPrice,
        costPrice,
        lineTotal,
      });
    }

    for (const productState of productStates.values()) {
      transaction.update(productState.productRef, {
        variants: productState.variants,
        stock: calculateTotalStock(productState.variants),
        updatedAt: serverTimestamp(),
      });
    }

    const totalItems = reservationLines.reduce(
      (total, line) => total + line.requestedItem.quantity,
      0
    );

    const subtotal = reservationLines.reduce(
      (total, line) => total + line.lineTotal,
      0
    );

    transaction.set(groupRef, {
      storeId: cleanStoreId,
      groupNumber,
      customerName: customer.customerName,
      customerDocument: customer.customerDocument,
      customerPhone: customer.customerPhone,

      status: "active",
      source,
      totalLines: reservationLines.length,
      totalItems,
      subtotal,

      reservationIds: reservationLines.map(
        (line) => line.reservationRef.id
      ),

      reservedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAtDate),

      completedAt: null,
      cancelledAt: null,
      expiredAt: null,
      saleId: null,
    });

    reservationLines.forEach((line, index) => {
      transaction.set(line.reservationRef, {
        storeId: cleanStoreId,
        reservationGroupId: groupRef.id,
        reservationGroupNumber: groupNumber,
        lineNumber: index + 1,

        productId: line.requestedItem.productId,
        productName: line.product.name || "",
        productCode: line.product.code || "",
        productImageUrl: getProductCoverUrl(line.product),
        categoryId: line.product.categoryId || "",
        categoryName: line.product.categoryName || "",

        variantId: line.variant.id,
        productSize: line.variant.size,
        size: line.variant.size,
        variantBarcode: line.variant.barcode || "",

        unitPrice: line.unitPrice,
        costPrice: line.costPrice,
        quantity: line.requestedItem.quantity,
        subtotal: line.lineTotal,

        customerName: customer.customerName,
        customerDocument: customer.customerDocument,
        customerPhone: customer.customerPhone,

        status: "active",
        source,
        reservedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAtDate),

        notificationRead: false,
        notificationReadAt: null,
        notificationReadByUid: "",
        notificationReadByName: "",
        notificationReadByEmail: "",

        completedAt: null,
        expiredAt: null,
        cancelledAt: null,
        saleId: null,
      });
    });

    return {
      reservationGroupId: groupRef.id,
      reservationGroupNumber: groupNumber,
      reservationIds: reservationLines.map(
        (line) => line.reservationRef.id
      ),
      totalLines: reservationLines.length,
      totalItems,
      subtotal,
      expiresAt: expiresAtDate,
    };
  });

  return result;
}

export async function createReservation({
  productId,
  variantId,
  size,
  productSize,
  quantity = 1,
  customerName,
  customerDocument,
  customerPhone = "",
  storeId = STORE_ID,
}) {
  const result = await createReservationCart({
    items: [
      {
        productId,
        variantId:
          safeString(variantId) ||
          (safeString(size || productSize) ? "legacy-variant" : ""),
        size: size || productSize,
        quantity,
      },
    ],
    customerName,
    customerDocument,
    customerPhone,
    storeId,
    source: "catalog-single",
  });

  return result.reservationIds[0];
}

export async function getReservationById(reservationId) {
  const reservationRef = doc(db, "reservations", reservationId);
  const snapshot = await getDoc(reservationRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function getReservationGroupById(groupId) {
  const groupRef = doc(db, "reservationGroups", groupId);
  const snapshot = await getDoc(groupRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function markReservationsAsRead({
  reservationIds = [],
  storeId = STORE_ID,
  actor = null,
} = {}) {
  const cleanIds = reservationIds
    .map((id) => safeString(id))
    .filter(Boolean);

  const batch = writeBatch(db);
  let updatesCount = 0;

  if (cleanIds.length > 0) {
    cleanIds.forEach((reservationId) => {
      const reservationRef = doc(db, "reservations", reservationId);

      batch.update(reservationRef, {
        notificationRead: true,
        notificationReadAt: serverTimestamp(),
        notificationReadByUid: actor?.uid || "",
        notificationReadByName: actor?.name || "",
        notificationReadByEmail: actor?.email || "",
      });

      updatesCount += 1;
    });
  } else {
    const reservationsRef = collection(db, "reservations");

    const q = query(
      reservationsRef,
      where("storeId", "==", storeId),
      where("status", "==", "active")
    );

    const snapshot = await getDocs(q);

    snapshot.docs.forEach((docItem) => {
      const reservation = docItem.data();

      if (reservation.notificationRead === true) return;

      batch.update(docItem.ref, {
        notificationRead: true,
        notificationReadAt: serverTimestamp(),
        notificationReadByUid: actor?.uid || "",
        notificationReadByName: actor?.name || "",
        notificationReadByEmail: actor?.email || "",
      });

      updatesCount += 1;
    });
  }

  if (updatesCount === 0) return 0;

  await batch.commit();

  return updatesCount;
}

export async function completeReservationSale({
  reservationId,
  paymentMethod = "efectivo",
  notes = "",
  seller = null,
}) {
  if (!reservationId) {
    throw new Error("No se encontró el apartado.");
  }

  const saleId = await runTransaction(db, async (transaction) => {
    const reservationRef = doc(db, "reservations", reservationId);
    const reservationSnap = await transaction.get(reservationRef);

    if (!reservationSnap.exists()) {
      throw new Error("El apartado no existe.");
    }

    const reservation = reservationSnap.data();

    if (reservation.status !== "active") {
      throw new Error("Este apartado ya no está activo.");
    }

    const now = new Date();
    const expiresAtDate = reservation.expiresAt?.toDate?.();

    if (expiresAtDate && expiresAtDate < now) {
      throw new Error(
        "Este apartado ya venció. Primero libéralo para devolverlo al inventario."
      );
    }

    const quantity = Math.max(safeNumber(reservation.quantity, 1), 1);
    const unitPrice = Math.max(safeNumber(reservation.unitPrice), 0);
    const costPrice = Math.max(safeNumber(reservation.costPrice), 0);
    const total = unitPrice * quantity;
    const totalCost = costPrice * quantity;
    const profit = total - totalCost;

    const saleRef = doc(collection(db, "sales"));

    transaction.set(saleRef, {
      storeId: reservation.storeId || STORE_ID,

      items: [
        {
          lineId: reservationId,
          productId: reservation.productId || "",
          productName: reservation.productName || "",
          productCode: reservation.productCode || "",
          variantId: reservation.variantId || "legacy-variant",
          size:
            reservation.productSize ||
            reservation.size ||
            "Talla única",
          categoryId: reservation.categoryId || "",
          categoryName: reservation.categoryName || "",
          quantity,
          unitPrice,
          costPrice,
          subtotal: total,
        },
      ],

      productId: reservation.productId || "",
      productName: reservation.productName || "",
      productCode: reservation.productCode || "",
      productSize:
        reservation.productSize ||
        reservation.size ||
        "Talla única",
      variantId: reservation.variantId || "legacy-variant",
      categoryId: reservation.categoryId || "",
      categoryName: reservation.categoryName || "",

      quantity,
      totalItems: quantity,
      uniqueItems: 1,
      unitPrice,
      costPrice,
      subtotal: total,
      total,
      totalCost,
      profit,
      discount: 0,

      customerName: reservation.customerName || "",
      customerDocument: reservation.customerDocument || "",
      customerPhone: reservation.customerPhone || "",

      paymentMethod,
      notes: safeString(notes),
      source: "reservation",
      reservationId,
      reservationGroupId: reservation.reservationGroupId || "",

      sellerUid: seller?.uid || "",
      sellerName: seller?.name || "",
      sellerEmail: seller?.email || "",

      createdAt: serverTimestamp(),
    });

    transaction.update(reservationRef, {
      status: "completed",
      completedAt: serverTimestamp(),
      saleId: saleRef.id,
      paymentMethod,
      notes: safeString(notes),

      notificationRead: true,
      notificationReadAt: serverTimestamp(),
      notificationReadByUid: seller?.uid || "",
      notificationReadByName: seller?.name || "",
      notificationReadByEmail: seller?.email || "",

      completedByUid: seller?.uid || "",
      completedByName: seller?.name || "",
      completedByEmail: seller?.email || "",
    });

    return saleRef.id;
  });

  return saleId;
}

async function restoreReservationStock({
  reservationId,
  nextStatus,
  statusDateField,
  actor = null,
}) {
  if (!reservationId) {
    throw new Error("No se encontró el apartado.");
  }

  await runTransaction(db, async (transaction) => {
    const reservationRef = doc(db, "reservations", reservationId);
    const reservationSnap = await transaction.get(reservationRef);

    if (!reservationSnap.exists()) {
      throw new Error("El apartado no existe.");
    }

    const reservation = reservationSnap.data();

    if (reservation.status !== "active") {
      if (nextStatus === "expired") return;

      throw new Error("Solo se pueden liberar apartados activos.");
    }

    const productRef = doc(db, "products", reservation.productId);
    const productSnap = await transaction.get(productRef);

    if (productSnap.exists()) {
      const product = productSnap.data();
      const quantity = Math.max(
        Math.trunc(safeNumber(reservation.quantity, 1)),
        1
      );

      const variantId =
        safeString(reservation.variantId) || "legacy-variant";

      const stockUpdate = buildUpdatedProductStock(
        product,
        variantId,
        quantity
      );

      transaction.update(productRef, {
        variants: stockUpdate.variants,
        stock: stockUpdate.totalStock,
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(reservationRef, {
      status: nextStatus,
      [statusDateField]: serverTimestamp(),

      notificationRead: true,
      notificationReadAt: serverTimestamp(),
      notificationReadByUid: actor?.uid || "",
      notificationReadByName: actor?.name || "",
      notificationReadByEmail: actor?.email || "",
    });
  });
}

export async function cancelReservation(reservationId, actor = null) {
  return restoreReservationStock({
    reservationId,
    nextStatus: "cancelled",
    statusDateField: "cancelledAt",
    actor,
  });
}

export async function expireReservation(reservationId, actor = null) {
  return restoreReservationStock({
    reservationId,
    nextStatus: "expired",
    statusDateField: "expiredAt",
    actor,
  });
}

export async function cancelReservationGroup(groupId, actor = null) {
  if (!groupId) {
    throw new Error("No se encontró el grupo de apartados.");
  }

  const reservationsRef = collection(db, "reservations");
  const q = query(
    reservationsRef,
    where("reservationGroupId", "==", groupId),
    where("status", "==", "active")
  );

  const snapshot = await getDocs(q);

  for (const reservationDoc of snapshot.docs) {
    await cancelReservation(reservationDoc.id, actor);
  }

  const groupRef = doc(db, "reservationGroups", groupId);

  await runTransaction(db, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);

    if (!groupSnap.exists()) return;

    transaction.update(groupRef, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledByUid: actor?.uid || "",
      cancelledByName: actor?.name || "",
      cancelledByEmail: actor?.email || "",
    });
  });

  return snapshot.size;
}

export async function expireOverdueReservations(storeId = STORE_ID) {
  const reservationsRef = collection(db, "reservations");

  const q = query(
    reservationsRef,
    where("storeId", "==", storeId),
    where("status", "==", "active")
  );

  const snapshot = await getDocs(q);
  const now = new Date();

  const overdueReservations = snapshot.docs
    .map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }))
    .filter((reservation) => {
      const expiresAtDate = reservation.expiresAt?.toDate?.();
      return expiresAtDate && expiresAtDate < now;
    });

  for (const reservation of overdueReservations) {
    await expireReservation(reservation.id);
  }

  return overdueReservations.length;
}