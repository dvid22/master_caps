import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
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
import {
  FINANCE_PERIOD_TYPE,
  formatFinanceCurrency,
  getFinanceSummary,
  validateAmountAgainstAvailableBalance,
} from "./finance.service";

export const EXPENSES_COLLECTION = "expenses";

export const EXPENSE_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  VOIDED: "voided",
};

export const EXPENSE_STATUS_OPTIONS = [
  {
    value: EXPENSE_STATUS.PENDING,
    label: "Pendiente",
  },
  {
    value: EXPENSE_STATUS.PAID,
    label: "Pagado",
  },
  {
    value: EXPENSE_STATUS.VOIDED,
    label: "Anulado",
  },
];

export const EXPENSE_PAYMENT_METHODS = [
  {
    value: "cash",
    label: "Efectivo",
  },
  {
    value: "transfer",
    label: "Transferencia",
  },
  {
    value: "card",
    label: "Tarjeta",
  },
  {
    value: "nequi",
    label: "Nequi",
  },
  {
    value: "daviplata",
    label: "Daviplata",
  },
  {
    value: "other",
    label: "Otro",
  },
];

export const EXPENSE_CATEGORIES = [
  {
    value: "services",
    label: "Servicios",
  },
  {
    value: "rent",
    label: "Arriendo",
  },
  {
    value: "payroll",
    label: "Nómina",
  },
  {
    value: "transport",
    label: "Transporte",
  },
  {
    value: "inventory",
    label: "Compras de inventario",
  },
  {
    value: "maintenance",
    label: "Mantenimiento",
  },
  {
    value: "advertising",
    label: "Publicidad",
  },
  {
    value: "stationery",
    label: "Papelería",
  },
  {
    value: "taxes",
    label: "Impuestos",
  },
  {
    value: "other",
    label: "Otros",
  },
];

export const EXPENSE_SOURCE = {
  MANUAL: "manual",
  PAYROLL: "payroll",
  SYSTEM: "system",
};

const MAX_RECEIPT_SIZE = 8 * 1024 * 1024;

const ALLOWED_RECEIPT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanString(value).toLowerCase();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveAmount(value) {
  const amount = toFiniteNumber(value, 0);
  return amount > 0 ? Math.round(amount) : 0;
}

function isValidDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanString(value));
}

function getTodayDateKey() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getMonthKeyFromDateKey(dateKey) {
  const safeDate = cleanString(dateKey);

  if (!isValidDateKey(safeDate)) return "";

  return safeDate.slice(0, 7);
}

function getStatusLabel(status) {
  return (
    EXPENSE_STATUS_OPTIONS.find(
      (option) => option.value === status
    )?.label || "Pendiente"
  );
}

function getCategoryLabel(category) {
  return (
    EXPENSE_CATEGORIES.find(
      (option) => option.value === category
    )?.label || "Otros"
  );
}

function getPaymentMethodLabel(paymentMethod) {
  return (
    EXPENSE_PAYMENT_METHODS.find(
      (option) => option.value === paymentMethod
    )?.label || "Otro"
  );
}

function normalizeExpenseStatus(value) {
  const safeValue = normalizeText(value);

  return Object.values(EXPENSE_STATUS).includes(safeValue)
    ? safeValue
    : EXPENSE_STATUS.PENDING;
}

function normalizeExpenseCategory(value) {
  const safeValue = normalizeText(value);

  return EXPENSE_CATEGORIES.some(
    (option) => option.value === safeValue
  )
    ? safeValue
    : "other";
}

function normalizePaymentMethod(value) {
  const safeValue = normalizeText(value);

  return EXPENSE_PAYMENT_METHODS.some(
    (option) => option.value === safeValue
  )
    ? safeValue
    : "other";
}

function normalizeExpenseSource(value) {
  const safeValue = normalizeText(value);

  return Object.values(EXPENSE_SOURCE).includes(safeValue)
    ? safeValue
    : EXPENSE_SOURCE.MANUAL;
}

function mapExpenseSnapshot(snapshot) {
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

function validateReceiptFile(file) {
  if (!file) return;

  if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
    throw new Error(
      "El comprobante debe ser una imagen JPG, PNG, WEBP o un archivo PDF."
    );
  }

  if (Number(file.size || 0) > MAX_RECEIPT_SIZE) {
    throw new Error("El comprobante no puede superar los 8 MB.");
  }
}

function getFileExtension(file) {
  const originalName = cleanString(file?.name);

  if (originalName.includes(".")) {
    return originalName.split(".").pop().toLowerCase();
  }

  if (file?.type === "application/pdf") return "pdf";
  if (file?.type === "image/png") return "png";
  if (file?.type === "image/webp") return "webp";

  return "jpg";
}

function buildFinancePeriod(expenseDate) {
  return {
    type: FINANCE_PERIOD_TYPE.MONTH,
    monthKey: getMonthKeyFromDateKey(expenseDate),
  };
}

function createFinancialSnapshot(summary, amount) {
  const availableBefore = Math.round(
    Number(summary?.balances?.availableBalance || 0)
  );

  return {
    grossRevenueSnapshot: Math.round(
      Number(summary?.sales?.grossRevenue || 0)
    ),
    costOfGoodsSnapshot: Math.round(
      Number(summary?.sales?.costOfGoods || 0)
    ),
    grossProfitSnapshot: Math.round(
      Number(summary?.sales?.grossProfit || 0)
    ),
    paidExpensesSnapshot: Math.round(
      Number(summary?.expenses?.paidTotal || 0)
    ),
    pendingExpensesSnapshot: Math.round(
      Number(summary?.expenses?.pendingTotal || 0)
    ),
    unpaidPayrollSnapshot: Math.round(
      Number(summary?.payroll?.unpaidTotal || 0)
    ),
    availableBalanceBeforeSnapshot: availableBefore,
    availableBalanceAfterSnapshot: Math.round(
      availableBefore - Number(amount || 0)
    ),
  };
}

async function validatePaidExpenseAgainstFinance({
  amount,
  expenseDate,
  storeId,
  excludeCurrentPaidAmount = 0,
  label = "El gasto",
}) {
  const financeSummary = await getFinanceSummary({
    storeId,
    period: buildFinancePeriod(expenseDate),
  });

  const validation = validateAmountAgainstAvailableBalance({
    amount,
    summary: financeSummary,
    excludeCurrentPaidAmount,
    label,
  });

  return {
    financeSummary,
    validation,
    financialSnapshot: createFinancialSnapshot(
      financeSummary,
      validation.requestedAmount
    ),
  };
}

function createInsufficientBalanceError({
  requestedAmount,
  availableBalance,
  label = "El gasto",
}) {
  const error = new Error(
    `${label} supera el saldo disponible. Disponible: ${formatFinanceCurrency(
      Math.max(Number(availableBalance || 0), 0)
    )}.`
  );

  error.code = "INSUFFICIENT_AVAILABLE_BALANCE";
  error.requestedAmount = Number(requestedAmount || 0);
  error.availableBalance = Number(availableBalance || 0);
  error.shortfall = Math.max(
    Number(requestedAmount || 0) -
      Number(availableBalance || 0),
    0
  );

  return error;
}

export function formatExpenseCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(toFiniteNumber(value, 0));
}

export function getExpenseStatusLabel(status) {
  return getStatusLabel(normalizeExpenseStatus(status));
}

export function getExpenseCategoryLabel(category) {
  return getCategoryLabel(normalizeExpenseCategory(category));
}

export function getExpensePaymentMethodLabel(paymentMethod) {
  return getPaymentMethodLabel(
    normalizePaymentMethod(paymentMethod)
  );
}

export function getCurrentExpenseMonthKey() {
  return getTodayDateKey().slice(0, 7);
}

export function getExpenseMonthKey(expense) {
  return (
    cleanString(expense?.monthKey) ||
    getMonthKeyFromDateKey(expense?.expenseDate) ||
    ""
  );
}

export function normalizeExpensePayload(payload = {}) {
  const expenseDate =
    cleanString(payload.expenseDate) || getTodayDateKey();

  return {
    description: cleanString(payload.description),
    amount: toPositiveAmount(payload.amount),
    supplier: cleanString(payload.supplier),
    expenseDate,
    monthKey: getMonthKeyFromDateKey(expenseDate),
    category: normalizeExpenseCategory(payload.category),
    paymentMethod: normalizePaymentMethod(payload.paymentMethod),
    status: normalizeExpenseStatus(payload.status),
    notes: cleanString(payload.notes),

    source: normalizeExpenseSource(payload.source),
    payrollPaymentId: cleanString(payload.payrollPaymentId),
    sellerUid: cleanString(payload.sellerUid),
    sellerName: cleanString(payload.sellerName),
    timeEntryIds: Array.isArray(payload.timeEntryIds)
      ? payload.timeEntryIds.map(cleanString).filter(Boolean)
      : [],
  };
}

export function validateExpensePayload(payload = {}) {
  const expense = normalizeExpensePayload(payload);

  if (!expense.description) {
    throw new Error("Debes escribir la descripción del gasto.");
  }

  if (!expense.amount) {
    throw new Error("Debes registrar un valor mayor a cero.");
  }

  if (!expense.supplier) {
    throw new Error("Debes escribir el proveedor o beneficiario.");
  }

  if (!isValidDateKey(expense.expenseDate)) {
    throw new Error("La fecha del gasto no es válida.");
  }

  if (
    expense.source === EXPENSE_SOURCE.PAYROLL &&
    expense.category !== "payroll"
  ) {
    throw new Error(
      "Los pagos de trabajadores deben registrarse en la categoría Nómina."
    );
  }

  return expense;
}

export async function uploadExpenseReceipt({
  file,
  storeId = STORE_ID,
  userId = "",
}) {
  if (!file) return null;

  validateReceiptFile(file);

  const safeStoreId = cleanString(storeId) || STORE_ID;
  const safeUserId = cleanString(userId) || "unknown-user";
  const extension = getFileExtension(file);

  const fileName = `expense_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}.${extension}`;

  const storagePath = [
    "expenses",
    safeStoreId,
    safeUserId,
    fileName,
  ].join("/");

  const storageReference = ref(storage, storagePath);

  await uploadBytes(storageReference, file, {
    contentType: file.type || undefined,
    customMetadata: {
      storeId: safeStoreId,
      uploadedByUid: safeUserId,
      originalName: cleanString(file.name),
    },
  });

  const url = await getDownloadURL(storageReference);

  return {
    url,
    path: storagePath,
    name: cleanString(file.name) || fileName,
    type: cleanString(file.type),
    size: Number(file.size || 0),
  };
}

export async function deleteExpenseReceipt(receiptPath) {
  const safePath = cleanString(receiptPath);

  if (!safePath) return false;

  try {
    await deleteObject(ref(storage, safePath));
    return true;
  } catch (error) {
    if (error?.code === "storage/object-not-found") {
      return false;
    }

    throw error;
  }
}

export function subscribeExpenses(
  callback,
  onError,
  storeId = STORE_ID
) {
  const safeStoreId = cleanString(storeId) || STORE_ID;

  const expensesQuery = query(
    collection(db, EXPENSES_COLLECTION),
    where("storeId", "==", safeStoreId),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    expensesQuery,
    (snapshot) => {
      callback(mapExpenseSnapshot(snapshot));
    },
    (error) => {
      console.error("Error escuchando gastos:", error);

      if (onError) {
        onError(error);
      }
    }
  );
}

export async function createExpense({
  storeId = STORE_ID,
  expense,
  receiptFile = null,
  actor = null,
}) {
  const safeStoreId = cleanString(storeId) || STORE_ID;
  const normalizedExpense = validateExpensePayload(expense);

  let financeValidation = null;
  let uploadedReceipt = null;

  if (normalizedExpense.status === EXPENSE_STATUS.PAID) {
    financeValidation =
      await validatePaidExpenseAgainstFinance({
        amount: normalizedExpense.amount,
        expenseDate: normalizedExpense.expenseDate,
        storeId: safeStoreId,
        label:
          normalizedExpense.category === "payroll"
            ? "El pago de nómina"
            : "El gasto",
      });
  }

  try {
    uploadedReceipt = await uploadExpenseReceipt({
      file: receiptFile,
      storeId: safeStoreId,
      userId: actor?.uid,
    });

    const expenseDocument = {
      storeId: safeStoreId,

      ...normalizedExpense,

      receipt: uploadedReceipt,
      receiptUrl: uploadedReceipt?.url || "",
      receiptPath: uploadedReceipt?.path || "",
      receiptName: uploadedReceipt?.name || "",
      receiptType: uploadedReceipt?.type || "",
      receiptSize: uploadedReceipt?.size || 0,

      financialValidationApplied:
        normalizedExpense.status === EXPENSE_STATUS.PAID,
      financialPeriodMonthKey: normalizedExpense.monthKey,
      financialSnapshot:
        financeValidation?.financialSnapshot || null,

      registeredByUid: actor?.uid || "",
      registeredByName: actor?.name || "",
      registeredByEmail: actor?.email || "",

      statusUpdatedAt: serverTimestamp(),
      statusUpdatedByUid: actor?.uid || "",
      statusUpdatedByName: actor?.name || "",
      statusUpdatedByEmail: actor?.email || "",

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const documentReference = await addDoc(
      collection(db, EXPENSES_COLLECTION),
      expenseDocument
    );

    return {
      id: documentReference.id,
      ...expenseDocument,
      financeValidation:
        financeValidation?.validation || null,
    };
  } catch (error) {
    if (uploadedReceipt?.path) {
      try {
        await deleteExpenseReceipt(uploadedReceipt.path);
      } catch (cleanupError) {
        console.error(
          "No se pudo limpiar el comprobante después del error:",
          cleanupError
        );
      }
    }

    throw error;
  }
}

export async function updateExpense(
  expenseId,
  payload,
  actor = null
) {
  const safeExpenseId = cleanString(expenseId);

  if (!safeExpenseId) {
    throw new Error("No se encontró el gasto.");
  }

  const expenseReference = doc(
    db,
    EXPENSES_COLLECTION,
    safeExpenseId
  );

  const snapshot = await getDoc(expenseReference);

  if (!snapshot.exists()) {
    throw new Error("El gasto no existe.");
  }

  const currentExpense = snapshot.data();
  const normalizedExpense = validateExpensePayload(payload);
  const safeStoreId =
    cleanString(currentExpense.storeId) || STORE_ID;

  let financeValidation = null;

  if (normalizedExpense.status === EXPENSE_STATUS.PAID) {
    const currentPaidAmount =
      currentExpense.status === EXPENSE_STATUS.PAID
        ? toPositiveAmount(currentExpense.amount)
        : 0;

    financeValidation =
      await validatePaidExpenseAgainstFinance({
        amount: normalizedExpense.amount,
        expenseDate: normalizedExpense.expenseDate,
        storeId: safeStoreId,
        excludeCurrentPaidAmount: currentPaidAmount,
        label:
          normalizedExpense.category === "payroll"
            ? "El pago de nómina"
            : "El gasto",
      });
  }

  const statusChanged =
    currentExpense.status !== normalizedExpense.status;

  const updatePayload = {
    ...normalizedExpense,

    financialValidationApplied:
      normalizedExpense.status === EXPENSE_STATUS.PAID,
    financialPeriodMonthKey: normalizedExpense.monthKey,
    financialSnapshot:
      financeValidation?.financialSnapshot || null,

    updatedByUid: actor?.uid || "",
    updatedByName: actor?.name || "",
    updatedByEmail: actor?.email || "",

    updatedAt: serverTimestamp(),
  };

  if (statusChanged) {
    updatePayload.statusUpdatedAt = serverTimestamp();
    updatePayload.statusUpdatedByUid = actor?.uid || "";
    updatePayload.statusUpdatedByName = actor?.name || "";
    updatePayload.statusUpdatedByEmail = actor?.email || "";
  }

  await updateDoc(expenseReference, updatePayload);

  return {
    ...normalizedExpense,
    financeValidation:
      financeValidation?.validation || null,
  };
}

export async function replaceExpenseReceipt({
  expenseId,
  file,
  storeId = STORE_ID,
  actor = null,
}) {
  const safeExpenseId = cleanString(expenseId);

  if (!safeExpenseId) {
    throw new Error("No se encontró el gasto.");
  }

  validateReceiptFile(file);

  const expenseReference = doc(
    db,
    EXPENSES_COLLECTION,
    safeExpenseId
  );

  const snapshot = await getDoc(expenseReference);

  if (!snapshot.exists()) {
    throw new Error("El gasto no existe.");
  }

  const currentExpense = snapshot.data();

  const uploadedReceipt = await uploadExpenseReceipt({
    file,
    storeId:
      cleanString(currentExpense.storeId) ||
      cleanString(storeId) ||
      STORE_ID,
    userId: actor?.uid,
  });

  try {
    await updateDoc(expenseReference, {
      receipt: uploadedReceipt,
      receiptUrl: uploadedReceipt.url,
      receiptPath: uploadedReceipt.path,
      receiptName: uploadedReceipt.name,
      receiptType: uploadedReceipt.type,
      receiptSize: uploadedReceipt.size,

      updatedByUid: actor?.uid || "",
      updatedByName: actor?.name || "",
      updatedByEmail: actor?.email || "",

      updatedAt: serverTimestamp(),
    });

    if (
      currentExpense.receiptPath &&
      currentExpense.receiptPath !==
        uploadedReceipt.path
    ) {
      try {
        await deleteExpenseReceipt(
          currentExpense.receiptPath
        );
      } catch (cleanupError) {
        console.error(
          "No se pudo eliminar el comprobante anterior:",
          cleanupError
        );
      }
    }

    return uploadedReceipt;
  } catch (error) {
    try {
      await deleteExpenseReceipt(uploadedReceipt.path);
    } catch (cleanupError) {
      console.error(
        "No se pudo limpiar el comprobante nuevo:",
        cleanupError
      );
    }

    throw error;
  }
}

export async function removeExpenseReceipt(
  expenseId,
  actor = null
) {
  const safeExpenseId = cleanString(expenseId);

  if (!safeExpenseId) {
    throw new Error("No se encontró el gasto.");
  }

  const expenseReference = doc(
    db,
    EXPENSES_COLLECTION,
    safeExpenseId
  );

  const snapshot = await getDoc(expenseReference);

  if (!snapshot.exists()) {
    throw new Error("El gasto no existe.");
  }

  const expense = snapshot.data();

  await updateDoc(expenseReference, {
    receipt: null,
    receiptUrl: "",
    receiptPath: "",
    receiptName: "",
    receiptType: "",
    receiptSize: 0,

    updatedByUid: actor?.uid || "",
    updatedByName: actor?.name || "",
    updatedByEmail: actor?.email || "",

    updatedAt: serverTimestamp(),
  });

  if (expense.receiptPath) {
    try {
      await deleteExpenseReceipt(expense.receiptPath);
    } catch (error) {
      console.error(
        "El gasto se actualizó, pero no se pudo eliminar el archivo:",
        error
      );
    }
  }
}

export async function updateExpenseStatus(
  expenseId,
  status,
  actor = null
) {
  const safeExpenseId = cleanString(expenseId);

  if (!safeExpenseId) {
    throw new Error("No se encontró el gasto.");
  }

  const expenseReference = doc(
    db,
    EXPENSES_COLLECTION,
    safeExpenseId
  );

  const snapshot = await getDoc(expenseReference);

  if (!snapshot.exists()) {
    throw new Error("El gasto no existe.");
  }

  const currentExpense = snapshot.data();
  const normalizedStatus = normalizeExpenseStatus(status);

  if (currentExpense.status === normalizedStatus) {
    return normalizedStatus;
  }

  let financeValidation = null;

  if (normalizedStatus === EXPENSE_STATUS.PAID) {
    financeValidation =
      await validatePaidExpenseAgainstFinance({
        amount: currentExpense.amount,
        expenseDate: currentExpense.expenseDate,
        storeId:
          cleanString(currentExpense.storeId) ||
          STORE_ID,
        excludeCurrentPaidAmount:
          currentExpense.status === EXPENSE_STATUS.PAID
            ? toPositiveAmount(currentExpense.amount)
            : 0,
        label:
          currentExpense.category === "payroll"
            ? "El pago de nómina"
            : "El gasto",
      });
  }

  await updateDoc(expenseReference, {
    status: normalizedStatus,

    financialValidationApplied:
      normalizedStatus === EXPENSE_STATUS.PAID,
    financialPeriodMonthKey:
      cleanString(currentExpense.monthKey) ||
      getMonthKeyFromDateKey(
        currentExpense.expenseDate
      ),
    financialSnapshot:
      financeValidation?.financialSnapshot || null,

    statusUpdatedAt: serverTimestamp(),
    statusUpdatedByUid: actor?.uid || "",
    statusUpdatedByName: actor?.name || "",
    statusUpdatedByEmail: actor?.email || "",

    updatedAt: serverTimestamp(),
  });

  return {
    status: normalizedStatus,
    financeValidation:
      financeValidation?.validation || null,
  };
}

export async function deleteExpense({
  expenseId,
  deleteReceipt = true,
  allowPayrollExpenseDeletion = false,
}) {
  const safeExpenseId = cleanString(expenseId);

  if (!safeExpenseId) {
    throw new Error("No se encontró el gasto.");
  }

  const expenseReference = doc(
    db,
    EXPENSES_COLLECTION,
    safeExpenseId
  );

  const snapshot = await getDoc(expenseReference);

  if (!snapshot.exists()) {
    throw new Error("El gasto no existe.");
  }

  const expense = snapshot.data();

  if (
    expense.source === EXPENSE_SOURCE.PAYROLL &&
    !allowPayrollExpenseDeletion
  ) {
    const error = new Error(
      "Este gasto pertenece a un pago de nómina. Debes anular el pago desde el módulo de nómina para conservar la trazabilidad."
    );

    error.code = "PAYROLL_EXPENSE_PROTECTED";
    throw error;
  }

  await deleteDoc(expenseReference);

  if (deleteReceipt && expense.receiptPath) {
    try {
      await deleteExpenseReceipt(expense.receiptPath);
    } catch (error) {
      console.error(
        "El gasto fue eliminado, pero no se pudo borrar el comprobante:",
        error
      );
    }
  }

  return true;
}

export async function assertExpenseCanBePaid({
  amount,
  expenseDate,
  storeId = STORE_ID,
  excludeCurrentPaidAmount = 0,
  label = "El gasto",
}) {
  const safeAmount = toPositiveAmount(amount);

  if (!safeAmount) {
    throw new Error(`${label} debe tener un valor mayor a cero.`);
  }

  const result = await validatePaidExpenseAgainstFinance({
    amount: safeAmount,
    expenseDate:
      cleanString(expenseDate) || getTodayDateKey(),
    storeId: cleanString(storeId) || STORE_ID,
    excludeCurrentPaidAmount,
    label,
  });

  return {
    allowed: true,
    ...result.validation,
    financialSnapshot: result.financialSnapshot,
    summary: result.financeSummary,
  };
}

export async function getExpensePaymentCapacity({
  amount,
  expenseDate,
  storeId = STORE_ID,
  excludeCurrentPaidAmount = 0,
  label = "El gasto",
}) {
  try {
    return await assertExpenseCanBePaid({
      amount,
      expenseDate,
      storeId,
      excludeCurrentPaidAmount,
      label,
    });
  } catch (error) {
    if (
      error?.code ===
      "INSUFFICIENT_AVAILABLE_BALANCE"
    ) {
      return {
        allowed: false,
        code: error.code,
        message: error.message,
        requestedAmount: error.requestedAmount,
        availableBalance: error.availableBalance,
        shortfall: error.shortfall,
      };
    }

    throw error;
  }
}

export function createBalanceExceededError({
  requestedAmount,
  availableBalance,
  label = "El gasto",
}) {
  return createInsufficientBalanceError({
    requestedAmount,
    availableBalance,
    label,
  });
}