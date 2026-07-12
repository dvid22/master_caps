import {
  Timestamp,
  arrayUnion,
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

const DEFAULT_RESERVATION_DAYS = 7;

function safeString(value) {
  return String(value || "").trim();
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDays(value, fallback = DEFAULT_RESERVATION_DAYS) {
  const days = Math.trunc(safeNumber(value, fallback));
  return Math.min(Math.max(days, 1), 365);
}

function normalizeSize(value) {
  const clean = safeString(value);
  if (!clean) return "Talla única";

  const normalized = clean.toUpperCase();

  if (
    normalized === "TALLA UNICA" ||
    normalized === "TALLA ÚNICA" ||
    normalized === "UNICA" ||
    normalized === "ÚNICA"
  ) {
    return "Talla única";
  }

  return clean;
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
      product.images.find((image) => image?.isCover === true) ||
      product.images[0];

    return safeString(cover?.url);
  }

  return safeString(product.imageUrl);
}

function validateCustomer({
  customerName,
  customerDocument,
  customerPhone = "",
}) {
  const cleanName = safeString(customerName);
  const cleanDocument = safeString(customerDocument);
  const cleanPhone = safeString(customerPhone);

  if (!cleanName) throw new Error("Debes escribir el nombre del cliente.");
  if (!cleanDocument) throw new Error("Debes escribir la cédula del cliente.");

  return {
    customerName: cleanName,
    customerDocument: cleanDocument,
    customerPhone: cleanPhone,
  };
}

function normalizeCartItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agrega al menos un producto al apartado.");
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
      throw new Error(`La talla de la línea ${index + 1} no es válida.`);
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

function createGroupNumber(groupRef) {
  return `AP-${groupRef.id.slice(0, 8).toUpperCase()}`;
}

function mapSnapshot(snapshot) {
  return snapshot.docs
    .map((item) => ({
      id: item.id,
      ...item.data(),
    }))
    .sort((a, b) => {
      const dateA = a.reservedAt?.seconds || a.createdAt?.seconds || 0;
      const dateB = b.reservedAt?.seconds || b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
}

function buildPaymentEntry({
  amount,
  paymentMethod,
  notes = "",
  actor = null,
  type = "payment",
}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    amount: Math.max(safeNumber(amount), 0),
    paymentMethod: safeString(paymentMethod) || "efectivo",
    notes: safeString(notes),
    type,
    createdAt: Timestamp.now(),
    actorUid: actor?.uid || "",
    actorName: actor?.name || "",
    actorEmail: actor?.email || "",
  };
}

export function subscribeReservations(callback, onError, storeId = STORE_ID) {
  const q = query(
    collection(db, "reservations"),
    where("storeId", "==", storeId)
  );

  return onSnapshot(
    q,
    (snapshot) => callback(mapSnapshot(snapshot)),
    (error) => {
      console.error("Error escuchando apartados:", error);
      if (onError) onError(error);
    }
  );
}

export function subscribeReservationGroups(callback, onError, storeId = STORE_ID) {
  const q = query(
    collection(db, "reservationGroups"),
    where("storeId", "==", storeId)
  );

  return onSnapshot(
    q,
    (snapshot) => callback(mapSnapshot(snapshot)),
    (error) => {
      console.error("Error escuchando grupos de apartados:", error);
      if (onError) onError(error);
    }
  );
}

export function subscribeReservationSettings(callback, onError, storeId = STORE_ID) {
  const settingsRef = doc(db, "reservationSettings", storeId);

  return onSnapshot(
    settingsRef,
    (snapshot) => {
      callback({
        id: snapshot.id,
        storeId,
        defaultReservationDays: DEFAULT_RESERVATION_DAYS,
        ...(snapshot.exists() ? snapshot.data() : {}),
      });
    },
    (error) => {
      console.error("Error escuchando configuración de apartados:", error);
      if (onError) onError(error);
    }
  );
}

export async function updateReservationSettings({
  storeId = STORE_ID,
  defaultReservationDays,
  actor = null,
  clientVisitorId = "",
  clientSessionId = "",
}) {
  const cleanStoreId = safeString(storeId) || STORE_ID;
  const days = normalizeDays(defaultReservationDays);
  const settingsRef = doc(db, "reservationSettings", cleanStoreId);

  await runTransaction(db, async (transaction) => {
    transaction.set(
      settingsRef,
      {
        storeId: cleanStoreId,
        defaultReservationDays: days,
        updatedAt: serverTimestamp(),
        updatedByUid: actor?.uid || "",
        updatedByName: actor?.name || "",
        updatedByEmail: actor?.email || "",
      },
      { merge: true }
    );
  });

  return days;
}

export async function createReservationCart({
  items = [],
  customerName,
  customerDocument,
  customerPhone = "",
  storeId = STORE_ID,
  source = "catalog-cart",
  reservationDays,
  initialPayment = 0,
  initialPaymentMethod = "efectivo",
  notes = "",
  actor = null,
}) {
  const cleanStoreId = safeString(storeId) || STORE_ID;
  const normalizedItems = normalizeCartItems(items);
  const customer = validateCustomer({
    customerName,
    customerDocument,
    customerPhone,
  });
  const requestedInitialPayment = Math.max(safeNumber(initialPayment), 0);

  return runTransaction(db, async (transaction) => {
    const settingsRef = doc(db, "reservationSettings", cleanStoreId);
    const settingsSnap = await transaction.get(settingsRef);

    const defaultDays = normalizeDays(
      settingsSnap.exists()
        ? settingsSnap.data()?.defaultReservationDays
        : DEFAULT_RESERVATION_DAYS
    );

    const finalReservationDays = normalizeDays(reservationDays, defaultDays);
    const expiresAtDate = new Date(
      Date.now() + finalReservationDays * 24 * 60 * 60 * 1000
    );

    const groupRef = doc(collection(db, "reservationGroups"));
    const groupNumber = createGroupNumber(groupRef);

    const productRefs = normalizedItems.map((item) =>
      doc(db, "products", item.productId)
    );

    const productSnapshots = [];
    for (const productRef of productRefs) {
      productSnapshots.push(await transaction.get(productRef));
    }

    const productStates = new Map();
    const lines = [];

    for (let index = 0; index < normalizedItems.length; index += 1) {
      const requested = normalizedItems[index];
      const productSnap = productSnapshots[index];

      if (!productSnap.exists()) {
        throw new Error(`El producto de la línea ${index + 1} ya no existe.`);
      }

      const product = productSnap.data();

      if (safeString(product.storeId) !== cleanStoreId) {
        throw new Error(
          `El producto "${product.name || "sin nombre"}" no pertenece a esta tienda.`
        );
      }

      let state = productStates.get(requested.productId);

      if (!state) {
        state = {
          productRef: productRefs[index],
          product,
          variants: normalizeVariants(product),
        };
        productStates.set(requested.productId, state);
      }

      const variantIndex = state.variants.findIndex(
        (variant) => variant.id === requested.variantId
      );

      if (variantIndex < 0) {
        throw new Error(
          `La talla ${requested.size} de "${product.name}" ya no existe.`
        );
      }

      const variant = state.variants[variantIndex];

      if (requested.quantity > variant.stock) {
        throw new Error(
          `Solo hay ${variant.stock} unidad(es) de "${product.name}" talla ${variant.size}.`
        );
      }

      state.variants = state.variants.map((currentVariant, currentIndex) =>
        currentIndex === variantIndex
          ? { ...currentVariant, stock: currentVariant.stock - requested.quantity }
          : currentVariant
      );

      const reservationRef = doc(collection(db, "reservations"));
      const unitPrice = Math.max(safeNumber(product.salePrice), 0);
      const costPrice = Math.max(safeNumber(product.costPrice), 0);
      const subtotal = unitPrice * requested.quantity;

      lines.push({
        reservationRef,
        product,
        variant,
        requested,
        unitPrice,
        costPrice,
        subtotal,
      });
    }

    const totalItems = lines.reduce(
      (total, line) => total + line.requested.quantity,
      0
    );
    const subtotal = lines.reduce((total, line) => total + line.subtotal, 0);

    if (requestedInitialPayment > subtotal) {
      throw new Error(
        "El valor entregado no puede superar el total del apartado."
      );
    }

    const amountPaid = requestedInitialPayment;
    const balanceDue = Math.max(subtotal - amountPaid, 0);

    const paymentHistory =
      amountPaid > 0
        ? [
            buildPaymentEntry({
              amount: amountPaid,
              paymentMethod: initialPaymentMethod,
              notes: notes || "Pago inicial del apartado",
              actor,
              type: "initial",
            }),
          ]
        : [];

    for (const state of productStates.values()) {
      transaction.update(state.productRef, {
        variants: state.variants,
        stock: calculateTotalStock(state.variants),
        updatedAt: serverTimestamp(),
      });
    }

    transaction.set(groupRef, {
      storeId: cleanStoreId,
      groupNumber,
      customerName: customer.customerName,
      customerDocument: customer.customerDocument,
      customerPhone: customer.customerPhone,
      status: "active",
      source,
      clientVisitorId: safeString(clientVisitorId),
      clientSessionId: safeString(clientSessionId),
      reservationDays: finalReservationDays,
      totalLines: lines.length,
      totalItems,
      subtotal,
      amountPaid,
      balanceDue,
      initialPayment: amountPaid,
      initialPaymentMethod:
        amountPaid > 0 ? safeString(initialPaymentMethod) || "efectivo" : "",
      paymentHistory,
      notes: safeString(notes),
      reservationIds: lines.map((line) => line.reservationRef.id),
      reservedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAtDate),
      createdByUid: actor?.uid || "",
      createdByName: actor?.name || "",
      createdByEmail: actor?.email || "",
      completedAt: null,
      cancelledAt: null,
      expiredAt: null,
      saleId: null,
    });

    lines.forEach((line, index) => {
      transaction.set(line.reservationRef, {
        storeId: cleanStoreId,
        reservationGroupId: groupRef.id,
        reservationGroupNumber: groupNumber,
        lineNumber: index + 1,
        productId: line.requested.productId,
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
        quantity: line.requested.quantity,
        subtotal: line.subtotal,
        customerName: customer.customerName,
        customerDocument: customer.customerDocument,
        customerPhone: customer.customerPhone,
        status: "active",
        source,
        clientVisitorId: safeString(clientVisitorId),
        clientSessionId: safeString(clientSessionId),
        reservationDays: finalReservationDays,
        reservedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAtDate),
        notificationRead: source === "manual",
        notificationReadAt: source === "manual" ? serverTimestamp() : null,
        notificationReadByUid: source === "manual" ? actor?.uid || "" : "",
        notificationReadByName: source === "manual" ? actor?.name || "" : "",
        notificationReadByEmail: source === "manual" ? actor?.email || "" : "",
        completedAt: null,
        expiredAt: null,
        cancelledAt: null,
        saleId: null,
      });
    });

    return {
      reservationGroupId: groupRef.id,
      reservationGroupNumber: groupNumber,
      reservationIds: lines.map((line) => line.reservationRef.id),
      totalLines: lines.length,
      totalItems,
      subtotal,
      amountPaid,
      balanceDue,
      reservationDays: finalReservationDays,
      expiresAt: expiresAtDate,
    };
  });
}

export async function createManualReservation(payload) {
  return createReservationCart({
    ...payload,
    source: "manual",
  });
}

export async function createReservation(payload) {
  const result = await createReservationCart({
    items: [
      {
        productId: payload.productId,
        variantId:
          safeString(payload.variantId) ||
          (safeString(payload.size || payload.productSize)
            ? "legacy-variant"
            : ""),
        size: payload.size || payload.productSize,
        quantity: payload.quantity || 1,
      },
    ],
    customerName: payload.customerName,
    customerDocument: payload.customerDocument,
    customerPhone: payload.customerPhone || "",
    storeId: payload.storeId || STORE_ID,
    source: "catalog-single",
  });

  return result.reservationIds[0];
}

export async function addReservationGroupPayment({
  groupId,
  amount,
  paymentMethod = "efectivo",
  notes = "",
  actor = null,
}) {
  const cleanAmount = Math.max(safeNumber(amount), 0);

  if (!groupId) throw new Error("No se encontró el apartado.");
  if (cleanAmount <= 0) {
    throw new Error("El valor del abono debe ser mayor a cero.");
  }

  return runTransaction(db, async (transaction) => {
    const groupRef = doc(db, "reservationGroups", groupId);
    const groupSnap = await transaction.get(groupRef);

    if (!groupSnap.exists()) throw new Error("El apartado no existe.");

    const group = groupSnap.data();

    if (group.status !== "active") {
      throw new Error("Solo puedes registrar abonos en apartados activos.");
    }

    const subtotal = Math.max(safeNumber(group.subtotal), 0);
    const amountPaid = Math.max(safeNumber(group.amountPaid), 0);
    const balanceDue = Math.max(subtotal - amountPaid, 0);

    if (cleanAmount > balanceDue) {
      throw new Error(
        "El abono no puede superar el saldo pendiente."
      );
    }

    const nextPaid = amountPaid + cleanAmount;
    const nextBalance = Math.max(subtotal - nextPaid, 0);
    const payment = buildPaymentEntry({
      amount: cleanAmount,
      paymentMethod,
      notes,
      actor,
      type: "installment",
    });

    transaction.update(groupRef, {
      amountPaid: nextPaid,
      balanceDue: nextBalance,
      paymentHistory: arrayUnion(payment),
      updatedAt: serverTimestamp(),
    });

    return {
      amountPaid: nextPaid,
      balanceDue: nextBalance,
      payment,
    };
  });
}

export async function getReservationById(reservationId) {
  const snapshot = await getDoc(doc(db, "reservations", reservationId));

  if (!snapshot.exists()) return null;

  return { id: snapshot.id, ...snapshot.data() };
}

export async function getReservationGroupById(groupId) {
  const snapshot = await getDoc(doc(db, "reservationGroups", groupId));

  if (!snapshot.exists()) return null;

  return { id: snapshot.id, ...snapshot.data() };
}

export async function completeReservationGroupSale({
  groupId,
  paymentMethod = "efectivo",
  notes = "",
  seller = null,
}) {
  if (!groupId) throw new Error("No se encontró el apartado.");

  return runTransaction(db, async (transaction) => {
    const groupRef = doc(db, "reservationGroups", groupId);
    const groupSnap = await transaction.get(groupRef);

    if (!groupSnap.exists()) throw new Error("El apartado no existe.");

    const group = groupSnap.data();

    if (group.status !== "active") {
      throw new Error("Este apartado ya no está activo.");
    }

    const expiresAtDate = group.expiresAt?.toDate?.();

    if (expiresAtDate && expiresAtDate < new Date()) {
      throw new Error("Este apartado ya venció.");
    }

    const reservationIds = Array.isArray(group.reservationIds)
      ? group.reservationIds
      : [];

    if (reservationIds.length === 0) {
      throw new Error("El apartado no contiene productos.");
    }

    const refs = reservationIds.map((id) => doc(db, "reservations", id));
    const snapshots = [];

    for (const ref of refs) {
      snapshots.push(await transaction.get(ref));
    }

    const items = snapshots.map((snapshot, index) => {
      if (!snapshot.exists()) {
        throw new Error(`No se encontró la línea ${index + 1}.`);
      }

      const reservation = snapshot.data();

      if (reservation.status !== "active") {
        throw new Error(`La línea ${index + 1} ya no está activa.`);
      }

      const quantity = Math.max(
        Math.trunc(safeNumber(reservation.quantity, 1)),
        1
      );
      const unitPrice = Math.max(safeNumber(reservation.unitPrice), 0);
      const costPrice = Math.max(safeNumber(reservation.costPrice), 0);

      return {
        reservationId: snapshot.id,
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
        subtotal: unitPrice * quantity,
        totalCost: costPrice * quantity,
      };
    });

    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0);
    const amountPaid = Math.max(safeNumber(group.amountPaid), 0);
    const finalPayment = Math.max(total - amountPaid, 0);
    const totalPaid = amountPaid + finalPayment;

    const saleRef = doc(collection(db, "sales"));

    transaction.set(saleRef, {
      storeId: group.storeId || STORE_ID,
      items,
      totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
      uniqueItems: items.length,
      subtotal: total,
      total,
      totalCost,
      profit: total - totalCost,
      discount: 0,
      amountPaidBeforeSale: amountPaid,
      finalPayment,
      totalPaid,
      balanceDue: 0,
      customerName: group.customerName || "",
      customerDocument: group.customerDocument || "",
      customerPhone: group.customerPhone || "",
      paymentMethod,
      notes: safeString(notes),
      source: "reservation",
      reservationGroupId: groupId,
      reservationGroupNumber: group.groupNumber || "",
      sellerUid: seller?.uid || "",
      sellerName: seller?.name || "",
      sellerEmail: seller?.email || "",
      createdAt: serverTimestamp(),
    });

    const finalPaymentEntry =
      finalPayment > 0
        ? buildPaymentEntry({
            amount: finalPayment,
            paymentMethod,
            notes: notes || "Pago final de la venta",
            actor: seller,
            type: "final",
          })
        : null;

    transaction.update(groupRef, {
      status: "completed",
      completedAt: serverTimestamp(),
      saleId: saleRef.id,
      amountPaid: totalPaid,
      balanceDue: 0,
      finalPayment,
      finalPaymentMethod: paymentMethod,
      ...(finalPaymentEntry
        ? { paymentHistory: arrayUnion(finalPaymentEntry) }
        : {}),
      completedByUid: seller?.uid || "",
      completedByName: seller?.name || "",
      completedByEmail: seller?.email || "",
    });

    refs.forEach((ref) => {
      transaction.update(ref, {
        status: "completed",
        completedAt: serverTimestamp(),
        saleId: saleRef.id,
        paymentMethod,
        notes: safeString(notes),
        notificationRead: true,
        notificationReadAt: serverTimestamp(),
      });
    });

    return saleRef.id;
  });
}

export async function completeReservationSale({
  reservationId,
  paymentMethod = "efectivo",
  notes = "",
  seller = null,
}) {
  const reservation = await getReservationById(reservationId);

  if (!reservation) throw new Error("El apartado no existe.");

  if (!reservation.reservationGroupId) {
    throw new Error(
      "Este apartado antiguo debe migrarse antes de venderlo."
    );
  }

  return completeReservationGroupSale({
    groupId: reservation.reservationGroupId,
    paymentMethod,
    notes,
    seller,
  });
}

export async function markReservationsAsRead({
  reservationIds = [],
  storeId = STORE_ID,
  actor = null,
} = {}) {
  const cleanIds = reservationIds.map(safeString).filter(Boolean);
  const batch = writeBatch(db);
  let count = 0;

  if (cleanIds.length > 0) {
    cleanIds.forEach((reservationId) => {
      batch.update(doc(db, "reservations", reservationId), {
        notificationRead: true,
        notificationReadAt: serverTimestamp(),
        notificationReadByUid: actor?.uid || "",
        notificationReadByName: actor?.name || "",
        notificationReadByEmail: actor?.email || "",
      });
      count += 1;
    });
  } else {
    const q = query(
      collection(db, "reservations"),
      where("storeId", "==", storeId),
      where("status", "==", "active")
    );

    const snapshot = await getDocs(q);

    snapshot.docs.forEach((item) => {
      if (item.data().notificationRead === true) return;

      batch.update(item.ref, {
        notificationRead: true,
        notificationReadAt: serverTimestamp(),
        notificationReadByUid: actor?.uid || "",
        notificationReadByName: actor?.name || "",
        notificationReadByEmail: actor?.email || "",
      });
      count += 1;
    });
  }

  if (count === 0) return 0;

  await batch.commit();
  return count;
}

async function closeReservationGroup({
  groupId,
  nextStatus,
  statusDateField,
  actor = null,
}) {
  if (!groupId) throw new Error("No se encontró el apartado.");

  return runTransaction(db, async (transaction) => {
    const groupRef = doc(db, "reservationGroups", groupId);
    const groupSnap = await transaction.get(groupRef);

    if (!groupSnap.exists()) throw new Error("El apartado no existe.");

    const group = groupSnap.data();

    if (group.status !== "active") {
      if (nextStatus === "expired") return 0;
      throw new Error("Solo se pueden liberar apartados activos.");
    }

    const reservationIds = Array.isArray(group.reservationIds)
      ? group.reservationIds
      : [];

    const reservationRefs = reservationIds.map((id) =>
      doc(db, "reservations", id)
    );

    const reservationSnapshots = [];

    for (const ref of reservationRefs) {
      reservationSnapshots.push(await transaction.get(ref));
    }

    const productIds = [
      ...new Set(
        reservationSnapshots
          .filter((snapshot) => snapshot.exists())
          .map((snapshot) => snapshot.data().productId)
          .filter(Boolean)
      ),
    ];

    const productRefs = productIds.map((id) => doc(db, "products", id));
    const productSnapshots = [];

    for (const ref of productRefs) {
      productSnapshots.push(await transaction.get(ref));
    }

    const states = new Map();

    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists()) return;

      states.set(snapshot.id, {
        ref: productRefs[index],
        variants: normalizeVariants(snapshot.data()),
      });
    });

    reservationSnapshots.forEach((snapshot) => {
      if (!snapshot.exists() || snapshot.data().status !== "active") return;

      const reservation = snapshot.data();
      const state = states.get(reservation.productId);

      if (!state) return;

      const variantIndex = state.variants.findIndex(
        (variant) =>
          variant.id ===
          (safeString(reservation.variantId) || "legacy-variant")
      );

      if (variantIndex < 0) return;

      const quantity = Math.max(
        Math.trunc(safeNumber(reservation.quantity, 1)),
        1
      );

      state.variants = state.variants.map((variant, index) =>
        index === variantIndex
          ? { ...variant, stock: variant.stock + quantity }
          : variant
      );
    });

    for (const state of states.values()) {
      transaction.update(state.ref, {
        variants: state.variants,
        stock: calculateTotalStock(state.variants),
        updatedAt: serverTimestamp(),
      });
    }

    reservationSnapshots.forEach((snapshot) => {
      if (!snapshot.exists() || snapshot.data().status !== "active") return;

      transaction.update(snapshot.ref, {
        status: nextStatus,
        [statusDateField]: serverTimestamp(),
        notificationRead: true,
        notificationReadAt: serverTimestamp(),
      });
    });

    transaction.update(groupRef, {
      status: nextStatus,
      [statusDateField]: serverTimestamp(),
      closedByUid: actor?.uid || "",
      closedByName: actor?.name || "",
      closedByEmail: actor?.email || "",
    });

    return reservationSnapshots.length;
  });
}

export async function cancelReservationGroup(groupId, actor = null) {
  return closeReservationGroup({
    groupId,
    nextStatus: "cancelled",
    statusDateField: "cancelledAt",
    actor,
  });
}

export async function expireReservationGroup(groupId, actor = null) {
  return closeReservationGroup({
    groupId,
    nextStatus: "expired",
    statusDateField: "expiredAt",
    actor,
  });
}

export async function cancelReservation(reservationId, actor = null) {
  const reservation = await getReservationById(reservationId);

  if (!reservation) throw new Error("El apartado no existe.");
  if (!reservation.reservationGroupId) {
    throw new Error("Este apartado antiguo debe migrarse antes de liberarlo.");
  }

  return cancelReservationGroup(reservation.reservationGroupId, actor);
}

export async function expireReservation(reservationId, actor = null) {
  const reservation = await getReservationById(reservationId);

  if (!reservation?.reservationGroupId) return 0;

  return expireReservationGroup(reservation.reservationGroupId, actor);
}

export async function expireOverdueReservations(storeId = STORE_ID) {
  const q = query(
    collection(db, "reservationGroups"),
    where("storeId", "==", storeId),
    where("status", "==", "active")
  );

  const snapshot = await getDocs(q);
  const now = new Date();

  const overdue = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((group) => {
      const expiresAt = group.expiresAt?.toDate?.();
      return expiresAt && expiresAt < now;
    });

  for (const group of overdue) {
    await expireReservationGroup(group.id);
  }

  return overdue.length;
}