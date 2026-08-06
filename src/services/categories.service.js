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
/*                              LECTURA GENERAL                                */
/* -------------------------------------------------------------------------- */

export function subscribeCategories(
  callback,
  onError,
  storeId = STORE_ID
) {
  const categoriesRef = collection(
    db,
    CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", storeId)
  );

  return onSnapshot(
    categoriesQuery,
    (snapshot) => {
      callback(mapCategoriesSnapshot(snapshot));
    },
    (error) => {
      console.error(
        "Error escuchando categorías:",
        error
      );

      if (onError) {
        onError(error);
      }
    }
  );
}

export async function getCategories(
  storeId = STORE_ID
) {
  const categoriesRef = collection(
    db,
    CATEGORIES_COLLECTION
  );

  const categoriesQuery = query(
    categoriesRef,
    where("storeId", "==", storeId)
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

  const categoriesRef = collection(
    db,
    CATEGORIES_COLLECTION
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

  return onSnapshot(
    categoriesQuery,
    (snapshot) => {
      callback(mapCategoriesSnapshot(snapshot));
    },
    (error) => {
      console.error(
        "Error escuchando subcategorías:",
        error
      );

      if (onError) {
        onError(error);
      }
    }
  );
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
    CATEGORIES_COLLECTION
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

  return mapCategoriesSnapshot(snapshot);
}

export async function getUnassignedCategories(
  storeId = STORE_ID
) {
  const categories = await getCategories(storeId);

  return categories.filter(
    (category) =>
      !String(
        category.parentCategoryId || ""
      ).trim()
  );
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