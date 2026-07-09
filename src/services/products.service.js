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
    console.warn("No se pudo eliminar la imagen anterior:", error);
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

  const productsRef = collection(db, "products");

  const docRef = await addDoc(productsRef, {
    ...productData,
    storeId,
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

  return docRef.id;
}

export async function updateProduct(
  productId,
  productData,
  imageFile,
  oldImagePath,
  actor = null
) {
  const productRef = doc(db, "products", productId);

  let imagePayload = null;

  if (imageFile) {
    imagePayload = await uploadProductImage(
      imageFile,
      productData.storeId || STORE_ID
    );

    if (oldImagePath) {
      await deleteProductImage(oldImagePath);
    }
  }

  await updateDoc(productRef, {
    ...productData,
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
}

export async function deleteProduct(productId, imagePath) {
  await deleteDoc(doc(db, "products", productId));

  if (imagePath) {
    await deleteProductImage(imagePath);
  }
}