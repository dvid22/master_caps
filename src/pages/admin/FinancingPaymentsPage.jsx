import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Filter,
  Search,
  ShieldCheck,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";

import {
  ADDI_PAYMENT_METHOD,
  SISTECREDITO_PAYMENT_METHOD,
  SETTLEMENT_STATUS_SETTLED,
  settleDeferredSale,
  subscribeDeferredSales,
} from "../../services/sales.service";

import { STORE_ID } from "../../services/categories.service";
import { getCurrentUserActor } from "../../services/auth.service";
import { formatCurrency } from "../../utils/money";

const PAGE_SIZE = 10;

const PROVIDERS = [
  { value: "all", label: "Todos" },
  { value: ADDI_PAYMENT_METHOD, label: "Addi" },
  { value: SISTECREDITO_PAYMENT_METHOD, label: "Sistecrédito" },
];

function getDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, fallback = "Sin fecha") {
  const date = getDate(value);
  if (!date) return fallback;

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateInput(value) {
  const date = getDate(value) || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getProvider(sale) {
  if (sale?.settlementProvider) {
    return sale.settlementProvider;
  }

  if (sale?.paymentMethod === ADDI_PAYMENT_METHOD) {
    return ADDI_PAYMENT_METHOD;
  }

  if (sale?.paymentMethod === SISTECREDITO_PAYMENT_METHOD) {
    return SISTECREDITO_PAYMENT_METHOD;
  }

  const payment = Array.isArray(sale?.payments)
    ? sale.payments.find((item) =>
        [ADDI_PAYMENT_METHOD, SISTECREDITO_PAYMENT_METHOD].includes(
          String(item?.method || "").trim()
        )
      )
    : null;

  return payment?.method || "";
}

function getProviderLabel(provider) {
  if (provider === ADDI_PAYMENT_METHOD) return "Addi";
  if (provider === SISTECREDITO_PAYMENT_METHOD) return "Sistecrédito";
  return "Financiación";
}

function isSettled(sale) {
  if (sale?.settlementStatus === SETTLEMENT_STATUS_SETTLED) {
    return true;
  }

  const provider = getProvider(sale);

  if (provider === ADDI_PAYMENT_METHOD) {
    return sale?.addiStatus === "settled";
  }

  if (provider === SISTECREDITO_PAYMENT_METHOD) {
    return sale?.sistecreditoStatus === "settled";
  }

  return false;
}

function getSettlementDate(sale) {
  return (
    sale?.settlementSettledAt ||
    sale?.addiSettledAt ||
    sale?.sistecreditoSettledAt ||
    null
  );
}

function getSettlementReference(sale) {
  return (
    sale?.settlementReference ||
    sale?.addiReference ||
    sale?.sistecreditoReference ||
    ""
  );
}

function getDaysSince(value) {
  const date = getDate(value);
  if (!date) return 0;

  return Math.max(
    Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)),
    0
  );
}

function getSettlementDays(sale) {
  const createdAt = getDate(sale.createdAt);
  const settledAt = getDate(getSettlementDate(sale));

  if (!createdAt || !settledAt) return null;

  return Math.max(
    Math.round(
      (settledAt.getTime() - createdAt.getTime()) /
        (1000 * 60 * 60 * 24)
    ),
    0
  );
}

function getExpectedAmount(sale) {
  if (sale?.settlementExpectedAmount !== undefined) {
    return Number(sale.settlementExpectedAmount || 0);
  }

  const provider = getProvider(sale);

  if (provider === ADDI_PAYMENT_METHOD && sale?.addiExpectedAmount !== undefined) {
    return Number(sale.addiExpectedAmount || 0);
  }

  if (
    provider === SISTECREDITO_PAYMENT_METHOD &&
    sale?.sistecreditoExpectedAmount !== undefined
  ) {
    return Number(sale.sistecreditoExpectedAmount || 0);
  }

  const deferredPayment = Array.isArray(sale?.payments)
    ? sale.payments.find((payment) => payment.method === provider)
    : null;

  return Number(deferredPayment?.amount ?? sale?.total ?? 0);
}

function getSettledAmount(sale) {
  if (sale?.settlementSettledAmount !== undefined) {
    return Number(sale.settlementSettledAmount || 0);
  }

  const provider = getProvider(sale);

  if (provider === ADDI_PAYMENT_METHOD) {
    return Number(sale?.addiSettledAmount || 0);
  }

  if (provider === SISTECREDITO_PAYMENT_METHOD) {
    return Number(sale?.sistecreditoSettledAmount || 0);
  }

  return 0;
}

function getPendingState(sale) {
  if (isSettled(sale)) {
    return {
      id: "settled",
      label: "Recibido",
      helper: getSettlementDate(sale)
        ? `Recibido ${formatDate(getSettlementDate(sale))}`
        : "Desembolso confirmado",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  const days = getDaysSince(sale.createdAt);

  if (days >= 15) {
    return {
      id: "overdue",
      label: "Atrasado",
      helper: `${days} días en espera`,
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  if (days >= 8) {
    return {
      id: "review",
      label: "Revisar",
      helper: `${days} días en espera`,
      className: "border-orange-200 bg-orange-50 text-orange-700",
    };
  }

  return {
    id: "pending",
    label: "Pendiente",
    helper: `${days} día(s) en espera`,
    className: "border-amber-200 bg-amber-50 text-amber-700",
  };
}

export default function FinancingPaymentsPage() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [selectedSale, setSelectedSale] = useState(null);
  const [settlementForm, setSettlementForm] = useState({
    amount: "",
    date: "",
    reference: "",
    notes: "",
  });

  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const unsubscribe = subscribeDeferredSales(
      (data) => {
        setSales(Array.isArray(data) ? data : []);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoading(false);
        pushNotification(
          "error",
          "No se pudieron cargar las financiaciones."
        );
      },
      STORE_ID
    );

    return () => unsubscribe();
  }, []);

  function pushNotification(type, message) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setNotifications((current) => [
      ...current,
      { id, type, message },
    ]);

    window.setTimeout(() => {
      setNotifications((current) =>
        current.filter((item) => item.id !== id)
      );
    }, 4200);
  }

  function closeNotification(id) {
    setNotifications((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  const stats = useMemo(() => {
    const pendingSales = sales.filter((sale) => !isSettled(sale));
    const settledSales = sales.filter((sale) => isSettled(sale));

    const pendingAmount = pendingSales.reduce(
      (total, sale) => total + getExpectedAmount(sale),
      0
    );

    const settledAmount = settledSales.reduce(
      (total, sale) => total + (getSettledAmount(sale) || getExpectedAmount(sale)),
      0
    );

    const settlementDays = settledSales
      .map(getSettlementDays)
      .filter((value) => Number.isFinite(value));

    const averageDays =
      settlementDays.length > 0
        ? settlementDays.reduce((sum, value) => sum + value, 0) /
          settlementDays.length
        : 0;

    const pendingByProvider = {
      addi: pendingSales
        .filter((sale) => getProvider(sale) === ADDI_PAYMENT_METHOD)
        .reduce((total, sale) => total + getExpectedAmount(sale), 0),
      sistecredito: pendingSales
        .filter((sale) => getProvider(sale) === SISTECREDITO_PAYMENT_METHOD)
        .reduce((total, sale) => total + getExpectedAmount(sale), 0),
    };

    return {
      pendingCount: pendingSales.length,
      pendingAmount,
      settledAmount,
      averageDays,
      pendingByProvider,
    };
  }, [sales]);

  const filteredSales = useMemo(() => {
    const cleanSearch = normalizeText(search);

    return sales.filter((sale) => {
      const state = getPendingState(sale);
      const provider = getProvider(sale);

      const haystack = normalizeText(
        [
          sale.saleNumber,
          sale.customerName,
          sale.customerDocument,
          sale.customerPhone,
          sale.sellerName,
          getProviderLabel(provider),
          getSettlementReference(sale),
        ].join(" ")
      );

      const matchesSearch =
        !cleanSearch || haystack.includes(cleanSearch);

      const matchesProvider =
        providerFilter === "all" || provider === providerFilter;

      const matchesStatus =
        statusFilter === "all" || state.id === statusFilter;

      return matchesSearch && matchesProvider && matchesStatus;
    });
  }, [sales, search, providerFilter, statusFilter]);

  const totalPages = Math.max(
    Math.ceil(filteredSales.length / PAGE_SIZE),
    1
  );

  const paginatedSales = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;

    return filteredSales.slice(start, start + PAGE_SIZE);
  }, [filteredSales, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [search, providerFilter, statusFilter]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function openSettlementModal(sale) {
    const expectedAmount = getExpectedAmount(sale);

    setSelectedSale(sale);
    setSettlementForm({
      amount: String(expectedAmount),
      date: formatDateInput(new Date()),
      reference: "",
      notes: "",
    });
  }

  function closeSettlementModal() {
    if (saving) return;

    setSelectedSale(null);
    setSettlementForm({
      amount: "",
      date: "",
      reference: "",
      notes: "",
    });
  }

  async function handleSettle(event) {
    event.preventDefault();

    if (!selectedSale) return;

    const amount = Number(settlementForm.amount || 0);
    const provider = getProvider(selectedSale);

    if (!Number.isFinite(amount) || amount <= 0) {
      pushNotification("warning", "Escribe un valor recibido válido.");
      return;
    }

    if (!settlementForm.date) {
      pushNotification("warning", "Selecciona la fecha de recepción.");
      return;
    }

    try {
      setSaving(true);

      await settleDeferredSale({
        saleId: selectedSale.id,
        provider,
        settledAmount: amount,
        settledAt: settlementForm.date,
        reference: settlementForm.reference,
        notes: settlementForm.notes,
        actor: getCurrentUserActor(),
      });

      pushNotification(
        "success",
        `${selectedSale.saleNumber || "Venta"} · ${getProviderLabel(
          provider
        )} marcado como recibido.`
      );

      setSelectedSale(null);
      setSettlementForm({
        amount: "",
        date: "",
        reference: "",
        notes: "",
      });
    } catch (error) {
      console.error(error);
      pushNotification(
        "error",
        error?.message || "No se pudo confirmar el desembolso."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 text-black sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1680px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-red-600">
              Conciliación
            </p>

            <h1 className="mt-1 text-[28px] font-medium tracking-[-0.045em] sm:text-[32px]">
              Financiaciones
            </h1>

            <p className="mt-1 text-[12px] text-black/46">
              Controla los desembolsos pendientes de Addi y Sistecrédito y confirma cuándo entra realmente el dinero.
            </p>
          </div>

          <div className="inline-flex h-9 items-center gap-2 self-start rounded-xl border border-black/[0.06] bg-white px-3 text-[10px] text-black/48 shadow-sm lg:self-auto">
            <ShieldCheck size={14} className="text-red-600" />
            El dinero entra a caja solo cuando confirmas el desembolso
          </div>
        </header>

        <section className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Clock3}
            label="Pendiente por recibir"
            value={formatCurrency(stats.pendingAmount)}
            helper={`${stats.pendingCount} operación(es)`}
            compactValue
          />

          <StatCard
            icon={WalletCards}
            label="Addi pendiente"
            value={formatCurrency(stats.pendingByProvider.addi)}
            helper="Desembolsos aún no recibidos"
            compactValue
          />

          <StatCard
            icon={Banknote}
            label="Sistecrédito pendiente"
            value={formatCurrency(stats.pendingByProvider.sistecredito)}
            helper="Desembolsos aún no recibidos"
            compactValue
          />

          <StatCard
            icon={TrendingUp}
            label="Recibido confirmado"
            value={formatCurrency(stats.settledAmount)}
            helper={`Promedio ${stats.averageDays.toFixed(1)} días`}
            compactValue
          />
        </section>

        <section className="mt-4 overflow-hidden rounded-[24px] border border-black/[0.06] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.04)]">
          <div className="border-b border-black/[0.06] p-3 sm:p-4">
            <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_210px_190px]">
              <label className="relative block">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35"
                />

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-xl border border-black/[0.08] bg-white pl-10 pr-3 text-[11px] outline-none transition placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  placeholder="Buscar venta, cliente, cédula o referencia..."
                />
              </label>

              <label className="relative">
                <WalletCards
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35"
                />

                <select
                  value={providerFilter}
                  onChange={(event) => setProviderFilter(event.target.value)}
                  className="h-10 w-full appearance-none rounded-xl border border-black/[0.08] bg-white pl-8 pr-3 text-[11px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                >
                  {PROVIDERS.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="relative">
                <Filter
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35"
                />

                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-10 w-full appearance-none rounded-xl border border-black/[0.08] bg-white pl-8 pr-3 text-[11px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                >
                  <option value="all">Todos los estados</option>
                  <option value="pending">Pendientes</option>
                  <option value="review">Revisar</option>
                  <option value="overdue">Atrasados</option>
                  <option value="settled">Recibidos</option>
                </select>
              </label>
            </div>
          </div>

          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06] bg-black/[0.015] text-left">
                    <TableHead>Venta</TableHead>
                    <TableHead>Financiador</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Fecha venta</TableHead>
                    <TableHead>Valor esperado</TableHead>
                    <TableHead>Espera</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead align="right">Acción</TableHead>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-[11px] text-black/40">
                        Cargando financiaciones...
                      </td>
                    </tr>
                  ) : paginatedSales.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-[11px] text-black/40">
                        No hay operaciones para mostrar.
                      </td>
                    </tr>
                  ) : (
                    paginatedSales.map((sale) => (
                      <FinanceTableRow
                        key={sale.id}
                        sale={sale}
                        onSettle={() => openSettlementModal(sale)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-2.5 p-3 md:hidden">
            {loading ? (
              <div className="rounded-2xl bg-black/[0.025] p-8 text-center text-[11px] text-black/40">
                Cargando financiaciones...
              </div>
            ) : paginatedSales.length === 0 ? (
              <div className="rounded-2xl bg-black/[0.025] p-8 text-center text-[11px] text-black/40">
                No hay operaciones para mostrar.
              </div>
            ) : (
              paginatedSales.map((sale) => (
                <FinanceMobileCard
                  key={sale.id}
                  sale={sale}
                  onSettle={() => openSettlementModal(sale)}
                />
              ))
            )}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={filteredSales.length}
            onPageChange={setPage}
          />
        </section>
      </section>

      {selectedSale && (
        <SettlementModal
          sale={selectedSale}
          form={settlementForm}
          saving={saving}
          onChange={(field, value) =>
            setSettlementForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onClose={closeSettlementModal}
          onSubmit={handleSettle}
        />
      )}

      <NotificationStack
        notifications={notifications}
        onClose={closeNotification}
      />
    </main>
  );
}

function StatCard({ icon: Icon, label, value, helper, compactValue = false }) {
  return (
    <article className="rounded-[18px] border border-black/[0.055] bg-white px-3.5 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.028)]">
      <div className="flex min-h-[76px] items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[8px] font-medium uppercase tracking-[0.11em] text-black/38">
            {label}
          </p>
          <p className={`mt-1.5 truncate font-medium leading-none tracking-[-0.04em] ${compactValue ? "text-[16px]" : "text-[22px]"}`}>
            {value}
          </p>
          <p className="mt-1.5 truncate text-[8.5px] leading-none text-black/38">
            {helper}
          </p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon size={15} strokeWidth={1.8} />
        </div>
      </div>
    </article>
  );
}

function TableHead({ children, align = "left" }) {
  return (
    <th className={`px-4 py-3 text-[8px] font-medium uppercase tracking-[0.11em] text-black/38 ${align === "right" ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

function ProviderBadge({ provider }) {
  const label = getProviderLabel(provider);
  const className =
    provider === ADDI_PAYMENT_METHOD
      ? "border-violet-200 bg-violet-50 text-violet-700"
      : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[8.5px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function FinanceTableRow({ sale, onSettle }) {
  const state = getPendingState(sale);
  const provider = getProvider(sale);
  const expected = getExpectedAmount(sale);
  const settled = isSettled(sale);

  return (
    <tr className="border-b border-black/[0.055] last:border-0 hover:bg-black/[0.012]">
      <td className="px-4 py-3">
        <p className="text-[11px] font-medium">{sale.saleNumber || "Venta"}</p>
        <p className="mt-0.5 text-[8.5px] text-black/38">{sale.sellerName || "Sin vendedor"}</p>
      </td>
      <td className="px-4 py-3"><ProviderBadge provider={provider} /></td>
      <td className="px-4 py-3">
        <p className="max-w-[190px] truncate text-[10px] font-medium">{sale.customerName || "Venta sin cliente"}</p>
        <p className="mt-0.5 text-[8.5px] text-black/38">{sale.customerDocument || "Sin cédula"}</p>
      </td>
      <td className="px-4 py-3 text-[9.5px] text-black/55">{formatDate(sale.createdAt)}</td>
      <td className="px-4 py-3 text-[10.5px] font-medium">{formatCurrency(expected)}</td>
      <td className="px-4 py-3">
        <p className="text-[9.5px] font-medium">
          {settled ? `${getSettlementDays(sale) ?? 0} día(s)` : `${getDaysSince(sale.createdAt)} día(s)`}
        </p>
        <p className="mt-0.5 text-[8px] text-black/38">{settled ? "Tiempo final" : "Desde la venta"}</p>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[8.5px] font-medium ${state.className}`}>
          {state.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {settled ? (
          <div>
            <p className="text-[9px] font-medium text-emerald-700">{formatCurrency(getSettledAmount(sale) || expected)}</p>
            <p className="mt-0.5 text-[8px] text-black/36">{getSettlementReference(sale) || "Sin referencia"}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSettle}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 text-[9px] font-medium text-white shadow-sm shadow-red-600/15 transition hover:bg-red-700"
          >
            <CheckCircle2 size={12} />
            Confirmar recibido
          </button>
        )}
      </td>
    </tr>
  );
}

function FinanceMobileCard({ sale, onSettle }) {
  const state = getPendingState(sale);
  const provider = getProvider(sale);
  const expected = getExpectedAmount(sale);
  const settled = isSettled(sale);

  return (
    <article className="rounded-[18px] border border-black/[0.06] bg-white p-3 shadow-[0_10px_28px_rgba(0,0,0,0.025)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ProviderBadge provider={provider} />
          <p className="mt-2 truncate text-[12px] font-medium">{sale.customerName || "Venta sin cliente"}</p>
          <p className="mt-0.5 text-[9px] text-black/40">{sale.saleNumber || "Venta"} · {sale.customerDocument || "Sin cédula"}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-medium ${state.className}`}>{state.label}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniBox label="Fecha" value={formatDate(sale.createdAt)} />
        <MiniBox label="Valor" value={formatCurrency(expected)} />
        <MiniBox
          label={settled ? "Tiempo" : "Espera"}
          value={settled ? `${getSettlementDays(sale) ?? 0} d` : `${getDaysSince(sale.createdAt)} d`}
        />
      </div>

      {settled ? (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2">
          <p className="text-[8px] text-emerald-700/70">Valor recibido</p>
          <p className="mt-0.5 text-[11px] font-medium text-emerald-700">{formatCurrency(getSettledAmount(sale) || expected)}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSettle}
          className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-[10px] font-medium text-white shadow-sm shadow-red-600/15"
        >
          <CheckCircle2 size={13} />
          Confirmar dinero recibido
        </button>
      )}
    </article>
  );
}

function MiniBox({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-black/[0.025] px-2.5 py-2">
      <p className="text-[7.5px] text-black/36">{label}</p>
      <p className="mt-0.5 truncate text-[9px] font-medium">{value}</p>
    </div>
  );
}

function SettlementModal({ sale, form, saving, onChange, onClose, onSubmit }) {
  const expectedAmount = getExpectedAmount(sale);
  const provider = getProvider(sale);
  const providerLabel = getProviderLabel(provider);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[500px] overflow-hidden rounded-[26px] bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-red-600">Conciliación · {providerLabel}</p>
            <h2 className="mt-1 text-[20px] font-medium tracking-[-0.035em]">Confirmar desembolso</h2>
            <p className="mt-1 text-[10px] text-black/42">{sale.saleNumber || "Venta"} · {sale.customerName || "Sin cliente"}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035] disabled:opacity-40">
            <X size={17} />
          </button>
        </header>

        <form onSubmit={onSubmit} className="p-5">
          <div className="grid grid-cols-2 gap-2.5">
            <SummaryBox label="Valor esperado" value={formatCurrency(expectedAmount)} />
            <SummaryBox label="Fecha de venta" value={formatDate(sale.createdAt)} />
          </div>

          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-[9px] leading-4 text-blue-800">
            Al confirmar, este dinero quedará reconocido en la caja de la fecha seleccionada como ingreso bancario proveniente de {providerLabel}.
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Valor recibido" type="number" min="1" value={form.amount} onChange={(value) => onChange("amount", value)} />
            <Field label="Fecha de recepción" type="date" value={form.date} onChange={(value) => onChange("date", value)} />
          </div>

          <div className="mt-3">
            <Field label="Referencia" value={form.reference} onChange={(value) => onChange("reference", value)} placeholder="Ej: desembolso, lote o referencia bancaria" />
          </div>

          <label className="mt-3 block">
            <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-black/50">Observaciones</span>
            <textarea
              value={form.notes}
              onChange={(event) => onChange("notes", event.target.value)}
              rows={2}
              className="mt-1.5 w-full resize-none rounded-xl border border-black/[0.08] px-3 py-2.5 text-[11px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="Opcional"
            />
          </label>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-xl border border-black/[0.08] text-[10px] font-medium disabled:opacity-40">Cancelar</button>
            <button type="submit" disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 text-[10px] font-medium text-white shadow-sm shadow-red-600/15 disabled:bg-black/20 disabled:shadow-none">
              <CheckCircle2 size={13} />
              {saving ? "Confirmando..." : "Confirmar recibido"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SummaryBox({ label, value }) {
  return (
    <div className="rounded-xl bg-black/[0.025] px-3 py-2.5">
      <p className="text-[8px] text-black/38">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-medium">{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", min }) {
  return (
    <label className="block">
      <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-black/50">{label}</span>
      <input
        type={type}
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
      />
    </label>
  );
}

function Pagination({ page, totalPages, totalItems, onPageChange }) {
  const start = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);

  return (
    <footer className="flex flex-col gap-2.5 border-t border-black/[0.06] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <p className="text-[9px] text-black/40">Mostrando {start}-{end} de {totalItems} operación(es)</p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange((current) => Math.max(current - 1, 1))} className="h-8 min-w-8 rounded-lg border border-black/[0.08] px-2 text-[10px] disabled:opacity-30">‹</button>
        <span className="min-w-[62px] text-center text-[9px] text-black/48">{page} / {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange((current) => Math.min(current + 1, totalPages))} className="h-8 min-w-8 rounded-lg border border-black/[0.08] px-2 text-[10px] disabled:opacity-30">›</button>
      </div>
    </footer>
  );
}

function NotificationStack({ notifications, onClose }) {
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[150] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2 sm:right-5 sm:top-5">
      {notifications.map((notification) => {
        const styles = {
          success: "border-emerald-200 bg-white text-emerald-700",
          error: "border-red-200 bg-white text-red-700",
          warning: "border-amber-200 bg-white text-amber-700",
          info: "border-black/[0.08] bg-white text-black/65",
        };

        const Icon =
          notification.type === "success"
            ? CheckCircle2
            : notification.type === "warning"
              ? Clock3
              : notification.type === "error"
                ? ShieldCheck
                : CalendarDays;

        return (
          <div key={notification.id} className={`pointer-events-auto flex items-start gap-3 rounded-[16px] border px-3.5 py-3 shadow-[0_14px_38px_rgba(0,0,0,0.10)] ${styles[notification.type] || styles.info}`}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-current/5"><Icon size={14} /></div>
            <p className="min-w-0 flex-1 pt-0.5 text-[10px] leading-4 text-black/68">{notification.message}</p>
            <button type="button" onClick={() => onClose(notification.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-black/35 hover:bg-black/[0.04] hover:text-black"><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}
