import { deleteApp, initializeApp } from "firebase/app";

import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  updateProfile,
} from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db, firebaseConfig } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

function mapUsersSnapshot(snapshot) {
  return snapshot.docs
    .map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }))
    .sort((a, b) => {
      const nameA = String(a.displayName || a.email || "");
      const nameB = String(b.displayName || b.email || "");
      return nameA.localeCompare(nameB);
    });
}

export function subscribeUsers(callback, onError, storeId = STORE_ID) {
  const usersRef = collection(db, "users");

  const q = query(usersRef, where("storeId", "==", storeId));

  return onSnapshot(
    q,
    (snapshot) => {
      callback(mapUsersSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando usuarios:", error);
      if (onError) onError(error);
    }
  );
}

export async function getUserProfile(uid) {
  if (!uid) return null;

  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function createStoreUser({
  displayName,
  email,
  password,
  role = "seller",
  storeId = STORE_ID,
  creator = null,
}) {
  const cleanName = String(displayName || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanPassword = String(password || "").trim();

  if (!cleanName) {
    throw new Error("Debes escribir el nombre del usuario.");
  }

  if (!cleanEmail) {
    throw new Error("Debes escribir el correo del usuario.");
  }

  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error("La contraseña debe tener mínimo 6 caracteres.");
  }

  const secondaryAppName = `secondary-user-create-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      cleanEmail,
      cleanPassword
    );

    const newUser = credential.user;

    await updateProfile(newUser, {
      displayName: cleanName,
    });

    await setDoc(doc(db, "users", newUser.uid), {
      uid: newUser.uid,
      storeId,
      displayName: cleanName,
      email: cleanEmail,
      role,
      active: true,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      createdByUid: creator?.uid || "",
      createdByName: creator?.name || "",
      createdByEmail: creator?.email || "",
    });

    await signOut(secondaryAuth);

    return newUser.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function updateStoreUser(userId, payload) {
  if (!userId) {
    throw new Error("No se encontró el usuario.");
  }

  const userRef = doc(db, "users", userId);

  await updateDoc(userRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function setUserActiveStatus(userId, active) {
  if (!userId) {
    throw new Error("No se encontró el usuario.");
  }

  const userRef = doc(db, "users", userId);

  await updateDoc(userRef, {
    active: Boolean(active),
    updatedAt: serverTimestamp(),
  });
}
export function subscribeUserProfile(uid, callback, onError) {
  if (!uid) {
    callback(null);
    return () => {};
  }

  const userRef = doc(db, "users", uid);

  return onSnapshot(
    userRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({
        id: snapshot.id,
        ...snapshot.data(),
      });
    },
    (error) => {
      console.error("Error escuchando perfil de usuario:", error);
      if (onError) onError(error);
    }
  );
}