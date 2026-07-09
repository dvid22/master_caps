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

export async function createReservation({
  productId,
  customerName,
  customerDocument,
  customerPhone = "",
  storeId = STORE_ID,
}) {
  const cleanProductId = String(productId || "").trim();
  const cleanName = String(customerName || "").trim();
  const cleanDocument = String(customerDocument || "").trim();
  const cleanPhone = String(customerPhone || "").trim();

  if (!cleanProductId) {
    throw new Error("No se encontró el producto a apartar.");
  }

  if (!cleanName) {
    throw new Error("Debes escribir tu nombre.");
  }

  if (!cleanDocument) {
    throw new Error("Debes escribir tu cédula.");
  }

  const now = new Date();
  const expiresAtDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const reservationId = await runTransaction(db, async (transaction) => {
    const productRef = doc(db, "products", cleanProductId);
    const productSnap = await transaction.get(productRef);

    if (!productSnap.exists()) {
      throw new Error("El producto ya no existe.");
    }

    const product = productSnap.data();
    const currentStock = Number(product.stock || 0);

    if (product.storeId !== storeId) {
      throw new Error("Este producto no pertenece a esta tienda.");
    }

    if (currentStock <= 0) {
      throw new Error("Esta prenda ya no está disponible.");
    }

    const newStock = currentStock - 1;

    transaction.update(productRef, {
      stock: newStock,
      updatedAt: serverTimestamp(),
    });

    const reservationRef = doc(collection(db, "reservations"));

    transaction.set(reservationRef, {
      storeId,
      productId: cleanProductId,
      productName: product.name || "",
      productCode: product.code || "",
      productImageUrl: product.imageUrl || "",
      categoryId: product.categoryId || "",
      categoryName: product.categoryName || "",
      unitPrice: Number(product.salePrice || 0),
      costPrice: Number(product.costPrice || 0),
      quantity: 1,

      customerName: cleanName,
      customerDocument: cleanDocument,
      customerPhone: cleanPhone,

      status: "active",
      source: "catalog",
      reservedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAtDate),

      completedAt: null,
      expiredAt: null,
      cancelledAt: null,
      saleId: null,
    });

    return reservationRef.id;
  });

  return reservationId;
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

export async function completeReservationSale({
  reservationId,
  paymentMethod = "efectivo",
  notes = "",
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

    const quantity = Number(reservation.quantity || 1);
    const unitPrice = Number(reservation.unitPrice || 0);
    const costPrice = Number(reservation.costPrice || 0);
    const total = unitPrice * quantity;
    const totalCost = costPrice * quantity;
    const profit = total - totalCost;

    const saleRef = doc(collection(db, "sales"));

    transaction.set(saleRef, {
      storeId: reservation.storeId || STORE_ID,
      productId: reservation.productId || "",
      productName: reservation.productName || "",
      productCode: reservation.productCode || "",
      categoryId: reservation.categoryId || "",
      categoryName: reservation.categoryName || "",
      quantity,
      unitPrice,
      costPrice,
      total,
      totalCost,
      profit,
      customerName: reservation.customerName || "",
      customerDocument: reservation.customerDocument || "",
      customerPhone: reservation.customerPhone || "",
      paymentMethod,
      notes: String(notes || "").trim(),
      source: "reservation",
      reservationId,
      createdAt: serverTimestamp(),
    });

    transaction.update(reservationRef, {
      status: "completed",
      completedAt: serverTimestamp(),
      saleId: saleRef.id,
      paymentMethod,
      notes: String(notes || "").trim(),
    });

    return saleRef.id;
  });

  return saleId;
}

export async function cancelReservation(reservationId) {
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
      throw new Error("Solo se pueden liberar apartados activos.");
    }

    const productRef = doc(db, "products", reservation.productId);
    const productSnap = await transaction.get(productRef);

    if (productSnap.exists()) {
      const product = productSnap.data();
      const currentStock = Number(product.stock || 0);
      const quantity = Number(reservation.quantity || 1);

      transaction.update(productRef, {
        stock: currentStock + quantity,
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(reservationRef, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
    });
  });
}

export async function expireReservation(reservationId) {
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
      return;
    }

    const productRef = doc(db, "products", reservation.productId);
    const productSnap = await transaction.get(productRef);

    if (productSnap.exists()) {
      const product = productSnap.data();
      const currentStock = Number(product.stock || 0);
      const quantity = Number(reservation.quantity || 1);

      transaction.update(productRef, {
        stock: currentStock + quantity,
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(reservationRef, {
      status: "expired",
      expiredAt: serverTimestamp(),
    });
  });
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