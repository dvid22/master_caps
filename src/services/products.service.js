import {
  collection,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { db, storage } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

function safeFileName(fileName) {
  return String(fileName || "producto")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.\-_]/g, "");
}

function formatAutomaticProductCode(number) {
  return String(number).padStart(4, "0");
}

export function normalizeProductCode(value) {
  const cleanValue = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[\/\\#?[\]]/g, "-");

  if (!cleanValue) return "";

  if (/^\d+$/.test(cleanValue)) {
    return cleanValue.padStart(4, "0");
  }

  return cleanValue;
}

function getProductCodeIndexId(storeId, code) {
  return `${storeId}_${encodeURIComponent(code)}`;
}

function getProductCodeIndexRef(storeId, code) {
  return doc(db, "productCodeIndex", getProductCodeIndexId(storeId, code));
}

function getProductCounterRef(storeId) {
  return doc(db, "counters", `productCodes_${storeId}`);
}
export async function getNextProductCodePreview(storeId = STORE_ID) {
  const counterRef = getProductCounterRef(storeId);
  const counterSnap = await getDoc(counterRef);

  const lastNumber = Number(counterSnap.data()?.lastNumber || 0);

  let nextNumber = lastNumber + 1;
  let attempts = 0;

  while (attempts < 10000) {
    attempts += 1;

    const candidateCode = formatAutomaticProductCode(nextNumber);
    const candidateIndexRef = getProductCodeIndexRef(storeId, candidateCode);
    const candidateIndexSnap = await getDoc(candidateIndexRef);

    if (!candidateIndexSnap.exists()) {
      return candidateCode;
    }

    nextNumber += 1;
  }

  throw new Error("No se pudo obtener el siguiente código disponible.");
}
async function getNextAvailableProductCode(transaction, storeId) {
  const counterRef = getProductCounterRef(storeId);
  const counterSnap = await transaction.get(counterRef);

  const lastNumber = Number(counterSnap.data()?.lastNumber || 0);

  let nextNumber = lastNumber + 1;
  let selectedCode = "";
  let attempts = 0;

  while (!selectedCode) {
    attempts += 1;

    if (attempts > 10000) {
      throw new Error("No se pudo generar un código consecutivo disponible.");
    }

    const candidateCode = formatAutomaticProductCode(nextNumber);
    const candidateIndexRef = getProductCodeIndexRef(storeId, candidateCode);
    const candidateIndexSnap = await transaction.get(candidateIndexRef);

    if (!candidateIndexSnap.exists()) {
      selectedCode = candidateCode;
      break;
    }

    nextNumber += 1;
  }

  return {
    code: selectedCode,
    number: nextNumber,
  };
}

function mapProductsSnapshot(snapshot) {
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

export function subscribeProducts(callback, onError, storeId = STORE_ID) {
  const productsRef = collection(db, "products");
  const q = query(productsRef, where("storeId", "==", storeId));

  return onSnapshot(
    q,
    (snapshot) => {
      callback(mapProductsSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando productos:", error);
      if (onError) onError(error);
    }
  );
}

async function uploadProductImage(imageFile, storeId = STORE_ID) {
  if (!imageFile) return null;

  const fileName = `${Date.now()}-${safeFileName(imageFile.name)}`;
  const imagePath = `products/${storeId}/${fileName}`;
  const imageRef = ref(storage, imagePath);

  await uploadBytes(imageRef, imageFile);

  const imageUrl = await getDownloadURL(imageRef);

  return {
    imageUrl,
    imagePath,
  };
}

async function deleteProductImage(imagePath) {
  if (!imagePath) return;

  try {
    const imageRef = ref(storage, imagePath);
    await deleteObject(imageRef);
  } catch (error) {
    console.warn("No se pudo eliminar la imagen:", error);
  }
}

export async function getProducts(storeId = STORE_ID) {
  const productsRef = collection(db, "products");
  const q = query(productsRef, where("storeId", "==", storeId));
  const snapshot = await getDocs(q);

  return mapProductsSnapshot(snapshot);
}

export async function createProduct(
  productData,
  imageFile,
  storeId = STORE_ID,
  actor = null
) {
  const imagePayload = await uploadProductImage(imageFile, storeId);

  try {
    const productId = await runTransaction(db, async (transaction) => {
      const productsRef = collection(db, "products");
      const productRef = doc(productsRef);

      let finalCode = normalizeProductCode(productData?.code);

      if (finalCode) {
        const codeIndexRef = getProductCodeIndexRef(storeId, finalCode);
        const codeIndexSnap = await transaction.get(codeIndexRef);

        if (codeIndexSnap.exists()) {
          throw new Error(`El código ${finalCode} ya está usado por otro producto.`);
        }

        transaction.set(codeIndexRef, {
          storeId,
          code: finalCode,
          productId: productRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const nextCode = await getNextAvailableProductCode(transaction, storeId);

        finalCode = nextCode.code;

        const counterRef = getProductCounterRef(storeId);
        const codeIndexRef = getProductCodeIndexRef(storeId, finalCode);

        transaction.set(
          counterRef,
          {
            storeId,
            lastNumber: nextCode.number,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        transaction.set(codeIndexRef, {
          storeId,
          code: finalCode,
          productId: productRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(productRef, {
        ...productData,
        storeId,
        code: finalCode,
        imageUrl: imagePayload?.imageUrl || "",
        imagePath: imagePayload?.imagePath || "",
        status: "available",

        createdByUid: actor?.uid || "",
        createdByName: actor?.name || "",
        createdByEmail: actor?.email || "",

        updatedByUid: actor?.uid || "",
        updatedByName: actor?.name || "",
        updatedByEmail: actor?.email || "",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return productRef.id;
    });

    return productId;
  } catch (error) {
    if (imagePayload?.imagePath) {
      await deleteProductImage(imagePayload.imagePath);
    }

    throw error;
  }
}

export async function updateProduct(
  productId,
  productData,
  imageFile,
  oldImagePath,
  actor = null
) {
  if (!productId) {
    throw new Error("No se encontró el producto.");
  }

  const storeId = productData.storeId || STORE_ID;
  const imagePayload = await uploadProductImage(imageFile, storeId);

  try {
    await runTransaction(db, async (transaction) => {
      const productRef = doc(db, "products", productId);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) {
        throw new Error("El producto no existe.");
      }

      const currentProduct = productSnap.data();

      const oldCode = normalizeProductCode(currentProduct.code);
      let newCode = normalizeProductCode(productData?.code);

      if (!newCode) {
        const nextCode = await getNextAvailableProductCode(transaction, storeId);

        newCode = nextCode.code;

        const counterRef = getProductCounterRef(storeId);

        transaction.set(
          counterRef,
          {
            storeId,
            lastNumber: nextCode.number,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (newCode !== oldCode) {
        const newCodeIndexRef = getProductCodeIndexRef(storeId, newCode);
        const newCodeIndexSnap = await transaction.get(newCodeIndexRef);

        if (newCodeIndexSnap.exists()) {
          const existingProductId = newCodeIndexSnap.data()?.productId;

          if (existingProductId !== productId) {
            throw new Error(`El código ${newCode} ya está usado por otro producto.`);
          }
        }

        if (oldCode) {
          const oldCodeIndexRef = getProductCodeIndexRef(storeId, oldCode);
          transaction.delete(oldCodeIndexRef);
        }

        transaction.set(newCodeIndexRef, {
          storeId,
          code: newCode,
          productId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.update(productRef, {
        ...productData,
        storeId,
        code: newCode,
        ...(imagePayload
          ? {
              imageUrl: imagePayload.imageUrl,
              imagePath: imagePayload.imagePath,
            }
          : {}),

        updatedByUid: actor?.uid || "",
        updatedByName: actor?.name || "",
        updatedByEmail: actor?.email || "",

        updatedAt: serverTimestamp(),
      });
    });

    if (imagePayload?.imagePath && oldImagePath) {
      await deleteProductImage(oldImagePath);
    }
  } catch (error) {
    if (imagePayload?.imagePath) {
      await deleteProductImage(imagePayload.imagePath);
    }

    throw error;
  }
}

export async function deleteProduct(productId, imagePath) {
  if (!productId) {
    throw new Error("No se encontró el producto.");
  }

  await runTransaction(db, async (transaction) => {
    const productRef = doc(db, "products", productId);
    const productSnap = await transaction.get(productRef);

    if (!productSnap.exists()) {
      return;
    }

    const product = productSnap.data();
    const storeId = product.storeId || STORE_ID;
    const code = normalizeProductCode(product.code);

    if (code) {
      const codeIndexRef = getProductCodeIndexRef(storeId, code);
      transaction.delete(codeIndexRef);
    }

    transaction.delete(productRef);
  });

  if (imagePath) {
    await deleteProductImage(imagePath);
  }
}