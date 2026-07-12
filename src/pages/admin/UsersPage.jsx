import { useEffect, useMemo, useState } from "react";
import {
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
  dailyRate: "",
  biweeklySalary: "",
  monthlySalary: "",
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
    paymentType:
      userItem?.paymentType || DEFAULT_PAYMENT_CONFIG.paymentType,
    hourlyRate: String(userItem?.hourlyRate || ""),
    dailyRate: String(userItem?.dailyRate || ""),
    biweeklySalary: String(userItem?.biweeklySalary || ""),
    monthlySalary: String(userItem?.monthlySalary || ""),
    expectedDailyMinutes: String(
      userItem?.expectedDailyMinutes ||
        DEFAULT_PAYMENT_CONFIG.expectedDailyMinutes
    ),
    workDaysPerMonth: String(
      userItem?.workDaysPerMonth ||
        DEFAULT_PAYMENT_CONFIG.workDaysPerMonth
    ),
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

function calculatePayroll(entries, userItem, period) {
  const filtered = filterEntriesByPeriod(entries, period);
  const completed = getCompletedEntries(filtered);

  const workedMinutes = completed.reduce(
    (total, entry) => total + toNumber(entry.workedMinutes),
    0
  );

  const workedHours = Math.round((workedMinutes / 60) * 100) / 100;
  const workedDays = countUniqueWorkedDays(completed);
  const paymentType =
    userItem?.paymentType || PAYMENT_TYPES.HOURLY;

  let amount = 0;

  if (paymentType === PAYMENT_TYPES.HOURLY) {
    amount = completed.reduce(
      (total, entry) =>
        total +
        toNumber(
          entry.calculatedPayment,
          (toNumber(entry.workedMinutes) / 60) *
            toNumber(userItem?.hourlyRate)
        ),
      0
    );
  }

  if (paymentType === PAYMENT_TYPES.DAILY) {
    const days = new Map();

    completed.forEach((entry) => {
      const current = days.get(entry.workDate) || {
        minutes: 0,
        rate: toNumber(
          entry.dailyRateSnapshot,
          userItem?.dailyRate
        ),
        expectedMinutes: toNumber(
          entry.expectedDailyMinutesSnapshot,
          userItem?.expectedDailyMinutes || 480
        ),
      };

      current.minutes += toNumber(entry.workedMinutes);
      days.set(entry.workDate, current);
    });

    amount = [...days.values()].reduce((total, day) => {
      const expected = Math.max(day.expectedMinutes, 1);
      const ratio = Math.min(day.minutes / expected, 1);

      return total + ratio * day.rate;
    }, 0);
  }

  if (
    paymentType === PAYMENT_TYPES.BIWEEKLY &&
    completed.length > 0
  ) {
    const salary = toNumber(userItem?.biweeklySalary);
    const expectedMonthlyDays = Math.max(
      toNumber(userItem?.workDaysPerMonth, 30),
      1
    );
    const expectedHalfDays = Math.max(expectedMonthlyDays / 2, 1);

    if (period === REPORT_PERIODS.DAY) {
      amount = salary / expectedHalfDays;
    } else if (period === REPORT_PERIODS.BIWEEKLY) {
      amount = salary;
    } else {
      const halvesWorked = new Set(
        completed.map((entry) => entry.biweeklyPeriod).filter(Boolean)
      ).size;

      amount = salary * Math.max(halvesWorked, 1);
    }
  }

  if (
    paymentType === PAYMENT_TYPES.MONTHLY &&
    completed.length > 0
  ) {
    const salary = toNumber(userItem?.monthlySalary);
    const expectedMonthlyDays = Math.max(
      toNumber(userItem?.workDaysPerMonth, 30),
      1
    );

    if (period === REPORT_PERIODS.DAY) {
      amount = salary / expectedMonthlyDays;
    } else if (period === REPORT_PERIODS.BIWEEKLY) {
      amount = salary / 2;
    } else {
      amount = salary;
    }
  }

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
        alert("No se pudieron escuchar los usuarios.");
      },
      STORE_ID
    );

    const unsubscribeEntries = subscribeStoreTimeEntries({
      storeId: STORE_ID,
      callback: setStoreEntries,
      onError: () =>
        alert("No se pudieron escuchar las jornadas laborales."),
    });

    return () => {
      unsubscribeUsers();
      unsubscribeEntries();
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
        alert("No se pudieron escuchar tus jornadas.");
      },
    });

    const unsubscribeActive = subscribeActiveTimeEntry(
      firebaseUser.uid,
      setActiveEntry,
      () => alert("No se pudo escuchar la jornada activa."),
      STORE_ID
    );

    return () => {
      unsubscribeEntries();
      unsubscribeActive();
    };
  }, [isSeller, firebaseUser?.uid]);

  const sellers = useMemo(
    () => users.filter((userItem) => userItem.role === "seller"),
    [users]
  );

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

        return {
          seller,
          summary: calculatePayroll(entries, seller, period),
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
  }, [sellers, storeEntries, period, search, payrollPaymentFilter, payrollStatusFilter]);

  const adminTotals = useMemo(() => {
    return payrollRows.reduce(
      (totals, row) => {
        totals.sellers += 1;
        totals.workedHours += row.summary.workedHours;
        totals.workedDays += row.summary.workedDays;
        totals.amount += row.summary.amount;
        totals.openEntries += row.summary.openEntries;

        return totals;
      },
      {
        sellers: 0,
        workedHours: 0,
        workedDays: 0,
        amount: 0,
        openEntries: 0,
      }
    );
  }, [payrollRows]);

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
      alert("Escribe el nombre del usuario.");
      return;
    }

    if (!email) {
      alert("Escribe el correo.");
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
          alert("La contraseña debe tener mínimo 6 caracteres.");
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
        alert("Ya existe un usuario con ese correo.");
      } else {
        alert(error.message || "No se pudo guardar el usuario.");
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
      alert("Configuración de pago actualizada.");
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(userItem) {
    const nextStatus = !userItem.active;

    const confirmed = window.confirm(
      nextStatus
        ? `¿Deseas activar a ${userItem.displayName}?`
        : `¿Deseas desactivar a ${userItem.displayName}?`
    );

    if (!confirmed) return;

    try {
      await setUserActiveStatus(
        userItem.id,
        nextStatus,
        getCurrentUserActor()
      );
    } catch (error) {
      console.error(error);
      alert("No se pudo cambiar el estado del usuario.");
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
      alert(error.message || "No se pudo registrar la jornada.");
    } finally {
      setClocking(false);
    }
  }

  if (isSeller) {
    return (
      <SellerAttendanceView
        profile={profile}
        activeEntry={activeEntry}
        entries={sellerEntries}
        summaries={sellerSummaries}
        loading={loading}
        clocking={clocking}
        onClockAction={handleClockAction}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 text-black sm:px-5 lg:px-6">
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
                    {payrollRows.map(({ seller, summary }) => (
                      <PayrollCard
                        key={seller.id}
                        seller={seller}
                        summary={summary}
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
            onEdit={openEditUser}
            onToggle={handleToggleActive}
            onPayment={openPaymentModal}
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
              alert("Jornada corregida correctamente.");
            } catch (error) {
              console.error(error);
              alert(error.message || "No se pudo corregir la jornada.");
            } finally {
              setSaving(false);
            }
          }}
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
    <main className="min-h-screen bg-[#f7f7f8] px-3 pb-20 pt-3 text-black sm:px-5 sm:pb-8 sm:pt-5 lg:px-6">
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
                value={getPaymentTypeLabel(profile?.paymentType)}
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

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SellerSummaryCard
            icon={WalletCards}
            label="Ganado hoy"
            amount={summaries?.day?.amount || 0}
            hours={summaries?.day?.workedHours || 0}
          />

          <SellerSummaryCard
            icon={CalendarDays}
            label="Ganado en la quincena"
            amount={summaries?.biweekly?.amount || 0}
            hours={summaries?.biweekly?.workedHours || 0}
          />

          <SellerSummaryCard
            icon={Banknote}
            label="Ganado en el mes"
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
                <div className="hidden grid-cols-[1.2fr_.7fr_.7fr_.7fr_.8fr] gap-3 bg-black/[0.025] px-4 py-3 text-[10px] font-medium text-black/45 md:grid">
                  <span>Fecha</span>
                  <span>Entrada</span>
                  <span>Salida</span>
                  <span>Tiempo total</span>
                  <span>Pago estimado</span>
                </div>

                {recentEntries.map((entry) => (
                  <SellerHistoryRow key={entry.id} entry={entry} />
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
  return (
    <div className="border-t border-black/[0.055] px-3 py-3 first:border-t-0 sm:px-4">
      <div className="grid gap-3 md:grid-cols-[1.2fr_.7fr_.7fr_.7fr_.8fr] md:items-center">
        <div className="flex items-start justify-between gap-3 md:block">
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

          <p className="text-right text-[12px] font-medium text-emerald-600 md:hidden">
            {formatCurrency(entry.calculatedPayment || 0)}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 md:contents">
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

          <p className="hidden text-[11px] font-medium text-emerald-600 md:block">
            {formatCurrency(entry.calculatedPayment || 0)}
          </p>
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

      <div className="mt-3 grid grid-cols-[repeat(3,1fr)_1.25fr] divide-x divide-black/[0.06] rounded-2xl bg-black/[0.022] px-2 py-3">
        <PayrollMiniMetric
          label="Horas"
          value={`${summary.workedHours.toFixed(2)} h`}
        />
        <PayrollMiniMetric label="Días" value={summary.workedDays} />
        <PayrollMiniMetric label="Jornadas" value={summary.completedEntries} />
        <PayrollMiniMetric
          label="Pago estimado"
          value={formatCurrency(summary.amount)}
          strong
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onPayment}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-white text-[10px] font-medium transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <HandCoins size={13} />
          Configurar
        </button>

        <button
          type="button"
          onClick={onDetails}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-black text-[10px] font-medium text-white transition hover:bg-black/85"
        >
          <CalendarDays size={13} />
          Ver jornadas
        </button>
      </div>
    </article>
  );
}

function PayrollMiniMetric({ label, value, strong = false }) {
  return (
    <div className="min-w-0 px-2 text-center">
      <p className="truncate text-[8px] text-black/38">{label}</p>
      <p
        className={`mt-1 truncate ${
          strong
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
  onEdit,
  onToggle,
  onPayment,
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
                onEdit={() => onEdit(userItem)}
                onToggle={() => onToggle(userItem)}
                onPayment={() => onPayment(userItem)}
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
  onEdit,
  onToggle,
  onPayment,
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
        <button
          type="button"
          onClick={onPayment}
          className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[11px] font-medium text-white shadow-lg shadow-red-600/15"
        >
          <DollarSign size={14} />
          Configurar pago
        </button>
      )}
    </article>
  );
}

function SellerSummaryCard({
  icon: Icon,
  label,
  amount,
  hours,
}) {
  return (
    <article className="group flex items-center gap-3 rounded-[22px] border border-black/[0.06] bg-white p-3.5 shadow-[0_14px_40px_rgba(0,0,0,0.03)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(0,0,0,0.055)] sm:p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
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
  const selectedOption = PAYMENT_TYPE_OPTIONS.find(
    (option) => option.value === form.paymentType
  );

  const rateField = selectedOption?.rateField || "hourlyRate";

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

        <label className="mt-4 block">
          <span className="text-[11px] font-medium text-black/60">
            Modalidad de pago
          </span>

          <select
            value={form.paymentType}
            onChange={(event) =>
              onChange("paymentType", event.target.value)
            }
            className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none focus:border-red-600"
          >
            {PAYMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 rounded-[22px] border border-red-100 bg-red-50/60 p-4">
          <p className="text-[11px] font-medium text-red-600">
            Valor de la modalidad seleccionada
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <InputField
              label={
                form.paymentType === PAYMENT_TYPES.HOURLY
                  ? "Valor por hora"
                  : form.paymentType === PAYMENT_TYPES.DAILY
                    ? "Valor por día"
                    : form.paymentType === PAYMENT_TYPES.BIWEEKLY
                      ? "Valor quincenal"
                      : "Valor mensual"
              }
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