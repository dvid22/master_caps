import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

export const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories";

export const SYSTEM_EXPENSE_CATEGORIES = [
  { slug: "services", name: "Servicios", order: 10 },
  { slug: "rent", name: "Arriendo", order: 20 },
  { slug: "payroll", name: "Nómina", order: 30, protected: true },
  { slug: "transport", name: "Transporte", order: 40 },
  { slug: "inventory", name: "Compras de inventario", order: 50 },
  { slug: "maintenance", name: "Mantenimiento", order: 60 },
  { slug: "advertising", name: "Publicidad", order: 70 },
  { slug: "stationery", name: "Papelería", order: 80 },
  { slug: "taxes", name: "Impuestos", order: 90 },
  { slug: "other", name: "Otros", order: 100, protected: true },
];

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return cleanString(value).replace(/\s+/g, " ");
}

function normalizeSlug(value) {
  return cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapSnapshot(snapshot) {
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => {
      const orderDiff = Number(a.order || 0) - Number(b.order || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.name || "").localeCompare(String(b.name || ""), "es");
    });
}

export function normalizeExpenseCategoryPayload(payload = {}) {
  const name = normalizeName(payload.name);
  const slug = normalizeSlug(payload.slug || name);

  return {
    name,
    slug,
    description: cleanString(payload.description),
    active: payload.active !== false,
    color: cleanString(payload.color) || "red",
    order: Math.max(Number(payload.order || 0), 0),
  };
}

export function validateExpenseCategoryPayload(payload = {}) {
  const category = normalizeExpenseCategoryPayload(payload);

  if (!category.name) {
    throw new Error("Debes escribir el nombre de la categoría.");
  }

  if (!category.slug) {
    throw new Error("No se pudo generar un identificador válido.");
  }

  if (category.name.length > 50) {
    throw new Error("El nombre no puede superar los 50 caracteres.");
  }

  return category;
}

export async function seedExpenseCategories(storeId = STORE_ID) {
  const safeStoreId = cleanString(storeId) || STORE_ID;
  const existingSnapshot = await getDocs(
    query(
      collection(db, EXPENSE_CATEGORIES_COLLECTION),
      where("storeId", "==", safeStoreId)
    )
  );

  const existingSlugs = new Set(
    existingSnapshot.docs.map((item) => item.data()?.slug)
  );

  const missing = SYSTEM_EXPENSE_CATEGORIES.filter(
    (category) => !existingSlugs.has(category.slug)
  );

  if (!missing.length) return false;

  const batch = writeBatch(db);

  missing.forEach((category) => {
    const categoryRef = doc(
      collection(db, EXPENSE_CATEGORIES_COLLECTION)
    );

    batch.set(categoryRef, {
      storeId: safeStoreId,
      ...category,
      description: "",
      active: true,
      system: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
  return true;
}

export function subscribeExpenseCategories(
  callback,
  onError,
  storeId = STORE_ID,
  { includeInactive = false } = {}
) {
  const safeStoreId = cleanString(storeId) || STORE_ID;

  const unsubscribe = onSnapshot(
    query(
      collection(db, EXPENSE_CATEGORIES_COLLECTION),
      where("storeId", "==", safeStoreId)
    ),
    async (snapshot) => {
      if (snapshot.empty) {
        try {
          await seedExpenseCategories(safeStoreId);
        } catch (error) {
          console.error("No se pudieron crear las categorías iniciales:", error);
        }
        return;
      }

      const categories = mapSnapshot(snapshot);
      callback(
        includeInactive
          ? categories
          : categories.filter((category) => category.active !== false)
      );
    },
    (error) => {
      console.error("Error escuchando categorías de gastos:", error);
      onError?.(error);
    }
  );

  return unsubscribe;
}

export async function createExpenseCategory({
  storeId = STORE_ID,
  category,
  actor = null,
}) {
  const safeStoreId = cleanString(storeId) || STORE_ID;
  const normalized = validateExpenseCategoryPayload(category);

  const duplicateSnapshot = await getDocs(
    query(
      collection(db, EXPENSE_CATEGORIES_COLLECTION),
      where("storeId", "==", safeStoreId),
      where("slug", "==", normalized.slug)
    )
  );

  if (!duplicateSnapshot.empty) {
    throw new Error("Ya existe una categoría con ese nombre.");
  }

  const reference = await addDoc(
    collection(db, EXPENSE_CATEGORIES_COLLECTION),
    {
      storeId: safeStoreId,
      ...normalized,
      system: false,
      protected: false,
      createdByUid: actor?.uid || "",
      createdByName: actor?.name || "",
      createdByEmail: actor?.email || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
  );

  return { id: reference.id, storeId: safeStoreId, ...normalized };
}

export async function updateExpenseCategory(
  categoryId,
  payload,
  actor = null
) {
  const safeId = cleanString(categoryId);
  if (!safeId) throw new Error("No se encontró la categoría.");

  const normalized = validateExpenseCategoryPayload(payload);

  await updateDoc(
    doc(db, EXPENSE_CATEGORIES_COLLECTION, safeId),
    {
      ...normalized,
      updatedByUid: actor?.uid || "",
      updatedByName: actor?.name || "",
      updatedByEmail: actor?.email || "",
      updatedAt: serverTimestamp(),
    }
  );

  return normalized;
}

export async function setExpenseCategoryActive(
  categoryId,
  active,
  actor = null
) {
  const safeId = cleanString(categoryId);
  if (!safeId) throw new Error("No se encontró la categoría.");

  await updateDoc(
    doc(db, EXPENSE_CATEGORIES_COLLECTION, safeId),
    {
      active: Boolean(active),
      updatedByUid: actor?.uid || "",
      updatedByName: actor?.name || "",
      updatedByEmail: actor?.email || "",
      updatedAt: serverTimestamp(),
    }
  );
}

export async function deleteExpenseCategory({
  category,
  storeId = STORE_ID,
}) {
  const safeId = cleanString(category?.id);
  if (!safeId) throw new Error("No se encontró la categoría.");

  if (category?.protected || category?.slug === "payroll" || category?.slug === "other") {
    throw new Error("Esta categoría es necesaria para el sistema y no se puede eliminar.");
  }

  const safeStoreId = cleanString(storeId) || STORE_ID;

  const usageSnapshot = await getDocs(
    query(
      collection(db, "expenses"),
      where("storeId", "==", safeStoreId),
      where("category", "==", category.slug)
    )
  );

  if (!usageSnapshot.empty) {
    throw new Error(
      "La categoría ya tiene gastos asociados. Puedes desactivarla, pero no eliminarla."
    );
  }

  await deleteDoc(
    doc(db, EXPENSE_CATEGORIES_COLLECTION, safeId)
  );

  return true;
}

export function toExpenseCategoryOptions(categories = []) {
  return categories
    .filter((category) => category.active !== false)
    .map((category) => ({
      value: category.slug,
      label: category.name,
      id: category.id,
    }));
}