import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DollarSign,
  Edit3,
  Eye,
  FileClock,
  HandCoins,
  History,
  Info,
  LogIn,
  LogOut,
  Mail,
  Minus,
  Plus,
  RefreshCcw,
  Search,
  Shield,
  SlidersHorizontal,
  Store,
  Timer,
  Trash2,
  User,
  UserPlus,
  UserCheck,
  UserCog,
  Users,
  UserX,
  WalletCards,
  MoreHorizontal,
  X,
} from "lucide-react";

import {
  DEFAULT_PAYMENT_CONFIG,
  PAYMENT_TYPE_OPTIONS,
  PAYMENT_TYPES,
  createStoreUser,
  getActivePaymentRate,
  getPaymentTypeLabel,
  setUserActiveStatus,
  deleteStoreWorker,
  subscribeUsers,
  updateStoreUser,
  updateUserPaymentConfiguration,
} from "../../services/users.service";

import {
  REPORT_PERIODS,
  TIME_ENTRY_STATUS,
  clockIn,
  clockOut,
  correctTimeEntry,
  formatWorkedTime,
  getCurrentPeriodRange,
  subscribeActiveTimeEntry,
  subscribeStoreTimeEntries,
  subscribeUserTimeEntries,
} from "../../services/timeTracking.service";

import {
  PAYROLL_STATUS,
  calculatePayrollEntryAmount,
  subscribePayrollPayments,
} from "../../services/payrollPayments.service";

import { STORE_ID } from "../../services/categories.service";
import { getCurrentUserActor } from "../../services/auth.service";
import { useAuth } from "../../context/AuthContext";
import { formatCurrency } from "../../utils/money";

const emptyUserForm = {
  displayName: "",
  email: "",
  password: "",
  role: "seller",
};

const emptyPaymentForm = {
  paymentEnabled: true,
  paymentType: PAYMENT_TYPES.HOURLY,
  hourlyRate: "",
  expectedDailyMinutes: "480",
  workDaysPerMonth: "30",
};

const PERIOD_OPTIONS = [
  {
    value: REPORT_PERIODS.DAY,
    label: "Hoy",
  },
  {
    value: REPORT_PERIODS.BIWEEKLY,
    label: "Quincena",
  },
  {
    value: REPORT_PERIODS.MONTH,
    label: "Mes",
  },
];

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatDateTime(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);

  if (!date) return "Sin registro";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTime(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);

  if (!date) return "--:--";

  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDateKey(value) {
  if (!value) return "Sin fecha";

  const [year, month, day] = String(value).split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getRoleLabel(role) {
  return role === "admin" ? "Administrador" : "Vendedor";
}

function getRoleClass(role) {
  return role === "admin"
    ? "bg-red-600 text-white"
    : "bg-red-50 text-red-600";
}

function getStatusClass(active) {
  return active
    ? "bg-emerald-50 text-emerald-600"
    : "bg-red-50 text-red-600";
}

function getEntryStatusLabel(status) {
  if (status === TIME_ENTRY_STATUS.OPEN) return "Jornada abierta";
  if (status === TIME_ENTRY_STATUS.CORRECTED) return "Corregida";
  return "Completada";
}

function getEntryStatusClass(status) {
  if (status === TIME_ENTRY_STATUS.OPEN) {
    return "bg-orange-50 text-orange-600";
  }

  if (status === TIME_ENTRY_STATUS.CORRECTED) {
    return "bg-blue-50 text-blue-600";
  }

  return "bg-emerald-50 text-emerald-600";
}

function getPaymentFormFromUser(userItem) {
  return {
    paymentEnabled: Boolean(userItem?.paymentEnabled),
    paymentType: PAYMENT_TYPES.HOURLY,
    hourlyRate: String(userItem?.hourlyRate || ""),
    expectedDailyMinutes: String(userItem?.expectedDailyMinutes || DEFAULT_PAYMENT_CONFIG.expectedDailyMinutes),
    workDaysPerMonth: String(userItem?.workDaysPerMonth || DEFAULT_PAYMENT_CONFIG.workDaysPerMonth),
  };
}

function filterEntriesByPeriod(entries, period) {
  const range = getCurrentPeriodRange(period);

  return entries.filter((entry) => {
    const dateKey = entry.workDate;

    return (
      dateKey &&
      dateKey >= range.startDateKey &&
      dateKey <= range.endDateKey
    );
  });
}

function countUniqueWorkedDays(entries) {
  return new Set(
    entries
      .filter(
        (entry) =>
          entry.status === TIME_ENTRY_STATUS.COMPLETED ||
          entry.status === TIME_ENTRY_STATUS.CORRECTED
      )
      .map((entry) => entry.workDate)
      .filter(Boolean)
  ).size;
}

function getCompletedEntries(entries) {
  return entries.filter(
    (entry) =>
      entry.status === TIME_ENTRY_STATUS.COMPLETED ||
      entry.status === TIME_ENTRY_STATUS.CORRECTED
  );
}

function getEntryPaymentStatus(entry) {
  return entry?.paymentStatus === PAYROLL_STATUS.PAID
    ? PAYROLL_STATUS.PAID
    : PAYROLL_STATUS.PENDING;
}

function getEntryPaymentStatusLabel(entry) {
  return getEntryPaymentStatus(entry) === PAYROLL_STATUS.PAID
    ? "Pagada"
    : "Pendiente de pago";
}

function getEntryPaymentStatusClass(entry) {
  return getEntryPaymentStatus(entry) === PAYROLL_STATUS.PAID
    ? "bg-emerald-50 text-emerald-700"
    : "bg-amber-50 text-amber-700";
}

function summarizePaymentState(entries = []) {
  return getCompletedEntries(entries).reduce(
    (summary, entry) => {
      const amount = calculatePayrollEntryAmount(entry);
      const minutes = toNumber(entry.workedMinutes);

      summary.generatedAmount += amount;
      summary.workedMinutes += minutes;

      if (getEntryPaymentStatus(entry) === PAYROLL_STATUS.PAID) {
        summary.paidEntries += 1;
        summary.paidAmount += toNumber(entry.paidAmount, amount);
        summary.paidMinutes += minutes;
      } else {
        summary.pendingEntries += 1;
        summary.pendingAmount += amount;
        summary.pendingMinutes += minutes;
      }

      return summary;
    },
    {
      generatedAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
      workedMinutes: 0,
      paidMinutes: 0,
      pendingMinutes: 0,
      paidEntries: 0,
      pendingEntries: 0,
    }
  );
}

function calculatePayroll(entries, userItem, period) {
  const filtered = filterEntriesByPeriod(entries, period);
  const completed = getCompletedEntries(filtered);

  const workedMinutes = completed.reduce(
    (total, entry) => total + toNumber(entry.workedMinutes),
    0
  );

  const workedHours = Math.round((workedMinutes / 60) * 100) / 100;
  const workedDays = countUniqueWorkedDays(completed);
  const paymentType = PAYMENT_TYPES.HOURLY;

  const amount = completed.reduce(
    (total, entry) =>
      total +
      (toNumber(entry.workedMinutes) / 60) *
        toNumber(entry.hourlyRateSnapshot ?? userItem?.hourlyRate),
    0
  );

  return {
    entries: filtered,
    completedEntries: completed.length,
    openEntries: filtered.filter(
      (entry) => entry.status === TIME_ENTRY_STATUS.OPEN
    ).length,
    workedMinutes,
    workedHours,
    workedDays,
    amount: Math.round((amount + Number.EPSILON) * 100) / 100,
  };
}

export default function UsersPage() {
  const {
    firebaseUser,
    profile,
    isAdmin,
    isSeller,
  } = useAuth();

  const [users, setUsers] = useState([]);
  const [storeEntries, setStoreEntries] = useState([]);
  const [sellerEntries, setSellerEntries] = useState([]);
  const [payrollPayments, setPayrollPayments] = useState([]);
  const [sellerPayrollPayments, setSellerPayrollPayments] = useState([]);
  const [activeEntry, setActiveEntry] = useState(null);

  const [activeTab, setActiveTab] = useState("payroll");
  const [period, setPeriod] = useState(REPORT_PERIODS.MONTH);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [payrollPaymentFilter, setPayrollPaymentFilter] = useState("all");
  const [payrollStatusFilter, setPayrollStatusFilter] = useState("all");

  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState(emptyUserForm);

  const [paymentUser, setPaymentUser] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);

  const [detailUser, setDetailUser] = useState(null);
  const [correctionEntry, setCorrectionEntry] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clocking, setClocking] = useState(false);
  const [adminClockingUserId, setAdminClockingUserId] = useState("");
  const [deletingUserId, setDeletingUserId] = useState("");

  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  function showToast({
    type = "info",
    title,
    message = "",
    duration = 3600,
  }) {
    const id = Date.now();

    setToast({
      id,
      type,
      title,
      message,
    });

    window.setTimeout(() => {
      setToast((current) =>
        current?.id === id ? null : current
      );
    }, duration);
  }

  function askConfirmation({
    title,
    message,
    confirmLabel = "Confirmar",
    tone = "danger",
  }) {
    return new Promise((resolve) => {
      setConfirmDialog({
        title,
        message,
        confirmLabel,
        tone,
        resolve,
      });
    });
  }

  function closeConfirmation(result) {
    setConfirmDialog((current) => {
      current?.resolve?.(result);
      return null;
    });
  }

  useEffect(() => {
    if (!isAdmin) return undefined;

    setLoading(true);

    const unsubscribeUsers = subscribeUsers(
      (usersData) => {
        setUsers(usersData);
        setLoading(false);
      },
      () => {
        setLoading(false);
        showToast({
          type: "error",
          title: "No pudimos cargar el equipo",
          message:
            "Revisa la conexión e inténtalo nuevamente.",
        });
      },
      STORE_ID
    );

    const unsubscribeEntries = subscribeStoreTimeEntries({
      storeId: STORE_ID,
      callback: setStoreEntries,
      onError: () =>
        showToast({
          type: "error",
          title: "No pudimos cargar las jornadas",
          message:
            "Revisa la conexión e inténtalo nuevamente.",
        }),
    });

    const unsubscribePayroll = subscribePayrollPayments({
      storeId: STORE_ID,
      callback: setPayrollPayments,
      onError: () =>
        showToast({
          type: "error",
          title: "No pudimos cargar los pagos",
          message:
            "Revisa la conexión e inténtalo nuevamente.",
        }),
    });

    return () => {
      unsubscribeUsers();
      unsubscribeEntries();
      unsubscribePayroll();
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isSeller || !firebaseUser?.uid) return undefined;

    setLoading(true);

    const unsubscribeEntries = subscribeUserTimeEntries({
      userId: firebaseUser.uid,
      storeId: STORE_ID,
      callback: (entriesData) => {
        setSellerEntries(entriesData);
        setLoading(false);
      },
      onError: () => {
        setLoading(false);
        showToast({
          type: "error",
          title: "No pudimos cargar tus jornadas",
          message:
            "Revisa la conexión e inténtalo nuevamente.",
        });
      },
    });

    const unsubscribeActive = subscribeActiveTimeEntry(
      firebaseUser.uid,
      setActiveEntry,
      () =>
        showToast({
          type: "error",
          title: "No pudimos actualizar tu jornada",
          message:
            "Inténtalo nuevamente en unos segundos.",
        }),
      STORE_ID
    );

    const unsubscribePayroll = subscribePayrollPayments({
      storeId: STORE_ID,
      sellerUid: firebaseUser.uid,
      callback: setSellerPayrollPayments,
      onError: () =>
        showToast({
          type: "error",
          title: "No pudimos cargar tus pagos",
          message:
            "Revisa la conexión e inténtalo nuevamente.",
        }),
    });

    return () => {
      unsubscribeEntries();
      unsubscribeActive();
      unsubscribePayroll();
    };
  }, [isSeller, firebaseUser?.uid]);

  const sellers = useMemo(
    () => users.filter((userItem) => userItem.role === "seller"),
    [users]
  );

  const activeEntriesByUser = useMemo(() => {
    const map = new Map();

    storeEntries.forEach((entry) => {
      if (
        entry?.userId &&
        entry.status === TIME_ENTRY_STATUS.OPEN
      ) {
        map.set(entry.userId, entry);
      }
    });

    return map;
  }, [storeEntries]);

  const filteredUsers = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return users.filter((userItem) => {
      const matchesSearch =
        !cleanSearch ||
        String(userItem.displayName || "")
          .toLowerCase()
          .includes(cleanSearch) ||
        String(userItem.email || "")
          .toLowerCase()
          .includes(cleanSearch) ||
        String(userItem.role || "")
          .toLowerCase()
          .includes(cleanSearch);

      const matchesRole =
        roleFilter === "all" || userItem.role === roleFilter;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && userItem.active) ||
        (statusFilter === "inactive" && !userItem.active);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  const payrollRows = useMemo(() => {
    return sellers
      .map((seller) => {
        const entries = storeEntries.filter(
          (entry) => entry.userId === seller.id
        );

        const periodEntries = filterEntriesByPeriod(entries, period);
        const paymentState = summarizePaymentState(periodEntries);
        const sellerPayments = payrollPayments.filter(
          (payment) => payment.sellerUid === seller.id
        );

        return {
          seller,
          summary: calculatePayroll(entries, seller, period),
          paymentState,
          payments: sellerPayments,
          activeEntry:
            activeEntriesByUser.get(seller.id) || null,
        };
      })
      .filter(({ seller }) => {
        const cleanSearch = search.trim().toLowerCase();

        const matchesSearch =
          !cleanSearch ||
          String(seller.displayName || "")
            .toLowerCase()
            .includes(cleanSearch) ||
          String(seller.email || "")
            .toLowerCase()
            .includes(cleanSearch);

        const matchesPayment =
          payrollPaymentFilter === "all" ||
          seller.paymentType === payrollPaymentFilter;

        const matchesStatus =
          payrollStatusFilter === "all" ||
          (payrollStatusFilter === "active" && seller.active) ||
          (payrollStatusFilter === "inactive" && !seller.active);

        return matchesSearch && matchesPayment && matchesStatus;
      });
  }, [
    sellers,
    storeEntries,
    payrollPayments,
    period,
    search,
    payrollPaymentFilter,
    payrollStatusFilter,
    activeEntriesByUser,
  ]);

  const adminTotals = useMemo(() => {
    return payrollRows.reduce(
      (totals, row) => {
        totals.sellers += 1;
        totals.workedHours += row.summary.workedHours;
        totals.workedDays += row.summary.workedDays;
        totals.amount += row.summary.amount;
        totals.paidAmount += row.paymentState.paidAmount;
        totals.pendingAmount += row.paymentState.pendingAmount;
        totals.openEntries += row.summary.openEntries;

        return totals;
      },
      {
        sellers: 0,
        workedHours: 0,
        workedDays: 0,
        amount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        openEntries: 0,
      }
    );
  }, [payrollRows]);

  const sellerPaymentSummary = useMemo(() => {
    const state = summarizePaymentState(sellerEntries);

    return {
      ...state,
      workedHours: Math.round((state.workedMinutes / 60) * 100) / 100,
      paidHours: Math.round((state.paidMinutes / 60) * 100) / 100,
      pendingHours:
        Math.round((state.pendingMinutes / 60) * 100) / 100,
      paymentsCount: sellerPayrollPayments.length,
      lastPayment: sellerPayrollPayments[0] || null,
    };
  }, [sellerEntries, sellerPayrollPayments]);

  const sellerSummaries = useMemo(() => {
    if (!profile) return null;

    return {
      day: calculatePayroll(
        sellerEntries,
        profile,
        REPORT_PERIODS.DAY
      ),
      biweekly: calculatePayroll(
        sellerEntries,
        profile,
        REPORT_PERIODS.BIWEEKLY
      ),
      month: calculatePayroll(
        sellerEntries,
        profile,
        REPORT_PERIODS.MONTH
      ),
    };
  }, [sellerEntries, profile]);

  function openCreateUser() {
    setEditingUser(null);
    setUserForm(emptyUserForm);
    setShowUserForm(true);
  }

  function openEditUser(userItem) {
    setEditingUser(userItem);

    setUserForm({
      displayName: userItem.displayName || "",
      email: userItem.email || "",
      password: "",
      role: userItem.role || "seller",
    });

    setShowUserForm(true);
  }

  function closeUserForm() {
    setShowUserForm(false);
    setEditingUser(null);
    setUserForm(emptyUserForm);
  }

  function openPaymentModal(userItem) {
    setPaymentUser(userItem);
    setPaymentForm(getPaymentFormFromUser(userItem));
  }

  function closePaymentModal() {
    setPaymentUser(null);
    setPaymentForm(emptyPaymentForm);
  }

  async function handleUserSubmit(event) {
    event.preventDefault();

    const displayName = userForm.displayName.trim();
    const email = userForm.email.trim().toLowerCase();
    const password = userForm.password.trim();

    if (!displayName) {
      showToast({
        type: "warning",
        title: "Nombre requerido",
        message: "Escribe el nombre completo del usuario.",
      });
      return;
    }

    if (!email) {
      showToast({
        type: "warning",
        title: "Correo requerido",
        message: "Escribe un correo electrónico válido.",
      });
      return;
    }

    try {
      setSaving(true);
      const actor = getCurrentUserActor();

      if (editingUser) {
        await updateStoreUser(editingUser.id, {
          displayName,
          role: userForm.role,
          updatedByUid: actor.uid,
          updatedByName: actor.name,
          updatedByEmail: actor.email,
        });
      } else {
        if (!password || password.length < 6) {
          showToast({
            type: "warning",
            title: "Contraseña muy corta",
            message:
              "La contraseña temporal debe tener mínimo 6 caracteres.",
          });
          return;
        }

        await createStoreUser({
          displayName,
          email,
          password,
          role: userForm.role,
          storeId: STORE_ID,
          creator: actor,
        });
      }

      closeUserForm();
    } catch (error) {
      console.error(error);

      if (error.code === "auth/email-already-in-use") {
        showToast({
          type: "warning",
          title: "Correo ya registrado",
          message:
            "Ya existe un usuario con ese correo electrónico.",
        });
      } else {
        showToast({
          type: "error",
          title: "No pudimos guardar el usuario",
          message:
            error.message ||
            "Verifica los datos e inténtalo nuevamente.",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePaymentSubmit(event) {
    event.preventDefault();

    if (!paymentUser) return;

    try {
      setSaving(true);

      await updateUserPaymentConfiguration(
        paymentUser.id,
        paymentForm,
        getCurrentUserActor()
      );

      closePaymentModal();
      showToast({
        type: "success",
        title: "Configuración actualizada",
        message:
          "La configuración salarial se guardó correctamente.",
      });
    } catch (error) {
      console.error(error);
      showToast({
        type: "error",
        title: "No pudimos guardar la configuración",
        message:
          error.message ||
          "Inténtalo nuevamente en unos segundos.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(userItem) {
    const nextStatus = !userItem.active;

    const confirmed = await askConfirmation({
      title: nextStatus
        ? "Activar trabajador"
        : "Desactivar trabajador",
      message: nextStatus
        ? `¿Deseas activar a ${userItem.displayName}? Podrá volver a iniciar sesión y registrar jornadas.`
        : `¿Deseas desactivar a ${userItem.displayName}? No podrá iniciar nuevas jornadas mientras esté inactivo.`,
      confirmLabel: nextStatus
        ? "Sí, activar"
        : "Sí, desactivar",
      tone: nextStatus ? "success" : "danger",
    });

    if (!confirmed) return;

    try {
      await setUserActiveStatus(
        userItem.id,
        nextStatus,
        getCurrentUserActor()
      );

      showToast({
        type: "success",
        title: nextStatus
          ? "Trabajador activado"
          : "Trabajador desactivado",
        message: `${userItem.displayName} fue actualizado correctamente.`,
      });
    } catch (error) {
      console.error(error);
      showToast({
        type: "error",
        title: "No pudimos cambiar el estado",
        message:
          error.message ||
          "Inténtalo nuevamente en unos segundos.",
      });
    }
  }

  async function handleDeleteWorker(userItem) {
    if (!userItem?.id) return;

    if (userItem.role !== "seller") {
      showToast({
        type: "warning",
        title: "Acción no disponible",
        message:
          "La eliminación completa está disponible únicamente para trabajadores con rol vendedor.",
      });
      return;
    }

    const workerName =
      userItem.displayName ||
      userItem.email ||
      "este trabajador";

    const confirmed = await askConfirmation({
      title: `Eliminar a ${workerName}`,
      message:
        "Se eliminarán su perfil, su jornada activa y todas sus jornadas laborales. Las ventas, pagos de nómina ya realizados y gastos históricos se conservarán por trazabilidad contable. Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar trabajador",
      tone: "danger",
    });

    if (!confirmed) return;

    try {
      setDeletingUserId(userItem.id);

      const result = await deleteStoreWorker(
        userItem.id,
        getCurrentUserActor(),
        STORE_ID
      );

      if (detailUser?.id === userItem.id) {
        setDetailUser(null);
      }

      showToast({
        type: "success",
        title: "Trabajador eliminado",
        message: `${result.displayName} fue eliminado correctamente. Se eliminaron ${result.deletedTimeEntries} jornada(s).`,
        duration: 5000,
      });
    } catch (error) {
      console.error(error);
      showToast({
        type: "error",
        title: "No pudimos eliminar el trabajador",
        message:
          error.message ||
          "Inténtalo nuevamente en unos segundos.",
        duration: 5000,
      });
    } finally {
      setDeletingUserId("");
    }
  }

  async function handleClockAction() {
    if (!firebaseUser?.uid) return;

    try {
      setClocking(true);

      if (activeEntry) {
        await clockOut({
          userId: firebaseUser.uid,
          storeId: STORE_ID,
          actor: getCurrentUserActor(),
        });
      } else {
        await clockIn({
          userId: firebaseUser.uid,
          storeId: STORE_ID,
          actor: getCurrentUserActor(),
        });
      }
    } catch (error) {
      console.error(error);
      showToast({
        type: "error",
        title: "No pudimos actualizar la jornada",
        message:
          error.message ||
          "Inténtalo nuevamente en unos segundos.",
      });
    } finally {
      setClocking(false);
    }
  }

  async function handleAdminClockAction(userItem) {
    if (!isAdmin || !userItem?.id) return;

    if (userItem.role !== "seller") {
      showToast({
        type: "warning",
        title: "Acción no disponible",
        message:
          "La jornada laboral solo aplica a usuarios con rol vendedor.",
      });
      return;
    }

    if (!userItem.active) {
      showToast({
        type: "warning",
        title: "Trabajador inactivo",
        message:
          "Activa al trabajador antes de iniciar una jornada laboral.",
      });
      return;
    }

    const currentActiveEntry =
      activeEntriesByUser.get(userItem.id) || null;

    const actionLabel = currentActiveEntry
      ? "finalizar"
      : "iniciar";

    const workerName =
      userItem.displayName ||
      userItem.email ||
      "este vendedor";

    const confirmed = await askConfirmation({
      title: currentActiveEntry
        ? "Finalizar jornada"
        : "Iniciar jornada",
      message: currentActiveEntry
        ? `¿Deseas finalizar la jornada laboral de ${workerName}? La salida quedará registrada a nombre de administración.`
        : `¿Deseas iniciar la jornada laboral de ${workerName}? La entrada quedará registrada a nombre de administración.`,
      confirmLabel: currentActiveEntry
        ? "Finalizar jornada"
        : "Iniciar jornada",
      tone: currentActiveEntry
        ? "danger"
        : "success",
    });

    if (!confirmed) return;

    try {
      setAdminClockingUserId(userItem.id);

      if (currentActiveEntry) {
        await clockOut({
          userId: userItem.id,
          storeId: STORE_ID,
          actor: getCurrentUserActor(),
        });
      } else {
        await clockIn({
          userId: userItem.id,
          storeId: STORE_ID,
          actor: getCurrentUserActor(),
        });
      }
    } catch (error) {
      console.error(error);
      showToast({
        type: "error",
        title: "No pudimos actualizar la jornada",
        message:
          error.message ||
          "Inténtalo nuevamente en unos segundos.",
      });
    } finally {
      setAdminClockingUserId("");
    }
  }

  if (isSeller) {
    return (
      <SellerAttendanceView
        profile={profile}
        activeEntry={activeEntry}
        entries={sellerEntries}
        summaries={sellerSummaries}
        paymentSummary={sellerPaymentSummary}
        payrollPayments={sellerPayrollPayments}
        loading={loading}
        clocking={clocking}
        onClockAction={handleClockAction}
      />
    );
  }

  return (
    <main className="min-h-screen bg-white px-3 py-4 text-black sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1580px]">
        <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-600">
              Administración
            </p>

            <h1 className="mt-1.5 text-[31px] font-medium tracking-[-0.05em]">
              Equipo y nómina
            </h1>

            <p className="mt-1 text-[13px] text-black/48">
              Gestiona jornadas, modalidades de pago y pagos del equipo.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid h-11 grid-cols-2 overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.035)]">
              <button
                type="button"
                onClick={() => setActiveTab("payroll")}
                className={`min-w-[112px] rounded-xl px-4 text-[12px] font-medium transition ${
                  activeTab === "payroll"
                    ? "bg-red-600 text-white shadow-md shadow-red-600/15"
                    : "text-black/60 hover:bg-black/[0.025]"
                }`}
              >
                Nómina
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("users")}
                className={`min-w-[112px] rounded-xl px-4 text-[12px] font-medium transition ${
                  activeTab === "users"
                    ? "bg-red-600 text-white shadow-md shadow-red-600/15"
                    : "text-black/60 hover:bg-black/[0.025]"
                }`}
              >
                Equipo
              </button>
            </div>

            <button
              type="button"
              onClick={openCreateUser}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
            >
              <UserPlus size={17} />
              Nuevo usuario
            </button>
          </div>
        </header>

        {activeTab === "payroll" ? (
          <>
            <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={Users}
                title="Total vendedores"
                value={adminTotals.sellers}
                helper="Activos en el equipo"
              />

              <MetricCard
                icon={Clock3}
                title="Horas registradas"
                value={`${adminTotals.workedHours.toFixed(2)} h`}
                helper={getCurrentPeriodRange(period).label}
              />

              <MetricCard
                icon={CalendarDays}
                title="Días trabajados"
                value={adminTotals.workedDays}
                helper={`${adminTotals.openEntries} jornada(s) abierta(s)`}
              />

              <MetricCard
                icon={Banknote}
                title="Total estimado"
                value={formatCurrency(adminTotals.amount)}
                helper={getCurrentPeriodRange(period).label}
                featured
              />
            </section>

            <section className="mt-4">
              <div className="grid gap-2.5 xl:grid-cols-[minmax(280px,1.4fr)_repeat(3,minmax(150px,.7fr))_46px]">
                <label className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] outline-none transition placeholder:text-black/35 focus:border-red-500 focus:ring-4 focus:ring-red-600/10"
                    placeholder="Buscar vendedor por nombre o correo..."
                  />
                </label>

                <select
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[12px] outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-600/10"
                >
                  {PERIOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  value={payrollPaymentFilter}
                  onChange={(event) => setPayrollPaymentFilter(event.target.value)}
                  className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[12px] outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-600/10"
                >
                  <option value="all">Todas las modalidades</option>
                  {PAYMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  value={payrollStatusFilter}
                  onChange={(event) => setPayrollStatusFilter(event.target.value)}
                  className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[12px] outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-600/10"
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Inactivos</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setPayrollPaymentFilter("all");
                    setPayrollStatusFilter("all");
                    setPeriod(REPORT_PERIODS.MONTH);
                  }}
                  className="flex h-11 items-center justify-center rounded-2xl border border-black/[0.08] bg-white text-black/55 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  title="Restablecer filtros"
                >
                  <SlidersHorizontal size={16} />
                </button>
              </div>

              <div className="mt-4">
                {loading ? (
                  <EmptyState text="Cargando nómina y jornadas..." />
                ) : payrollRows.length === 0 ? (
                  <EmptyState text="No hay vendedores para mostrar." />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {payrollRows.map(
                      ({
                        seller,
                        summary,
                        paymentState,
                        payments,
                        activeEntry: sellerActiveEntry,
                      }) => (
                      <PayrollCard
                        key={seller.id}
                        seller={seller}
                        summary={summary}
                        paymentState={paymentState}
                        payments={payments}
                        activeEntry={sellerActiveEntry}
                        clocking={
                          adminClockingUserId === seller.id
                        }
                        onClockAction={() =>
                          handleAdminClockAction(seller)
                        }
                        deleting={
                          deletingUserId === seller.id
                        }
                        onDelete={() =>
                          handleDeleteWorker(seller)
                        }
                        onPayment={() => openPaymentModal(seller)}
                        onDetails={() => setDetailUser(seller)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        ) : (
          <UsersManagementSection
            users={filteredUsers}
            loading={loading}
            search={search}
            roleFilter={roleFilter}
            statusFilter={statusFilter}
            onSearch={setSearch}
            onRoleFilter={setRoleFilter}
            onStatusFilter={setStatusFilter}
            onCreate={openCreateUser}
            activeEntriesByUser={activeEntriesByUser}
            adminClockingUserId={adminClockingUserId}
            deletingUserId={deletingUserId}
            onEdit={openEditUser}
            onToggle={handleToggleActive}
            onPayment={openPaymentModal}
            onClockAction={handleAdminClockAction}
            onDelete={handleDeleteWorker}
          />
        )}
      </section>

      {showUserForm && (
        <UserFormModal
          editingUser={editingUser}
          form={userForm}
          saving={saving}
          onClose={closeUserForm}
          onSubmit={handleUserSubmit}
          onChange={(field, value) =>
            setUserForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
        />
      )}

      {paymentUser && (
        <PaymentConfigurationModal
          userItem={paymentUser}
          form={paymentForm}
          saving={saving}
          onClose={closePaymentModal}
          onSubmit={handlePaymentSubmit}
          onChange={(field, value) =>
            setPaymentForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
        />
      )}

      {detailUser && (
        <SellerDetailModal
          seller={detailUser}
          entries={storeEntries.filter(
            (entry) => entry.userId === detailUser.id
          )}
          onClose={() => setDetailUser(null)}
          onCorrect={setCorrectionEntry}
        />
      )}

      {correctionEntry && (
        <CorrectionModal
          entry={correctionEntry}
          saving={saving}
          onClose={() => setCorrectionEntry(null)}
          onSave={async (payload) => {
            try {
              setSaving(true);

              await correctTimeEntry({
                timeEntryId: correctionEntry.id,
                ...payload,
                actor: getCurrentUserActor(),
              });

              setCorrectionEntry(null);
              showToast({
                type: "success",
                title: "Jornada corregida",
                message:
                  "La corrección se guardó correctamente.",
              });
            } catch (error) {
              console.error(error);
              showToast({
                type: "error",
                title: "No pudimos corregir la jornada",
                message:
                  error.message ||
                  "Verifica los datos e inténtalo nuevamente.",
              });
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {confirmDialog && (
        <ProfessionalConfirm
          dialog={confirmDialog}
          onCancel={() => closeConfirmation(false)}
          onConfirm={() => closeConfirmation(true)}
        />
      )}

      {toast && (
        <ProfessionalToast
          toast={toast}
          onClose={() => setToast(null)}
        />
      )}
    </main>
  );
}

function SellerAttendanceView({
  profile,
  activeEntry,
  entries,
  summaries,
  paymentSummary,
  payrollPayments,
  loading,
  clocking,
  onClockAction,
}) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  const activeMinutes = useMemo(() => {
    if (!activeEntry?.clockIn) return 0;

    const start = activeEntry.clockIn?.toDate?.();
    if (!start) return 0;

    return Math.max(
      Math.floor((now.getTime() - start.getTime()) / 60000),
      0
    );
  }, [activeEntry, now]);

  const recentEntries = useMemo(
    () => [...entries].slice(0, 8),
    [entries]
  );

  const currentDate = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  const currentTime = new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

  return (
    <main className="min-h-screen bg-white px-3 pb-20 pt-3 text-black sm:px-5 sm:pb-8 sm:pt-5 lg:px-6">
      <section className="mx-auto max-w-[1450px]">
        <header className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-red-600 sm:text-[11px]">
              Mi jornada laboral
            </p>

            <h1 className="mt-1 text-[27px] font-medium tracking-[-0.05em] sm:text-[32px]">
              Hola, {profile?.displayName || "vendedor"}
            </h1>

            <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-black/48 sm:text-[13px]">
              Gestiona tu jornada, consulta tus horas y revisa tus pagos.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-[20px] border border-black/[0.07] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.035)] sm:min-w-[220px]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <Clock3 size={19} />
            </div>

            <div className="min-w-0">
              <p className="text-[9px] text-black/42 sm:text-[10px]">
                Hora actual
              </p>
              <p className="mt-0.5 text-[17px] font-medium tracking-[-0.035em] sm:text-[18px]">
                {currentTime}
              </p>
              <p className="mt-0.5 truncate capitalize text-[8px] text-black/40 sm:text-[9px]">
                {currentDate}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.08fr_.92fr]">
          <article className="rounded-[26px] border border-black/[0.06] bg-white p-4 shadow-[0_18px_55px_rgba(0,0,0,0.04)] sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    activeEntry ? "bg-emerald-500" : "bg-black/20"
                  }`}
                />
                <p
                  className={`text-[12px] font-medium sm:text-[13px] ${
                    activeEntry ? "text-emerald-600" : "text-black/50"
                  }`}
                >
                  {activeEntry ? "Jornada activa" : "Sin jornada activa"}
                </p>
              </div>

              <MoreHorizontal size={18} className="text-black/30" />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-[18px] bg-black/[0.025] p-3.5 sm:p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <LogIn size={20} />
                </div>

                <div className="min-w-0">
                  <p className="text-[9px] text-black/42 sm:text-[10px]">
                    Entrada registrada
                  </p>
                  <p className="mt-0.5 truncate text-[20px] font-medium tracking-[-0.045em] sm:text-[22px]">
                    {activeEntry ? formatTime(activeEntry.clockIn) : "--:--"}
                  </p>
                  <p className="mt-0.5 truncate text-[9px] text-black/42 sm:text-[10px]">
                    {activeEntry
                      ? formatDateKey(activeEntry.workDate)
                      : "Sin registro"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-[18px] bg-black/[0.025] p-3.5 sm:p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                  <Timer size={20} />
                </div>

                <div className="min-w-0">
                  <p className="text-[9px] text-black/42 sm:text-[10px]">
                    Tiempo trabajado
                  </p>
                  <p className="mt-0.5 truncate text-[20px] font-medium tracking-[-0.045em] sm:text-[22px]">
                    {activeEntry ? formatWorkedTime(activeMinutes) : "0 min"}
                  </p>
                  <p className="mt-0.5 truncate text-[9px] text-black/42 sm:text-[10px]">
                    {activeEntry ? "En curso" : "Aún no has iniciado"}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClockAction}
              disabled={clocking}
              className={`mt-4 inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl px-5 text-[13px] font-medium text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-55 sm:text-[14px] ${
                activeEntry
                  ? "bg-red-600 shadow-red-600/20 hover:bg-red-700"
                  : "bg-black shadow-black/10 hover:bg-black/85"
              }`}
            >
              {activeEntry ? <LogOut size={18} /> : <LogIn size={18} />}
              {clocking
                ? "Procesando..."
                : activeEntry
                  ? "Registrar salida"
                  : "Registrar entrada"}
            </button>
          </article>

          <article className="rounded-[26px] border border-black/[0.06] bg-white p-4 shadow-[0_18px_55px_rgba(0,0,0,0.04)] sm:p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-medium sm:text-[16px]">
                Mi configuración
              </h2>

              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <BadgeDollarSign size={18} />
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <ConfigurationRow
                icon={Clock3}
                label="Modalidad de pago"
                value="Pago por hora"
              />

              <ConfigurationRow
                icon={DollarSign}
                label="Valor configurado"
                value={formatCurrency(getActivePaymentRate(profile))}
              />

              <ConfigurationRow
                icon={Timer}
                label="Horas esperadas por día"
                value={formatWorkedTime(profile?.expectedDailyMinutes || 480)}
              />

              <ConfigurationRow
                icon={CalendarDays}
                label="Días trabajados por mes"
                value={`${profile?.workDaysPerMonth || 30} días`}
              />
            </div>
          </article>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SellerSummaryCard
            icon={WalletCards}
            label="Total generado"
            amount={paymentSummary?.generatedAmount || 0}
            hours={paymentSummary?.workedHours || 0}
          />

          <SellerSummaryCard
            icon={CheckCircle2}
            label="Total recibido"
            amount={paymentSummary?.paidAmount || 0}
            hours={paymentSummary?.paidHours || 0}
            tone="success"
          />

          <SellerSummaryCard
            icon={History}
            label="Saldo pendiente"
            amount={paymentSummary?.pendingAmount || 0}
            hours={paymentSummary?.pendingHours || 0}
            tone="warning"
          />

          <SellerSummaryCard
            icon={Banknote}
            label="Ganado este mes"
            amount={summaries?.month?.amount || 0}
            hours={summaries?.month?.workedHours || 0}
          />
        </section>

        <section className="mt-4 rounded-[26px] border border-black/[0.06] bg-white p-4 shadow-[0_18px_55px_rgba(0,0,0,0.04)] sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <History size={18} />
              </div>

              <div className="min-w-0">
                <h2 className="text-[15px] font-medium sm:text-[16px]">
                  Historial reciente
                </h2>
                <p className="mt-0.5 truncate text-[10px] text-black/42 sm:text-[11px]">
                  Tus últimas entradas, salidas y pagos calculados.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4">
            {loading ? (
              <EmptyState text="Cargando tus jornadas..." />
            ) : recentEntries.length === 0 ? (
              <EmptyState text="Aún no tienes jornadas registradas." />
            ) : (
              <div className="overflow-hidden rounded-[18px] border border-black/[0.06]">
                <div className="hidden grid-cols-[1.15fr_.65fr_.65fr_.7fr_.8fr_.8fr] gap-3 bg-black/[0.025] px-4 py-3 text-[10px] font-medium text-black/45 md:grid">
                  <span>Fecha</span>
                  <span>Entrada</span>
                  <span>Salida</span>
                  <span>Tiempo</span>
                  <span>Valor</span>
                  <span>Estado pago</span>
                </div>

                {recentEntries.map((entry) => (
                  <SellerHistoryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-[24px] border border-black/[0.06] bg-white p-4 shadow-[0_16px_46px_rgba(0,0,0,0.035)] sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-medium sm:text-[16px]">
                Pagos recibidos
              </h2>
              <p className="mt-0.5 text-[10px] text-black/42">
                Historial de pagos confirmados por administración.
              </p>
            </div>

            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[9px] font-medium text-emerald-700">
              {paymentSummary?.paymentsCount || 0} pago(s)
            </span>
          </div>

          <div className="mt-4">
            {payrollPayments.length === 0 ? (
              <EmptyState text="Aún no tienes pagos de nómina registrados." />
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {payrollPayments.map((payment) => (
                  <article
                    key={payment.id}
                    className="rounded-[18px] border border-black/[0.06] bg-white p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] text-black/42">
                          {formatDateKey(payment.paymentDate)}
                        </p>
                        <p className="mt-1 text-[18px] font-medium tracking-[-0.04em]">
                          {formatCurrency(payment.amount || 0)}
                        </p>
                      </div>

                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[8px] font-medium text-emerald-700">
                        Pagado
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <SmallInfo
                        label="Horas pagadas"
                        value={`${payment.totalHours || 0} h`}
                      />
                      <SmallInfo
                        label="Jornadas"
                        value={String(payment.entriesCount || 0)}
                      />
                    </div>

                    <p className="mt-2 text-[8px] text-black/38">
                      Ref. {payment.id}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function ConfigurationRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-black/[0.025] px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon size={15} />
        </div>

        <span className="min-w-0 truncate text-[10px] text-black/48 sm:text-[11px]">
          {label}
        </span>
      </div>

      <strong className="max-w-[48%] shrink-0 truncate text-right text-[10px] font-medium sm:text-[11px]">
        {value}
      </strong>
    </div>
  );
}

function SellerHistoryRow({ entry }) {
  const paid = getEntryPaymentStatus(entry) === PAYROLL_STATUS.PAID;

  return (
    <div className="border-t border-black/[0.055] px-3 py-3 first:border-t-0 sm:px-4">
      <div className="grid gap-3 md:grid-cols-[1.15fr_.65fr_.65fr_.7fr_.8fr_.8fr] md:items-center">
        <div>
          <p className="text-[11px] font-medium">
            {formatDateKey(entry.workDate)}
          </p>

          <span
            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[8px] ${getEntryStatusClass(
              entry.status
            )}`}
          >
            {getEntryStatusLabel(entry.status)}
          </span>
        </div>

        <MobileHistoryValue
          label="Entrada"
          value={formatTime(entry.clockIn)}
        />

        <MobileHistoryValue
          label="Salida"
          value={formatTime(entry.clockOut)}
        />

        <MobileHistoryValue
          label="Tiempo"
          value={formatWorkedTime(entry.workedMinutes)}
          strong
        />

        <div>
          <p className="text-[11px] font-medium">
            {formatCurrency(calculatePayrollEntryAmount(entry))}
          </p>
          {paid && entry.paidAt && (
            <p className="mt-0.5 text-[8px] text-black/38">
              {formatDateTime(entry.paidAt)}
            </p>
          )}
        </div>

        <div>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-[8px] font-medium ${getEntryPaymentStatusClass(
              entry
            )}`}
          >
            {getEntryPaymentStatusLabel(entry)}
          </span>

          {paid && entry.payrollPaymentId && (
            <p className="mt-1 truncate text-[7px] text-black/32">
              Ref. {entry.payrollPaymentId}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileHistoryValue({ label, value, strong = false }) {
  return (
    <div className="rounded-xl bg-black/[0.022] px-2 py-2 text-center md:bg-transparent md:px-0 md:py-0 md:text-left">
      <p className="text-[8px] text-black/38 md:hidden">{label}</p>
      <p
        className={`mt-0.5 truncate text-[10px] md:mt-0 md:text-[11px] ${
          strong ? "font-medium text-black" : "text-black/55"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  helper,
  featured = false,
}) {
  return (
    <article
      className={`rounded-[22px] border p-4 shadow-[0_12px_32px_rgba(0,0,0,0.028)] transition ${
        featured
          ? "border-red-100 bg-red-50/45"
          : "border-black/[0.065] bg-white"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            featured
              ? "bg-red-100 text-red-600"
              : "bg-black/[0.035] text-black/60"
          }`}
        >
          <Icon size={19} />
        </div>

        <div className="min-w-0">
          <p className="text-[10px] text-black/43">{title}</p>
          <p
            className={`mt-0.5 truncate text-[23px] font-medium tracking-[-0.045em] ${
              featured ? "text-red-600" : "text-black"
            }`}
          >
            {value}
          </p>
          <p className="mt-0.5 truncate text-[9px] text-black/38">{helper}</p>
        </div>
      </div>
    </article>
  );
}

function PayrollCard({
  seller,
  summary,
  paymentState,
  payments,
  activeEntry,
  clocking,
  deleting,
  onClockAction,
  onDelete,
  onPayment,
  onDetails,
}) {
  const isConfigured = Boolean(seller.paymentEnabled);
  const initials = String(seller.displayName || seller.email || "V")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <article className="rounded-[22px] border border-black/[0.065] bg-white p-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.025)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(0,0,0,0.055)]">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-[13px] font-medium text-red-600">
          {initials || "V"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[13px] font-medium">
                {seller.displayName}
              </h3>
              <p className="mt-0.5 truncate text-[9px] text-black/42">
                {seller.email}
              </p>
            </div>

            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[8px] ${
                isConfigured
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-orange-50 text-orange-600"
              }`}
            >
              {isConfigured
                ? getPaymentTypeLabel(seller.paymentType)
                : "Sin configurar"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 divide-x divide-black/[0.06] rounded-2xl bg-black/[0.022] px-2 py-3">
        <PayrollMiniMetric
          label="Generado"
          value={formatCurrency(paymentState?.generatedAmount || 0)}
        />
        <PayrollMiniMetric
          label="Pagado"
          value={formatCurrency(paymentState?.paidAmount || 0)}
          success
        />
        <PayrollMiniMetric
          label="Pendiente"
          value={formatCurrency(paymentState?.pendingAmount || 0)}
          warning
        />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <SmallInfo
          label="Horas"
          value={`${summary.workedHours.toFixed(2)} h`}
        />
        <SmallInfo
          label="Jornadas"
          value={String(summary.completedEntries)}
        />
        <SmallInfo
          label="Pagos"
          value={String(payments?.length || 0)}
        />
      </div>

      <div
        className={`mt-3 flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 ${
          activeEntry
            ? "border-emerald-100 bg-emerald-50/70"
            : "border-black/[0.055] bg-black/[0.02]"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                activeEntry
                  ? "bg-emerald-500"
                  : "bg-black/20"
              }`}
            />
            <p
              className={`truncate text-[9px] font-medium ${
                activeEntry
                  ? "text-emerald-700"
                  : "text-black/48"
              }`}
            >
              {activeEntry
                ? "Jornada activa"
                : "Sin jornada activa"}
            </p>
          </div>

          <p className="mt-1 truncate text-[8px] text-black/38">
            {activeEntry
              ? `Entrada ${formatTime(activeEntry.clockIn)}`
              : "Administración puede iniciar la jornada"}
          </p>
        </div>

        <button
          type="button"
          onClick={onClockAction}
          disabled={clocking || !seller.active}
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-[8.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
            activeEntry
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-black text-white hover:bg-black/85"
          }`}
        >
          {activeEntry ? (
            <LogOut size={11} />
          ) : (
            <LogIn size={11} />
          )}

          {clocking
            ? "Procesando..."
            : activeEntry
              ? "Finalizar"
              : "Iniciar"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onPayment}
          disabled={deleting}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-white text-[10px] font-medium transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <HandCoins size={13} />
          Configurar
        </button>

        <button
          type="button"
          onClick={onDetails}
          disabled={deleting}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-black text-[10px] font-medium text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CalendarDays size={13} />
          Ver jornadas
        </button>
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={deleting || clocking}
        className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-white text-[10px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={13} />
        {deleting
          ? "Eliminando trabajador..."
          : "Eliminar trabajador"}
      </button>
    </article>
  );
}

function PayrollMiniMetric({
  label,
  value,
  strong = false,
  success = false,
  warning = false,
}) {
  return (
    <div className="min-w-0 px-2 text-center">
      <p className="truncate text-[8px] text-black/38">{label}</p>
      <p
        className={`mt-1 truncate ${
          success
            ? "text-[11px] font-medium text-emerald-700"
            : warning
              ? "text-[11px] font-medium text-amber-700"
              : strong
                ? "text-[13px] font-medium"
                : "text-[11px] font-medium"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function UsersManagementSection({
  users,
  loading,
  search,
  roleFilter,
  statusFilter,
  onSearch,
  onRoleFilter,
  onStatusFilter,
  onCreate,
  activeEntriesByUser,
  adminClockingUserId,
  deletingUserId,
  onEdit,
  onToggle,
  onPayment,
  onClockAction,
  onDelete,
}) {
  return (
    <section className="mt-5 rounded-[28px] bg-white p-3 shadow-[0_18px_55px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.06]">
      <div className="grid gap-3 lg:grid-cols-[1.45fr_.82fr_.82fr]">
        <label className="relative block">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
          />

          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            className="h-11 w-full rounded-2xl border border-black/[0.08] pl-11 pr-4 text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            placeholder="Buscar por nombre, correo o rol..."
          />
        </label>

        <select
          value={roleFilter}
          onChange={(event) => onRoleFilter(event.target.value)}
          className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none"
        >
          <option value="all">Todos los roles</option>
          <option value="admin">Administradores</option>
          <option value="seller">Vendedores</option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) => onStatusFilter(event.target.value)}
          className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none"
        >
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
        </select>
      </div>

      <div className="mt-4">
        {loading ? (
          <EmptyState text="Cargando usuarios..." />
        ) : users.length === 0 ? (
          <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
            <UserCog size={28} className="mx-auto text-black/30" />

            <p className="mt-3 text-[13px] text-black/50">
              No hay usuarios para mostrar.
            </p>

            <button
              type="button"
              onClick={onCreate}
              className="mt-4 rounded-2xl bg-red-600 px-5 py-3 text-[12px] font-medium text-white"
            >
              Crear usuario
            </button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {users.map((userItem) => (
              <UserCard
                key={userItem.id}
                userItem={userItem}
                activeEntry={
                  activeEntriesByUser?.get(userItem.id) || null
                }
                clocking={
                  adminClockingUserId === userItem.id
                }
                deleting={
                  deletingUserId === userItem.id
                }
                onClockAction={() =>
                  onClockAction(userItem)
                }
                onEdit={() => onEdit(userItem)}
                onToggle={() => onToggle(userItem)}
                onPayment={() => onPayment(userItem)}
                onDelete={() => onDelete(userItem)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function UserCard({
  userItem,
  activeEntry,
  clocking,
  deleting,
  onClockAction,
  onEdit,
  onToggle,
  onPayment,
  onDelete,
}) {
  return (
    <article className="rounded-[24px] bg-white p-3 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(0,0,0,0.07)]">
      <div className="flex items-start gap-3">
        <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[20px] bg-black/[0.025] text-black/55">
          <User size={25} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium">
            {userItem.displayName}
          </h3>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-black/45">
            <Mail size={12} className="shrink-0" />
            <span className="truncate">{userItem.email}</span>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-black/45">
            <Store size={12} className="shrink-0" />
            <span className="truncate">{userItem.storeId}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-black/[0.06] pt-3">
        <span
          className={`rounded-full px-3 py-1.5 text-[10px] ${getRoleClass(
            userItem.role
          )}`}
        >
          {getRoleLabel(userItem.role)}
        </span>

        <span
          className={`rounded-full px-3 py-1.5 text-[10px] ${getStatusClass(
            userItem.active
          )}`}
        >
          {userItem.active ? "Activo" : "Inactivo"}
        </span>
      </div>

      {userItem.role === "seller" && (
        <div className="mt-3 rounded-2xl bg-black/[0.025] p-3">
          <p className="text-[10px] text-black/40">
            Configuración salarial
          </p>

          <p className="mt-1 text-[12px] font-medium">
            {userItem.paymentEnabled
              ? getPaymentTypeLabel(userItem.paymentType)
              : "Sin configurar"}
          </p>

          {userItem.paymentEnabled && (
            <p className="mt-1 text-[13px] font-medium text-red-600">
              {formatCurrency(getActivePaymentRate(userItem))}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-[11px] font-medium transition hover:bg-black/[0.025]"
        >
          <UserCog size={14} />
          Editar
        </button>

        <button
          type="button"
          onClick={onToggle}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border text-[11px] font-medium transition ${
            userItem.active
              ? "border-red-100 text-red-600 hover:bg-red-50"
              : "border-emerald-100 text-emerald-600 hover:bg-emerald-50"
          }`}
        >
          {userItem.active ? (
            <>
              <UserX size={14} />
              Desactivar
            </>
          ) : (
            <>
              <UserCheck size={14} />
              Activar
            </>
          )}
        </button>
      </div>

      {userItem.role === "seller" && (
        <>
          <div
            className={`mt-2 rounded-2xl border p-2.5 ${
              activeEntry
                ? "border-emerald-100 bg-emerald-50/65"
                : "border-black/[0.055] bg-black/[0.02]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      activeEntry
                        ? "bg-emerald-500"
                        : "bg-black/20"
                    }`}
                  />
                  <p
                    className={`truncate text-[9px] font-medium ${
                      activeEntry
                        ? "text-emerald-700"
                        : "text-black/48"
                    }`}
                  >
                    {activeEntry
                      ? "Jornada activa"
                      : "Sin jornada activa"}
                  </p>
                </div>

                <p className="mt-1 truncate text-[8px] text-black/38">
                  {activeEntry
                    ? `Entrada ${formatTime(activeEntry.clockIn)}`
                    : "Sin entrada registrada"}
                </p>
              </div>

              <button
                type="button"
                onClick={onClockAction}
                disabled={clocking || !userItem.active}
                className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-[8.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  activeEntry
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-black hover:bg-black/85"
                }`}
              >
                {activeEntry ? (
                  <LogOut size={11} />
                ) : (
                  <LogIn size={11} />
                )}

                {clocking
                  ? "Procesando..."
                  : activeEntry
                    ? "Finalizar"
                    : "Iniciar"}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onPayment}
            disabled={deleting}
            className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[11px] font-medium text-white shadow-lg shadow-red-600/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <DollarSign size={14} />
            Configurar pago
          </button>

          <button
            type="button"
            onClick={onDelete}
            disabled={deleting || clocking}
            className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white text-[11px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={14} />
            {deleting
              ? "Eliminando trabajador..."
              : "Eliminar trabajador"}
          </button>
        </>
      )}
    </article>
  );
}

function SellerSummaryCard({
  icon: Icon,
  label,
  amount,
  hours,
  tone = "default",
}) {
  return (
    <article className="group flex items-center gap-3 rounded-[22px] border border-black/[0.06] bg-white p-3.5 shadow-[0_14px_40px_rgba(0,0,0,0.03)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(0,0,0,0.055)] sm:p-4">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
          tone === "success"
            ? "bg-emerald-50 text-emerald-600"
            : tone === "warning"
              ? "bg-amber-50 text-amber-600"
              : "bg-red-50 text-red-600"
        }`}
      >
        <Icon size={19} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] text-black/45 sm:text-[11px]">
          {label}
        </p>

        <p className="mt-0.5 truncate text-[20px] font-medium tracking-[-0.045em] sm:text-[22px]">
          {formatCurrency(amount)}
        </p>

        <p className="mt-0.5 truncate text-[9px] text-black/38 sm:text-[10px]">
          {hours.toFixed(2)} h trabajadas
        </p>
      </div>

      <ChevronRight
        size={17}
        className="shrink-0 text-black/28 transition group-hover:translate-x-0.5 group-hover:text-red-600"
      />
    </article>
  );
}
function SellerDetailModal({
  seller,
  entries,
  onClose,
  onCorrect,
}) {
  const [period, setPeriod] = useState(REPORT_PERIODS.MONTH);

  const summary = useMemo(
    () => calculatePayroll(entries, seller, period),
    [entries, seller, period]
  );

  return (
    <ModalShell
      title={`Jornadas de ${seller.displayName}`}
      subtitle="Consulta horas, días, pagos y correcciones."
      onClose={onClose}
      maxWidth="max-w-[980px]"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <DetailMetric
          label="Horas"
          value={`${summary.workedHours.toFixed(2)} h`}
        />

        <DetailMetric
          label="Días"
          value={summary.workedDays}
        />

        <DetailMetric
          label="Jornadas"
          value={summary.completedEntries}
        />

        <DetailMetric
          label="Pago"
          value={formatCurrency(summary.amount)}
          featured
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={`h-10 rounded-2xl text-[11px] font-medium ${
              period === option.value
                ? "bg-red-600 text-white"
                : "border border-black/[0.08]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-4 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
        {summary.entries.length === 0 ? (
          <EmptyState text="No hay jornadas en este período." />
        ) : (
          summary.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onCorrect={() => onCorrect(entry)}
            />
          ))
        )}
      </div>
    </ModalShell>
  );
}

function EntryRow({
  entry,
  showUser = false,
  onCorrect,
}) {
  return (
    <article className="flex flex-col gap-3 rounded-[20px] border border-black/[0.06] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12px] font-medium">
            {formatDateKey(entry.workDate)}
          </p>

          <span
            className={`rounded-full px-2.5 py-1 text-[9px] ${getEntryStatusClass(
              entry.status
            )}`}
          >
            {getEntryStatusLabel(entry.status)}
          </span>
        </div>

        {showUser && (
          <p className="mt-1 text-[11px] text-black/45">
            {entry.userName}
          </p>
        )}

        <p className="mt-1 text-[10px] text-black/45">
          Entrada {formatTime(entry.clockIn)} · Salida{" "}
          {formatTime(entry.clockOut)}
        </p>

        {(entry.clockInByName || entry.clockOutByName) && (
          <p className="mt-1 text-[8px] text-black/35">
            Entrada por{" "}
            {entry.clockInSource === "admin"
              ? `administración · ${entry.clockInByName || "Administrador"}`
              : entry.clockInByName || "Vendedor"}
            {entry.clockOut && (
              <>
                {" "}
                · Salida por{" "}
                {entry.clockOutSource === "admin"
                  ? `administración · ${entry.clockOutByName || "Administrador"}`
                  : entry.clockOutByName || "Vendedor"}
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <div className="text-right">
          <p className="text-[12px] font-medium">
            {formatWorkedTime(entry.workedMinutes)}
          </p>

          <p className="mt-1 text-[11px] text-emerald-600">
            {formatCurrency(entry.calculatedPayment || 0)}
          </p>
        </div>

        {onCorrect && entry.status !== TIME_ENTRY_STATUS.OPEN && (
          <button
            type="button"
            onClick={onCorrect}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] text-black/50 transition hover:bg-red-50 hover:text-red-600"
          >
            <Edit3 size={14} />
          </button>
        )}
      </div>
    </article>
  );
}

function DetailMetric({
  label,
  value,
  featured = false,
}) {
  return (
    <div
      className={`rounded-[20px] p-3 ${
        featured
          ? "bg-red-600 text-white"
          : "bg-black/[0.025]"
      }`}
    >
      <p
        className={`text-[10px] ${
          featured ? "text-white/70" : "text-black/40"
        }`}
      >
        {label}
      </p>

      <p className="mt-1 text-[17px] font-medium">{value}</p>
    </div>
  );
}

function PaymentConfigurationModal({
  userItem,
  form,
  saving,
  onClose,
  onSubmit,
  onChange,
}) {
  const rateField = "hourlyRate";

  return (
    <ModalShell
      title={`Pago de ${userItem.displayName}`}
      subtitle="Define la modalidad, el valor y la jornada esperada."
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <label className="flex items-center justify-between rounded-[20px] bg-black/[0.025] p-4">
          <div>
            <p className="text-[13px] font-medium">
              Activar cálculo de pagos
            </p>

            <p className="mt-1 text-[11px] text-black/45">
              El sistema calculará los acumulados automáticamente.
            </p>
          </div>

          <input
            type="checkbox"
            checked={form.paymentEnabled}
            onChange={(event) =>
              onChange("paymentEnabled", event.target.checked)
            }
            className="h-5 w-5 accent-red-600"
          />
        </label>

        <div className="mt-4 rounded-[20px] border border-red-100 bg-red-50/60 p-4">
          <p className="text-[11px] font-medium text-red-600">Modalidad de pago</p>
          <p className="mt-1 text-[15px] font-medium text-black">Pago por hora</p>
        </div>

        <div className="mt-4 rounded-[22px] border border-red-100 bg-red-50/60 p-4">
          <p className="text-[11px] font-medium text-red-600">
            Valor de la modalidad seleccionada
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <InputField
              label="Valor por hora"
              type="number"
              min="0"
              value={form[rateField]}
              onChange={(value) => onChange(rateField, value)}
              placeholder="0"
            />

            <div className="rounded-2xl bg-white p-3 ring-1 ring-black/[0.06]">
              <p className="text-[10px] text-black/45">
                Vista previa
              </p>

              <p className="mt-1 text-[22px] font-medium tracking-[-0.045em]">
                {formatCurrency(toNumber(form[rateField]))}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <InputField
            label="Minutos esperados por día"
            type="number"
            min="1"
            max="1440"
            value={form.expectedDailyMinutes}
            onChange={(value) =>
              onChange("expectedDailyMinutes", value)
            }
            placeholder="480"
            helper="Ejemplo: 480 minutos equivalen a 8 horas."
          />

          <InputField
            label="Días laborales por mes"
            type="number"
            min="1"
            max="31"
            value={form.workDaysPerMonth}
            onChange={(value) =>
              onChange("workDaysPerMonth", value)
            }
            placeholder="30"
          />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-2xl border border-black/[0.08] text-[13px] font-medium"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={saving}
            className="h-11 rounded-2xl bg-red-600 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar pago"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function UserFormModal({
  editingUser,
  form,
  saving,
  onClose,
  onSubmit,
  onChange,
}) {
  return (
    <ModalShell
      title={editingUser ? "Editar usuario" : "Nuevo usuario"}
      subtitle={
        editingUser
          ? "Actualiza los datos del perfil."
          : "Crea un nuevo acceso al panel."
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <div className="grid gap-3">
          <InputField
            label="Nombre completo"
            value={form.displayName}
            onChange={(value) => onChange("displayName", value)}
            placeholder="Ej: María Pérez"
          />

          <InputField
            label="Correo electrónico"
            type="email"
            value={form.email}
            disabled={Boolean(editingUser)}
            onChange={(value) => onChange("email", value)}
            placeholder="usuario@mastercaps.com"
          />

          {!editingUser && (
            <InputField
              label="Contraseña temporal"
              type="password"
              value={form.password}
              onChange={(value) => onChange("password", value)}
              placeholder="Mínimo 6 caracteres"
            />
          )}

          <label>
            <span className="text-[11px] font-medium text-black/60">
              Rol
            </span>

            <select
              value={form.role}
              onChange={(event) =>
                onChange("role", event.target.value)
              }
              className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none"
            >
              <option value="seller">Vendedor</option>
              <option value="admin">Administrador</option>
            </select>
          </label>

          <div className="rounded-[20px] bg-black/[0.025] p-4">
            <div className="flex items-start gap-3">
              {form.role === "admin" ? (
                <Shield size={20} className="text-red-600" />
              ) : (
                <CheckCircle2
                  size={20}
                  className="text-emerald-600"
                />
              )}

              <div>
                <p className="text-[13px] font-medium">
                  {getRoleLabel(form.role)}
                </p>

                <p className="mt-1 text-[11px] leading-5 text-black/50">
                  {form.role === "admin"
                    ? "Podrá gestionar usuarios, pagos y jornadas."
                    : "Podrá registrar entrada, salida y consultar sus ganancias."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-2xl border border-black/[0.08] text-[13px] font-medium"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={saving}
            className="h-11 rounded-2xl bg-red-600 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving
              ? "Guardando..."
              : editingUser
                ? "Actualizar"
                : "Crear usuario"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function CorrectionModal({
  entry,
  saving,
  onClose,
  onSave,
}) {
  const clockInDate = entry.clockIn?.toDate?.();
  const clockOutDate = entry.clockOut?.toDate?.();

  function toLocalInput(date) {
    if (!date) return "";

    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);

    return local.toISOString().slice(0, 16);
  }

  const [form, setForm] = useState({
    clockIn: toLocalInput(clockInDate),
    clockOut: toLocalInput(clockOutDate),
    notes: "",
  });

  return (
    <ModalShell
      title="Corregir jornada"
      subtitle={`${entry.userName || "Vendedor"} · ${formatDateKey(
        entry.workDate
      )}`}
      onClose={onClose}
    >
      <div className="grid gap-3">
        <InputField
          label="Hora de entrada"
          type="datetime-local"
          value={form.clockIn}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              clockIn: value,
            }))
          }
        />

        <InputField
          label="Hora de salida"
          type="datetime-local"
          value={form.clockOut}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              clockOut: value,
            }))
          }
        />

        <InputField
          label="Motivo de la corrección"
          value={form.notes}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              notes: value,
            }))
          }
          placeholder="Ej: olvidó registrar la salida"
        />
      </div>

      <button
        type="button"
        onClick={() =>
          onSave({
            clockIn: new Date(form.clockIn),
            clockOut: new Date(form.clockOut),
            notes: form.notes,
          })
        }
        disabled={saving}
        className="mt-5 h-11 w-full rounded-2xl bg-red-600 text-[13px] font-medium text-white disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Guardar corrección"}
      </button>
    </ModalShell>
  );
}


function ProfessionalToast({ toast, onClose }) {
  const config = {
    success: {
      icon: CheckCircle2,
      shell: "border-emerald-100 bg-white",
      iconShell: "bg-emerald-50 text-emerald-600",
    },
    error: {
      icon: AlertTriangle,
      shell: "border-red-100 bg-white",
      iconShell: "bg-red-50 text-red-600",
    },
    warning: {
      icon: AlertTriangle,
      shell: "border-amber-100 bg-white",
      iconShell: "bg-amber-50 text-amber-600",
    },
    info: {
      icon: Info,
      shell: "border-black/[0.07] bg-white",
      iconShell: "bg-black/[0.04] text-black/60",
    },
  }[toast?.type || "info"];

  const Icon = config.icon;

  return (
    <div className="fixed right-4 top-4 z-[120] w-[min(92vw,390px)]">
      <div
        className={`flex items-start gap-3 rounded-[20px] border p-3.5 shadow-[0_22px_65px_rgba(0,0,0,0.16)] ${config.shell}`}
      >
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${config.iconShell}`}
        >
          <Icon size={18} />
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[12px] font-medium text-black">
            {toast.title}
          </p>

          {toast.message && (
            <p className="mt-1 text-[10px] leading-4 text-black/48">
              {toast.message}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-black/35 transition hover:bg-black/[0.035] hover:text-black/70"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function ProfessionalConfirm({
  dialog,
  onCancel,
  onConfirm,
}) {
  const destructive = dialog.tone === "danger";
  const success = dialog.tone === "success";

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-[3px]">
      <section className="w-full max-w-[440px] rounded-[28px] border border-white/70 bg-white p-5 shadow-[0_35px_120px_rgba(0,0,0,0.28)]">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-[18px] ${
            destructive
              ? "bg-red-50 text-red-600"
              : success
                ? "bg-emerald-50 text-emerald-600"
                : "bg-black/[0.04] text-black/60"
          }`}
        >
          {destructive ? (
            <AlertTriangle size={21} />
          ) : success ? (
            <CheckCircle2 size={21} />
          ) : (
            <Info size={21} />
          )}
        </div>

        <h3 className="mt-4 text-[19px] font-medium tracking-[-0.035em]">
          {dialog.title}
        </h3>

        <p className="mt-2 text-[11px] leading-5 text-black/48">
          {dialog.message}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-2xl border border-black/[0.08] bg-white text-[11px] font-medium text-black/60 transition hover:bg-black/[0.025]"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className={`h-11 rounded-2xl text-[11px] font-medium text-white shadow-lg transition ${
              destructive
                ? "bg-red-600 shadow-red-600/20 hover:bg-red-700"
                : success
                  ? "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700"
                  : "bg-black shadow-black/10 hover:bg-black/85"
            }`}
          >
            {dialog.confirmLabel || "Confirmar"}
          </button>
        </div>
      </section>
    </div>
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section
        className={`max-h-[92vh] w-full overflow-y-auto rounded-[30px] bg-white p-5 shadow-2xl ${maxWidth}`}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-medium tracking-[-0.035em] text-red-600">
              {title}
            </h2>

            <p className="mt-1 text-[12px] text-black/45">
              {subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.035] transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={18} />
          </button>
        </div>

        {children}
      </section>
    </div>
  );
}

function SmallInfo({ label, value }) {
  return (
    <div className="rounded-2xl bg-black/[0.025] p-3">
      <p className="text-[9px] text-black/40">{label}</p>
      <p className="mt-1 text-[12px] font-medium">{value}</p>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
      <FileClock size={28} className="mx-auto text-black/25" />
      <p className="mt-3 text-[13px] text-black/50">{text}</p>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder = "",
  type = "text",
  disabled = false,
  helper = "",
  min,
  max,
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-black/60">
        {label}
      </span>

      <input
        type={type}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45"
        placeholder={placeholder}
      />

      {helper && (
        <p className="mt-1 text-[10px] leading-4 text-black/40">
          {helper}
        </p>
      )}
    </label>
  );
}