import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { auth } from "../firebase/firebase";

export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function loginAdmin(email, password) {
  const cleanEmail = String(email || "").trim();

  if (!cleanEmail) {
    throw new Error("Debes escribir el correo.");
  }

  if (!password) {
    throw new Error("Debes escribir la contraseña.");
  }

  const credential = await signInWithEmailAndPassword(
    auth,
    cleanEmail,
    password
  );

  return credential.user;
}

export async function logoutAdmin() {
  await signOut(auth);
}