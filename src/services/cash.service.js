import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import { getSales } from "./sales.service";

export const CASH_TIME_ZONE = "America/Bogota";
export const CASH_METHODS = [
  "efectivo",
  "transferencia",
  "nequi",
  "daviplata",
  "tarjeta",
  "addi",
  "otro",
];

export const CASH_METHOD_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  nequi: "Nequi",
  daviplata: "Daviplata",
  tarjeta: "Tarjeta",
  addi: "Addi",
  otro: "Otro",
};

const CASH_SESSIONS_COLLECTION = "cashSessions";
const CASH_MOVEMENTS_COLLECTION = "cashMovements";

function cleanText(value) {
  return String(value || "").trim();
}

function safeId(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function getBogotaBusinessDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CASH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value || "0000";
  const month = parts.find((item) => item.type === "month")?.value || "00";
  const day = parts.find((item) => item.type === "day")?.value || "00";

  return `${year}-${month}-${day}`;
}

export function getCashSessionId({
  storeId = STORE_ID,
  operatorUid,
  businessDate = getBogotaBusinessDate(),
}) {
  const cleanUid = safeId(operatorUid);

  if (!cleanUid) {
    throw new Error("No se pudo identificar al operador de caja.");
  }

  return `${safeId(storeId)}__${cleanUid}__${businessDate}`;
}

function normalizeSession(session = {}) {
  return {
    ...session,
    openingAmount: money(session.openingAmount),
    expectedCash: money(session.expectedCash),
    countedCash:
      session.countedCash === null || session.countedCash === undefined
        ? null
        : money(session.countedCash),
    difference:
      session.difference === null || session.difference === undefined
        ? null
        : Number(session.difference || 0),
    status: cleanText(session.status) || "open",
    closeType: cleanText(session.closeType),
  };
}

function normalizeMovement(movement = {}) {
  return {
    ...movement,
    amount: money(movement.amount),
    type: cleanText(movement.type),
    fromMethod: cleanText(movement.fromMethod),
    toMethod: cleanText(movement.toMethod),
    note: cleanText(movement.note),
  };
}

export function normalizeSalePayments(sale = {}) {
  const total = money(sale.total);
  const source = Array.isArray(sale.payments) ? sale.payments : [];

  if (source.length > 0) {
    const normalized = source
      .map((payment) => ({
        method: CASH_METHODS.includes(cleanText(payment?.method))
          ? cleanText(payment.method)
          : "otro",
        amount: money(payment?.amount),
        receivedAmount:
          payment?.receivedAmount === null || payment?.receivedAmount === undefined
            ? money(payment?.amount)
            : money(payment.receivedAmount),
      }))
      .filter((payment) => payment.amount > 0);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  const method = CASH_METHODS.includes(cleanText(sale.paymentMethod))
    ? cleanText(sale.paymentMethod)
    : "otro";

  return [
    {
      method,
      amount: total,
      receivedAmount:
        method === "efectivo"
          ? money(sale.amountReceived || total)
          : total,
    },
  ];
}

function saleBelongsToSession(sale, session) {
  if (!sale || !session) return false;

  if (sale.cashSessionId) {
    return sale.cashSessionId === session.id;
  }

  const saleSellerUid = cleanText(sale.sellerUid);
  const sessionOperatorUid = cleanText(session.operatorUid);

  if (
    saleSellerUid &&
    sessionOperatorUid &&
    saleSellerUid !== sessionOperatorUid
  ) {
    return false;
  }

  const saleMs = timestampMs(sale.createdAt);
  const openedMs = timestampMs(session.openedAt);
  const closedMs = timestampMs(session.closedAt);

  if (!saleMs || !openedMs || saleMs < openedMs) {
    return false;
  }

  if (closedMs && saleMs > closedMs) {
    return false;
  }

  return getBogotaBusinessDate(new Date(saleMs)) === session.businessDate;
}

function emptyBalances() {
  return CASH_METHODS.reduce((result, method) => {
    result[method] = 0;
    return result;
  }, {});
}

export function buildCashSessionSummary(session, sales = [], movements = []) {
  const safeSession = normalizeSession(session || {});
  const balances = emptyBalances();
  const salesByMethod = emptyBalances();

  balances.efectivo = money(safeSession.openingAmount);

  let totalSales = 0;
  let saleCount = 0;
  let pendingAddi = 0;

  (Array.isArray(sales) ? sales : []).forEach((sale) => {
    if (!saleBelongsToSession(sale, safeSession)) return;

    saleCount += 1;
    totalSales += money(sale.total);

    normalizeSalePayments(sale).forEach((payment) => {
      salesByMethod[payment.method] += payment.amount;

      if (
        payment.method === "addi" &&
        cleanText(sale.addiStatus) !== "settled"
      ) {
        pendingAddi += payment.amount;
        return;
      }

      balances[payment.method] += payment.amount;
    });
  });

  const movementTotals = {
    entries: 0,
    exits: 0,
    transfers: 0,
  };

  (Array.isArray(movements) ? movements : []).forEach((rawMovement) => {
    const movement = normalizeMovement(rawMovement);
    const amount = movement.amount;

    if (amount <= 0) return;

    if (movement.type === "transfer") {
      if (CASH_METHODS.includes(movement.fromMethod)) {
        balances[movement.fromMethod] -= amount;
      }

      if (CASH_METHODS.includes(movement.toMethod)) {
        balances[movement.toMethod] += amount;
      }

      movementTotals.transfers += amount;
      return;
    }

    if (movement.type === "entry") {
      const destination = CASH_METHODS.includes(movement.toMethod)
        ? movement.toMethod
        : "efectivo";

      balances[destination] += amount;
      movementTotals.entries += amount;
      return;
    }

    if (movement.type === "exit") {
      const origin = CASH_METHODS.includes(movement.fromMethod)
        ? movement.fromMethod
        : "efectivo";

      balances[origin] -= amount;
      movementTotals.exits += amount;
    }
  });

  Object.keys(balances).forEach((method) => {
    if (Math.abs(balances[method]) < 0.000001) {
      balances[method] = 0;
    }
  });

  const totalAvailable = Object.values(balances).reduce(
    (total, value) => total + Number(value || 0),
    0
  );

  return {
    balances,
    salesByMethod,
    totalSales,
    saleCount,
    pendingAddi,
    totalAvailable,
    expectedCash: Number(balances.efectivo || 0),
    movementTotals,
  };
}

export async function getCashSessionById(sessionId) {
  const cleanSessionId = cleanText(sessionId);
  if (!cleanSessionId) return null;

  const snapshot = await getDoc(
    doc(db, CASH_SESSIONS_COLLECTION, cleanSessionId)
  );

  if (!snapshot.exists()) return null;

  return normalizeSession({
    id: snapshot.id,
    ...snapshot.data(),
  });
}

export async function getTodayCashSession({
  storeId = STORE_ID,
  actor,
}) {
  const sessionId = getCashSessionId({
    storeId,
    operatorUid: actor?.uid,
  });

  return getCashSessionById(sessionId);
}

export function subscribeTodayCashSession({
  storeId = STORE_ID,
  actor,
  callback,
  onError,
}) {
  const sessionId = getCashSessionId({
    storeId,
    operatorUid: actor?.uid,
  });

  return onSnapshot(
    doc(db, CASH_SESSIONS_COLLECTION, sessionId),
    (snapshot) => {
      callback(
        snapshot.exists()
          ? normalizeSession({ id: snapshot.id, ...snapshot.data() })
          : null
      );
    },
    (error) => {
      console.error("Error escuchando la caja actual:", error);
      onError?.(error);
    }
  );
}

const cashSessionsRegistry = new Map();

export function subscribeCashSessions(
  callback,
  onError,
  storeId = STORE_ID
) {
  const key = cleanText(storeId) || STORE_ID;

  if (!cashSessionsRegistry.has(key)) {
    cashSessionsRegistry.set(key, {
      subscribers: new Set(),
      values: [],
      hasSnapshot: false,
      unsubscribe: null,
    });
  }

  const entry = cashSessionsRegistry.get(key);
  const subscriber = { callback, onError };
  entry.subscribers.add(subscriber);

  if (entry.hasSnapshot) {
    callback(entry.values);
  }

  if (!entry.unsubscribe) {
    const q = query(
      collection(db, CASH_SESSIONS_COLLECTION),
      where("storeId", "==", key)
    );

    entry.unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        entry.values = snapshot.docs
          .map((item) =>
            normalizeSession({ id: item.id, ...item.data() })
          )
          .sort(
            (a, b) =>
              timestampMs(b.openedAt) - timestampMs(a.openedAt)
          );
        entry.hasSnapshot = true;

        entry.subscribers.forEach((item) => item.callback(entry.values));
      },
      (error) => {
        console.error("Error escuchando sesiones de caja:", error);
        entry.unsubscribe = null;
        entry.subscribers.forEach((item) => item.onError?.(error));
      }
    );
  }

  let active = true;

  return () => {
    if (!active) return;
    active = false;
    entry.subscribers.delete(subscriber);

    /*
     * Conservamos values/hasSnapshot como caché en memoria, pero cerramos
     * el listener cuando ya no existe ninguna pantalla consumiéndolo.
     * Así evitamos listeners duplicados al navegar por la aplicación.
     */
    if (entry.subscribers.size === 0 && typeof entry.unsubscribe === "function") {
      entry.unsubscribe();
      entry.unsubscribe = null;
    }
  };
}

export function subscribeCashMovements(sessionId, callback, onError) {
  const cleanSessionId = cleanText(sessionId);

  if (!cleanSessionId) {
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, CASH_MOVEMENTS_COLLECTION),
    where("sessionId", "==", cleanSessionId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((item) =>
            normalizeMovement({ id: item.id, ...item.data() })
          )
          .sort(
            (a, b) =>
              timestampMs(b.createdAt) - timestampMs(a.createdAt)
          )
      );
    },
    (error) => {
      console.error("Error escuchando movimientos de caja:", error);
      onError?.(error);
    }
  );
}

export async function getCashMovements(sessionId) {
  const cleanSessionId = cleanText(sessionId);
  if (!cleanSessionId) return [];

  const q = query(
    collection(db, CASH_MOVEMENTS_COLLECTION),
    where("sessionId", "==", cleanSessionId)
  );

  const snapshot = await getDocs(q);

  return snapshot.docs
    .map((item) => normalizeMovement({ id: item.id, ...item.data() }))
    .sort(
      (a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt)
    );
}

export async function openCashSession({
  openingAmount = 0,
  storeId = STORE_ID,
  actor,
}) {
  const operatorUid = cleanText(actor?.uid);

  if (!operatorUid) {
    throw new Error("No se pudo identificar al vendedor que abre la caja.");
  }

  const businessDate = getBogotaBusinessDate();
  const sessionId = getCashSessionId({
    storeId,
    operatorUid,
    businessDate,
  });
  const sessionRef = doc(db, CASH_SESSIONS_COLLECTION, sessionId);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(sessionRef);

    if (snapshot.exists()) {
      const current = normalizeSession({
        id: snapshot.id,
        ...snapshot.data(),
      });

      if (current.status === "open") {
        return current;
      }

      throw new Error(
        "La caja de hoy ya fue cerrada. No se puede abrir una segunda caja para el mismo operador en el mismo día."
      );
    }

    const payload = {
      storeId,
      businessDate,
      operatorUid,
      operatorName: cleanText(actor?.name),
      operatorEmail: cleanText(actor?.email),
      openingAmount: money(openingAmount),
      status: "open",
      closeType: "",
      expectedCash: 0,
      countedCash: null,
      difference: null,
      openedAt: serverTimestamp(),
      closedAt: null,
      closedByUid: "",
      closedByName: "",
      closedByEmail: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(sessionRef, payload);

    return {
      id: sessionId,
      ...payload,
    };
  });
}

async function calculateFreshSummary(session) {
  const [sales, movements] = await Promise.all([
    getSales(session.storeId || STORE_ID),
    getCashMovements(session.id),
  ]);

  return buildCashSessionSummary(session, sales, movements);
}

export async function createCashMovement({
  sessionId,
  type,
  fromMethod = "",
  toMethod = "",
  amount,
  note = "",
  actor,
}) {
  const cleanSessionId = cleanText(sessionId);
  const cleanType = cleanText(type);
  const cleanFrom = cleanText(fromMethod);
  const cleanTo = cleanText(toMethod);
  const cleanAmount = money(amount);

  if (!cleanSessionId) {
    throw new Error("No se encontró la caja abierta.");
  }

  if (!['transfer', 'entry', 'exit'].includes(cleanType)) {
    throw new Error("El tipo de movimiento de caja no es válido.");
  }

  if (cleanAmount <= 0) {
    throw new Error("El valor del movimiento debe ser mayor a cero.");
  }

  if (cleanType === "transfer") {
    if (!CASH_METHODS.includes(cleanFrom) || !CASH_METHODS.includes(cleanTo)) {
      throw new Error("Selecciona un origen y un destino válidos.");
    }

    if (cleanFrom === cleanTo) {
      throw new Error("El origen y el destino deben ser diferentes.");
    }
  }

  if (cleanType === "entry" && !CASH_METHODS.includes(cleanTo)) {
    throw new Error("Selecciona dónde entra el dinero.");
  }

  if (cleanType === "exit" && !CASH_METHODS.includes(cleanFrom)) {
    throw new Error("Selecciona de dónde sale el dinero.");
  }

  const session = await getCashSessionById(cleanSessionId);

  if (!session || session.status !== "open") {
    throw new Error("La caja ya no está abierta.");
  }

  if (session.businessDate !== getBogotaBusinessDate()) {
    throw new Error(
      "Esta caja pertenece a un día anterior y debe cerrarse antes de registrar movimientos."
    );
  }

  const summary = await calculateFreshSummary(session);
  const origin = cleanType === "exit" ? cleanFrom : cleanType === "transfer" ? cleanFrom : "";

  if (origin && cleanAmount > Number(summary.balances[origin] || 0)) {
    throw new Error(
      `No hay saldo suficiente en ${CASH_METHOD_LABELS[origin] || origin}. Disponible: ${Number(summary.balances[origin] || 0).toLocaleString("es-CO")}.`
    );
  }

  const sessionRef = doc(db, CASH_SESSIONS_COLLECTION, cleanSessionId);
  const movementRef = doc(collection(db, CASH_MOVEMENTS_COLLECTION));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(sessionRef);

    if (!snapshot.exists() || snapshot.data()?.status !== "open") {
      throw new Error("La caja fue cerrada antes de registrar el movimiento.");
    }

    transaction.set(movementRef, {
      storeId: session.storeId,
      sessionId: cleanSessionId,
      businessDate: session.businessDate,
      operatorUid: session.operatorUid,
      operatorName: session.operatorName || "",
      type: cleanType,
      fromMethod: cleanType === "entry" ? "" : cleanFrom,
      toMethod: cleanType === "exit" ? "" : cleanTo,
      amount: cleanAmount,
      note: cleanText(note),
      createdByUid: cleanText(actor?.uid),
      createdByName: cleanText(actor?.name),
      createdByEmail: cleanText(actor?.email),
      createdAt: serverTimestamp(),
    });

    transaction.update(sessionRef, {
      updatedAt: serverTimestamp(),
    });
  });

  return movementRef.id;
}

export async function closeCashSession({
  sessionId,
  countedCash = null,
  actor = null,
  closeType = "manual",
}) {
  const session = await getCashSessionById(sessionId);

  if (!session) {
    throw new Error("No se encontró la caja.");
  }

  if (session.status === "closed") {
    return session;
  }

  const summary = await calculateFreshSummary(session);
  const isAutomatic = cleanText(closeType).startsWith("automatic");
  const finalCountedCash =
    countedCash === null || countedCash === undefined || countedCash === ""
      ? null
      : money(countedCash);

  if (!isAutomatic && finalCountedCash === null) {
    throw new Error("Cuenta el efectivo antes de cerrar la caja.");
  }

  const difference =
    finalCountedCash === null
      ? null
      : finalCountedCash - summary.expectedCash;

  const sessionRef = doc(db, CASH_SESSIONS_COLLECTION, session.id);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(sessionRef);

    if (!snapshot.exists()) {
      throw new Error("La caja ya no existe.");
    }

    if (snapshot.data()?.status === "closed") {
      return;
    }

    transaction.update(sessionRef, {
      status: "closed",
      closeType: isAutomatic ? cleanText(closeType) || "automatic" : "manual",
      expectedCash: summary.expectedCash,
      countedCash: finalCountedCash,
      difference,
      closingTotalSales: summary.totalSales,
      closingSaleCount: summary.saleCount,
      closingBalances: summary.balances,
      closingSalesByMethod: summary.salesByMethod,
      closingPendingAddi: summary.pendingAddi,
      closedAt: serverTimestamp(),
      closedByUid: isAutomatic ? "system" : cleanText(actor?.uid),
      closedByName: isAutomatic ? "Sistema" : cleanText(actor?.name),
      closedByEmail: isAutomatic ? "" : cleanText(actor?.email),
      updatedAt: serverTimestamp(),
    });
  });

  return {
    ...session,
    status: "closed",
    expectedCash: summary.expectedCash,
    countedCash: finalCountedCash,
    difference,
    summary,
  };
}

export async function recoverExpiredCashSessions({
  storeId = STORE_ID,
  actor,
}) {
  const operatorUid = cleanText(actor?.uid);
  if (!operatorUid) return [];

  const q = query(
    collection(db, CASH_SESSIONS_COLLECTION),
    where("storeId", "==", storeId)
  );

  const snapshot = await getDocs(q);
  const today = getBogotaBusinessDate();

  const expired = snapshot.docs
    .map((item) => normalizeSession({ id: item.id, ...item.data() }))
    .filter(
      (session) =>
        session.status === "open" &&
        session.operatorUid === operatorUid &&
        session.businessDate &&
        session.businessDate < today
    );

  const results = [];

  for (const session of expired) {
    try {
      results.push(
        await closeCashSession({
          sessionId: session.id,
          countedCash: null,
          actor: { uid: "system", name: "Sistema", email: "" },
          closeType: "automatic_recovery",
        })
      );
    } catch (error) {
      console.error("No se pudo recuperar una caja vencida:", error);
    }
  }

  return results;
}
