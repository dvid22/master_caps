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
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db, firebaseConfig } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

export const PAYMENT_TYPES = {
  HOURLY: "hourly",
};

export const PAYMENT_TYPE_OPTIONS = [
  {
    value: PAYMENT_TYPES.HOURLY,
    label: "Pago por hora",
    rateField: "hourlyRate",
  },
];

export const DEFAULT_PAYMENT_CONFIG = {
  paymentEnabled: false,
  paymentType: PAYMENT_TYPES.HOURLY,
  hourlyRate: 0,
  expectedDailyMinutes: 480,
  workDaysPerMonth: 30,
};

function cleanString(value) {
  return String(value || "").trim();
}

function cleanEmail(value) {
  return cleanString(value).toLowerCase();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  return Math.max(toFiniteNumber(value, fallback), 0);
}

function toPositiveInteger(value, fallback) {
  const number = Math.trunc(toFiniteNumber(value, fallback));
  return number > 0 ? number : fallback;
}

function isValidPaymentType(value) {
  return Object.values(PAYMENT_TYPES).includes(value);
}

function mapUsersSnapshot(snapshot) {
  return snapshot.docs
    .map((docItem) => ({
      id: docItem.id,
      ...DEFAULT_PAYMENT_CONFIG,
      ...docItem.data(),
    }))
    .sort((a, b) => {
      const nameA = String(a.displayName || a.email || "");
      const nameB = String(b.displayName || b.email || "");
      return nameA.localeCompare(nameB, "es", {
        sensitivity: "base",
      });
    });
}

export function normalizePaymentConfig(payload = {}) {
  return {
    paymentEnabled: Boolean(payload.paymentEnabled),
    paymentType: PAYMENT_TYPES.HOURLY,
    hourlyRate: toNonNegativeNumber(payload.hourlyRate),
    expectedDailyMinutes: Math.min(
      toPositiveInteger(payload.expectedDailyMinutes, DEFAULT_PAYMENT_CONFIG.expectedDailyMinutes),
      24 * 60
    ),
    workDaysPerMonth: Math.min(
      toPositiveInteger(payload.workDaysPerMonth, DEFAULT_PAYMENT_CONFIG.workDaysPerMonth),
      31
    ),
  };
}

export function validatePaymentConfig(payload = {}) {
  const config = normalizePaymentConfig(payload);
  if (!config.paymentEnabled) return config;
  if (!config.hourlyRate || config.hourlyRate <= 0) {
    throw new Error("Debes registrar un valor por hora mayor a cero.");
  }
  return config;
}

export function getPaymentTypeLabel() {
  return "Pago por hora";
}

export function getActivePaymentRate(userOrConfig = {}) {
  const config = normalizePaymentConfig(userOrConfig);
  return config.hourlyRate || 0;
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

export function subscribeSellers(callback, onError, storeId = STORE_ID) {
  const usersRef = collection(db, "users");

  const q = query(
    usersRef,
    where("storeId", "==", storeId),
    where("role", "==", "seller")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      callback(mapUsersSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando vendedores:", error);
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
    ...DEFAULT_PAYMENT_CONFIG,
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

  paymentEnabled = false,
  hourlyRate = 0,
  expectedDailyMinutes = DEFAULT_PAYMENT_CONFIG.expectedDailyMinutes,
  workDaysPerMonth = DEFAULT_PAYMENT_CONFIG.workDaysPerMonth,
}) {
  const cleanName = cleanString(displayName);
  const cleanUserEmail = cleanEmail(email);
  const cleanPassword = cleanString(password);
  const cleanRole = role === "admin" ? "admin" : "seller";

  if (!cleanName) {
    throw new Error("Debes escribir el nombre del usuario.");
  }

  if (!cleanUserEmail) {
    throw new Error("Debes escribir el correo del usuario.");
  }

  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error("La contraseña debe tener mínimo 6 caracteres.");
  }

  const paymentConfig = validatePaymentConfig({
    paymentEnabled,
    paymentType: PAYMENT_TYPES.HOURLY,
    hourlyRate,
    expectedDailyMinutes,
    workDaysPerMonth,
  });

  const secondaryAppName = `secondary-user-create-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      cleanUserEmail,
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
      email: cleanUserEmail,
      role: cleanRole,
      active: true,

      ...paymentConfig,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      createdByUid: creator?.uid || "",
      createdByName: creator?.name || "",
      createdByEmail: creator?.email || "",

      paymentUpdatedAt: serverTimestamp(),
      paymentUpdatedByUid: creator?.uid || "",
      paymentUpdatedByName: creator?.name || "",
      paymentUpdatedByEmail: creator?.email || "",
    });

    await signOut(secondaryAuth);

    return newUser.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function updateStoreUser(userId, payload = {}) {
  if (!userId) {
    throw new Error("No se encontró el usuario.");
  }

  const allowedPayload = {};

  if (Object.prototype.hasOwnProperty.call(payload, "displayName")) {
    const displayName = cleanString(payload.displayName);

    if (!displayName) {
      throw new Error("El nombre del usuario no puede quedar vacío.");
    }

    allowedPayload.displayName = displayName;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "role")) {
    allowedPayload.role =
      payload.role === "admin" ? "admin" : "seller";
  }

  [
    "updatedByUid",
    "updatedByName",
    "updatedByEmail",
  ].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      allowedPayload[field] = payload[field] || "";
    }
  });

  const userRef = doc(db, "users", userId);

  await updateDoc(userRef, {
    ...allowedPayload,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserPaymentConfiguration(
  userId,
  paymentPayload,
  actor = null
) {
  if (!userId) {
    throw new Error("No se encontró el usuario.");
  }

  const userRef = doc(db, "users", userId);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    throw new Error("El usuario no existe.");
  }

  const user = snapshot.data();

  if (user.role !== "seller") {
    throw new Error(
      "La configuración salarial solo puede asignarse a vendedores."
    );
  }

  const paymentConfig = validatePaymentConfig(paymentPayload);

  await updateDoc(userRef, {
    ...paymentConfig,

    paymentUpdatedAt: serverTimestamp(),
    paymentUpdatedByUid: actor?.uid || "",
    paymentUpdatedByName: actor?.name || "",
    paymentUpdatedByEmail: actor?.email || "",

    updatedAt: serverTimestamp(),
  });

  return paymentConfig;
}

export async function setUserActiveStatus(
  userId,
  active,
  actor = null
) {
  if (!userId) {
    throw new Error("No se encontró el usuario.");
  }

  const userRef = doc(db, "users", userId);

  await updateDoc(userRef, {
    active: Boolean(active),

    statusUpdatedAt: serverTimestamp(),
    statusUpdatedByUid: actor?.uid || "",
    statusUpdatedByName: actor?.name || "",
    statusUpdatedByEmail: actor?.email || "",

    updatedAt: serverTimestamp(),
  });
}


async function deleteRefsInChunks(refs = [], chunkSize = 400) {
  let deleted = 0;

  for (let index = 0; index < refs.length; index += chunkSize) {
    const batch = writeBatch(db);
    const chunk = refs.slice(index, index + chunkSize);

    chunk.forEach((ref) => {
      batch.delete(ref);
    });

    await batch.commit();
    deleted += chunk.length;
  }

  return deleted;
}

export async function deleteStoreWorker(
  userId,
  actor = null,
  storeId = STORE_ID
) {
  const cleanUserId = cleanString(userId);
  const cleanStoreId = cleanString(storeId) || STORE_ID;

  if (!cleanUserId) {
    throw new Error("No se encontró el trabajador.");
  }

  if (actor?.uid && actor.uid === cleanUserId) {
    throw new Error(
      "No puedes eliminar tu propio usuario desde esta opción."
    );
  }

  const userRef = doc(db, "users", cleanUserId);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    throw new Error("El trabajador ya no existe.");
  }

  const user = userSnapshot.data();

  if (user.storeId !== cleanStoreId) {
    throw new Error(
      "El trabajador no pertenece a esta tienda."
    );
  }

  if (user.role !== "seller") {
    throw new Error(
      "Esta opción solo permite eliminar trabajadores con rol vendedor."
    );
  }

  /*
   * Primero lo desactivamos para impedir que pueda abrir una nueva jornada
   * mientras se ejecuta la limpieza de sus datos laborales.
   */
  await updateDoc(userRef, {
    active: false,
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedByUid: actor?.uid || "",
    statusUpdatedByName: actor?.name || "",
    statusUpdatedByEmail: actor?.email || "",
    updatedAt: serverTimestamp(),
  });

  const [timeEntriesSnapshot, activeEntriesSnapshot] =
    await Promise.all([
      getDocs(
        query(
          collection(db, "timeEntries"),
          where("storeId", "==", cleanStoreId),
          where("userId", "==", cleanUserId)
        )
      ),
      getDocs(
        query(
          collection(db, "activeTimeEntries"),
          where("storeId", "==", cleanStoreId),
          where("userId", "==", cleanUserId)
        )
      ),
    ]);

  const laborRefs = [
    ...timeEntriesSnapshot.docs.map((item) => item.ref),
    ...activeEntriesSnapshot.docs.map((item) => item.ref),
  ];

  const deletedLaborDocuments =
    await deleteRefsInChunks(laborRefs);

  /*
   * Los pagos de nómina ya confirmados, gastos y ventas se conservan como
   * historial financiero. Esos documentos contienen snapshots del nombre,
   * correo, horas y valores, por lo que no dependen del perfil del vendedor.
   *
   * Finalmente eliminamos el perfil Firestore del trabajador.
   */
  const finalBatch = writeBatch(db);
  finalBatch.delete(userRef);
  await finalBatch.commit();

  return {
    userId: cleanUserId,
    displayName:
      cleanString(user.displayName) ||
      cleanString(user.email) ||
      "Trabajador",
    deletedTimeEntries: timeEntriesSnapshot.size,
    deletedActiveEntries: activeEntriesSnapshot.size,
    deletedLaborDocuments,
  };
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
        ...DEFAULT_PAYMENT_CONFIG,
        ...snapshot.data(),
      });
    },
    (error) => {
      console.error("Error escuchando perfil de usuario:", error);
      if (onError) onError(error);
    }
  );
}
