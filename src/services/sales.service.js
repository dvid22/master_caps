import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

function mapSalesSnapshot(snapshot) {
  return snapshot.docs
    .map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }))
    .sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
}

export function subscribeSales(callback, onError, storeId = STORE_ID) {
  const salesRef = collection(db, "sales");
  const q = query(salesRef, where("storeId", "==", storeId));

  return onSnapshot(
    q,
    (snapshot) => {
      callback(mapSalesSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando ventas:", error);
      if (onError) onError(error);
    }
  );
}

export async function getSales(storeId = STORE_ID) {
  const salesRef = collection(db, "sales");
  const q = query(salesRef, where("storeId", "==", storeId));
  const snapshot = await getDocs(q);

  return mapSalesSnapshot(snapshot);
}

export async function createDirectSale({
  productId,
  quantity,
  customerName = "",
  paymentMethod = "efectivo",
  notes = "",
  storeId = STORE_ID,
  seller = null,
}) {
  if (!productId) {
    throw new Error("Debes seleccionar un producto.");
  }

  const cleanQuantity = Number(quantity || 0);

  if (!Number.isFinite(cleanQuantity) || cleanQuantity <= 0) {
    throw new Error("La cantidad debe ser mayor a cero.");
  }

  const saleId = await runTransaction(db, async (transaction) => {
    const productRef = doc(db, "products", productId);
    const productSnap = await transaction.get(productRef);

    if (!productSnap.exists()) {
      throw new Error("El producto no existe.");
    }

    const product = productSnap.data();
    const currentStock = Number(product.stock || 0);

    if (product.storeId !== storeId) {
      throw new Error("Este producto no pertenece a esta tienda.");
    }

    if (currentStock <= 0) {
      throw new Error("Este producto no tiene stock disponible.");
    }

    if (cleanQuantity > currentStock) {
      throw new Error(
        `No puedes vender ${cleanQuantity} unidad(es). Solo hay ${currentStock} disponible(s).`
      );
    }

    const unitPrice = Number(product.salePrice || 0);
    const costPrice = Number(product.costPrice || 0);
    const total = unitPrice * cleanQuantity;
    const totalCost = costPrice * cleanQuantity;
    const profit = total - totalCost;
    const newStock = currentStock - cleanQuantity;

    transaction.update(productRef, {
      stock: newStock,
      updatedAt: serverTimestamp(),
    });

    const saleRef = doc(collection(db, "sales"));

    transaction.set(saleRef, {
      storeId,
      productId,
      productName: product.name || "",
      productCode: product.code || "",
      productSize: product.size || "Talla única",
      categoryId: product.categoryId || "",
      categoryName: product.categoryName || "",

      quantity: cleanQuantity,
      unitPrice,
      costPrice,
      total,
      totalCost,
      profit,

      customerName: String(customerName || "").trim(),
      paymentMethod,
      notes: String(notes || "").trim(),

      source: "direct",
      reservationId: null,

      sellerUid: seller?.uid || "",
      sellerName: seller?.name || "",
      sellerEmail: seller?.email || "",

      createdAt: serverTimestamp(),
    });

    return saleRef.id;
  });

  return saleId;
}