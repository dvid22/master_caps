import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  History,
  ImagePlus,
  Layers3,
  Plus,
  Receipt,
  RefreshCcw,
  Search,
  Settings2,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";

import {
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_SOURCE,
  EXPENSE_STATUS,
  EXPENSE_STATUS_OPTIONS,
  createExpense,
  deleteExpense,
  formatExpenseCurrency,
  getCurrentExpenseMonthKey,
  getExpensePaymentMethodLabel,
  getExpenseMonthKey,
  removeExpenseReceipt,
  replaceExpenseReceipt,
  subscribeExpenses,
  updateExpense,
  updateExpenseStatus,
} from "../../services/expenses.service";

import {
  createExpenseCategory,
  deleteExpenseCategory,
  setExpenseCategoryActive,
  subscribeExpenseCategories,
  toExpenseCategoryOptions,
  updateExpenseCategory,
} from "../../services/expenseCategories.service";

import {
  paySellerPayroll,
  subscribePayrollPayments,
  subscribeSellerUnpaidTimeEntries,
  summarizePayrollEntries,
} from "../../services/payrollPayments.service";

import {
  FINANCE_BALANCE_STATUS,
  FINANCE_PERIOD_TYPE,
  formatFinanceCurrency,
  formatFinancePercent,
  getFinanceBalanceLabel,
  subscribeFinanceSummary,
} from "../../services/finance.service";

import { subscribeSellers } from "../../services/users.service";
import { STORE_ID } from "../../services/categories.service";
import { getCurrentUserActor } from "../../services/auth.service";

const EMPTY_EXPENSE_FORM = {
  description: "",
  amount: "",
  supplier: "",
  expenseDate: getTodayDateKey(),
  category: "other",
  paymentMethod: "cash",
  status: EXPENSE_STATUS.PENDING,
  notes: "",
  source: EXPENSE_SOURCE.MANUAL,
};

const EMPTY_CATEGORY_FORM = {
  name: "",
  description: "",
  active: true,
  order: 0,
};

const EMPTY_PAYROLL_FORM = {
  sellerUid: "",
  paymentMethod: "transfer",
  paymentDate: getTodayDateKey(),
  notes: "",
};

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMonthKey(value) {
  const safe = String(value || "").trim();

  if (/^\d{4}-\d{2}$/.test(safe)) return safe;
  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) return safe.slice(0, 7);

  return "";
}

function addMonths(monthKey, amount) {
  const safeMonth =
    normalizeMonthKey(monthKey) || getCurrentExpenseMonthKey();

  const [year, month] = safeMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + Number(amount || 0), 1);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function formatMonthLabel(monthKey) {
  const safeMonth = normalizeMonthKey(monthKey);

  if (!safeMonth) return "Todos los meses";

  const [year, month] = safeMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);

  return new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDate(value) {
  const safe = String(value || "").trim();

  if (!safe) return "Sin fecha";

  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) {
    const [year, month, day] = safe.split("-");
    return `${day}/${month}/${year}`;
  }

  return safe;
}

function formatMinutes(minutes) {
  const total = Math.max(Number(minutes || 0), 0);
  const hours = Math.floor(total / 60);
  const rest = Math.round(total % 60);

  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;

  return `${hours} h ${rest} min`;
}

function parseAmount(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function getStatusVisual(status) {
  if (status === EXPENSE_STATUS.PAID) {
    return {
      icon: CheckCircle2,
      label: "Pagado",
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      iconBox: "bg-emerald-50 text-emerald-600",
    };
  }

  if (status === EXPENSE_STATUS.VOIDED) {
    return {
      icon: XCircle,
      label: "Anulado",
      badge: "bg-red-50 text-red-700 ring-red-100",
      iconBox: "bg-red-50 text-red-600",
    };
  }

  return {
    icon: History,
    label: "Pendiente",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
    iconBox: "bg-amber-50 text-amber-600",
  };
}

function getBalanceVisual(status) {
  if (status === FINANCE_BALANCE_STATUS.NEGATIVE) {
    return {
      icon: TrendingDown,
      className: "bg-red-50 text-red-700 ring-red-100",
    };
  }

  if (status === FINANCE_BALANCE_STATUS.LOW) {
    return {
      icon: AlertTriangle,
      className: "bg-amber-50 text-amber-700 ring-amber-100",
    };
  }

  if (status === FINANCE_BALANCE_STATUS.EXHAUSTED) {
    return {
      icon: CircleDollarSign,
      className: "bg-black/[0.04] text-black/55 ring-black/[0.06]",
    };
  }

  return {
    icon: TrendingUp,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  };
}

export default function ExpensesPage() {
  const [activeTab, setActiveTab] = useState("expenses");

  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [payrollPayments, setPayrollPayments] = useState([]);
  const [sellerPendingMap, setSellerPendingMap] = useState({});

  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [loadingFinance, setLoadingFinance] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingPayrollEntries, setLoadingPayrollEntries] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState(
    getCurrentExpenseMonthKey()
  );
  const [financeSummary, setFinanceSummary] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE_FORM);
  const [receiptFile, setReceiptFile] = useState(null);

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY_FORM);

  const [payrollModalOpen, setPayrollModalOpen] = useState(false);
  const [payrollForm, setPayrollForm] = useState(EMPTY_PAYROLL_FORM);
  const [unpaidEntries, setUnpaidEntries] = useState([]);
  const [selectedEntryIds, setSelectedEntryIds] = useState([]);

  const [detailExpense, setDetailExpense] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeExpenses(
      (rows) => {
        setExpenses(rows);
        setLoadingExpenses(false);
      },
      (error) => {
        console.error(error);
        setLoadingExpenses(false);
        toast.error("No se pudieron cargar los gastos.");
      },
      STORE_ID
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeExpenseCategories(
      (rows) => {
        setCategories(rows);
        setLoadingCategories(false);
      },
      (error) => {
        console.error(error);
        setLoadingCategories(false);
        toast.error("No se pudieron cargar las categorías.");
      },
      STORE_ID,
      { includeInactive: true }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSellers(
      (rows) => setSellers(rows),
      (error) => {
        console.error(error);
        toast.error("No se pudieron cargar los vendedores.");
      },
      STORE_ID
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!sellers.length) {
      setSellerPendingMap({});
      return undefined;
    }

    const unsubscribers = sellers.map((seller) => {
      const sellerUid = seller.id || seller.uid;

      return subscribeSellerUnpaidTimeEntries({
        sellerUid,
        storeId: STORE_ID,
        callback: (rows) => {
          setSellerPendingMap((current) => ({
            ...current,
            [sellerUid]: {
              entries: rows,
              summary: summarizePayrollEntries(rows),
            },
          }));
        },
        onError: (error) => {
          console.error(
            `No se pudieron cargar las jornadas pendientes de ${sellerUid}:`,
            error
          );
        },
      });
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [sellers]);

  useEffect(() => {
    const unsubscribe = subscribePayrollPayments({
      storeId: STORE_ID,
      callback: setPayrollPayments,
      onError: (error) => {
        console.error(error);
        toast.error("No se pudo cargar el historial de nómina.");
      },
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const listener = subscribeFinanceSummary({
      storeId: STORE_ID,
      period: {
        type: FINANCE_PERIOD_TYPE.MONTH,
        monthKey: selectedMonth,
      },
      callback: (summary) => {
        setFinanceSummary(summary);
        setLoadingFinance(false);
      },
      onError: (error) => {
        console.error(error);
        setLoadingFinance(false);
        toast.error("No se pudo calcular el resumen financiero.");
      },
    });

    return () => listener.unsubscribe();
  }, [selectedMonth]);

  useEffect(() => {
    if (!payrollModalOpen || !payrollForm.sellerUid) {
      setUnpaidEntries([]);
      setSelectedEntryIds([]);
      return undefined;
    }

    setLoadingPayrollEntries(true);

    const unsubscribe = subscribeSellerUnpaidTimeEntries({
      sellerUid: payrollForm.sellerUid,
      storeId: STORE_ID,
      callback: (rows) => {
        setUnpaidEntries(rows);
        setSelectedEntryIds(rows.map((entry) => entry.id));
        setLoadingPayrollEntries(false);
      },
      onError: (error) => {
        console.error(error);
        setLoadingPayrollEntries(false);
        toast.error("No se pudieron cargar las jornadas pendientes.");
      },
    });

    return () => unsubscribe();
  }, [payrollModalOpen, payrollForm.sellerUid]);

  const categoryOptions = useMemo(
    () => toExpenseCategoryOptions(categories),
    [categories]
  );

  const categoryMap = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [category.slug, category.name])
      ),
    [categories]
  );

  const filteredExpenses = useMemo(() => {
    const cleanSearch = normalizeText(search);

    return expenses.filter((expense) => {
      if (
        getExpenseMonthKey(expense) !==
        normalizeMonthKey(selectedMonth)
      ) {
        return false;
      }

      if (
        statusFilter !== "all" &&
        expense.status !== statusFilter
      ) {
        return false;
      }

      if (
        categoryFilter !== "all" &&
        expense.category !== categoryFilter
      ) {
        return false;
      }

      if (!cleanSearch) return true;

      const searchable = [
        expense.description,
        expense.supplier,
        categoryMap[expense.category],
        getExpensePaymentMethodLabel(expense.paymentMethod),
        expense.status,
        expense.expenseDate,
        expense.registeredByName,
        expense.registeredByEmail,
        expense.amount,
      ]
        .map(normalizeText)
        .join(" ");

      return searchable.includes(cleanSearch);
    });
  }, [
    expenses,
    selectedMonth,
    statusFilter,
    categoryFilter,
    search,
    categoryMap,
  ]);

  const expenseTotals = useMemo(() => {
    return filteredExpenses.reduce(
      (totals, expense) => {
        const amount = Number(expense.amount || 0);

        totals.records += 1;
        totals.total += amount;

        if (expense.status === EXPENSE_STATUS.PAID) {
          totals.paid += amount;
          totals.paidCount += 1;
        } else if (expense.status === EXPENSE_STATUS.PENDING) {
          totals.pending += amount;
          totals.pendingCount += 1;
        } else if (expense.status === EXPENSE_STATUS.VOIDED) {
          totals.voided += amount;
          totals.voidedCount += 1;
        }

        return totals;
      },
      {
        records: 0,
        total: 0,
        paid: 0,
        pending: 0,
        voided: 0,
        paidCount: 0,
        pendingCount: 0,
        voidedCount: 0,
      }
    );
  }, [filteredExpenses]);

  const selectedPayrollEntries = useMemo(
    () =>
      unpaidEntries.filter((entry) =>
        selectedEntryIds.includes(entry.id)
      ),
    [unpaidEntries, selectedEntryIds]
  );

  const payrollPreview = useMemo(
    () => summarizePayrollEntries(selectedPayrollEntries),
    [selectedPayrollEntries]
  );

  const payrollMonthPayments = useMemo(
    () =>
      payrollPayments.filter(
        (payment) =>
          normalizeMonthKey(payment.paymentDate) ===
          normalizeMonthKey(selectedMonth)
      ),
    [payrollPayments, selectedMonth]
  );

  const selectedSeller = useMemo(
    () =>
      sellers.find(
        (seller) =>
          (seller.id || seller.uid) === payrollForm.sellerUid
      ) || null,
    [sellers, payrollForm.sellerUid]
  );

  const pendingSellers = useMemo(() => {
    return sellers
      .map((seller) => {
        const sellerUid = seller.id || seller.uid;
        const pending = sellerPendingMap[sellerUid];

        return {
          ...seller,
          sellerUid,
          pendingEntries: pending?.entries || [],
          pendingSummary:
            pending?.summary ||
            summarizePayrollEntries([]),
        };
      })
      .filter((seller) => seller.pendingSummary.entries > 0)
      .sort(
        (a, b) =>
          Number(b.pendingSummary.amount || 0) -
          Number(a.pendingSummary.amount || 0)
      );
  }, [sellers, sellerPendingMap]);

  function getCategoryLabel(slug) {
    return categoryMap[slug] || slug || "Sin categoría";
  }

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setSelectedMonth(getCurrentExpenseMonthKey());
  }

  function openCreateExpense() {
    setEditingExpense(null);
    setExpenseForm({
      ...EMPTY_EXPENSE_FORM,
      expenseDate: getTodayDateKey(),
      category:
        categoryOptions.find((option) => option.value === "other")
          ?.value ||
        categoryOptions[0]?.value ||
        "other",
    });
    setReceiptFile(null);
    setExpenseModalOpen(true);
  }

  function openEditExpense(expense) {
    setEditingExpense(expense);
    setExpenseForm({
      description: expense.description || "",
      amount: String(expense.amount || ""),
      supplier: expense.supplier || "",
      expenseDate: expense.expenseDate || getTodayDateKey(),
      category: expense.category || "other",
      paymentMethod: expense.paymentMethod || "cash",
      status: expense.status || EXPENSE_STATUS.PENDING,
      notes: expense.notes || "",
      source: expense.source || EXPENSE_SOURCE.MANUAL,
    });
    setReceiptFile(null);
    setExpenseModalOpen(true);
  }

  function closeExpenseModal() {
    if (saving) return;

    setExpenseModalOpen(false);
    setEditingExpense(null);
    setExpenseForm(EMPTY_EXPENSE_FORM);
    setReceiptFile(null);
  }

  async function handleSaveExpense(event) {
    event.preventDefault();

    try {
      setSaving(true);
      const actor = getCurrentUserActor();

      if (editingExpense) {
        await updateExpense(editingExpense.id, expenseForm, actor);

        if (receiptFile) {
          await replaceExpenseReceipt({
            expenseId: editingExpense.id,
            file: receiptFile,
            storeId: STORE_ID,
            actor,
          });
        }

        toast.success("Gasto actualizado correctamente.");
      } else {
        await createExpense({
          storeId: STORE_ID,
          expense: expenseForm,
          receiptFile,
          actor,
        });

        toast.success("Gasto registrado correctamente.");
      }

      closeExpenseModal();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "No se pudo guardar el gasto.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(expenseId, status) {
    try {
      setUpdatingId(expenseId);

      await updateExpenseStatus(
        expenseId,
        status,
        getCurrentUserActor()
      );

      toast.success("Estado actualizado.");
    } catch (error) {
      console.error(error);
      toast.error(
        error.message || "No se pudo actualizar el estado."
      );
    } finally {
      setUpdatingId("");
    }
  }

  async function handleDeleteExpense() {
    if (!deleteTarget?.id) return;

    try {
      setDeleting(true);

      await deleteExpense({
        expenseId: deleteTarget.id,
        deleteReceipt: true,
      });

      setDeleteTarget(null);
      setDetailExpense(null);
      toast.success("Gasto eliminado.");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "No se pudo eliminar el gasto.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRemoveReceipt(expense) {
    const confirmed = window.confirm(
      "¿Deseas eliminar el comprobante de este gasto?"
    );

    if (!confirmed) return;

    try {
      setUpdatingId(expense.id);

      await removeExpenseReceipt(
        expense.id,
        getCurrentUserActor()
      );

      setDetailExpense((current) =>
        current?.id === expense.id
          ? {
              ...current,
              receipt: null,
              receiptUrl: "",
              receiptPath: "",
              receiptName: "",
              receiptType: "",
              receiptSize: 0,
            }
          : current
      );

      toast.success("Comprobante eliminado.");
    } catch (error) {
      console.error(error);
      toast.error(
        error.message || "No se pudo eliminar el comprobante."
      );
    } finally {
      setUpdatingId("");
    }
  }

  function openCreateCategory() {
    setEditingCategory(null);
    setCategoryForm(EMPTY_CATEGORY_FORM);
    setCategoryModalOpen(true);
  }

  function openEditCategory(category) {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name || "",
      description: category.description || "",
      active: category.active !== false,
      order: Number(category.order || 0),
    });
    setCategoryModalOpen(true);
  }

  async function handleSaveCategory(event) {
    event.preventDefault();

    try {
      setSaving(true);
      const actor = getCurrentUserActor();

      if (editingCategory) {
        await updateExpenseCategory(
          editingCategory.id,
          categoryForm,
          actor
        );

        toast.success("Categoría actualizada.");
      } else {
        await createExpenseCategory({
          storeId: STORE_ID,
          category: categoryForm,
          actor,
        });

        toast.success("Categoría creada.");
      }

      setCategoryModalOpen(false);
      setEditingCategory(null);
      setCategoryForm(EMPTY_CATEGORY_FORM);
    } catch (error) {
      console.error(error);
      toast.error(error.message || "No se pudo guardar la categoría.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleCategory(category) {
    try {
      setUpdatingId(category.id);

      await setExpenseCategoryActive(
        category.id,
        category.active === false,
        getCurrentUserActor()
      );

      toast.success(
        category.active === false
          ? "Categoría activada."
          : "Categoría desactivada."
      );
    } catch (error) {
      console.error(error);
      toast.error(error.message || "No se pudo actualizar la categoría.");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleDeleteCategory(category) {
    const confirmed = window.confirm(
      `¿Eliminar la categoría "${category.name}"?`
    );

    if (!confirmed) return;

    try {
      setUpdatingId(category.id);

      await deleteExpenseCategory({
        category,
        storeId: STORE_ID,
      });

      toast.success("Categoría eliminada.");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "No se pudo eliminar la categoría.");
    } finally {
      setUpdatingId("");
    }
  }

  function openPayrollModal() {
    const firstSeller = sellers[0];

    setPayrollForm({
      ...EMPTY_PAYROLL_FORM,
      sellerUid: firstSeller?.id || firstSeller?.uid || "",
      paymentDate: getTodayDateKey(),
    });
    setPayrollModalOpen(true);
  }

  function togglePayrollEntry(entryId) {
    setSelectedEntryIds((current) =>
      current.includes(entryId)
        ? current.filter((id) => id !== entryId)
        : [...current, entryId]
    );
  }

  function toggleAllPayrollEntries() {
    if (selectedEntryIds.length === unpaidEntries.length) {
      setSelectedEntryIds([]);
    } else {
      setSelectedEntryIds(unpaidEntries.map((entry) => entry.id));
    }
  }

  async function handlePayPayroll(event) {
    event.preventDefault();

    if (!selectedSeller) {
      toast.error("Selecciona un vendedor.");
      return;
    }

    try {
      setSaving(true);

      await paySellerPayroll({
        seller: selectedSeller,
        entries: selectedPayrollEntries,
        paymentMethod: payrollForm.paymentMethod,
        paymentDate: payrollForm.paymentDate,
        notes: payrollForm.notes,
        actor: getCurrentUserActor(),
        storeId: STORE_ID,
      });

      toast.success("Pago de nómina registrado correctamente.");
      setPayrollModalOpen(false);
      setPayrollForm(EMPTY_PAYROLL_FORM);
      setUnpaidEntries([]);
      setSelectedEntryIds([]);
    } catch (error) {
      console.error(error);
      toast.error(error.message || "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  const balanceVisual = getBalanceVisual(
    financeSummary?.balances?.status
  );
  const BalanceIcon = balanceVisual.icon;

  return (
    <main className="min-h-screen bg-white px-3 py-4 text-black sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1640px]">
        <header className="rounded-[24px] bg-white px-4 py-4 shadow-[0_14px_36px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.05] sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-600">
                Finanzas de Master Caps
              </p>

              <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] sm:text-[32px]">
                Gastos y nómina
              </h1>

              <p className="mt-1 max-w-3xl text-[12px] leading-5 text-black/45">
                Controla tus gastos, administra categorías y paga las jornadas pendientes de los vendedores.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 xl:flex">
              <button
                type="button"
                onClick={openPayrollModal}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-[11px] font-medium transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <UsersRound size={16} />
                Pagar vendedor
              </button>

              <button
                type="button"
                onClick={openCreateCategory}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-[11px] font-medium transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <Tag size={16} />
                Nueva categoría
              </button>

              <button
                type="button"
                onClick={openCreateExpense}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[11px] font-medium text-white shadow-[0_10px_24px_rgba(220,38,38,0.2)] transition hover:bg-red-700"
              >
                <Plus size={16} />
                Nuevo gasto
              </button>
            </div>
          </div>
        </header>

        <section className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.62fr)_minmax(360px,.78fr)]">
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-[24px] bg-[#090909] p-[18px] text-white shadow-[0_18px_45px_rgba(0,0,0,0.16)]">
              <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full border border-red-600/25" />
              <div className="pointer-events-none absolute -right-2 -top-10 h-52 w-52 rounded-full border border-red-600/20" />
              <div className="pointer-events-none absolute right-6 top-0 h-40 w-40 rounded-full border border-red-600/15" />

              <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-white/[0.08] text-red-500 ring-1 ring-white/10">
                    <WalletCards size={24} />
                  </div>

                  <div>
                    <p className="text-[10px] text-white/55">
                      {getFinanceBalanceLabel(
                        financeSummary?.balances?.status
                      )}
                    </p>

                    <p className="mt-1 text-[31px] font-semibold tracking-[-0.05em]">
                      {loadingFinance
                        ? "Calculando..."
                        : formatFinanceCurrency(
                            financeSummary?.balances?.availableBalance || 0
                          )}
                    </p>

                    <p className="mt-1 text-[10px] text-white/42">
                      Ganancia real después de gastos pagados
                    </p>
                  </div>
                </div>

                <div className="grid gap-0 overflow-hidden rounded-[18px] border border-white/10 bg-white/[0.04] sm:grid-cols-3 lg:min-w-[500px]">
                  <DarkMetric
                    label="Ganancia bruta"
                    value={formatFinanceCurrency(
                      financeSummary?.sales?.grossProfit || 0
                    )}
                  />
                  <DarkMetric
                    label="Comprometido"
                    value={formatFinanceCurrency(
                      financeSummary?.balances?.committedBalance || 0
                    )}
                    border
                  />
                  <DarkMetric
                    label="Saldo proyectado"
                    value={formatFinanceCurrency(
                      financeSummary?.balances?.projectedBalance || 0
                    )}
                    border
                    danger={
                      Number(
                        financeSummary?.balances?.projectedBalance || 0
                      ) < 0
                    }
                  />
                </div>
              </div>
            </div>

            <div className="grid overflow-hidden rounded-[22px] bg-white shadow-[0_12px_30px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.05] sm:grid-cols-2 lg:grid-cols-4">
              <InlineFinanceMetric
                icon={TrendingUp}
                label="Ventas"
                value={formatFinanceCurrency(
                  financeSummary?.sales?.grossRevenue || 0
                )}
              />
              <InlineFinanceMetric
                icon={TrendingDown}
                label="Costo mercancía"
                value={formatFinanceCurrency(
                  financeSummary?.sales?.costOfGoods || 0
                )}
                border
              />
              <InlineFinanceMetric
                icon={Receipt}
                label="Gastos pagados"
                value={formatFinanceCurrency(
                  financeSummary?.expenses?.paidTotal || 0
                )}
                border
              />
              <InlineFinanceMetric
                icon={Clock3}
                label="Nómina pendiente"
                value={formatFinanceCurrency(
                  financeSummary?.payroll?.unpaidTotal || 0
                )}
                border
              />
            </div>
          </div>

          <ProfitUsagePanel
            summary={financeSummary}
            payrollPayments={payrollMonthPayments}
            pendingSellers={pendingSellers}
          />
        </section>

        {financeSummary?.warnings?.length > 0 && (
          <div className="mt-4 space-y-2">
            {financeSummary.warnings.map((warning) => (
              <div
                key={warning.code}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-[10px] ${
                  warning.level === "danger"
                    ? "border-red-100 bg-red-50 text-red-700"
                    : "border-amber-100 bg-amber-50 text-amber-700"
                }`}
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                {warning.message}
              </div>
            ))}
          </div>
        )}

        <nav className="mt-4 flex flex-wrap gap-7 border-b border-black/[0.06] bg-transparent px-1">
          <TabButton
            active={activeTab === "expenses"}
            icon={Receipt}
            label="Gastos"
            onClick={() => setActiveTab("expenses")}
          />
          <TabButton
            active={activeTab === "payroll"}
            icon={UsersRound}
            label="Nómina"
            onClick={() => setActiveTab("payroll")}
          />
          <TabButton
            active={activeTab === "categories"}
            icon={Layers3}
            label="Categorías"
            onClick={() => setActiveTab("categories")}
          />
        </nav>

        {activeTab === "expenses" && (
          <ExpensesTab
            loading={loadingExpenses}
            expenses={filteredExpenses}
            categories={categories}
            categoryOptions={categoryOptions}
            categoryFilter={categoryFilter}
            statusFilter={statusFilter}
            search={search}
            selectedMonth={selectedMonth}
            updatingId={updatingId}
            getCategoryLabel={getCategoryLabel}
            onSearch={setSearch}
            onStatusFilter={setStatusFilter}
            onCategoryFilter={setCategoryFilter}
            onMonth={setSelectedMonth}
            onStatusChange={handleStatusChange}
            onEdit={openEditExpense}
            onView={setDetailExpense}
            onDelete={setDeleteTarget}
          />
        )}

        {activeTab === "payroll" && (
          <PayrollTab
            payments={payrollMonthPayments}
            sellers={sellers}
            pendingSellers={pendingSellers}
            financeSummary={financeSummary}
            selectedMonth={selectedMonth}
            onMonth={setSelectedMonth}
            onPay={openPayrollModal}
          />
        )}

        {activeTab === "categories" && (
          <CategoriesTab
            categories={categories}
            loading={loadingCategories}
            updatingId={updatingId}
            onCreate={openCreateCategory}
            onEdit={openEditCategory}
            onToggle={handleToggleCategory}
            onDelete={handleDeleteCategory}
          />
        )}
      </section>

      {expenseModalOpen && (
        <ExpenseFormModal
          editingExpense={editingExpense}
          form={expenseForm}
          receiptFile={receiptFile}
          saving={saving}
          financeSummary={financeSummary}
          categoryOptions={categoryOptions}
          onClose={closeExpenseModal}
          onSubmit={handleSaveExpense}
          onChange={(field, value) =>
            setExpenseForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onReceiptChange={setReceiptFile}
        />
      )}

      {categoryModalOpen && (
        <CategoryModal
          editingCategory={editingCategory}
          form={categoryForm}
          saving={saving}
          onClose={() => {
            if (!saving) {
              setCategoryModalOpen(false);
              setEditingCategory(null);
              setCategoryForm(EMPTY_CATEGORY_FORM);
            }
          }}
          onSubmit={handleSaveCategory}
          onChange={(field, value) =>
            setCategoryForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
        />
      )}

      {payrollModalOpen && (
        <PayrollModal
          sellers={sellers}
          form={payrollForm}
          selectedSeller={selectedSeller}
          unpaidEntries={unpaidEntries}
          selectedEntryIds={selectedEntryIds}
          preview={payrollPreview}
          loadingEntries={loadingPayrollEntries}
          financeSummary={financeSummary}
          saving={saving}
          onClose={() => {
            if (!saving) setPayrollModalOpen(false);
          }}
          onSubmit={handlePayPayroll}
          onChange={(field, value) =>
            setPayrollForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onToggleEntry={togglePayrollEntry}
          onToggleAll={toggleAllPayrollEntries}
        />
      )}

      {detailExpense && (
        <ExpenseDetailModal
          expense={detailExpense}
          categoryLabel={getCategoryLabel(detailExpense.category)}
          updating={updatingId === detailExpense.id}
          onClose={() => setDetailExpense(null)}
          onEdit={() => {
            openEditExpense(detailExpense);
            setDetailExpense(null);
          }}
          onRemoveReceipt={() => handleRemoveReceipt(detailExpense)}
          onDelete={() => setDeleteTarget(detailExpense)}
        />
      )}

      {deleteTarget && (
        <DeleteExpenseModal
          expense={deleteTarget}
          deleting={deleting}
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          onConfirm={handleDeleteExpense}
        />
      )}
    </main>
  );
}

function DarkMetric({
  label,
  value,
  border = false,
  danger = false,
}) {
  return (
    <div
      className={`px-4 py-3 ${
        border ? "border-t border-white/10 sm:border-l sm:border-t-0" : ""
      }`}
    >
      <p className="text-[9px] text-white/45">{label}</p>
      <p
        className={`mt-1 text-[13px] font-medium ${
          danger ? "text-red-400" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InlineFinanceMetric({
  icon: Icon,
  label,
  value,
  border = false,
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${
        border ? "border-t border-black/[0.055] sm:border-l sm:border-t-0" : ""
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-red-100">
        <Icon size={17} />
      </div>

      <div className="min-w-0">
        <p className="text-[8px] text-black/40">{label}</p>
        <p className="mt-0.5 truncate text-[11px] font-semibold">{value}</p>
      </div>
    </div>
  );
}

function ProfitUsagePanel({
  summary,
  payrollPayments,
  pendingSellers,
}) {
  const used = Math.min(
    Math.max(Number(summary?.balances?.expenseUsagePercent || 0), 0),
    100
  );
  const available = Math.max(100 - used, 0);

  return (
    <article className="rounded-[24px] bg-white p-4 shadow-[0_14px_36px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold">Uso de la ganancia</p>
          <p className="mt-0.5 text-[9px] text-black/38">
            Distribución financiera del período
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black text-white">
          <CircleDollarSign size={18} />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[118px_1fr] sm:items-center">
        <div className="relative mx-auto h-28 w-28">
          <div
            className="h-full w-full rounded-full"
            style={{
              background: `conic-gradient(#ef2b2d 0 ${used}%, #111111 ${used}% 100%)`,
            }}
          />

          <div className="absolute inset-[12px] flex flex-col items-center justify-center rounded-full bg-white">
            <p className="text-[23px] font-semibold tracking-[-0.04em]">
              {Math.round(used)}%
            </p>
            <p className="text-[8px] text-black/38">utilizado</p>
          </div>
        </div>

        <div className="space-y-2">
          <UsageRow
            dotClass="bg-black"
            label="Disponible"
            value={formatFinanceCurrency(
              summary?.balances?.availableBalance || 0
            )}
            percent={`${Math.round(available)}%`}
          />
          <UsageRow
            dotClass="bg-red-500"
            label="Comprometido"
            value={formatFinanceCurrency(
              summary?.balances?.committedBalance || 0
            )}
            percent={`${Math.round(
              Math.min(
                Number(summary?.balances?.availablePercent || 0),
                100
              )
            )}%`}
          />
          <UsageRow
            dotClass="bg-black/20"
            label="Usado"
            value={formatFinanceCurrency(
              summary?.expenses?.paidTotal || 0
            )}
            percent={`${Math.round(used)}%`}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <PanelMetric
          label="Horas sin pagar"
          value={`${summary?.payroll?.unpaidHours || 0} h`}
        />
        <PanelMetric
          label="Vendedores pendientes"
          value={String(pendingSellers.length)}
        />
        <PanelMetric
          label="Pagos del mes"
          value={String(payrollPayments.length)}
        />
      </div>
    </article>
  );
}

function UsageRow({ dotClass, label, value, percent }) {
  return (
    <div className="grid grid-cols-[8px_1fr_auto_auto] items-center gap-2 border-b border-black/[0.05] pb-2 last:border-0 last:pb-0">
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span className="text-[9px] text-black/52">{label}</span>
      <span className="text-[9px] font-medium">{value}</span>
      <span className="min-w-[32px] text-right text-[8px] text-black/35">
        {percent}
      </span>
    </div>
  );
}

function PanelMetric({ label, value }) {
  return (
    <div className="rounded-xl bg-black/[0.025] px-2.5 py-2">
      <p className="text-[8px] text-black/38">{label}</p>
      <p className="mt-0.5 text-[10px] font-semibold">{value}</p>
    </div>
  );
}

function PayrollHeaderMetric({ label, value }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[8px] text-black/38">{label}</p>
      <p className="mt-1 text-[13px] font-semibold">{value}</p>
    </div>
  );
}

function PendingPayrollPanel({
  pendingSellers,
  financeSummary,
  sellersCount,
  onPay,
}) {
  return (
    <aside className="overflow-hidden rounded-[24px] bg-white shadow-[0_14px_36px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05]">
      <div className="border-b border-black/[0.055] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <Clock3 size={17} />
          </div>
          <div>
            <p className="text-[13px] font-semibold">Nómina pendiente</p>
            <p className="mt-0.5 text-[9px] text-black/40">
              Jornadas listas para pagar
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-black/[0.05]">
        <PayrollHeaderMetric
          label="Total por pagar"
          value={formatFinanceCurrency(
            financeSummary?.payroll?.unpaidTotal || 0
          )}
        />
        <PayrollHeaderMetric
          label="Horas"
          value={`${financeSummary?.payroll?.unpaidHours || 0} h`}
        />
        <PayrollHeaderMetric
          label="Vendedores"
          value={String(
            pendingSellers.length || sellersCount || 0
          )}
        />
      </div>

      <div className="max-h-[300px] divide-y divide-black/[0.05] overflow-y-auto">
        {pendingSellers.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <UsersRound size={26} className="mx-auto text-black/20" />
            <p className="mt-2 text-[10px] text-black/40">
              No hay vendedores con jornadas pendientes.
            </p>
          </div>
        ) : (
          pendingSellers.map((seller) => (
            <div
              key={seller.sellerUid}
              className="grid grid-cols-[38px_1fr_auto] items-center gap-3 px-4 py-3"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-[10px] font-semibold text-red-600">
                {String(
                  seller.displayName ||
                    seller.name ||
                    seller.email ||
                    "V"
                )
                  .slice(0, 2)
                  .toUpperCase()}
              </div>

              <div className="min-w-0">
                <p className="truncate text-[10px] font-medium">
                  {seller.displayName ||
                    seller.name ||
                    seller.email ||
                    "Vendedor"}
                </p>
                <p className="mt-0.5 text-[8px] text-black/38">
                  {seller.pendingSummary.totalHours} h pendientes
                </p>
              </div>

              <p className="text-[10px] font-semibold">
                {formatFinanceCurrency(
                  seller.pendingSummary.amount
                )}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-black/[0.055] p-3">
        <button
          type="button"
          onClick={onPay}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-[10px] font-medium text-white shadow-[0_10px_20px_rgba(220,38,38,0.16)]"
        >
          <Banknote size={15} />
          Registrar pago
        </button>
      </div>
    </aside>
  );
}

function ExpensesTab({
  loading,
  expenses,
  categoryOptions,
  categoryFilter,
  statusFilter,
  search,
  selectedMonth,
  updatingId,
  getCategoryLabel,
  onSearch,
  onStatusFilter,
  onCategoryFilter,
  onMonth,
  onStatusChange,
  onEdit,
  onView,
  onDelete,
}) {
  return (
    <>
      <FilterBar
        search={search}
        statusFilter={statusFilter}
        categoryFilter={categoryFilter}
        categoryOptions={categoryOptions}
        selectedMonth={selectedMonth}
        onSearch={onSearch}
        onStatusFilter={onStatusFilter}
        onCategoryFilter={onCategoryFilter}
        onMonth={onMonth}
      />

      <section className="mt-3">
        <SectionTitle
          title="Historial de gastos"
          subtitle={`${expenses.length} resultado(s)`}
          icon={Receipt}
        />

        {loading ? (
          <EmptyState text="Cargando gastos..." />
        ) : expenses.length === 0 ? (
          <EmptyState text="No hay gastos en este período." />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-[22px] bg-white shadow-[0_12px_35px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.055] lg:block">
              <div className="grid grid-cols-[1.55fr_.8fr_.7fr_.7fr_.7fr_90px] gap-3 border-b border-black/[0.055] bg-black/[0.018] px-4 py-3 text-[9px] font-medium uppercase tracking-[0.08em] text-black/38">
                <span>Gasto</span>
                <span>Categoría</span>
                <span>Fecha</span>
                <span>Estado</span>
                <span className="text-right">Valor</span>
                <span className="text-right">Acciones</span>
              </div>

              <div className="divide-y divide-black/[0.05]">
                {expenses.map((expense) => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    categoryLabel={getCategoryLabel(expense.category)}
                    updating={updatingId === expense.id}
                    onStatusChange={onStatusChange}
                    onEdit={() => onEdit(expense)}
                    onView={() => onView(expense)}
                    onDelete={() => onDelete(expense)}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
              {expenses.map((expense) => (
                <ExpenseMobileCard
                  key={expense.id}
                  expense={expense}
                  categoryLabel={getCategoryLabel(expense.category)}
                  updating={updatingId === expense.id}
                  onStatusChange={onStatusChange}
                  onEdit={() => onEdit(expense)}
                  onView={() => onView(expense)}
                  onDelete={() => onDelete(expense)}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function PayrollTab({
  payments,
  sellers,
  pendingSellers,
  financeSummary,
  selectedMonth,
  onMonth,
  onPay,
}) {
  const paidTotal = payments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  );

  return (
    <section className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_.9fr]">
      <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_14px_36px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05]">
        <div className="flex flex-col gap-3 border-b border-black/[0.055] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Receipt size={17} />
            </div>

            <div>
              <p className="text-[13px] font-semibold">
                Pagos de nómina
              </p>
              <p className="mt-0.5 text-[9px] text-black/40">
                Historial de pagos generados desde jornadas laborales.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="month"
              value={selectedMonth}
              onChange={(event) => onMonth(event.target.value)}
              className="h-10 rounded-xl border border-black/[0.07] bg-white px-3 text-[9px] outline-none focus:border-red-600"
            />

            <button
              type="button"
              onClick={onPay}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-[9px] font-medium text-white"
            >
              <Plus size={14} />
              Nuevo pago
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px border-b border-black/[0.055] bg-black/[0.05]">
          <PayrollHeaderMetric
            label="Nómina pagada"
            value={formatFinanceCurrency(paidTotal)}
          />
          <PayrollHeaderMetric
            label="Horas pendientes"
            value={`${financeSummary?.payroll?.unpaidHours || 0} h`}
          />
          <PayrollHeaderMetric
            label="Valor pendiente"
            value={formatFinanceCurrency(
              financeSummary?.payroll?.unpaidTotal || 0
            )}
          />
        </div>

        {payments.length === 0 ? (
          <div className="flex min-h-[330px] flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <Receipt size={24} />
            </div>

            <p className="mt-4 text-[12px] font-medium">
              No hay pagos de nómina en este mes
            </p>

            <p className="mt-1 text-[9px] text-black/38">
              Cuando registres pagos, aparecerán en este historial.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.05]">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3.5 transition hover:bg-black/[0.015]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                    <UserRound size={16} />
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium">
                      {payment.sellerName}
                    </p>
                    <p className="mt-0.5 text-[8px] text-black/38">
                      {formatDate(payment.paymentDate)} ·{" "}
                      {payment.totalHours || 0} h ·{" "}
                      {payment.entriesCount || 0} jornada(s)
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-[11px] font-semibold">
                    {formatFinanceCurrency(payment.amount)}
                  </p>
                  <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[8px] text-emerald-700">
                    Pagado
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PendingPayrollPanel
        pendingSellers={pendingSellers}
        financeSummary={financeSummary}
        sellersCount={sellers.length}
        onPay={onPay}
      />
    </section>
  );
}

function CategoriesTab({
  categories,
  loading,
  updatingId,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
}) {
  return (
    <>
      <section className="mt-4 flex items-center justify-between gap-4 rounded-[20px] bg-white p-3.5 shadow-[0_10px_28px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.05]">
        <div>
          <p className="text-[11px] font-medium">
            Categorías de gastos
          </p>
          <p className="mt-0.5 text-[9px] text-black/40">
            Crea categorías propias y reutilízalas al registrar gastos.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 text-[9px] font-medium text-white"
        >
          <Plus size={14} />
          Nueva categoría
        </button>
      </section>

      <section className="mt-3">
        {loading ? (
          <EmptyState text="Cargando categorías..." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => (
              <article
                key={category.id}
                className={`rounded-[18px] bg-white p-3.5 shadow-[0_10px_28px_rgba(0,0,0,0.03)] ring-1 ${
                  category.active === false
                    ? "opacity-60 ring-black/[0.04]"
                    : "ring-black/[0.05]"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                    <Tag size={17} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">
                      {category.name}
                    </p>
                    <p className="mt-0.5 truncate text-[8px] text-black/38">
                      {category.description || "Sin descripción"}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-2 py-1 text-[8px] ${
                      category.active === false
                        ? "bg-black/[0.04] text-black/45"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {category.active === false ? "Inactiva" : "Activa"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <ActionButton
                    icon={Edit3}
                    label="Editar"
                    onClick={() => onEdit(category)}
                  />

                  <ActionButton
                    icon={category.active === false ? Check : XCircle}
                    label={
                      category.active === false ? "Activar" : "Desactivar"
                    }
                    onClick={() => onToggle(category)}
                  />

                  <ActionButton
                    icon={Trash2}
                    label="Eliminar"
                    onClick={() => onDelete(category)}
                    danger
                    disabled={updatingId === category.id}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function FilterBar({
  search,
  statusFilter,
  categoryFilter,
  categoryOptions,
  selectedMonth,
  onSearch,
  onStatusFilter,
  onCategoryFilter,
  onMonth,
}) {
  return (
    <section className="mt-4 rounded-[20px] bg-white p-3 shadow-[0_10px_28px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.05]">
      <div className="grid gap-2 xl:grid-cols-[1.2fr_auto]">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35"
          />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            className="h-10 w-full rounded-xl border border-black/[0.07] bg-white pl-10 pr-4 text-[10px] outline-none placeholder:text-black/32 focus:border-red-600"
            placeholder="Buscar gasto, proveedor o método..."
          />
        </label>

        <div className="grid gap-2 sm:grid-cols-3">
          <select
            value={statusFilter}
            onChange={(event) =>
              onStatusFilter(event.target.value)
            }
            className="h-10 rounded-xl border border-black/[0.07] bg-white px-3 text-[9px] outline-none focus:border-red-600"
          >
            <option value="all">Todos los estados</option>
            {EXPENSE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(event) =>
              onCategoryFilter(event.target.value)
            }
            className="h-10 rounded-xl border border-black/[0.07] bg-white px-3 text-[9px] outline-none focus:border-red-600"
          >
            <option value="all">Todas las categorías</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <input
            type="month"
            value={selectedMonth}
            onChange={(event) => onMonth(event.target.value)}
            className="h-10 rounded-xl border border-black/[0.07] bg-white px-3 text-[9px] outline-none focus:border-red-600"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-black/[0.025] p-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <CalendarDays size={14} />
          </div>
          <p className="text-[10px] font-medium capitalize">
            {formatMonthLabel(selectedMonth)}
          </p>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onMonth(addMonths(selectedMonth, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.07] bg-white"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => onMonth(getCurrentExpenseMonthKey())}
            className="h-8 rounded-lg bg-red-600 px-3 text-[8px] font-medium text-white"
          >
            Actual
          </button>
          <button
            type="button"
            onClick={() => onMonth(addMonths(selectedMonth, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.07] bg-white"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}

function PayrollModal({
  sellers,
  form,
  selectedSeller,
  unpaidEntries,
  selectedEntryIds,
  preview,
  loadingEntries,
  financeSummary,
  saving,
  onClose,
  onSubmit,
  onChange,
  onToggleEntry,
  onToggleAll,
}) {
  const available =
    Number(financeSummary?.balances?.availableBalance || 0);
  const remaining = available - Number(preview.amount || 0);
  const canPay =
    preview.entries > 0 &&
    preview.amount > 0 &&
    preview.amount <= available;

  return (
    <ModalShell
      title="Pagar vendedor"
      subtitle="Selecciona las jornadas pendientes y genera el gasto de nómina automáticamente."
      onClose={onClose}
      maxWidth="max-w-[820px]"
    >
      <form onSubmit={onSubmit}>
        <div className="grid gap-2 sm:grid-cols-3">
          <ModalMetric
            label="Saldo disponible"
            value={formatFinanceCurrency(available)}
          />
          <ModalMetric
            label="Total a pagar"
            value={formatFinanceCurrency(preview.amount)}
          />
          <ModalMetric
            label="Saldo posterior"
            value={formatFinanceCurrency(remaining)}
            danger={remaining < 0}
          />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <SelectField
            label="Vendedor"
            value={form.sellerUid}
            onChange={(value) => onChange("sellerUid", value)}
            options={sellers.map((seller) => ({
              value: seller.id || seller.uid,
              label:
                seller.displayName ||
                seller.name ||
                seller.email ||
                "Vendedor",
            }))}
          />

          <SelectField
            label="Método de pago"
            value={form.paymentMethod}
            onChange={(value) => onChange("paymentMethod", value)}
            options={EXPENSE_PAYMENT_METHODS}
          />

          <InputField
            label="Fecha de pago"
            type="date"
            value={form.paymentDate}
            onChange={(value) => onChange("paymentDate", value)}
          />
        </div>

        <div className="mt-3 rounded-[18px] border border-black/[0.06]">
          <div className="flex items-center justify-between border-b border-black/[0.05] px-3 py-2.5">
            <div>
              <p className="text-[10px] font-medium">
                Jornadas pendientes
              </p>
              <p className="mt-0.5 text-[8px] text-black/38">
                {selectedSeller
                  ? selectedSeller.displayName ||
                    selectedSeller.email
                  : "Selecciona un vendedor"}
              </p>
            </div>

            <button
              type="button"
              onClick={onToggleAll}
              disabled={!unpaidEntries.length}
              className="h-8 rounded-lg border border-black/[0.07] px-3 text-[8px] font-medium disabled:opacity-40"
            >
              {selectedEntryIds.length === unpaidEntries.length
                ? "Quitar todas"
                : "Seleccionar todas"}
            </button>
          </div>

          <div className="max-h-[320px] divide-y divide-black/[0.05] overflow-y-auto">
            {loadingEntries ? (
              <p className="px-3 py-8 text-center text-[10px] text-black/40">
                Cargando jornadas...
              </p>
            ) : unpaidEntries.length === 0 ? (
              <p className="px-3 py-8 text-center text-[10px] text-black/40">
                No hay jornadas pendientes para este vendedor.
              </p>
            ) : (
              unpaidEntries.map((entry) => {
                const selected = selectedEntryIds.includes(entry.id);
                const amount = Number(
                  entry.calculatedPayment ||
                    ((Number(entry.workedMinutes || 0) / 60) *
                      Number(
                        entry.hourlyRateSnapshot ||
                          entry.activeRateSnapshot ||
                          0
                      ))
                );

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onToggleEntry(entry.id)}
                    className={`grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 px-3 py-2.5 text-left transition ${
                      selected ? "bg-red-50/60" : "hover:bg-black/[0.015]"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                        selected
                          ? "border-red-600 bg-red-600 text-white"
                          : "border-black/[0.12] bg-white"
                      }`}
                    >
                      {selected && <Check size={12} />}
                    </span>

                    <span className="min-w-0">
                      <span className="block text-[10px] font-medium">
                        {formatDate(entry.workDate)}
                      </span>
                      <span className="mt-0.5 block text-[8px] text-black/38">
                        {formatMinutes(entry.workedMinutes)} ·{" "}
                        {formatFinanceCurrency(
                          entry.hourlyRateSnapshot ||
                            entry.activeRateSnapshot ||
                            0
                        )}{" "}
                        por hora
                      </span>
                    </span>

                    <span className="text-[10px] font-medium">
                      {formatFinanceCurrency(amount)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <ModalMetric
            label="Jornadas"
            value={String(preview.entries)}
          />
          <ModalMetric
            label="Horas"
            value={`${preview.totalHours} h`}
          />
          <ModalMetric
            label="Total"
            value={formatFinanceCurrency(preview.amount)}
          />
        </div>

        <label className="mt-3 block">
          <FieldLabel>Notas del pago</FieldLabel>
          <textarea
            value={form.notes}
            onChange={(event) =>
              onChange("notes", event.target.value)
            }
            rows={2}
            className="mt-1.5 w-full resize-none rounded-xl border border-black/[0.07] px-3 py-2.5 text-[10px] outline-none focus:border-red-600"
            placeholder="Observaciones opcionales"
          />
        </label>

        {!canPay && preview.amount > available && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-[9px] text-red-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            El saldo disponible no alcanza para pagar las jornadas seleccionadas.
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-xl border border-black/[0.07] text-[10px] font-medium"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={saving || !canPay}
            className="h-10 rounded-xl bg-red-600 text-[10px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Procesando..." : "Confirmar pago"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function CategoryModal({
  editingCategory,
  form,
  saving,
  onClose,
  onSubmit,
  onChange,
}) {
  return (
    <ModalShell
      title={
        editingCategory ? "Editar categoría" : "Nueva categoría"
      }
      subtitle="Las categorías activas aparecerán en el formulario de gastos."
      onClose={onClose}
      maxWidth="max-w-[480px]"
    >
      <form onSubmit={onSubmit}>
        <div className="grid gap-3">
          <InputField
            label="Nombre"
            value={form.name}
            onChange={(value) => onChange("name", value)}
            placeholder="Ej: Empaques"
          />

          <label>
            <FieldLabel>Descripción</FieldLabel>
            <textarea
              value={form.description}
              onChange={(event) =>
                onChange("description", event.target.value)
              }
              rows={2}
              className="mt-1.5 w-full resize-none rounded-xl border border-black/[0.07] px-3 py-2.5 text-[10px] outline-none focus:border-red-600"
              placeholder="Uso interno de la categoría"
            />
          </label>

          <InputField
            label="Orden"
            type="number"
            value={form.order}
            onChange={(value) => onChange("order", value)}
          />

          <label className="flex items-center justify-between rounded-xl bg-black/[0.025] px-3 py-2.5">
            <div>
              <p className="text-[10px] font-medium">Categoría activa</p>
              <p className="mt-0.5 text-[8px] text-black/38">
                Se podrá seleccionar al crear gastos.
              </p>
            </div>

            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                onChange("active", event.target.checked)
              }
              className="h-4 w-4 accent-red-600"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-black/[0.07] text-[10px] font-medium"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-red-600 text-[10px] font-medium text-white disabled:opacity-40"
          >
            {saving
              ? "Guardando..."
              : editingCategory
                ? "Actualizar"
                : "Crear categoría"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ExpenseFormModal({
  editingExpense,
  form,
  receiptFile,
  saving,
  financeSummary,
  categoryOptions,
  onClose,
  onSubmit,
  onChange,
  onReceiptChange,
}) {
  const availableBalance =
    Number(financeSummary?.balances?.availableBalance || 0);
  const requestedAmount = Number(form.amount || 0);
  const currentPaidAmount =
    editingExpense?.status === EXPENSE_STATUS.PAID
      ? Number(editingExpense.amount || 0)
      : 0;
  const effectiveAvailable =
    availableBalance + currentPaidAmount;
  const remaining = effectiveAvailable - requestedAmount;

  return (
    <ModalShell
      title={editingExpense ? "Editar gasto" : "Nuevo gasto"}
      subtitle="Registra el gasto usando una categoría creada para Master Caps."
      onClose={onClose}
      maxWidth="max-w-[720px]"
    >
      <form onSubmit={onSubmit}>
        <div className="grid gap-2 sm:grid-cols-3">
          <ModalMetric
            label="Saldo disponible"
            value={formatFinanceCurrency(effectiveAvailable)}
          />
          <ModalMetric
            label="Valor del gasto"
            value={formatFinanceCurrency(requestedAmount)}
          />
          <ModalMetric
            label="Saldo posterior"
            value={formatFinanceCurrency(remaining)}
            danger={remaining < 0}
          />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="md:col-span-2">
            <FieldLabel>Descripción</FieldLabel>
            <textarea
              value={form.description}
              onChange={(event) =>
                onChange("description", event.target.value)
              }
              rows={2}
              className="mt-1.5 w-full resize-none rounded-xl border border-black/[0.07] px-3 py-2.5 text-[10px] outline-none focus:border-red-600"
              placeholder="Descripción del gasto"
            />
          </label>

          <InputField
            label="Valor"
            value={form.amount}
            inputMode="numeric"
            onChange={(value) =>
              onChange("amount", parseAmount(value))
            }
            placeholder="Ej: 150000"
          />

          <InputField
            label="Proveedor o beneficiario"
            value={form.supplier}
            onChange={(value) => onChange("supplier", value)}
            placeholder="Nombre del proveedor"
          />

          <InputField
            label="Fecha"
            type="date"
            value={form.expenseDate}
            onChange={(value) => onChange("expenseDate", value)}
          />

          <SelectField
            label="Categoría"
            value={form.category}
            onChange={(value) => onChange("category", value)}
            options={categoryOptions}
          />

          <SelectField
            label="Método de pago"
            value={form.paymentMethod}
            onChange={(value) =>
              onChange("paymentMethod", value)
            }
            options={EXPENSE_PAYMENT_METHODS}
          />

          <SelectField
            label="Estado"
            value={form.status}
            onChange={(value) => onChange("status", value)}
            options={EXPENSE_STATUS_OPTIONS}
          />

          <label className="md:col-span-2">
            <FieldLabel>Notas</FieldLabel>
            <textarea
              value={form.notes}
              onChange={(event) =>
                onChange("notes", event.target.value)
              }
              rows={2}
              className="mt-1.5 w-full resize-none rounded-xl border border-black/[0.07] px-3 py-2.5 text-[10px] outline-none focus:border-red-600"
              placeholder="Observaciones internas"
            />
          </label>

          <label className="md:col-span-2">
            <FieldLabel>Comprobante opcional</FieldLabel>
            <div className="mt-1.5 flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-black/[0.1] bg-black/[0.018] px-3 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <Upload size={16} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-medium">
                    {receiptFile
                      ? receiptFile.name
                      : "Seleccionar imagen o PDF"}
                  </p>
                  <p className="mt-0.5 text-[8px] text-black/38">
                    Máximo 8 MB
                  </p>
                </div>
              </div>

              <ImagePlus size={16} className="text-black/25" />

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) =>
                  onReceiptChange(event.target.files?.[0] || null)
                }
                className="hidden"
              />
            </div>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-black/[0.07] text-[10px] font-medium"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-red-600 text-[10px] font-medium text-white disabled:opacity-40"
          >
            {saving
              ? "Guardando..."
              : editingExpense
                ? "Actualizar"
                : "Guardar gasto"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ExpenseRow({
  expense,
  categoryLabel,
  updating,
  onStatusChange,
  onEdit,
  onView,
  onDelete,
}) {
  const visual = getStatusVisual(expense.status);
  const StatusIcon = visual.icon;
  const isPayroll = expense.source === EXPENSE_SOURCE.PAYROLL;

  return (
    <div className="grid grid-cols-[1.55fr_.8fr_.7fr_.7fr_.7fr_90px] items-center gap-3 px-4 py-3 transition hover:bg-black/[0.012]">
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${visual.iconBox}`}
        >
          <StatusIcon size={16} />
        </div>

        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium">
            {expense.description}
          </p>
          <p className="mt-0.5 truncate text-[9px] text-black/38">
            {expense.supplier || "Sin proveedor"}
            {isPayroll ? " · Nómina automática" : ""}
          </p>
        </div>
      </div>

      <span className="truncate text-[10px] text-black/55">
        {categoryLabel}
      </span>

      <span className="text-[10px] text-black/55">
        {formatDate(expense.expenseDate)}
      </span>

      <select
        value={expense.status || EXPENSE_STATUS.PENDING}
        disabled={updating || isPayroll}
        onChange={(event) =>
          onStatusChange(expense.id, event.target.value)
        }
        className={`h-8 rounded-lg border-0 px-2 text-[9px] outline-none ring-1 disabled:opacity-50 ${visual.badge}`}
      >
        {EXPENSE_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <span className="text-right text-[11px] font-medium">
        {formatExpenseCurrency(expense.amount)}
      </span>

      <div className="flex items-center justify-end gap-1">
        <IconButton icon={Eye} onClick={onView} />
        <IconButton
          icon={Edit3}
          onClick={onEdit}
          disabled={isPayroll}
        />
        <IconButton
          icon={Trash2}
          onClick={onDelete}
          danger
          disabled={isPayroll}
        />
      </div>
    </div>
  );
}

function ExpenseMobileCard({
  expense,
  categoryLabel,
  updating,
  onStatusChange,
  onEdit,
  onView,
  onDelete,
}) {
  const visual = getStatusVisual(expense.status);
  const StatusIcon = visual.icon;
  const isPayroll = expense.source === EXPENSE_SOURCE.PAYROLL;

  return (
    <article className="rounded-[18px] bg-white p-3 shadow-[0_10px_28px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.05]">
      <div className="flex items-start gap-2.5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${visual.iconBox}`}
        >
          <StatusIcon size={17} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[11px] font-medium">
            {expense.description}
          </p>
          <p className="mt-0.5 truncate text-[8px] text-black/38">
            {expense.supplier}
          </p>
        </div>

        <button
          type="button"
          onClick={onView}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-black/35"
        >
          <Eye size={14} />
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <MiniInfo
          label="Valor"
          value={formatExpenseCurrency(expense.amount)}
        />
        <MiniInfo
          label="Categoría"
          value={categoryLabel}
        />
      </div>

      <select
        value={expense.status || EXPENSE_STATUS.PENDING}
        disabled={updating || isPayroll}
        onChange={(event) =>
          onStatusChange(expense.id, event.target.value)
        }
        className="mt-2.5 h-9 w-full rounded-xl border border-black/[0.07] px-3 text-[9px] outline-none disabled:opacity-50"
      >
        {EXPENSE_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <ActionButton icon={Eye} label="Ver" onClick={onView} />
        <ActionButton
          icon={Edit3}
          label="Editar"
          onClick={onEdit}
          disabled={isPayroll}
        />
        <ActionButton
          icon={Trash2}
          label="Eliminar"
          onClick={onDelete}
          danger
          disabled={isPayroll}
        />
      </div>
    </article>
  );
}

function ExpenseDetailModal({
  expense,
  categoryLabel,
  updating,
  onClose,
  onEdit,
  onRemoveReceipt,
  onDelete,
}) {
  const isPayroll = expense.source === EXPENSE_SOURCE.PAYROLL;

  return (
    <ModalShell
      title="Detalle del gasto"
      subtitle={
        isPayroll
          ? "Gasto generado automáticamente por un pago de nómina."
          : "Información completa del registro."
      }
      onClose={onClose}
      maxWidth="max-w-[600px]"
    >
      <div className="rounded-[18px] bg-black/[0.025] p-3.5">
        <p className="text-[13px] font-medium">
          {expense.description}
        </p>
        <p className="mt-1 text-[9px] text-black/38">
          {expense.supplier}
        </p>
        <p className="mt-3 text-[24px] font-medium tracking-[-0.05em]">
          {formatExpenseCurrency(expense.amount)}
        </p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <DetailItem
          icon={CalendarDays}
          label="Fecha"
          value={formatDate(expense.expenseDate)}
        />
        <DetailItem
          icon={Tag}
          label="Categoría"
          value={categoryLabel}
        />
        <DetailItem
          icon={WalletCards}
          label="Método"
          value={getExpensePaymentMethodLabel(
            expense.paymentMethod
          )}
        />
        <DetailItem
          icon={FileText}
          label="Registrado por"
          value={
            expense.registeredByName ||
            expense.registeredByEmail ||
            "Sin información"
          }
        />
      </div>

      {expense.receiptUrl && (
        <div className="mt-3 rounded-xl border border-black/[0.06] p-3">
          <a
            href={expense.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-black px-3 text-[9px] text-white"
          >
            <Eye size={13} />
            Ver comprobante
          </a>

          {!isPayroll && (
            <button
              type="button"
              disabled={updating}
              onClick={onRemoveReceipt}
              className="ml-2 inline-flex h-8 items-center gap-2 rounded-lg border border-red-100 px-3 text-[9px] text-red-600"
            >
              <Trash2 size={13} />
              Eliminar
            </button>
          )}
        </div>
      )}

      {!isPayroll && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="h-10 rounded-xl border border-black/[0.07] text-[10px] font-medium"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="h-10 rounded-xl bg-red-600 text-[10px] font-medium text-white"
          >
            Eliminar
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function DeleteExpenseModal({
  expense,
  deleting,
  onClose,
  onConfirm,
}) {
  return (
    <ModalShell
      title="Eliminar gasto"
      subtitle="Esta acción eliminará el registro y su comprobante."
      onClose={onClose}
      maxWidth="max-w-[420px]"
    >
      <div className="rounded-[18px] bg-red-50 p-3.5">
        <p className="text-[12px] font-medium">
          {expense.description}
        </p>
        <p className="mt-2 text-[20px] font-medium">
          {formatExpenseCurrency(expense.amount)}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-xl border border-black/[0.07] text-[10px]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={deleting}
          className="h-10 rounded-xl bg-red-600 text-[10px] text-white disabled:opacity-40"
        >
          {deleting ? "Eliminando..." : "Eliminar"}
        </button>
      </div>
    </ModalShell>
  );
}

function TabButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-12 items-center gap-2 px-2 text-[10px] font-medium transition ${
        active
          ? "text-red-600"
          : "text-black/55 hover:text-black"
      }`}
    >
      <Icon size={15} />
      {label}

      <span
        className={`absolute inset-x-0 bottom-0 h-[2px] rounded-full transition ${
          active ? "bg-red-600" : "bg-transparent"
        }`}
      />
    </button>
  );
}

function SectionTitle({ title, subtitle, icon: Icon }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div>
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-0.5 text-[9px] text-black/38">{subtitle}</p>
      </div>
      <Icon size={18} className="text-black/22" />
    </div>
  );
}

function CompactMetric({ label, value, danger = false }) {
  return (
    <div className="rounded-2xl bg-black/[0.025] px-3 py-2.5">
      <p className="text-[8px] text-black/38">{label}</p>
      <p
        className={`mt-1 truncate text-[11px] font-medium ${
          danger ? "text-red-600" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function FinanceMiniCard({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-black/[0.022] p-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-red-600 ring-1 ring-black/[0.05]">
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-[8px] text-black/38">{label}</p>
        <p className="mt-0.5 truncate text-[10px] font-medium">
          {value}
        </p>
      </div>
    </div>
  );
}

function ExpenseSummaryCard({ icon: Icon, label, value, helper }) {
  return (
    <article className="rounded-[18px] bg-white p-3.5 shadow-[0_10px_28px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.05]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] text-black/40">{label}</p>
          <p className="mt-1 truncate text-[18px] font-medium tracking-[-0.04em]">
            {value}
          </p>
          <p className="mt-1 text-[8px] text-black/35">{helper}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon size={16} />
        </div>
      </div>
    </article>
  );
}

function ModalMetric({ label, value, danger = false }) {
  return (
    <div className="rounded-xl bg-black/[0.025] px-3 py-2.5">
      <p className="text-[8px] text-black/38">{label}</p>
      <p
        className={`mt-1 truncate text-[11px] font-medium ${
          danger ? "text-red-600" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MiniInfo({ label, value }) {
  return (
    <div className="rounded-xl bg-black/[0.025] px-2.5 py-2">
      <p className="text-[7px] text-black/35">{label}</p>
      <p className="mt-0.5 truncate text-[9px] font-medium">{value}</p>
    </div>
  );
}

function DetailItem({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-black/[0.025] p-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <p className="text-[8px] text-black/38">{label}</p>
        <p className="mt-0.5 truncate text-[9px] font-medium">{value}</p>
      </div>
    </div>
  );
}

function IconButton({
  icon: Icon,
  onClick,
  danger = false,
  disabled = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-25 ${
        danger
          ? "text-red-500 hover:bg-red-50"
          : "text-black/42 hover:bg-black/[0.035] hover:text-black"
      }`}
    >
      <Icon size={13} />
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg border text-[8px] font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? "border-red-100 text-red-600 hover:bg-red-50"
          : "border-black/[0.07] text-black/50 hover:bg-black/[0.025]"
      }`}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

function FieldLabel({ children }) {
  return (
    <span className="text-[9px] font-medium text-black/55">
      {children}
    </span>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder = "",
  type = "text",
  inputMode,
}) {
  return (
    <label>
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-10 w-full rounded-xl border border-black/[0.07] bg-white px-3 text-[10px] outline-none placeholder:text-black/30 focus:border-red-600"
        placeholder={placeholder}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-10 w-full rounded-xl border border-black/[0.07] bg-white px-3 text-[10px] outline-none focus:border-red-600"
      >
        {!options.length && <option value="">Sin opciones</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = "max-w-[540px]",
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-3 py-4 backdrop-blur-sm">
      <section
        className={`max-h-[94vh] w-full overflow-y-auto rounded-[24px] bg-white p-4 shadow-2xl ${maxWidth}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-medium tracking-[-0.035em] text-red-600">
              {title}
            </h2>
            <p className="mt-0.5 text-[9px] leading-4 text-black/40">
              {subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/[0.035]"
          >
            <X size={16} />
          </button>
        </div>

        {children}
      </section>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="rounded-[18px] bg-white p-8 text-center shadow-[0_10px_28px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.05]">
      <FolderOpen size={28} className="mx-auto text-black/20" />
      <p className="mt-2 text-[10px] text-black/42">{text}</p>
    </div>
  );
}