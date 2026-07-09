import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";

export const STORE_ID = "master-caps";

export function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mapCategoriesSnapshot(snapshot) {
  return snapshot.docs
    .map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function subscribeCategories(
  callback,
  onError,
  storeId = STORE_ID
) {
  const categoriesRef = collection(db, "categories");

  const q = query(categoriesRef, where("storeId", "==", storeId));

  return onSnapshot(
    q,
    (snapshot) => {
      callback(mapCategoriesSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando categorías:", error);
      if (onError) onError(error);
    }
  );
}

export async function getCategories(storeId = STORE_ID) {
  const categoriesRef = collection(db, "categories");

  const q = query(categoriesRef, where("storeId", "==", storeId));
  const snapshot = await getDocs(q);

  return mapCategoriesSnapshot(snapshot);
}

export async function getOrCreateCategory(name, storeId = STORE_ID) {
  const cleanName = String(name || "").trim();

  if (!cleanName) {
    throw new Error("Debes escribir una categoría.");
  }

  const normalizedName = normalizeText(cleanName);

  const categoriesRef = collection(db, "categories");

  const q = query(
    categoriesRef,
    where("storeId", "==", storeId),
    where("normalizedName", "==", normalizedName),
    limit(1)
  );

  const snapshot = await getDocs(q);

  if (!snapshot.empty) {
    const existingDoc = snapshot.docs[0];

    return {
      id: existingDoc.id,
      ...existingDoc.data(),
    };
  }

  const docRef = await addDoc(categoriesRef, {
    storeId,
    name: cleanName,
    normalizedName,
    createdAt: serverTimestamp(),
  });

  return {
    id: docRef.id,
    storeId,
    name: cleanName,
    normalizedName,
  };
}