import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";
import { getFinanceSummary, FINANCE_PERIOD_TYPE, validateAmountAgainstAvailableBalance } from "./finance.service";
import { EXPENSES_COLLECTION, EXPENSE_SOURCE, EXPENSE_STATUS } from "./expenses.service";

export const PAYROLL_PAYMENTS_COLLECTION = "payrollPayments";

export const PAYROLL_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  VOIDED: "voided",
};

function cleanString(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round(toNumber(value));
}

function getMonthKey(dateKey) {
  return cleanString(dateKey).slice(0, 7);
}

function getTodayDateKey() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isClosedEntry(entry) {
  return ["completed", "corrected"].includes(cleanString(entry?.status));
}

function isUnpaidEntry(entry) {
  return cleanString(entry?.paymentStatus || "pending") !== PAYROLL_STATUS.PAID;
}

export function calculatePayrollEntryAmount(entry = {}) {
  if (Number.isFinite(Number(entry.calculatedPayment))) {
    return roundMoney(Math.max(Number(entry.calculatedPayment), 0));
  }

  const minutes = Math.max(toNumber(entry.workedMinutes), 0);
  const hourlyRate = Math.max(
    toNumber(
      entry.hourlyRateSnapshot ??
        entry.activeRateSnapshot ??
        entry.hourlyRate
    ),
    0
  );

  return roundMoney((minutes / 60) * hourlyRate);
}

export function summarizePayrollEntries(entries = []) {
  return entries.reduce(
    (summary, entry) => {
      const minutes = Math.max(toNumber(entry.workedMinutes), 0);
      const amount = calculatePayrollEntryAmount(entry);

      summary.entryIds.push(entry.id);
      summary.entries += 1;
      summary.totalMinutes += minutes;
      summary.totalHours = Math.round((summary.totalMinutes / 60) * 100) / 100;
      summary.amount += amount;

      return summary;
    },
    {
      entryIds: [],
      entries: 0,
      totalMinutes: 0,
      totalHours: 0,
      amount: 0,
    }
  );
}

export function subscribeSellerUnpaidTimeEntries({
  sellerUid,
  callback,
  onError,
  storeId = STORE_ID,
}) {
  const safeSellerUid = cleanString(sellerUid);

  if (!safeSellerUid) {
    callback([]);
    return () => {};
  }

  return onSnapshot(
    query(
      collection(db, "timeEntries"),
      where("storeId", "==", cleanString(storeId) || STORE_ID),
      where("userId", "==", safeSellerUid)
    ),
    (snapshot) => {
      const entries = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((entry) => isClosedEntry(entry) && isUnpaidEntry(entry))
        .sort((a, b) =>
          String(b.workDate || "").localeCompare(String(a.workDate || ""))
        );

      callback(entries);
    },
    (error) => {
      console.error("Error escuchando jornadas pendientes:", error);
      onError?.(error);
    }
  );
}

export function subscribePayrollPayments({
  callback,
  onError,
  storeId = STORE_ID,
  sellerUid = "",
}) {
  const constraints = [
    where("storeId", "==", cleanString(storeId) || STORE_ID),
  ];

  if (cleanString(sellerUid)) {
    constraints.push(where("sellerUid", "==", cleanString(sellerUid)));
  }

  return onSnapshot(
    query(
      collection(db, PAYROLL_PAYMENTS_COLLECTION),
      ...constraints
    ),
    (snapshot) => {
      const rows = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) =>
          String(b.paymentDate || "").localeCompare(String(a.paymentDate || ""))
        );

      callback(rows);
    },
    (error) => {
      console.error("Error escuchando pagos de nómina:", error);
      onError?.(error);
    }
  );
}

export async function paySellerPayroll({
  seller,
  entries,
  paymentMethod = "transfer",
  paymentDate = getTodayDateKey(),
  notes = "",
  actor = null,
  storeId = STORE_ID,
}) {
  const safeStoreId = cleanString(storeId) || STORE_ID;
  const sellerUid = cleanString(seller?.id || seller?.uid);

  if (!sellerUid) throw new Error("No se encontró el vendedor.");
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error("Selecciona al menos una jornada pendiente.");
  }

  const preview = summarizePayrollEntries(entries);

  if (preview.amount <= 0) {
    throw new Error("Las jornadas seleccionadas no tienen un valor válido para pagar.");
  }

  const financeSummary = await getFinanceSummary({
    storeId: safeStoreId,
    period: {
      type: FINANCE_PERIOD_TYPE.MONTH,
      monthKey: getMonthKey(paymentDate),
    },
  });

  validateAmountAgainstAvailableBalance({
    amount: preview.amount,
    summary: financeSummary,
    label: "El pago de nómina",
  });

  const paymentRef = doc(collection(db, PAYROLL_PAYMENTS_COLLECTION));
  const expenseRef = doc(collection(db, EXPENSES_COLLECTION));

  return runTransaction(db, async (transaction) => {
    const entryRefs = preview.entryIds.map((entryId) =>
      doc(db, "timeEntries", entryId)
    );

    const snapshots = [];
    for (const entryRef of entryRefs) {
      snapshots.push(await transaction.get(entryRef));
    }

    const currentEntries = snapshots.map((snapshot, index) => {
      if (!snapshot.exists()) {
        throw new Error("Una de las jornadas seleccionadas ya no existe.");
      }

      const entry = { id: preview.entryIds[index], ...snapshot.data() };

      if (!isClosedEntry(entry)) {
        throw new Error("Una de las jornadas todavía no está cerrada.");
      }

      if (!isUnpaidEntry(entry)) {
        throw new Error("Una de las jornadas seleccionadas ya fue pagada.");
      }

      if (cleanString(entry.userId) !== sellerUid) {
        throw new Error("Las jornadas no pertenecen al vendedor seleccionado.");
      }

      return entry;
    });

    const confirmed = summarizePayrollEntries(currentEntries);

    const paymentDocument = {
      storeId: safeStoreId,
      sellerUid,
      sellerName:
        cleanString(seller?.displayName) ||
        cleanString(seller?.name) ||
        cleanString(seller?.email) ||
        "Vendedor",
      sellerEmail: cleanString(seller?.email),

      entryIds: confirmed.entryIds,
      entriesCount: confirmed.entries,
      totalMinutes: confirmed.totalMinutes,
      totalHours: confirmed.totalHours,
      amount: confirmed.amount,

      paymentMethod: cleanString(paymentMethod) || "transfer",
      paymentDate,
      monthKey: getMonthKey(paymentDate),
      status: PAYROLL_STATUS.PAID,
      notes: cleanString(notes),

      expenseId: expenseRef.id,

      paidByUid: actor?.uid || "",
      paidByName: actor?.name || "",
      paidByEmail: actor?.email || "",
      paidAt: serverTimestamp(),

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const expenseDocument = {
      storeId: safeStoreId,
      description: `Pago de nómina · ${paymentDocument.sellerName}`,
      amount: confirmed.amount,
      supplier: paymentDocument.sellerName,
      expenseDate: paymentDate,
      monthKey: getMonthKey(paymentDate),
      category: "payroll",
      paymentMethod: paymentDocument.paymentMethod,
      status: EXPENSE_STATUS.PAID,
      notes: cleanString(notes),

      source: EXPENSE_SOURCE.PAYROLL,
      payrollPaymentId: paymentRef.id,
      sellerUid,
      sellerName: paymentDocument.sellerName,
      timeEntryIds: confirmed.entryIds,

      receipt: null,
      receiptUrl: "",
      receiptPath: "",
      receiptName: "",
      receiptType: "",
      receiptSize: 0,

      registeredByUid: actor?.uid || "",
      registeredByName: actor?.name || "",
      registeredByEmail: actor?.email || "",

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(paymentRef, paymentDocument);
    transaction.set(expenseRef, expenseDocument);

    currentEntries.forEach((entry) => {
      transaction.update(doc(db, "timeEntries", entry.id), {
        paymentStatus: PAYROLL_STATUS.PAID,
        payrollPaymentId: paymentRef.id,
        expenseId: expenseRef.id,
        paidAmount: calculatePayrollEntryAmount(entry),
        paidAt: serverTimestamp(),
        paidByUid: actor?.uid || "",
        paidByName: actor?.name || "",
        paidByEmail: actor?.email || "",
        updatedAt: serverTimestamp(),
      });
    });

    return {
      id: paymentRef.id,
      expenseId: expenseRef.id,
      ...paymentDocument,
    };
  });
}