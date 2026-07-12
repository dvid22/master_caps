import {
  Timestamp,
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
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import {
  DEFAULT_PAYMENT_CONFIG,
  PAYMENT_TYPES,
  getActivePaymentRate,
  normalizePaymentConfig,
} from "./users.service";

export const BUSINESS_TIME_ZONE = "America/Bogota";

export const TIME_ENTRY_STATUS = {
  OPEN: "open",
  COMPLETED: "completed",
  CORRECTED: "corrected",
};

export const REPORT_PERIODS = {
  DAY: "day",
  BIWEEKLY: "biweekly",
  MONTH: "month",
};

const MINUTE_IN_MS = 60 * 1000;
const MAX_SHIFT_MINUTES = 24 * 60;

function cleanString(value) {
  return String(value || "").trim();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  return Math.max(toFiniteNumber(value, fallback), 0);
}

function roundMoney(value) {
  return Math.round((toFiniteNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundHours(value) {
  return Math.round((toFiniteNumber(value) + Number.EPSILON) * 100) / 100;
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getBogotaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

export function getBusinessDateKey(date = new Date()) {
  const { year, month, day } = getBogotaParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function getBiweeklyPeriodKey(date = new Date()) {
  const { year, month, day } = getBogotaParts(date);
  const half = day <= 15 ? 1 : 2;

  return `${year}-${pad2(month)}-Q${half}`;
}

export function getMonthlyPeriodKey(date = new Date()) {
  const { year, month } = getBogotaParts(date);
  return `${year}-${pad2(month)}`;
}

function getActiveEntryDocId(storeId, userId) {
  return `${cleanString(storeId)}__${cleanString(userId)}`;
}

function getPaymentSnapshot(profile = {}) {
  const config = normalizePaymentConfig({
    ...DEFAULT_PAYMENT_CONFIG,
    ...profile,
  });

  return {
    paymentEnabledSnapshot: Boolean(config.paymentEnabled),
    paymentTypeSnapshot: config.paymentType,

    hourlyRateSnapshot: config.hourlyRate,
    dailyRateSnapshot: config.dailyRate,
    biweeklySalarySnapshot: config.biweeklySalary,
    monthlySalarySnapshot: config.monthlySalary,

    expectedDailyMinutesSnapshot: config.expectedDailyMinutes,
    workDaysPerMonthSnapshot: config.workDaysPerMonth,

    activeRateSnapshot: getActivePaymentRate(config),
  };
}

export function calculateWorkedMinutes(clockIn, clockOut) {
  const start = asDate(clockIn);
  const end = asDate(clockOut);

  if (!start || !end) return 0;

  const difference = Math.floor(
    (end.getTime() - start.getTime()) / MINUTE_IN_MS
  );

  return Math.min(Math.max(difference, 0), MAX_SHIFT_MINUTES);
}

export function calculateEntryPayment({
  workedMinutes,
  paymentEnabledSnapshot,
  paymentTypeSnapshot,
  hourlyRateSnapshot,
  dailyRateSnapshot,
  expectedDailyMinutesSnapshot,
}) {
  if (!paymentEnabledSnapshot) return 0;

  const minutes = Math.max(toFiniteNumber(workedMinutes), 0);

  if (paymentTypeSnapshot === PAYMENT_TYPES.HOURLY) {
    return roundMoney(
      (minutes / 60) * toNonNegativeNumber(hourlyRateSnapshot)
    );
  }

  if (paymentTypeSnapshot === PAYMENT_TYPES.DAILY) {
    /*
     * El pago diario se registra proporcionalmente por jornada.
     * El resumen diario agrupa todas las jornadas del mismo día y limita
     * el total al valor diario configurado.
     */
    const expectedMinutes = Math.max(
      toFiniteNumber(
        expectedDailyMinutesSnapshot,
        DEFAULT_PAYMENT_CONFIG.expectedDailyMinutes
      ),
      1
    );

    return roundMoney(
      Math.min(minutes / expectedMinutes, 1) *
        toNonNegativeNumber(dailyRateSnapshot)
    );
  }

  /*
   * Quincenal y mensual son salarios fijos por período.
   * No se cargan completos en cada jornada para evitar duplicarlos.
   * Se calculan en summarizeTimeEntries().
   */
  return 0;
}

export async function clockIn({
  userId,
  storeId = STORE_ID,
  actor = null,
  now = new Date(),
}) {
  const cleanUserId = cleanString(userId);
  const cleanStoreId = cleanString(storeId) || STORE_ID;

  if (!cleanUserId) {
    throw new Error("No se encontró el usuario.");
  }

  const userRef = doc(db, "users", cleanUserId);
  const activeRef = doc(
    db,
    "activeTimeEntries",
    getActiveEntryDocId(cleanStoreId, cleanUserId)
  );
  const entryRef = doc(collection(db, "timeEntries"));
  const nowTimestamp = Timestamp.fromDate(now);

  return runTransaction(db, async (transaction) => {
    const [userSnapshot, activeSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(activeRef),
    ]);

    if (!userSnapshot.exists()) {
      throw new Error("El perfil del vendedor no existe.");
    }

    const user = userSnapshot.data();

    if (user.storeId !== cleanStoreId) {
      throw new Error("El usuario no pertenece a esta tienda.");
    }

    if (user.role !== "seller") {
      throw new Error(
        "Solo los vendedores pueden registrar una jornada laboral."
      );
    }

    if (user.active !== true) {
      throw new Error("El usuario está inactivo.");
    }

    if (activeSnapshot.exists()) {
      throw new Error(
        "Ya existe una jornada abierta. Debes registrar la salida antes de iniciar otra."
      );
    }

    const workDate = getBusinessDateKey(now);
    const biweeklyPeriod = getBiweeklyPeriodKey(now);
    const monthlyPeriod = getMonthlyPeriodKey(now);
    const paymentSnapshot = getPaymentSnapshot(user);

    transaction.set(entryRef, {
      storeId: cleanStoreId,

      userId: cleanUserId,
      userName: user.displayName || user.email || "Vendedor",
      userEmail: user.email || "",

      workDate,
      biweeklyPeriod,
      monthlyPeriod,

      clockIn: nowTimestamp,
      clockOut: null,

      workedMinutes: 0,
      workedHours: 0,

      status: TIME_ENTRY_STATUS.OPEN,

      ...paymentSnapshot,

      calculatedPayment: 0,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      clockInByUid: actor?.uid || cleanUserId,
      clockInByName:
        actor?.name || user.displayName || user.email || "Vendedor",
      clockInByEmail: actor?.email || user.email || "",

      clockOutByUid: "",
      clockOutByName: "",
      clockOutByEmail: "",

      correctedAt: null,
      correctedByUid: "",
      correctedByName: "",
      correctedByEmail: "",
      correctionNotes: "",
    });

    transaction.set(activeRef, {
      storeId: cleanStoreId,
      userId: cleanUserId,
      timeEntryId: entryRef.id,
      clockIn: nowTimestamp,
      createdAt: serverTimestamp(),
    });

    return {
      id: entryRef.id,
      storeId: cleanStoreId,
      userId: cleanUserId,
      workDate,
      clockIn: now,
      status: TIME_ENTRY_STATUS.OPEN,
      ...paymentSnapshot,
    };
  });
}

export async function clockOut({
  userId,
  storeId = STORE_ID,
  actor = null,
  now = new Date(),
}) {
  const cleanUserId = cleanString(userId);
  const cleanStoreId = cleanString(storeId) || STORE_ID;

  if (!cleanUserId) {
    throw new Error("No se encontró el usuario.");
  }

  const activeRef = doc(
    db,
    "activeTimeEntries",
    getActiveEntryDocId(cleanStoreId, cleanUserId)
  );
  const nowTimestamp = Timestamp.fromDate(now);

  return runTransaction(db, async (transaction) => {
    const activeSnapshot = await transaction.get(activeRef);

    if (!activeSnapshot.exists()) {
      throw new Error("No existe una jornada abierta para registrar salida.");
    }

    const activeEntry = activeSnapshot.data();
    const entryRef = doc(db, "timeEntries", activeEntry.timeEntryId);
    const entrySnapshot = await transaction.get(entryRef);

    if (!entrySnapshot.exists()) {
      throw new Error("La jornada activa no existe.");
    }

    const entry = entrySnapshot.data();

    if (entry.status !== TIME_ENTRY_STATUS.OPEN) {
      throw new Error("La jornada ya fue cerrada.");
    }

    const workedMinutes = calculateWorkedMinutes(entry.clockIn, nowTimestamp);

    if (workedMinutes <= 0) {
      throw new Error(
        "La hora de salida debe ser posterior a la hora de entrada."
      );
    }

    const workedHours = roundHours(workedMinutes / 60);
    const calculatedPayment = calculateEntryPayment({
      ...entry,
      workedMinutes,
    });

    transaction.update(entryRef, {
      clockOut: nowTimestamp,

      workedMinutes,
      workedHours,

      calculatedPayment,
      status: TIME_ENTRY_STATUS.COMPLETED,

      updatedAt: serverTimestamp(),

      clockOutByUid: actor?.uid || cleanUserId,
      clockOutByName: actor?.name || entry.userName || "Vendedor",
      clockOutByEmail: actor?.email || entry.userEmail || "",
    });

    transaction.delete(activeRef);

    return {
      id: entrySnapshot.id,
      ...entry,
      clockOut: now,
      workedMinutes,
      workedHours,
      calculatedPayment,
      status: TIME_ENTRY_STATUS.COMPLETED,
    };
  });
}

export async function getActiveTimeEntry(
  userId,
  storeId = STORE_ID
) {
  const cleanUserId = cleanString(userId);
  const cleanStoreId = cleanString(storeId) || STORE_ID;

  if (!cleanUserId) return null;

  const activeRef = doc(
    db,
    "activeTimeEntries",
    getActiveEntryDocId(cleanStoreId, cleanUserId)
  );

  const activeSnapshot = await getDoc(activeRef);

  if (!activeSnapshot.exists()) return null;

  const active = activeSnapshot.data();
  const entrySnapshot = await getDoc(
    doc(db, "timeEntries", active.timeEntryId)
  );

  if (!entrySnapshot.exists()) return null;

  return {
    id: entrySnapshot.id,
    ...entrySnapshot.data(),
  };
}

export function subscribeActiveTimeEntry(
  userId,
  callback,
  onError,
  storeId = STORE_ID
) {
  const cleanUserId = cleanString(userId);
  const cleanStoreId = cleanString(storeId) || STORE_ID;

  if (!cleanUserId) {
    callback(null);
    return () => {};
  }

  const activeRef = doc(
    db,
    "activeTimeEntries",
    getActiveEntryDocId(cleanStoreId, cleanUserId)
  );

  let unsubscribeEntry = null;

  const unsubscribeActive = onSnapshot(
    activeRef,
    (activeSnapshot) => {
      if (unsubscribeEntry) {
        unsubscribeEntry();
        unsubscribeEntry = null;
      }

      if (!activeSnapshot.exists()) {
        callback(null);
        return;
      }

      const active = activeSnapshot.data();

      unsubscribeEntry = onSnapshot(
        doc(db, "timeEntries", active.timeEntryId),
        (entrySnapshot) => {
          if (!entrySnapshot.exists()) {
            callback(null);
            return;
          }

          callback({
            id: entrySnapshot.id,
            ...entrySnapshot.data(),
          });
        },
        (error) => {
          console.error("Error escuchando jornada activa:", error);
          if (onError) onError(error);
        }
      );
    },
    (error) => {
      console.error("Error escuchando jornada activa:", error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubscribeActive();
    if (unsubscribeEntry) unsubscribeEntry();
  };
}

function mapEntriesSnapshot(snapshot) {
  return snapshot.docs
    .map((item) => ({
      id: item.id,
      ...item.data(),
    }))
    .sort((a, b) => {
      const dateA =
        a.clockIn?.toMillis?.() ||
        asDate(a.clockIn)?.getTime() ||
        0;
      const dateB =
        b.clockIn?.toMillis?.() ||
        asDate(b.clockIn)?.getTime() ||
        0;

      return dateB - dateA;
    });
}

function isDateKeyInRange(dateKey, startDateKey, endDateKey) {
  if (!dateKey) return false;
  if (startDateKey && dateKey < startDateKey) return false;
  if (endDateKey && dateKey > endDateKey) return false;
  return true;
}

export function subscribeUserTimeEntries({
  userId,
  callback,
  onError,
  storeId = STORE_ID,
  startDateKey = "",
  endDateKey = "",
}) {
  const cleanUserId = cleanString(userId);
  const cleanStoreId = cleanString(storeId) || STORE_ID;

  if (!cleanUserId) {
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, "timeEntries"),
    where("storeId", "==", cleanStoreId),
    where("userId", "==", cleanUserId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const entries = mapEntriesSnapshot(snapshot).filter((entry) =>
        isDateKeyInRange(
          entry.workDate,
          startDateKey,
          endDateKey
        )
      );

      callback(entries);
    },
    (error) => {
      console.error("Error escuchando jornadas del vendedor:", error);
      if (onError) onError(error);
    }
  );
}

export function subscribeStoreTimeEntries({
  callback,
  onError,
  storeId = STORE_ID,
  userId = "",
  startDateKey = "",
  endDateKey = "",
}) {
  const cleanStoreId = cleanString(storeId) || STORE_ID;
  const cleanUserId = cleanString(userId);

  const q = query(
    collection(db, "timeEntries"),
    where("storeId", "==", cleanStoreId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const entries = mapEntriesSnapshot(snapshot).filter((entry) => {
        const matchesUser =
          !cleanUserId || entry.userId === cleanUserId;

        const matchesDate = isDateKeyInRange(
          entry.workDate,
          startDateKey,
          endDateKey
        );

        return matchesUser && matchesDate;
      });

      callback(entries);
    },
    (error) => {
      console.error("Error escuchando jornadas de la tienda:", error);
      if (onError) onError(error);
    }
  );
}

export async function getUserTimeEntries({
  userId,
  storeId = STORE_ID,
  startDateKey = "",
  endDateKey = "",
}) {
  const cleanUserId = cleanString(userId);
  const cleanStoreId = cleanString(storeId) || STORE_ID;

  if (!cleanUserId) return [];

  const q = query(
    collection(db, "timeEntries"),
    where("storeId", "==", cleanStoreId),
    where("userId", "==", cleanUserId)
  );

  const snapshot = await getDocs(q);

  return mapEntriesSnapshot(snapshot).filter((entry) =>
    isDateKeyInRange(
      entry.workDate,
      startDateKey,
      endDateKey
    )
  );
}

function groupBy(items, keyGetter) {
  return items.reduce((groups, item) => {
    const key = keyGetter(item);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(item);
    return groups;
  }, new Map());
}

function getLatestEntry(entries) {
  return [...entries].sort((a, b) => {
    const dateA =
      a.clockOut?.toMillis?.() ||
      a.clockIn?.toMillis?.() ||
      asDate(a.clockOut)?.getTime() ||
      asDate(a.clockIn)?.getTime() ||
      0;

    const dateB =
      b.clockOut?.toMillis?.() ||
      b.clockIn?.toMillis?.() ||
      asDate(b.clockOut)?.getTime() ||
      asDate(b.clockIn)?.getTime() ||
      0;

    return dateB - dateA;
  })[0];
}

function calculateDailyGroupPayment(dayEntries) {
  if (!dayEntries.length) return 0;

  const type = dayEntries[0].paymentTypeSnapshot;

  if (type === PAYMENT_TYPES.HOURLY) {
    return roundMoney(
      dayEntries.reduce(
        (total, entry) =>
          total + toNonNegativeNumber(entry.calculatedPayment),
        0
      )
    );
  }

  if (type === PAYMENT_TYPES.DAILY) {
    const latest = getLatestEntry(dayEntries);
    const totalMinutes = dayEntries.reduce(
      (total, entry) =>
        total + toNonNegativeNumber(entry.workedMinutes),
      0
    );

    const expectedMinutes = Math.max(
      toFiniteNumber(
        latest.expectedDailyMinutesSnapshot,
        DEFAULT_PAYMENT_CONFIG.expectedDailyMinutes
      ),
      1
    );

    return roundMoney(
      Math.min(totalMinutes / expectedMinutes, 1) *
        toNonNegativeNumber(latest.dailyRateSnapshot)
    );
  }

  return 0;
}

export function summarizeTimeEntries(
  entries = [],
  {
    paymentType = "",
    paymentConfig = null,
  } = {}
) {
  const completedEntries = entries.filter(
    (entry) =>
      entry.status === TIME_ENTRY_STATUS.COMPLETED ||
      entry.status === TIME_ENTRY_STATUS.CORRECTED
  );

  const openEntries = entries.filter(
    (entry) => entry.status === TIME_ENTRY_STATUS.OPEN
  );

  const workedMinutes = completedEntries.reduce(
    (total, entry) =>
      total + toNonNegativeNumber(entry.workedMinutes),
    0
  );

  const workedHours = roundHours(workedMinutes / 60);

  const entriesByDay = groupBy(
    completedEntries,
    (entry) => entry.workDate || "sin-fecha"
  );

  const workedDays = entriesByDay.size;

  const detectedPaymentType =
    paymentType ||
    getLatestEntry(completedEntries)?.paymentTypeSnapshot ||
    paymentConfig?.paymentType ||
    PAYMENT_TYPES.HOURLY;

  let amountDue = 0;

  if (
    detectedPaymentType === PAYMENT_TYPES.HOURLY ||
    detectedPaymentType === PAYMENT_TYPES.DAILY
  ) {
    for (const dayEntries of entriesByDay.values()) {
      amountDue += calculateDailyGroupPayment(dayEntries);
    }
  }

  if (detectedPaymentType === PAYMENT_TYPES.BIWEEKLY) {
    const groups = groupBy(
      completedEntries,
      (entry) => entry.biweeklyPeriod || "sin-periodo"
    );

    for (const periodEntries of groups.values()) {
      const latest = getLatestEntry(periodEntries);
      amountDue += toNonNegativeNumber(
        latest?.biweeklySalarySnapshot ??
          paymentConfig?.biweeklySalary
      );
    }
  }

  if (detectedPaymentType === PAYMENT_TYPES.MONTHLY) {
    const groups = groupBy(
      completedEntries,
      (entry) => entry.monthlyPeriod || "sin-periodo"
    );

    for (const periodEntries of groups.values()) {
      const latest = getLatestEntry(periodEntries);
      amountDue += toNonNegativeNumber(
        latest?.monthlySalarySnapshot ??
          paymentConfig?.monthlySalary
      );
    }
  }

  return {
    totalEntries: entries.length,
    completedEntries: completedEntries.length,
    openEntries: openEntries.length,

    workedMinutes,
    workedHours,
    workedDays,

    paymentType: detectedPaymentType,
    amountDue: roundMoney(amountDue),

    firstWorkDate:
      completedEntries
        .map((entry) => entry.workDate)
        .filter(Boolean)
        .sort()[0] || "",

    lastWorkDate:
      completedEntries
        .map((entry) => entry.workDate)
        .filter(Boolean)
        .sort()
        .at(-1) || "",
  };
}

export function getCurrentPeriodRange(
  period = REPORT_PERIODS.MONTH,
  referenceDate = new Date()
) {
  const { year, month, day } = getBogotaParts(referenceDate);

  if (period === REPORT_PERIODS.DAY) {
    const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;

    return {
      startDateKey: dateKey,
      endDateKey: dateKey,
      label: "Hoy",
    };
  }

  if (period === REPORT_PERIODS.BIWEEKLY) {
    const startDay = day <= 15 ? 1 : 16;
    const endDay = day <= 15 ? 15 : new Date(year, month, 0).getDate();

    return {
      startDateKey: `${year}-${pad2(month)}-${pad2(startDay)}`,
      endDateKey: `${year}-${pad2(month)}-${pad2(endDay)}`,
      label: day <= 15 ? "Primera quincena" : "Segunda quincena",
    };
  }

  const endDay = new Date(year, month, 0).getDate();

  return {
    startDateKey: `${year}-${pad2(month)}-01`,
    endDateKey: `${year}-${pad2(month)}-${pad2(endDay)}`,
    label: "Mes actual",
  };
}

export async function correctTimeEntry({
  timeEntryId,
  clockIn,
  clockOut,
  notes,
  actor = null,
}) {
  const cleanEntryId = cleanString(timeEntryId);
  const cleanNotes = cleanString(notes);
  const startDate = asDate(clockIn);
  const endDate = asDate(clockOut);

  if (!cleanEntryId) {
    throw new Error("No se encontró la jornada.");
  }

  if (!startDate || !endDate) {
    throw new Error(
      "Debes indicar una hora de entrada y una hora de salida válidas."
    );
  }

  if (endDate <= startDate) {
    throw new Error(
      "La hora de salida debe ser posterior a la hora de entrada."
    );
  }

  if (!cleanNotes) {
    throw new Error(
      "Debes escribir el motivo de la corrección."
    );
  }

  const entryRef = doc(db, "timeEntries", cleanEntryId);
  const snapshot = await getDoc(entryRef);

  if (!snapshot.exists()) {
    throw new Error("La jornada no existe.");
  }

  const entry = snapshot.data();
  const workedMinutes = calculateWorkedMinutes(startDate, endDate);
  const workedHours = roundHours(workedMinutes / 60);

  const calculatedPayment = calculateEntryPayment({
    ...entry,
    workedMinutes,
  });

  const nextWorkDate = getBusinessDateKey(startDate);
  const nextBiweeklyPeriod = getBiweeklyPeriodKey(startDate);
  const nextMonthlyPeriod = getMonthlyPeriodKey(startDate);

  await updateDoc(entryRef, {
    clockIn: Timestamp.fromDate(startDate),
    clockOut: Timestamp.fromDate(endDate),

    workDate: nextWorkDate,
    biweeklyPeriod: nextBiweeklyPeriod,
    monthlyPeriod: nextMonthlyPeriod,

    workedMinutes,
    workedHours,
    calculatedPayment,

    status: TIME_ENTRY_STATUS.CORRECTED,

    correctedAt: serverTimestamp(),
    correctedByUid: actor?.uid || "",
    correctedByName: actor?.name || "",
    correctedByEmail: actor?.email || "",
    correctionNotes: cleanNotes,

    updatedAt: serverTimestamp(),
  });

  /*
   * Si por un error previo existía un puntero de jornada activa,
   * se elimina cuando la corrección ya contiene salida.
   */
  const activeRef = doc(
    db,
    "activeTimeEntries",
    getActiveEntryDocId(entry.storeId, entry.userId)
  );

  const activeSnapshot = await getDoc(activeRef);

  if (
    activeSnapshot.exists() &&
    activeSnapshot.data().timeEntryId === cleanEntryId
  ) {
    await deleteDoc(activeRef);
  }

  return {
    id: cleanEntryId,
    ...entry,
    clockIn: Timestamp.fromDate(startDate),
    clockOut: Timestamp.fromDate(endDate),
    workDate: nextWorkDate,
    biweeklyPeriod: nextBiweeklyPeriod,
    monthlyPeriod: nextMonthlyPeriod,
    workedMinutes,
    workedHours,
    calculatedPayment,
    status: TIME_ENTRY_STATUS.CORRECTED,
    correctionNotes: cleanNotes,
  };
}

export function formatWorkedTime(minutes) {
  const safeMinutes = Math.max(
    Math.trunc(toFiniteNumber(minutes)),
    0
  );

  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  if (hours <= 0) {
    return `${remainingMinutes} min`;
  }

  return `${hours} h ${remainingMinutes} min`;
}