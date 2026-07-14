import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

export const FINANCE_PERIOD_TYPE = {
  MONTH: "month",
  DATE_RANGE: "date-range",
  ALL_TIME: "all-time",
};

export const FINANCE_BALANCE_STATUS = {
  AVAILABLE: "available",
  LOW: "low",
  EXHAUSTED: "exhausted",
  NEGATIVE: "negative",
};

export const PAYROLL_PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  VOIDED: "voided",
};

const SALES_COLLECTION = "sales";
const EXPENSES_COLLECTION = "expenses";
const TIME_ENTRIES_COLLECTION = "timeEntries";

const COMPLETED_TIME_ENTRY_STATUSES = new Set([
  "completed",
  "corrected",
]);

const PAID_EXPENSE_STATUS = "paid";
const PENDING_EXPENSE_STATUS = "pending";
const VOIDED_EXPENSE_STATUS = "voided";
const PAYROLL_CATEGORY = "payroll";

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

function toNonNegativeNumber(value) {
  return Math.max(toFiniteNumber(value), 0);
}

function roundMoney(value) {
  return Math.round(toFiniteNumber(value));
}

function roundHours(value) {
  return Math.round(toFiniteNumber(value) * 100) / 100;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanString(value));
}

function isMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(cleanString(value));
}

function toDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getBogotaDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  return Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
}

export function getCurrentFinanceDateKey() {
  const parts = getBogotaDateParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getCurrentFinanceMonthKey() {
  return getCurrentFinanceDateKey().slice(0, 7);
}

export function getMonthDateRange(monthKey) {
  const safeMonth = isMonthKey(monthKey)
    ? monthKey
    : getCurrentFinanceMonthKey();

  const [year, month] = safeMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();

  return {
    monthKey: safeMonth,
    startDateKey: `${safeMonth}-01`,
    endDateKey: `${safeMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function normalizeFinancePeriod(period = {}) {
  const requestedType = cleanString(period.type);

  if (requestedType === FINANCE_PERIOD_TYPE.ALL_TIME) {
    return {
      type: FINANCE_PERIOD_TYPE.ALL_TIME,
      monthKey: "",
      startDateKey: "",
      endDateKey: "",
    };
  }

  if (requestedType === FINANCE_PERIOD_TYPE.DATE_RANGE) {
    const startDateKey = cleanString(period.startDateKey);
    const endDateKey = cleanString(period.endDateKey);

    if (!isDateKey(startDateKey) || !isDateKey(endDateKey)) {
      throw new Error(
        "El rango financiero debe tener una fecha inicial y una fecha final válidas."
      );
    }

    if (startDateKey > endDateKey) {
      throw new Error(
        "La fecha inicial no puede ser posterior a la fecha final."
      );
    }

    return {
      type: FINANCE_PERIOD_TYPE.DATE_RANGE,
      monthKey: "",
      startDateKey,
      endDateKey,
    };
  }

  const monthKey = isMonthKey(period.monthKey)
    ? period.monthKey
    : getCurrentFinanceMonthKey();

  return {
    type: FINANCE_PERIOD_TYPE.MONTH,
    ...getMonthDateRange(monthKey),
  };
}

function getDateKeyFromDate(value) {
  const date = toDate(value);
  if (!date) return "";

  const parts = getBogotaDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getSaleDateKey(sale) {
  return (
    cleanString(sale?.saleDate) ||
    cleanString(sale?.createdDateKey) ||
    getDateKeyFromDate(sale?.createdAt)
  );
}

function getExpenseDateKey(expense) {
  return (
    cleanString(expense?.expenseDate) ||
    cleanString(expense?.fechaManual) ||
    getDateKeyFromDate(expense?.createdAt)
  );
}

function getTimeEntryDateKey(entry) {
  return (
    cleanString(entry?.workDate) ||
    getDateKeyFromDate(entry?.clockIn) ||
    getDateKeyFromDate(entry?.createdAt)
  );
}

function isDateInsidePeriod(dateKey, period) {
  if (period.type === FINANCE_PERIOD_TYPE.ALL_TIME) return true;
  if (!isDateKey(dateKey)) return false;

  return (
    dateKey >= period.startDateKey &&
    dateKey <= period.endDateKey
  );
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

function calculateSaleAmounts(sale) {
  const quantity = toNonNegativeNumber(sale?.quantity);
  const revenue = toNonNegativeNumber(
    sale?.total ??
      sale?.totalAmount ??
      sale?.amount ??
      toNonNegativeNumber(sale?.unitPrice) * quantity
  );

  const costOfGoods = toNonNegativeNumber(
    sale?.totalCost ??
      sale?.costTotal ??
      toNonNegativeNumber(sale?.costPrice) * quantity
  );

  const grossProfit = Number.isFinite(Number(sale?.profit))
    ? toFiniteNumber(sale.profit)
    : revenue - costOfGoods;

  return {
    quantity,
    revenue: roundMoney(revenue),
    costOfGoods: roundMoney(costOfGoods),
    grossProfit: roundMoney(grossProfit),
  };
}

function normalizeExpenseStatus(expense) {
  return normalizeText(expense?.status || expense?.estado);
}

function normalizeExpenseCategory(expense) {
  return normalizeText(expense?.category || expense?.categoria);
}

function getExpenseAmount(expense) {
  return roundMoney(
    toNonNegativeNumber(expense?.amount ?? expense?.monto)
  );
}

function normalizePayrollStatus(entry) {
  return normalizeText(
    entry?.paymentStatus ||
      entry?.payrollStatus ||
      PAYROLL_PAYMENT_STATUS.PENDING
  );
}

function getEntryPaymentAmount(entry) {
  if (Number.isFinite(Number(entry?.paidAmount))) {
    return roundMoney(toNonNegativeNumber(entry.paidAmount));
  }

  if (Number.isFinite(Number(entry?.calculatedPayment))) {
    return roundMoney(
      toNonNegativeNumber(entry.calculatedPayment)
    );
  }

  const workedMinutes = toNonNegativeNumber(entry?.workedMinutes);
  const hourlyRate = toNonNegativeNumber(
    entry?.hourlyRateSnapshot ??
      entry?.activeRateSnapshot ??
      entry?.hourlyRate
  );

  return roundMoney((workedMinutes / 60) * hourlyRate);
}

function isClosedTimeEntry(entry) {
  return COMPLETED_TIME_ENTRY_STATUSES.has(
    normalizeText(entry?.status)
  );
}

function createEmptyFinanceSummary(period) {
  return {
    period,

    sales: {
      records: 0,
      units: 0,
      grossRevenue: 0,
      costOfGoods: 0,
      grossProfit: 0,
      grossMarginPercent: 0,
      averageTicket: 0,
    },

    expenses: {
      records: 0,
      paidRecords: 0,
      pendingRecords: 0,
      voidedRecords: 0,

      paidTotal: 0,
      pendingTotal: 0,
      voidedTotal: 0,

      operatingPaid: 0,
      payrollPaid: 0,

      operatingPending: 0,
      payrollPending: 0,
    },

    payroll: {
      closedEntries: 0,
      paidEntries: 0,
      unpaidEntries: 0,
      voidedEntries: 0,

      workedMinutes: 0,
      workedHours: 0,

      paidMinutes: 0,
      paidHours: 0,
      unpaidMinutes: 0,
      unpaidHours: 0,

      earnedTotal: 0,
      paidTotal: 0,
      unpaidTotal: 0,
    },

    balances: {
      grossProfit: 0,
      paidExpenses: 0,
      pendingExpenses: 0,
      unpaidPayrollLiability: 0,

      availableBalance: 0,
      committedBalance: 0,
      projectedBalance: 0,

      availablePercent: 0,
      expenseUsagePercent: 0,
      status: FINANCE_BALANCE_STATUS.EXHAUSTED,
    },

    warnings: [],
  };
}

function getBalanceStatus(availableBalance, grossProfit) {
  if (availableBalance < 0) {
    return FINANCE_BALANCE_STATUS.NEGATIVE;
  }

  if (availableBalance === 0) {
    return FINANCE_BALANCE_STATUS.EXHAUSTED;
  }

  if (grossProfit > 0 && availableBalance / grossProfit <= 0.2) {
    return FINANCE_BALANCE_STATUS.LOW;
  }

  return FINANCE_BALANCE_STATUS.AVAILABLE;
}

export function calculateFinanceSummary({
  sales = [],
  expenses = [],
  timeEntries = [],
  period = {
    type: FINANCE_PERIOD_TYPE.MONTH,
    monthKey: getCurrentFinanceMonthKey(),
  },
} = {}) {
  const normalizedPeriod = normalizeFinancePeriod(period);
  const summary = createEmptyFinanceSummary(normalizedPeriod);

  const periodSales = sales.filter((sale) =>
    isDateInsidePeriod(getSaleDateKey(sale), normalizedPeriod)
  );

  for (const sale of periodSales) {
    const amounts = calculateSaleAmounts(sale);

    summary.sales.records += 1;
    summary.sales.units += amounts.quantity;
    summary.sales.grossRevenue += amounts.revenue;
    summary.sales.costOfGoods += amounts.costOfGoods;
    summary.sales.grossProfit += amounts.grossProfit;
  }

  summary.sales.grossRevenue = roundMoney(
    summary.sales.grossRevenue
  );
  summary.sales.costOfGoods = roundMoney(
    summary.sales.costOfGoods
  );
  summary.sales.grossProfit = roundMoney(
    summary.sales.grossProfit
  );

  summary.sales.grossMarginPercent =
    summary.sales.grossRevenue > 0
      ? Math.round(
          (summary.sales.grossProfit /
            summary.sales.grossRevenue) *
            10000
        ) / 100
      : 0;

  summary.sales.averageTicket =
    summary.sales.records > 0
      ? roundMoney(
          summary.sales.grossRevenue / summary.sales.records
        )
      : 0;

  const periodExpenses = expenses.filter((expense) =>
    isDateInsidePeriod(
      getExpenseDateKey(expense),
      normalizedPeriod
    )
  );

  for (const expense of periodExpenses) {
    const status = normalizeExpenseStatus(expense);
    const category = normalizeExpenseCategory(expense);
    const amount = getExpenseAmount(expense);
    const isPayroll = category === PAYROLL_CATEGORY;

    summary.expenses.records += 1;

    if (status === PAID_EXPENSE_STATUS) {
      summary.expenses.paidRecords += 1;
      summary.expenses.paidTotal += amount;

      if (isPayroll) {
        summary.expenses.payrollPaid += amount;
      } else {
        summary.expenses.operatingPaid += amount;
      }

      continue;
    }

    if (status === PENDING_EXPENSE_STATUS) {
      summary.expenses.pendingRecords += 1;
      summary.expenses.pendingTotal += amount;

      if (isPayroll) {
        summary.expenses.payrollPending += amount;
      } else {
        summary.expenses.operatingPending += amount;
      }

      continue;
    }

    if (status === VOIDED_EXPENSE_STATUS) {
      summary.expenses.voidedRecords += 1;
      summary.expenses.voidedTotal += amount;
    }
  }

  const moneyExpenseFields = [
    "paidTotal",
    "pendingTotal",
    "voidedTotal",
    "operatingPaid",
    "payrollPaid",
    "operatingPending",
    "payrollPending",
  ];

  for (const field of moneyExpenseFields) {
    summary.expenses[field] = roundMoney(
      summary.expenses[field]
    );
  }

  const periodTimeEntries = timeEntries.filter((entry) => {
    return (
      isClosedTimeEntry(entry) &&
      isDateInsidePeriod(
        getTimeEntryDateKey(entry),
        normalizedPeriod
      )
    );
  });

  for (const entry of periodTimeEntries) {
    const paymentStatus = normalizePayrollStatus(entry);
    const workedMinutes = Math.trunc(
      toNonNegativeNumber(entry?.workedMinutes)
    );
    const earnedAmount = getEntryPaymentAmount(entry);

    summary.payroll.closedEntries += 1;
    summary.payroll.workedMinutes += workedMinutes;
    summary.payroll.earnedTotal += earnedAmount;

    if (paymentStatus === PAYROLL_PAYMENT_STATUS.PAID) {
      summary.payroll.paidEntries += 1;
      summary.payroll.paidMinutes += workedMinutes;
      summary.payroll.paidTotal += earnedAmount;
      continue;
    }

    if (paymentStatus === PAYROLL_PAYMENT_STATUS.VOIDED) {
      summary.payroll.voidedEntries += 1;
      continue;
    }

    summary.payroll.unpaidEntries += 1;
    summary.payroll.unpaidMinutes += workedMinutes;
    summary.payroll.unpaidTotal += earnedAmount;
  }

  summary.payroll.workedHours = roundHours(
    summary.payroll.workedMinutes / 60
  );
  summary.payroll.paidHours = roundHours(
    summary.payroll.paidMinutes / 60
  );
  summary.payroll.unpaidHours = roundHours(
    summary.payroll.unpaidMinutes / 60
  );
  summary.payroll.earnedTotal = roundMoney(
    summary.payroll.earnedTotal
  );
  summary.payroll.paidTotal = roundMoney(
    summary.payroll.paidTotal
  );
  summary.payroll.unpaidTotal = roundMoney(
    summary.payroll.unpaidTotal
  );

  const grossProfit = summary.sales.grossProfit;
  const paidExpenses = summary.expenses.paidTotal;
  const pendingExpenses = summary.expenses.pendingTotal;

  /*
   * La nómina pagada ya debe existir como un gasto pagado de categoría
   * "payroll", por eso no se vuelve a descontar aquí.
   *
   * Las jornadas aún no pagadas sí se muestran como una obligación futura.
   */
  const unpaidPayrollLiability =
    summary.payroll.unpaidTotal;

  const availableBalance = roundMoney(
    grossProfit - paidExpenses
  );

  const committedBalance = roundMoney(
    pendingExpenses + unpaidPayrollLiability
  );

  const projectedBalance = roundMoney(
    availableBalance - committedBalance
  );

  summary.balances = {
    grossProfit,
    paidExpenses,
    pendingExpenses,
    unpaidPayrollLiability,

    availableBalance,
    committedBalance,
    projectedBalance,

    availablePercent:
      grossProfit > 0
        ? Math.round(
            (availableBalance / grossProfit) * 10000
          ) / 100
        : 0,

    expenseUsagePercent:
      grossProfit > 0
        ? Math.round(
            (paidExpenses / grossProfit) * 10000
          ) / 100
        : paidExpenses > 0
          ? 100
          : 0,

    status: getBalanceStatus(
      availableBalance,
      grossProfit
    ),
  };

  if (grossProfit <= 0 && paidExpenses > 0) {
    summary.warnings.push({
      code: "EXPENSES_WITHOUT_PROFIT",
      level: "danger",
      message:
        "Existen gastos pagados, pero no hay ganancia bruta disponible en el período.",
    });
  }

  if (availableBalance < 0) {
    summary.warnings.push({
      code: "NEGATIVE_AVAILABLE_BALANCE",
      level: "danger",
      message:
        "Los gastos pagados superan la ganancia bruta del período.",
    });
  }

  if (projectedBalance < 0) {
    summary.warnings.push({
      code: "NEGATIVE_PROJECTED_BALANCE",
      level: "warning",
      message:
        "El saldo no alcanza para cubrir todos los gastos pendientes y la nómina aún no pagada.",
    });
  }

  if (
    summary.expenses.payrollPaid !==
      summary.payroll.paidTotal &&
    summary.payroll.paidEntries > 0
  ) {
    summary.warnings.push({
      code: "PAYROLL_RECONCILIATION_MISMATCH",
      level: "warning",
      message:
        "La nómina marcada como pagada en jornadas no coincide con los gastos pagados de categoría nómina.",
    });
  }

  return summary;
}

function buildStoreQuery(collectionName, storeId) {
  return query(
    collection(db, collectionName),
    where("storeId", "==", storeId)
  );
}

export async function getFinanceSourceData(
  storeId = STORE_ID
) {
  const safeStoreId = cleanString(storeId) || STORE_ID;

  const [salesSnapshot, expensesSnapshot, entriesSnapshot] =
    await Promise.all([
      getDocs(buildStoreQuery(SALES_COLLECTION, safeStoreId)),
      getDocs(
        buildStoreQuery(EXPENSES_COLLECTION, safeStoreId)
      ),
      getDocs(
        buildStoreQuery(
          TIME_ENTRIES_COLLECTION,
          safeStoreId
        )
      ),
    ]);

  return {
    sales: mapSnapshot(salesSnapshot),
    expenses: mapSnapshot(expensesSnapshot),
    timeEntries: mapSnapshot(entriesSnapshot),
  };
}

export async function getFinanceSummary({
  storeId = STORE_ID,
  period,
} = {}) {
  const sourceData = await getFinanceSourceData(storeId);

  return calculateFinanceSummary({
    ...sourceData,
    period,
  });
}

export function subscribeFinanceSummary({
  callback,
  onError,
  storeId = STORE_ID,
  period = {
    type: FINANCE_PERIOD_TYPE.MONTH,
    monthKey: getCurrentFinanceMonthKey(),
  },
} = {}) {
  if (typeof callback !== "function") {
    throw new Error(
      "Debes enviar una función callback para escuchar el resumen financiero."
    );
  }

  const safeStoreId = cleanString(storeId) || STORE_ID;
  let currentPeriod = normalizeFinancePeriod(period);

  const state = {
    sales: [],
    expenses: [],
    timeEntries: [],
  };

  const ready = {
    sales: false,
    expenses: false,
    timeEntries: false,
  };

  let stopped = false;

  function emit() {
    if (
      stopped ||
      !ready.sales ||
      !ready.expenses ||
      !ready.timeEntries
    ) {
      return;
    }

    callback(
      calculateFinanceSummary({
        sales: state.sales,
        expenses: state.expenses,
        timeEntries: state.timeEntries,
        period: currentPeriod,
      })
    );
  }

  function handleError(source, error) {
    console.error(
      `Error escuchando información financiera de ${source}:`,
      error
    );

    if (typeof onError === "function") {
      onError(error, source);
    }
  }

  const unsubscribeSales = onSnapshot(
    buildStoreQuery(SALES_COLLECTION, safeStoreId),
    (snapshot) => {
      state.sales = mapSnapshot(snapshot);
      ready.sales = true;
      emit();
    },
    (error) => handleError("ventas", error)
  );

  const unsubscribeExpenses = onSnapshot(
    buildStoreQuery(EXPENSES_COLLECTION, safeStoreId),
    (snapshot) => {
      state.expenses = mapSnapshot(snapshot);
      ready.expenses = true;
      emit();
    },
    (error) => handleError("gastos", error)
  );

  const unsubscribeEntries = onSnapshot(
    buildStoreQuery(
      TIME_ENTRIES_COLLECTION,
      safeStoreId
    ),
    (snapshot) => {
      state.timeEntries = mapSnapshot(snapshot);
      ready.timeEntries = true;
      emit();
    },
    (error) => handleError("jornadas", error)
  );

  return {
    unsubscribe() {
      stopped = true;
      unsubscribeSales();
      unsubscribeExpenses();
      unsubscribeEntries();
    },

    setPeriod(nextPeriod) {
      currentPeriod = normalizeFinancePeriod(nextPeriod);
      emit();
    },

    getPeriod() {
      return currentPeriod;
    },
  };
}

export function getMaximumPayableAmount(summary) {
  return roundMoney(
    Math.max(
      toFiniteNumber(
        summary?.balances?.availableBalance
      ),
      0
    )
  );
}

export function validateAmountAgainstAvailableBalance({
  amount,
  summary,
  excludeCurrentPaidAmount = 0,
  label = "El pago",
}) {
  const requestedAmount = roundMoney(
    toNonNegativeNumber(amount)
  );

  if (requestedAmount <= 0) {
    throw new Error(
      `${label} debe tener un valor mayor a cero.`
    );
  }

  const availableBalance = roundMoney(
    toFiniteNumber(
      summary?.balances?.availableBalance
    ) +
      toNonNegativeNumber(excludeCurrentPaidAmount)
  );

  if (requestedAmount > availableBalance) {
    const error = new Error(
      `${label} supera el saldo disponible. Disponible: ${formatFinanceCurrency(
        Math.max(availableBalance, 0)
      )}.`
    );

    error.code = "INSUFFICIENT_AVAILABLE_BALANCE";
    error.requestedAmount = requestedAmount;
    error.availableBalance = availableBalance;
    error.shortfall = roundMoney(
      requestedAmount - availableBalance
    );

    throw error;
  }

  return {
    allowed: true,
    requestedAmount,
    availableBalance,
    remainingBalance: roundMoney(
      availableBalance - requestedAmount
    ),
  };
}

export function canPayAmount({
  amount,
  summary,
  excludeCurrentPaidAmount = 0,
}) {
  try {
    return {
      ...validateAmountAgainstAvailableBalance({
        amount,
        summary,
        excludeCurrentPaidAmount,
      }),
      reason: "",
    };
  } catch (error) {
    return {
      allowed: false,
      requestedAmount: roundMoney(
        toNonNegativeNumber(amount)
      ),
      availableBalance: roundMoney(
        toFiniteNumber(
          summary?.balances?.availableBalance
        ) +
          toNonNegativeNumber(excludeCurrentPaidAmount)
      ),
      remainingBalance: 0,
      reason: error.message,
      code: error.code || "INVALID_PAYMENT",
    };
  }
}

export function formatFinanceCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(roundMoney(value));
}

export function formatFinancePercent(value) {
  return `${Math.round(toFiniteNumber(value) * 100) / 100}%`;
}

export function getFinanceBalanceLabel(status) {
  const labels = {
    [FINANCE_BALANCE_STATUS.AVAILABLE]:
      "Saldo disponible",
    [FINANCE_BALANCE_STATUS.LOW]:
      "Saldo disponible bajo",
    [FINANCE_BALANCE_STATUS.EXHAUSTED]:
      "Saldo agotado",
    [FINANCE_BALANCE_STATUS.NEGATIVE]:
      "Saldo negativo",
  };

  return labels[status] || "Saldo disponible";
}