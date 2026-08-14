import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import {
  STORE_ID,
  normalizeText,
} from "./categories.service";

export const MAIN_CATEGORIES_COLLECTION =
  "mainCategories";

export const MAIN_CATEGORY_INDEX_COLLECTION =
  "mainCategoryUniqueIndexes";

/* -------------------------------------------------------------------------- */
/*                              UTILIDADES INTERNAS                            */
/* -------------------------------------------------------------------------- */

function cleanDisplayName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es-CO");
}

function normalizeOrder(value, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(Math.trunc(number), 0);
}

function normalizeBoolean(value, fallback = true) {
  return typeof value === "boolean"
    ? value
    : fallback;
}

function createSlug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createIndexId(storeId, normalizedName) {
  const safeStoreId = String(storeId || STORE_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");

  const safeName = createSlug(normalizedName);

  return `${safeStoreId}__${safeName}`;
}

function mapMainCategoryDocument(documentSnapshot) {
  if (!documentSnapshot?.exists()) {
    return null;
  }

  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

function mapMainCategoriesSnapshot(snapshot) {
  return snapshot.docs
    .map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    }))
    .sort((left, right) => {
      const orderDifference =
        normalizeOrder(left.sortOrder) -
        normalizeOrder(right.sortOrder);

      if (orderDifference !== 0) {
        return orderDifference;
      }

      return String(left.name || "").localeCompare(
        String(right.name || ""),
        "es-CO"
      );
    });
}

async function getNextSortOrder(storeId) {
  const cleanStoreId = normalizeStoreId(storeId);

  const cachedEntry =
    mainCategoriesRealtimeRegistry.get(cleanStoreId);

  const currentCategories =
    cachedEntry?.hasSnapshot
      ? cachedEntry.categories
      : await getMainCategories(cleanStoreId);

  if (currentCategories.length === 0) {
    return 0;
  }

  return (
    Math.max(
      ...currentCategories.map((category) =>
        normalizeOrder(category.sortOrder)
      )
    ) + 1
  );
}

function buildMainCategoryPayload({
  name,
  sortOrder,
  isActive,
  actor,
}) {
  const cleanName = cleanDisplayName(name);
  const normalizedName = normalizeText(cleanName);

  if (!cleanName) {
    throw new Error(
      "Debes escribir el nombre de la categoría principal."
    );
  }

  if (!normalizedName) {
    throw new Error(
      "El nombre de la categoría principal no es válido."
    );
  }

  return {
    cleanName,
    normalizedName,
    slug: createSlug(cleanName),
    sortOrder: normalizeOrder(sortOrder),
    isActive: normalizeBoolean(isActive, true),
    actor: {
      uid: String(actor?.uid || ""),
      name: String(actor?.name || ""),
      email: String(actor?.email || ""),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                         CACHÉ Y LISTENER COMPARTIDO                         */
/* -------------------------------------------------------------------------- */

/**
 * Registro compartido de categorías principales por tienda.
 *
 * - Mantiene un único onSnapshot real por storeId.
 * - Permite múltiples consumidores sin duplicar listeners de Firestore.
 * - Conserva el último snapshot normalizado en memoria durante la sesión.
 * - Respeta includeArchived de forma individual para cada consumidor.
 *
 * La persistencia entre recargas sigue siendo responsabilidad de la caché
 * IndexedDB configurada en firebase.js.
 */
const mainCategoriesRealtimeRegistry = new Map();

function normalizeStoreId(storeId = STORE_ID) {
  const cleanStoreId = String(storeId || STORE_ID).trim();

  return cleanStoreId || STORE_ID;
}

function createMainCategoriesRealtimeEntry(storeId) {
  return {
    storeId,
    subscribers: new Set(),
    categories: [],
    hasSnapshot: false,
    unsubscribeFirestore: null,
    lastError: null,
  };
}

function getMainCategoriesRealtimeEntry(
  storeId = STORE_ID
) {
  const cleanStoreId =
    normalizeStoreId(storeId);

  if (
    !mainCategoriesRealtimeRegistry.has(
      cleanStoreId
    )
  ) {
    mainCategoriesRealtimeRegistry.set(
      cleanStoreId,
      createMainCategoriesRealtimeEntry(
        cleanStoreId
      )
    );
  }

  return mainCategoriesRealtimeRegistry.get(
    cleanStoreId
  );
}

function getMainCategoriesForSubscriber(
  entry,
  subscriber
) {
  return subscriber.includeArchived
    ? entry.categories
    : entry.categories.filter(
        (category) =>
          category.isActive !== false
      );
}

function notifyMainCategorySubscriber(
  entry,
  subscriber
) {
  try {
    subscriber.callback(
      getMainCategoriesForSubscriber(
        entry,
        subscriber
      )
    );
  } catch (error) {
    console.error(
      "Error entregando categorías principales a un suscriptor:",
      error
    );
  }
}

function notifyMainCategorySubscribers(
  entry
) {
  entry.subscribers.forEach(
    (subscriber) => {
      notifyMainCategorySubscriber(
        entry,
        subscriber
      );
    }
  );
}

function notifyMainCategorySubscribersError(
  entry,
  error
) {
  entry.subscribers.forEach(
    (subscriber) => {
      if (
        typeof subscriber.onError !==
        "function"
      ) {
        return;
      }

      try {
        subscriber.onError(error);
      } catch (subscriberError) {
        console.error(
          "Error ejecutando el manejador de error de categorías principales:",
          subscriberError
        );
      }
    }
  );
}

function ensureMainCategoriesRealtimeListener(
  entry
) {
  if (entry.unsubscribeFirestore) {
    return;
  }

  const categoriesRef = collection(
    db,
    MAIN_CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where(
      "storeId",
      "==",
      entry.storeId
    )
  );

  entry.unsubscribeFirestore = onSnapshot(
    categoriesQuery,
    (snapshot) => {
      entry.categories =
        mapMainCategoriesSnapshot(snapshot);
      entry.hasSnapshot = true;
      entry.lastError = null;

      notifyMainCategorySubscribers(entry);
    },
    (error) => {
      console.error(
        `Error escuchando categorías principales de la tienda "${entry.storeId}":`,
        error
      );

      entry.lastError = error;
      entry.unsubscribeFirestore = null;

      notifyMainCategorySubscribersError(
        entry,
        error
      );
    }
  );
}

/* -------------------------------------------------------------------------- */
/*                           LECTURA EN TIEMPO REAL                            */
/* -------------------------------------------------------------------------- */

export function subscribeMainCategories(
  callback,
  onError,
  storeId = STORE_ID,
  options = {}
) {
  if (typeof callback !== "function") {
    throw new TypeError(
      "subscribeMainCategories necesita una función callback."
    );
  }

  const {
    includeArchived = true,
  } = options;

  const entry =
    getMainCategoriesRealtimeEntry(
      storeId
    );

  const subscriber = {
    callback,
    onError:
      typeof onError === "function"
        ? onError
        : null,
    includeArchived:
      includeArchived !== false,
  };

  entry.subscribers.add(subscriber);

  if (entry.hasSnapshot) {
    notifyMainCategorySubscriber(
      entry,
      subscriber
    );
  }

  ensureMainCategoriesRealtimeListener(
    entry
  );

  let active = true;

  return () => {
    if (!active) {
      return;
    }

    active = false;
    entry.subscribers.delete(subscriber);
  };
}

export async function getMainCategories(
  storeId = STORE_ID,
  options = {}
) {
  const {
    includeArchived = true,
  } = options;

  const cleanStoreId =
    normalizeStoreId(storeId);

  const cachedEntry =
    mainCategoriesRealtimeRegistry.get(
      cleanStoreId
    );

  if (cachedEntry?.hasSnapshot) {
    return includeArchived
      ? cachedEntry.categories
      : cachedEntry.categories.filter(
          (category) =>
            category.isActive !== false
        );
  }

  const categoriesRef = collection(
    db,
    MAIN_CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where(
      "storeId",
      "==",
      cleanStoreId
    )
  );

  const snapshot =
    await getDocs(categoriesQuery);

  const categories =
    mapMainCategoriesSnapshot(snapshot);

  return includeArchived
    ? categories
    : categories.filter(
        (category) =>
          category.isActive !== false
      );
}

export async function getMainCategoryById(
  categoryId
) {
  const cleanCategoryId = String(
    categoryId || ""
  ).trim();

  if (!cleanCategoryId) {
    return null;
  }

  for (
    const entry of
    mainCategoriesRealtimeRegistry.values()
  ) {
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
    MAIN_CATEGORIES_COLLECTION,
    cleanCategoryId
  );

  const snapshot =
    await getDoc(categoryRef);

  return mapMainCategoryDocument(snapshot);
}

/**
 * Limpieza opcional de caché/listeners en memoria.
 *
 * No se necesita durante la navegación normal. Puede utilizarse al cerrar
 * sesión o si en el futuro la aplicación cambia dinámicamente de tienda.
 */
export function clearMainCategoriesRealtimeCache(
  storeId
) {
  if (
    storeId !== undefined &&
    storeId !== null
  ) {
    const cleanStoreId =
      normalizeStoreId(storeId);

    const entry =
      mainCategoriesRealtimeRegistry.get(
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

    mainCategoriesRealtimeRegistry.delete(
      cleanStoreId
    );

    return;
  }

  mainCategoriesRealtimeRegistry.forEach(
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

  mainCategoriesRealtimeRegistry.clear();
}

/* -------------------------------------------------------------------------- */
/*                         CREAR CATEGORÍA PRINCIPAL                           */
/* -------------------------------------------------------------------------- */

export async function createMainCategory(
  data,
  storeId = STORE_ID,
  actor = {}
) {
  const nextSortOrder =
    data?.sortOrder === undefined
      ? await getNextSortOrder(storeId)
      : data.sortOrder;

  const payload = buildMainCategoryPayload({
    name: data?.name,
    sortOrder: nextSortOrder,
    isActive: data?.isActive,
    actor,
  });

  const categoryRef = doc(
    collection(
      db,
      MAIN_CATEGORIES_COLLECTION
    )
  );

  const indexRef = doc(
    db,
    MAIN_CATEGORY_INDEX_COLLECTION,
    createIndexId(
      storeId,
      payload.normalizedName
    )
  );

  await runTransaction(
    db,
    async (transaction) => {
      const indexSnapshot =
        await transaction.get(indexRef);

      if (indexSnapshot.exists()) {
        throw new Error(
          `Ya existe una categoría principal llamada "${payload.cleanName}".`
        );
      }

      transaction.set(categoryRef, {
        storeId,
        name: payload.cleanName,
        normalizedName:
          payload.normalizedName,
        slug: payload.slug,
        sortOrder: payload.sortOrder,
        isActive: payload.isActive,
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: payload.actor.uid,
        createdByName: payload.actor.name,
        createdByEmail: payload.actor.email,
      });

      transaction.set(indexRef, {
        storeId,
        normalizedName:
          payload.normalizedName,
        mainCategoryId: categoryRef.id,
        createdAt: serverTimestamp(),
      });
    }
  );

  return {
    id: categoryRef.id,
    storeId,
    name: payload.cleanName,
    normalizedName:
      payload.normalizedName,
    slug: payload.slug,
    sortOrder: payload.sortOrder,
    isActive: payload.isActive,
    schemaVersion: 1,
  };
}

/* -------------------------------------------------------------------------- */
/*                        ACTUALIZAR CATEGORÍA PRINCIPAL                       */
/* -------------------------------------------------------------------------- */

export async function updateMainCategory(
  categoryId,
  changes,
  actor = {}
) {
  const cleanCategoryId = String(
    categoryId || ""
  ).trim();

  if (!cleanCategoryId) {
    throw new Error(
      "No se recibió la categoría principal que deseas actualizar."
    );
  }

  const categoryRef = doc(
    db,
    MAIN_CATEGORIES_COLLECTION,
    cleanCategoryId
  );

  await runTransaction(
    db,
    async (transaction) => {
      const categorySnapshot =
        await transaction.get(categoryRef);

      if (!categorySnapshot.exists()) {
        throw new Error(
          "La categoría principal ya no existe."
        );
      }

      const currentCategory =
        categorySnapshot.data();

      const nextName =
        changes?.name !== undefined
          ? cleanDisplayName(changes.name)
          : cleanDisplayName(
              currentCategory.name
            );

      const nextNormalizedName =
        normalizeText(nextName);

      if (!nextName || !nextNormalizedName) {
        throw new Error(
          "El nombre de la categoría principal no es válido."
        );
      }

      const oldNormalizedName =
        normalizeText(
          currentCategory.normalizedName ||
            currentCategory.name
        );

      const storeId =
        currentCategory.storeId || STORE_ID;

      const oldIndexRef = doc(
        db,
        MAIN_CATEGORY_INDEX_COLLECTION,
        createIndexId(
          storeId,
          oldNormalizedName
        )
      );

      const newIndexRef = doc(
        db,
        MAIN_CATEGORY_INDEX_COLLECTION,
        createIndexId(
          storeId,
          nextNormalizedName
        )
      );

      if (
        nextNormalizedName !==
        oldNormalizedName
      ) {
        const newIndexSnapshot =
          await transaction.get(newIndexRef);

        if (newIndexSnapshot.exists()) {
          const indexData =
            newIndexSnapshot.data();

          if (
            indexData.mainCategoryId !==
            cleanCategoryId
          ) {
            throw new Error(
              `Ya existe una categoría principal llamada "${nextName}".`
            );
          }
        }

        transaction.delete(oldIndexRef);

        transaction.set(newIndexRef, {
          storeId,
          normalizedName:
            nextNormalizedName,
          mainCategoryId:
            cleanCategoryId,
          createdAt: serverTimestamp(),
        });
      }

      transaction.update(categoryRef, {
        name: nextName,
        normalizedName:
          nextNormalizedName,
        slug: createSlug(nextName),
        sortOrder:
          changes?.sortOrder !== undefined
            ? normalizeOrder(
                changes.sortOrder
              )
            : normalizeOrder(
                currentCategory.sortOrder
              ),
        isActive:
          changes?.isActive !== undefined
            ? Boolean(changes.isActive)
            : currentCategory.isActive !==
                false,
        updatedAt: serverTimestamp(),
        updatedByUid: String(
          actor?.uid || ""
        ),
        updatedByName: String(
          actor?.name || ""
        ),
        updatedByEmail: String(
          actor?.email || ""
        ),
      });
    }
  );

  return getMainCategoryById(
    cleanCategoryId
  );
}

/* -------------------------------------------------------------------------- */
/*                      ACTIVAR, ARCHIVAR Y ORDENAR                            */
/* -------------------------------------------------------------------------- */

export async function setMainCategoryActive(
  categoryId,
  isActive,
  actor = {}
) {
  return updateMainCategory(
    categoryId,
    {
      isActive: Boolean(isActive),
    },
    actor
  );
}

export async function archiveMainCategory(
  categoryId,
  actor = {}
) {
  const assignedSubcategories =
    await getSubcategoriesByMainCategory(
      categoryId
    );

  if (assignedSubcategories.length > 0) {
    throw new Error(
      `No puedes archivar esta categoría porque tiene ${assignedSubcategories.length} subcategoría(s) asignada(s).`
    );
  }

  return setMainCategoryActive(
    categoryId,
    false,
    actor
  );
}

export async function restoreMainCategory(
  categoryId,
  actor = {}
) {
  return setMainCategoryActive(
    categoryId,
    true,
    actor
  );
}

export async function reorderMainCategories(
  orderedCategoryIds,
  actor = {}
) {
  const safeIds = Array.from(
    new Set(
      (Array.isArray(orderedCategoryIds)
        ? orderedCategoryIds
        : []
      )
        .map((categoryId) =>
          String(categoryId || "").trim()
        )
        .filter(Boolean)
    )
  );

  if (safeIds.length === 0) {
    return;
  }

  const batch = writeBatch(db);

  safeIds.forEach(
    (categoryId, index) => {
      const categoryRef = doc(
        db,
        MAIN_CATEGORIES_COLLECTION,
        categoryId
      );

      batch.update(categoryRef, {
        sortOrder: index,
        updatedAt: serverTimestamp(),
        updatedByUid: String(
          actor?.uid || ""
        ),
        updatedByName: String(
          actor?.name || ""
        ),
        updatedByEmail: String(
          actor?.email || ""
        ),
      });
    }
  );

  await batch.commit();
}

/* -------------------------------------------------------------------------- */
/*                         RELACIÓN CON SUBCATEGORÍAS                          */
/* -------------------------------------------------------------------------- */

export async function assignSubcategoryToMainCategory(
  subcategoryId,
  mainCategoryId,
  actor = {}
) {
  const cleanSubcategoryId = String(
    subcategoryId || ""
  ).trim();

  const cleanMainCategoryId = String(
    mainCategoryId || ""
  ).trim();

  if (!cleanSubcategoryId) {
    throw new Error(
      "No se recibió la subcategoría que deseas organizar."
    );
  }

  if (!cleanMainCategoryId) {
    throw new Error(
      "Selecciona una categoría principal."
    );
  }

  const subcategoryRef = doc(
    db,
    "categories",
    cleanSubcategoryId
  );

  const mainCategoryRef = doc(
    db,
    MAIN_CATEGORIES_COLLECTION,
    cleanMainCategoryId
  );

  await runTransaction(
    db,
    async (transaction) => {
      const [
        subcategorySnapshot,
        mainCategorySnapshot,
      ] = await Promise.all([
        transaction.get(subcategoryRef),
        transaction.get(mainCategoryRef),
      ]);

      if (!subcategorySnapshot.exists()) {
        throw new Error(
          "La subcategoría ya no existe."
        );
      }

      if (!mainCategorySnapshot.exists()) {
        throw new Error(
          "La categoría principal ya no existe."
        );
      }

      const subcategory =
        subcategorySnapshot.data();

      const mainCategory =
        mainCategorySnapshot.data();

      if (
        subcategory.storeId &&
        mainCategory.storeId &&
        subcategory.storeId !==
          mainCategory.storeId
      ) {
        throw new Error(
          "La categoría principal y la subcategoría pertenecen a tiendas diferentes."
        );
      }

      if (mainCategory.isActive === false) {
        throw new Error(
          "No puedes asignar productos a una categoría principal archivada."
        );
      }

      transaction.update(subcategoryRef, {
        parentCategoryId:
          cleanMainCategoryId,
        parentCategoryName:
          cleanDisplayName(
            mainCategory.name
          ),
        schemaVersion: 2,
        isActive:
          subcategory.isActive !== false,
        migratedAt:
          subcategory.migratedAt ||
          serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: String(
          actor?.uid || ""
        ),
        updatedByName: String(
          actor?.name || ""
        ),
        updatedByEmail: String(
          actor?.email || ""
        ),
      });
    }
  );
}

export async function unassignSubcategory(
  subcategoryId,
  actor = {}
) {
  const cleanSubcategoryId = String(
    subcategoryId || ""
  ).trim();

  if (!cleanSubcategoryId) {
    throw new Error(
      "No se recibió la subcategoría."
    );
  }

  const subcategoryRef = doc(
    db,
    "categories",
    cleanSubcategoryId
  );

  await updateDoc(subcategoryRef, {
    parentCategoryId: "",
    parentCategoryName: "",
    schemaVersion: 2,
    updatedAt: serverTimestamp(),
    updatedByUid: String(
      actor?.uid || ""
    ),
    updatedByName: String(
      actor?.name || ""
    ),
    updatedByEmail: String(
      actor?.email || ""
    ),
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

  const categoriesRef = collection(
    db,
    "categories"
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", storeId),
    where(
      "parentCategoryId",
      "==",
      cleanMainCategoryId
    )
  );

  const snapshot = await getDocs(
    categoriesQuery
  );

  return snapshot.docs
    .map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    }))
    .sort((left, right) => {
      const orderDifference =
        normalizeOrder(left.sortOrder) -
        normalizeOrder(right.sortOrder);

      if (orderDifference !== 0) {
        return orderDifference;
      }

      return String(left.name || "").localeCompare(
        String(right.name || ""),
        "es-CO"
      );
    });
}

export async function getUnassignedSubcategories(
  storeId = STORE_ID
) {
  const categoriesRef = collection(
    db,
    "categories"
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", storeId)
  );

  const snapshot = await getDocs(
    categoriesQuery
  );

  return snapshot.docs
    .map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    }))
    .filter(
      (category) =>
        !String(
          category.parentCategoryId || ""
        ).trim()
    )
    .sort((left, right) =>
      String(left.name || "").localeCompare(
        String(right.name || ""),
        "es-CO"
      )
    );
}

/* -------------------------------------------------------------------------- */
/*                         ELIMINACIÓN CONTROLADA                              */
/* -------------------------------------------------------------------------- */

export async function deleteMainCategoryPermanently(
  categoryId
) {
  const cleanCategoryId = String(
    categoryId || ""
  ).trim();

  if (!cleanCategoryId) {
    throw new Error(
      "No se recibió la categoría principal."
    );
  }

  const category =
    await getMainCategoryById(
      cleanCategoryId
    );

  if (!category) {
    return;
  }

  const assignedSubcategories =
    await getSubcategoriesByMainCategory(
      cleanCategoryId,
      category.storeId || STORE_ID
    );

  if (assignedSubcategories.length > 0) {
    throw new Error(
      `No puedes eliminar esta categoría porque tiene ${assignedSubcategories.length} subcategoría(s) asignada(s).`
    );
  }

  const categoryRef = doc(
    db,
    MAIN_CATEGORIES_COLLECTION,
    cleanCategoryId
  );

  const indexRef = doc(
    db,
    MAIN_CATEGORY_INDEX_COLLECTION,
    createIndexId(
      category.storeId || STORE_ID,
      category.normalizedName ||
        category.name
    )
  );

  await Promise.all([
    deleteDoc(categoryRef),
    deleteDoc(indexRef),
  ]);
}