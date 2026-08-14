import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";

export const STORE_ID = "master-caps";

export const CATEGORIES_COLLECTION = "categories";
export const CATEGORY_INDEX_COLLECTION = "categoryUniqueIndexes";

/* -------------------------------------------------------------------------- */
/*                              NORMALIZACIÓN                                  */
/* -------------------------------------------------------------------------- */

export function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es-CO")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeCategoryName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es-CO");
}

function createSlug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createCategoryIndexId({
  storeId,
  parentCategoryId,
  normalizedName,
}) {
  const safeStoreId = String(storeId || STORE_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");

  const safeParentId = String(parentCategoryId || "unassigned")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");

  const safeName = createSlug(normalizedName);

  return `${safeStoreId}__${safeParentId}__${safeName}`;
}

function normalizeSortOrder(value, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(Math.trunc(number), 0);
}

/* -------------------------------------------------------------------------- */
/*                              MAPEO Y ORDEN                                  */
/* -------------------------------------------------------------------------- */

function mapCategoryDocument(documentSnapshot) {
  if (!documentSnapshot?.exists()) {
    return null;
  }

  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

function sortCategories(categories) {
  return [...categories].sort((left, right) => {
    const leftParent = String(left.parentCategoryName || "");
    const rightParent = String(right.parentCategoryName || "");

    const parentComparison = leftParent.localeCompare(
      rightParent,
      "es-CO"
    );

    if (parentComparison !== 0) {
      return parentComparison;
    }

    const orderDifference =
      normalizeSortOrder(left.sortOrder) -
      normalizeSortOrder(right.sortOrder);

    if (orderDifference !== 0) {
      return orderDifference;
    }

    return String(left.name || "").localeCompare(
      String(right.name || ""),
      "es-CO"
    );
  });
}

function mapCategoriesSnapshot(snapshot) {
  return sortCategories(
    snapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }))
  );
}

/* -------------------------------------------------------------------------- */
/*                         CACHÉ Y LISTENER COMPARTIDO                         */
/* -------------------------------------------------------------------------- */

/**
 * Registro compartido de categorías por tienda.
 *
 * - Un único onSnapshot real por storeId.
 * - Varios consumidores pueden reutilizar el mismo listener.
 * - El último snapshot queda en memoria durante la sesión.
 * - Las suscripciones por categoría principal se derivan del mismo snapshot,
 *   evitando listeners adicionales a Firestore.
 *
 * La persistencia entre recargas sigue siendo responsabilidad de la caché
 * IndexedDB configurada en firebase.js.
 */
const categoriesRealtimeRegistry = new Map();

function normalizeStoreId(storeId = STORE_ID) {
  const cleanStoreId = String(storeId || STORE_ID).trim();

  return cleanStoreId || STORE_ID;
}

function createCategoriesRealtimeEntry(storeId) {
  return {
    storeId,
    subscribers: new Set(),
    categories: [],
    hasSnapshot: false,
    unsubscribeFirestore: null,
    lastError: null,
  };
}

function getCategoriesRealtimeEntry(storeId = STORE_ID) {
  const cleanStoreId = normalizeStoreId(storeId);

  if (!categoriesRealtimeRegistry.has(cleanStoreId)) {
    categoriesRealtimeRegistry.set(
      cleanStoreId,
      createCategoriesRealtimeEntry(cleanStoreId)
    );
  }

  return categoriesRealtimeRegistry.get(cleanStoreId);
}

function getCategoriesForSubscriber(entry, subscriber) {
  if (!subscriber.mainCategoryId) {
    return entry.categories;
  }

  return entry.categories.filter(
    (category) =>
      String(category.parentCategoryId || "").trim() ===
      subscriber.mainCategoryId
  );
}

function notifyCategorySubscriber(entry, subscriber) {
  try {
    subscriber.callback(
      getCategoriesForSubscriber(entry, subscriber)
    );
  } catch (error) {
    console.error(
      "Error entregando categorías a un suscriptor:",
      error
    );
  }
}

function notifyCategorySubscribers(entry) {
  entry.subscribers.forEach((subscriber) => {
    notifyCategorySubscriber(entry, subscriber);
  });
}

function notifyCategorySubscribersError(entry, error) {
  entry.subscribers.forEach((subscriber) => {
    if (typeof subscriber.onError !== "function") {
      return;
    }

    try {
      subscriber.onError(error);
    } catch (subscriberError) {
      console.error(
        "Error ejecutando el manejador de error de categorías:",
        subscriberError
      );
    }
  });
}

function ensureCategoriesRealtimeListener(entry) {
  if (entry.unsubscribeFirestore) {
    return;
  }

  const categoriesRef = collection(
    db,
    CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", entry.storeId)
  );

  entry.unsubscribeFirestore = onSnapshot(
    categoriesQuery,
    (snapshot) => {
      entry.categories =
        mapCategoriesSnapshot(snapshot);
      entry.hasSnapshot = true;
      entry.lastError = null;

      notifyCategorySubscribers(entry);
    },
    (error) => {
      console.error(
        `Error escuchando categorías de la tienda "${entry.storeId}":`,
        error
      );

      entry.lastError = error;
      entry.unsubscribeFirestore = null;

      notifyCategorySubscribersError(
        entry,
        error
      );
    }
  );
}

function addCategoriesSubscriber({
  callback,
  onError,
  storeId,
  mainCategoryId = "",
}) {
  if (typeof callback !== "function") {
    throw new TypeError(
      "La suscripción de categorías necesita una función callback."
    );
  }

  const entry =
    getCategoriesRealtimeEntry(storeId);

  const subscriber = {
    callback,
    onError:
      typeof onError === "function"
        ? onError
        : null,
    mainCategoryId: String(
      mainCategoryId || ""
    ).trim(),
  };

  entry.subscribers.add(subscriber);

  if (entry.hasSnapshot) {
    notifyCategorySubscriber(
      entry,
      subscriber
    );
  }

  ensureCategoriesRealtimeListener(entry);

  let active = true;

  return () => {
    if (!active) {
      return;
    }

    active = false;
    entry.subscribers.delete(subscriber);
  };
}

/* -------------------------------------------------------------------------- */
/*                              LECTURA GENERAL                                */
/* -------------------------------------------------------------------------- */

export function subscribeCategories(
  callback,
  onError,
  storeId = STORE_ID
) {
  return addCategoriesSubscriber({
    callback,
    onError,
    storeId,
  });
}

export async function getCategories(
  storeId = STORE_ID
) {
  const cleanStoreId =
    normalizeStoreId(storeId);

  const cachedEntry =
    categoriesRealtimeRegistry.get(
      cleanStoreId
    );

  if (cachedEntry?.hasSnapshot) {
    return cachedEntry.categories;
  }

  const categoriesRef = collection(
    db,
    CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", cleanStoreId)
  );

  const snapshot = await getDocs(
    categoriesQuery
  );

  return mapCategoriesSnapshot(snapshot);
}

export async function getCategoryById(
  categoryId
) {
  const cleanCategoryId = String(
    categoryId || ""
  ).trim();

  if (!cleanCategoryId) {
    return null;
  }

  for (const entry of categoriesRealtimeRegistry.values()) {
    if (!entry.hasSnapshot) {
      continue;
    }

    const cachedCategory =
      entry.categories.find(
        (category) =>
          category.id ===
          cleanCategoryId
      );

    if (cachedCategory) {
      return cachedCategory;
    }
  }

  const categoryRef = doc(
    db,
    CATEGORIES_COLLECTION,
    cleanCategoryId
  );

  const snapshot = await getDoc(categoryRef);

  return mapCategoryDocument(snapshot);
}

/* -------------------------------------------------------------------------- */
/*                     SUBCATEGORÍAS POR CATEGORÍA PRINCIPAL                   */
/* -------------------------------------------------------------------------- */

export function subscribeSubcategoriesByMainCategory(
  mainCategoryId,
  callback,
  onError,
  storeId = STORE_ID
) {
  const cleanMainCategoryId = String(
    mainCategoryId || ""
  ).trim();

  if (!cleanMainCategoryId) {
    callback([]);
    return () => {};
  }

  return addCategoriesSubscriber({
    callback,
    onError,
    storeId,
    mainCategoryId:
      cleanMainCategoryId,
  });
}

export async function getSubcategoriesByMainCategory(
  mainCategoryId,
  storeId = STORE_ID
) {
  const cleanMainCategoryId = String(
    mainCategoryId || ""
  ).trim();

  if (!cleanMainCategoryId) {
    return [];
  }

  const cleanStoreId =
    normalizeStoreId(storeId);

  const cachedEntry =
    categoriesRealtimeRegistry.get(
      cleanStoreId
    );

  if (cachedEntry?.hasSnapshot) {
    return cachedEntry.categories.filter(
      (category) =>
        String(
          category.parentCategoryId || ""
        ).trim() === cleanMainCategoryId
    );
  }

  const categoriesRef = collection(
    db,
    CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", cleanStoreId),
    where(
      "parentCategoryId",
      "==",
      cleanMainCategoryId
    )
  );

  const snapshot = await getDocs(
    categoriesQuery
  );

  return mapCategoriesSnapshot(snapshot);
}

export async function getUnassignedCategories(
  storeId = STORE_ID
) {
  const categories =
    await getCategories(storeId);

  return categories.filter(
    (category) =>
      !String(
        category.parentCategoryId || ""
      ).trim()
  );
}

/**
 * Limpieza opcional de caché/listeners en memoria.
 *
 * No se necesita durante la navegación normal. Puede utilizarse al cerrar
 * sesión o si en el futuro la app cambia dinámicamente de tienda.
 */
export function clearCategoriesRealtimeCache(
  storeId
) {
  if (
    storeId !== undefined &&
    storeId !== null
  ) {
    const cleanStoreId =
      normalizeStoreId(storeId);

    const entry =
      categoriesRealtimeRegistry.get(
        cleanStoreId
      );

    if (!entry) {
      return;
    }

    if (
      typeof entry.unsubscribeFirestore ===
      "function"
    ) {
      entry.unsubscribeFirestore();
    }

    entry.subscribers.clear();
    categoriesRealtimeRegistry.delete(
      cleanStoreId
    );

    return;
  }

  categoriesRealtimeRegistry.forEach(
    (entry) => {
      if (
        typeof entry.unsubscribeFirestore ===
        "function"
      ) {
        entry.unsubscribeFirestore();
      }

      entry.subscribers.clear();
    }
  );

  categoriesRealtimeRegistry.clear();
}

/* -------------------------------------------------------------------------- */
/*                         CREAR NUEVA SUBCATEGORÍA                            */
/* -------------------------------------------------------------------------- */

export async function getOrCreateSubcategory(
  name,
  parentCategoryId,
  storeId = STORE_ID,
  actor = {}
) {
  const cleanName = normalizeCategoryName(name);

  const cleanParentCategoryId = String(
    parentCategoryId || ""
  ).trim();

  if (!cleanName) {
    throw new Error(
      "Debes escribir el nombre de la subcategoría."
    );
  }

  if (!cleanParentCategoryId) {
    throw new Error(
      "Selecciona una categoría principal."
    );
  }

  const normalizedName = normalizeText(cleanName);

  if (!normalizedName) {
    throw new Error(
      "El nombre de la subcategoría no es válido."
    );
  }

  const mainCategoryRef = doc(
    db,
    "mainCategories",
    cleanParentCategoryId
  );

  const categoryRef = doc(
    collection(
      db,
      CATEGORIES_COLLECTION
    )
  );

  const indexRef = doc(
    db,
    CATEGORY_INDEX_COLLECTION,
    createCategoryIndexId({
      storeId,
      parentCategoryId:
        cleanParentCategoryId,
      normalizedName,
    })
  );

  let result = null;

  await runTransaction(
    db,
    async (transaction) => {
      const [
        mainCategorySnapshot,
        indexSnapshot,
      ] = await Promise.all([
        transaction.get(mainCategoryRef),
        transaction.get(indexRef),
      ]);

      if (!mainCategorySnapshot.exists()) {
        throw new Error(
          "La categoría principal seleccionada ya no existe."
        );
      }

      const mainCategory =
        mainCategorySnapshot.data();

      if (
        mainCategory.storeId &&
        mainCategory.storeId !== storeId
      ) {
        throw new Error(
          "La categoría principal pertenece a otra tienda."
        );
      }

      if (mainCategory.isActive === false) {
        throw new Error(
          "No puedes crear subcategorías dentro de una categoría archivada."
        );
      }

      if (indexSnapshot.exists()) {
        const indexData =
          indexSnapshot.data();

        const existingCategoryId = String(
          indexData.categoryId || ""
        ).trim();

        if (existingCategoryId) {
          const existingCategoryRef = doc(
            db,
            CATEGORIES_COLLECTION,
            existingCategoryId
          );

          const existingCategorySnapshot =
            await transaction.get(
              existingCategoryRef
            );

          if (
            existingCategorySnapshot.exists()
          ) {
            result = {
              id:
                existingCategorySnapshot.id,
              ...existingCategorySnapshot.data(),
            };

            return;
          }
        }
      }

      const mainCategoryName =
        normalizeCategoryName(
          mainCategory.name
        );

      const nextCategory = {
        storeId,
        name: cleanName,
        normalizedName,
        slug: createSlug(cleanName),

        parentCategoryId:
          cleanParentCategoryId,
        parentCategoryName:
          mainCategoryName,

        sortOrder: 0,
        isActive: true,
        schemaVersion: 2,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        createdByUid: String(
          actor?.uid || ""
        ),
        createdByName: String(
          actor?.name || ""
        ),
        createdByEmail: String(
          actor?.email || ""
        ),
      };

      transaction.set(
        categoryRef,
        nextCategory
      );

      transaction.set(indexRef, {
        storeId,
        parentCategoryId:
          cleanParentCategoryId,
        normalizedName,
        categoryId: categoryRef.id,
        createdAt: serverTimestamp(),
      });

      result = {
        id: categoryRef.id,
        ...nextCategory,
      };
    }
  );

  return result;
}

/* -------------------------------------------------------------------------- */
/*                     COMPATIBILIDAD CON EL CÓDIGO ANTERIOR                   */
/* -------------------------------------------------------------------------- */

export async function getOrCreateCategory(
  name,
  storeId = STORE_ID,
  options = {}
) {
  const cleanParentCategoryId = String(
    options?.parentCategoryId || ""
  ).trim();

  if (cleanParentCategoryId) {
    return getOrCreateSubcategory(
      name,
      cleanParentCategoryId,
      storeId,
      options?.actor || {}
    );
  }

  const cleanName = normalizeCategoryName(name);

  if (!cleanName) {
    throw new Error(
      "Debes escribir una categoría."
    );
  }

  const normalizedName = normalizeText(cleanName);

  const categoriesRef = collection(
    db,
    CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", storeId),
    where(
      "normalizedName",
      "==",
      normalizedName
    ),
    limit(1)
  );

  const snapshot = await getDocs(
    categoriesQuery
  );

  if (!snapshot.empty) {
    const existingDoc = snapshot.docs[0];

    return {
      id: existingDoc.id,
      ...existingDoc.data(),
    };
  }

  throw new Error(
    "Ya no se pueden crear categorías sueltas. Selecciona una categoría principal y crea una subcategoría."
  );
}