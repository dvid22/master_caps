import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  FileClock,
  HandCoins,
  Minus,
  PackageSearch,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";

import {
  addReservationGroupPayment,
  cancelReservationGroup,
  completeReservationGroupSale,
  createManualReservation,
  expireOverdueReservations,
  markReservationsAsRead,
  subscribeReservationGroups,
  subscribeReservations,
  subscribeReservationSettings,
  updateReservationSettings,
} from "../../services/reservations.service";

import {
  getProductCoverImage,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";

import {
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";
import { formatCurrency } from "../../utils/money";
import { getCurrentUserActor } from "../../services/auth.service";

const emptySaleForm = {
  paymentMethod: "efectivo",
  notes: "",
};

const emptyPaymentForm = {
  amount: "",
  paymentMethod: "efectivo",
  notes: "",
};

function formatDate(value) {
  const date = value?.toDate?.();
  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getDaysLeft(value) {
  const date = value?.toDate?.();
  if (!date) return null;

  return Math.ceil(
    (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
}

function getStatusLabel(status) {
  return (
    {
      active: "Activo",
      completed: "Vendido",
      expired: "Vencido",
      cancelled: "Liberado",
    }[status] || "Sin estado"
  );
}

function getStatusClass(status) {
  return (
    {
      active: "bg-emerald-50 text-emerald-600",
      completed: "bg-emerald-50 text-emerald-600",
      expired: "bg-red-50 text-red-600",
      cancelled: "bg-black/[0.04] text-black/55",
    }[status] || "bg-black/[0.04] text-black/55"
  );
}

function getDueText(group) {
  const daysLeft = getDaysLeft(group.expiresAt);

  if (group.status !== "active") {
    if (group.status === "completed") return "Completado";
    if (group.status === "cancelled") return "Liberado";
    if (group.status === "expired") return "Vencido";
    return "Cerrado";
  }

  if (daysLeft === null) return "Sin vencimiento";
  if (daysLeft < 0) return `${Math.abs(daysLeft)} día(s) vencido`;
  if (daysLeft === 0) return "Vence hoy";
  if (daysLeft === 1) return "1 día restante";

  return `${daysLeft} días restantes`;
}

function getTimestampMilliseconds(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const date = value?.toDate?.() || new Date(value);
  return Number.isNaN(date?.getTime?.()) ? 0 : date.getTime();
}

function getReservationGroupKey(reservation) {
  const explicitGroupId = String(
    reservation?.reservationGroupId || ""
  ).trim();

  if (explicitGroupId) return explicitGroupId;

  /*
   * Compatibilidad con registros creados antes de reservationGroups.
   * Solo se agrupan juntos cuando comparten cliente, sesión y momento.
   */
  const visitorId = String(
    reservation?.clientVisitorId || ""
  ).trim();
  const sessionId = String(
    reservation?.clientSessionId || ""
  ).trim();
  const customerDocument = String(
    reservation?.customerDocument || ""
  ).trim();
  const groupNumber = String(
    reservation?.reservationGroupNumber || ""
  ).trim();

  if (groupNumber) return `number:${groupNumber}`;

  if (visitorId && sessionId) {
    return `visitor:${visitorId}:session:${sessionId}`;
  }

  const createdBucket = Math.floor(
    getTimestampMilliseconds(
      reservation?.reservedAt || reservation?.createdAt
    ) / 60000
  );

  return [
    "legacy",
    customerDocument || reservation?.customerPhone || "sin-cliente",
    createdBucket,
  ].join(":");
}

function buildFallbackGroup(groupKey, lines) {
  const sortedLines = [...lines].sort(
    (a, b) =>
      Number(a.lineNumber || 0) - Number(b.lineNumber || 0)
  );
  const first = sortedLines[0] || {};

  const subtotal = sortedLines.reduce(
    (total, line) =>
      total +
      Number(
        line.subtotal ??
          Number(line.unitPrice || 0) *
            Number(line.quantity || 1)
      ),
    0
  );

  const totalItems = sortedLines.reduce(
    (total, line) => total + Number(line.quantity || 1),
    0
  );

  const amountPaid = Math.max(
    ...sortedLines.map((line) => Number(line.amountPaid || 0)),
    0
  );

  return {
    id: String(first.reservationGroupId || groupKey),
    groupNumber:
      first.reservationGroupNumber ||
      `AP-${String(first.id || groupKey)
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 8)
        .toUpperCase()}`,
    customerName: first.customerName,
    customerDocument: first.customerDocument,
    customerPhone: first.customerPhone,
    status: first.status,
    source: first.source || "legacy",
    clientVisitorId: first.clientVisitorId || "",
    clientSessionId: first.clientSessionId || "",
    reservationDays: first.reservationDays || 7,
    subtotal,
    amountPaid,
    balanceDue: Math.max(subtotal - amountPaid, 0),
    totalItems,
    totalLines: sortedLines.length,
    expiresAt: first.expiresAt,
    reservedAt: first.reservedAt,
    createdAt: first.createdAt,
    paymentHistory: first.paymentHistory || [],
    reservationIds: sortedLines.map((line) => line.id),
    lines: sortedLines,
    legacy: !first.reservationGroupId,
    temporaryGroup: Boolean(first.reservationGroupId),
  };
}

function buildGroups(groups, reservations) {
  const linesByGroup = new Map();

  reservations.forEach((reservation) => {
    const key = getReservationGroupKey(reservation);

    if (!linesByGroup.has(key)) {
      linesByGroup.set(key, []);
    }

    linesByGroup.get(key).push(reservation);
  });

  const normalized = [];
  const consumedKeys = new Set();

  groups.forEach((group) => {
    const directLines =
      linesByGroup.get(group.id) ||
      linesByGroup.get(`number:${group.groupNumber}`) ||
      [];

    consumedKeys.add(group.id);

    if (group.groupNumber) {
      consumedKeys.add(`number:${group.groupNumber}`);
    }

    normalized.push({
      ...group,
      totalLines:
        Number(group.totalLines || 0) || directLines.length,
      totalItems:
        Number(group.totalItems || 0) ||
        directLines.reduce(
          (total, line) =>
            total + Number(line.quantity || 1),
          0
        ),
      lines: [...directLines].sort(
        (a, b) =>
          Number(a.lineNumber || 0) -
          Number(b.lineNumber || 0)
      ),
      legacy: false,
      temporaryGroup: false,
    });
  });

  /*
   * Si el snapshot de las líneas llega antes que el snapshot del grupo,
   * se crea UNA sola tarjeta temporal por reservationGroupId.
   * Antes se creaba una tarjeta por cada línea, que era el error visual.
   */
  linesByGroup.forEach((lines, groupKey) => {
    if (consumedKeys.has(groupKey)) return;

    normalized.push(buildFallbackGroup(groupKey, lines));
  });

  return normalized.sort((a, b) => {
    const dateA = getTimestampMilliseconds(
      a.reservedAt || a.createdAt
    );
    const dateB = getTimestampMilliseconds(
      b.reservedAt || b.createdAt
    );

    return dateB - dateA;
  });
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState([]);
  const [reservationGroups, setReservationGroups] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState({
    defaultReservationDays: 7,
  });

  const [selectedGroup, setSelectedGroup] = useState(null);
  const [detailGroup, setDetailGroup] = useState(null);
  const [saleForm, setSaleForm] = useState(emptySaleForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);

  const [manualOpen, setManualOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [checkingExpired, setCheckingExpired] = useState(false);

  const reservationsPerPage = 8;

  useEffect(() => {
    setLoading(true);

    const unsubscribeReservations = subscribeReservations(
      setReservations,
      () => {
        setLoading(false);
        alert("No se pudieron escuchar los apartados.");
      },
      STORE_ID
    );

    const unsubscribeGroups = subscribeReservationGroups(
      (data) => {
        setReservationGroups(data);
        setLoading(false);
      },
      () => setLoading(false),
      STORE_ID
    );

    const unsubscribeProducts = subscribeProducts(
      setProducts,
      () => alert("No se pudieron cargar los productos."),
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      setCategories,
      () => alert("No se pudieron cargar las categorías."),
      STORE_ID
    );

    const unsubscribeSettings = subscribeReservationSettings(
      setSettings,
      () => {},
      STORE_ID
    );

    return () => {
      unsubscribeReservations();
      unsubscribeGroups();
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeSettings();
    };
  }, []);

  const groups = useMemo(
    () => buildGroups(reservationGroups, reservations),
    [reservationGroups, reservations]
  );

  useEffect(() => {
    const hasOverdue = groups.some((group) => {
      if (group.status !== "active") return false;
      const expiresAt = group.expiresAt?.toDate?.();
      return expiresAt && expiresAt < new Date();
    });

    if (!hasOverdue || checkingExpired) return;

    async function autoExpire() {
      try {
        setCheckingExpired(true);
        await expireOverdueReservations(STORE_ID);
      } catch (error) {
        console.error(error);
      } finally {
        setCheckingExpired(false);
      }
    }

    autoExpire();
  }, [groups, checkingExpired]);

  const unreadReservations = useMemo(
    () =>
      reservations.filter(
        (reservation) =>
          reservation.status === "active" &&
          reservation.notificationRead !== true
      ),
    [reservations]
  );

  const filteredGroups = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return groups.filter((group) => {
      const daysLeft = getDaysLeft(group.expiresAt);

      const lineMatches = group.lines.some((line) =>
        [
          line.productName,
          line.productCode,
          line.productSize,
          line.categoryName,
        ].some((value) =>
          String(value || "").toLowerCase().includes(cleanSearch)
        )
      );

      const matchesSearch =
        !cleanSearch ||
        lineMatches ||
        [
          group.groupNumber,
          group.customerName,
          group.customerDocument,
          group.customerPhone,
        ].some((value) =>
          String(value || "").toLowerCase().includes(cleanSearch)
        );

      const matchesStatus =
        statusFilter === "all" || group.status === statusFilter;

      const matchesDate =
        dateFilter === "all" ||
        (dateFilter === "today" &&
          group.status === "active" &&
          daysLeft !== null &&
          daysLeft <= 1 &&
          daysLeft >= 0) ||
        (dateFilter === "soon" &&
          group.status === "active" &&
          daysLeft !== null &&
          daysLeft <= 3 &&
          daysLeft >= 0) ||
        (dateFilter === "overdue" &&
          group.status === "active" &&
          daysLeft !== null &&
          daysLeft < 0);

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [groups, search, statusFilter, dateFilter]);

  const totalPages = Math.max(
    Math.ceil(filteredGroups.length / reservationsPerPage),
    1
  );

  const paginatedGroups = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * reservationsPerPage;

    return filteredGroups.slice(start, start + reservationsPerPage);
  }, [filteredGroups, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFilter]);

  function closeActionModals() {
    setSelectedGroup(null);
    setPaymentOpen(false);
    setSaleForm(emptySaleForm);
    setPaymentForm(emptyPaymentForm);
  }

  async function handleMarkAsRead() {
    if (unreadReservations.length === 0) return;

    try {
      setProcessing(true);

      await markReservationsAsRead({
        reservationIds: unreadReservations.map((item) => item.id),
        storeId: STORE_ID,
        actor: getCurrentUserActor(),
      });
    } catch (error) {
      alert(error.message || "No se pudieron marcar como leídos.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleCheckExpired() {
    try {
      setProcessing(true);
      const count = await expireOverdueReservations(STORE_ID);

      alert(
        count === 0
          ? "No hay apartados vencidos."
          : `${count} apartado(s) vencido(s) fueron liberados.`
      );
    } catch {
      alert("No se pudieron revisar los apartados vencidos.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleCancel(group) {
    if (group.legacy) {
      alert("Este apartado antiguo debe migrarse antes de liberarlo.");
      return;
    }

    const confirmed = window.confirm(
      `¿Deseas liberar ${group.groupNumber}? Todos los productos volverán al inventario.`
    );

    if (!confirmed) return;

    try {
      setProcessing(true);
      await cancelReservationGroup(group.id, getCurrentUserActor());
      alert("Apartado liberado correctamente.");
    } catch (error) {
      alert(error.message || "No se pudo liberar el apartado.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <main className="min-h-screen bg-white px-3 py-4 sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[28px] font-medium tracking-[-0.045em]">
                Apartados
              </h1>

              {unreadReservations.length > 0 && (
                <span className="rounded-full bg-red-600 px-3 py-1 text-[12px] font-medium text-white">
                  {unreadReservations.length} nuevo(s)
                </span>
              )}
            </div>

            <p className="mt-1 text-[13px] text-black/50">
              Controla días, abonos, saldos y ventas de cada apartado.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-medium"
            >
              <Settings2 size={16} />
              {settings.defaultReservationDays} días por defecto
            </button>

            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20"
            >
              <Plus size={16} />
              Nuevo apartado manual
            </button>

            <button
              type="button"
              onClick={handleMarkAsRead}
              disabled={processing || unreadReservations.length === 0}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-medium disabled:opacity-40"
            >
              <Eye size={16} />
              Marcar leídos
            </button>

            <button
              type="button"
              onClick={handleCheckExpired}
              disabled={processing}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-medium"
            >
              <RefreshCcw size={16} />
              Vencidos
            </button>
          </div>
        </header>

        <section className="mt-5 rounded-[26px] bg-white p-3 shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
          <div className="grid gap-3 lg:grid-cols-[1.45fr_0.82fr_0.82fr]">
            <label className="relative block">
              <Search
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-full rounded-2xl border border-black/[0.08] pl-11 pr-4 text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Buscar cliente, apartado o producto..."
              />
            </label>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] px-4 text-[13px] outline-none"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="completed">Vendidos</option>
              <option value="expired">Vencidos</option>
              <option value="cancelled">Liberados</option>
            </select>

            <select
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] px-4 text-[13px] outline-none"
            >
              <option value="all">Fecha límite</option>
              <option value="today">Vencen hoy</option>
              <option value="soon">Vencen pronto</option>
              <option value="overdue">Vencidos activos</option>
            </select>
          </div>

          <section className="mt-4">
            {loading ? (
              <EmptyState text="Cargando apartados..." />
            ) : filteredGroups.length === 0 ? (
              <EmptyState text="No hay apartados registrados." />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {paginatedGroups.map((group) => (
                    <ReservationGroupCard
                      key={group.id}
                      group={group}
                      processing={processing}
                      onSell={() => {
                        if (group.legacy) {
                          alert(
                            "Este apartado antiguo debe migrarse antes de finalizarlo."
                          );
                          return;
                        }

                        setSelectedGroup(group);
                        setPaymentOpen(false);
                        setSaleForm(emptySaleForm);
                      }}
                      onPayment={() => {
                        if (group.legacy) {
                          alert(
                            "Este apartado antiguo debe migrarse antes de registrar abonos."
                          );
                          return;
                        }

                        setSelectedGroup(group);
                        setPaymentOpen(true);
                        setPaymentForm(emptyPaymentForm);
                      }}
                      onCancel={() => handleCancel(group)}
                      onView={() => setDetailGroup(group)}
                    />
                  ))}
                </div>

                <footer className="mt-4 flex items-center justify-between border-t border-black/[0.06] pt-4">
                  <p className="text-[12px] text-black/50">
                    {filteredGroups.length} apartado(s)
                  </p>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => current - 1)}
                      className="h-9 w-9 rounded-xl border border-black/[0.08] disabled:opacity-30"
                    >
                      ‹
                    </button>

                    <span className="flex h-9 items-center rounded-xl bg-red-600 px-4 text-[12px] text-white">
                      {Math.min(page, totalPages)} / {totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => current + 1)}
                      className="h-9 w-9 rounded-xl border border-black/[0.08] disabled:opacity-30"
                    >
                      ›
                    </button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </section>
      </section>

      {manualOpen && (
        <ManualReservationModal
          products={products}
          categories={categories}
          defaultDays={settings.defaultReservationDays}
          processing={processing}
          onClose={() => setManualOpen(false)}
          onSubmit={async (payload) => {
            try {
              setProcessing(true);

              await createManualReservation({
                ...payload,
                storeId: STORE_ID,
                actor: getCurrentUserActor(),
              });

              setManualOpen(false);
              alert("Apartado manual creado correctamente.");
            } catch (error) {
              alert(error.message || "No se pudo crear el apartado.");
            } finally {
              setProcessing(false);
            }
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          currentDays={settings.defaultReservationDays}
          processing={processing}
          onClose={() => setSettingsOpen(false)}
          onSave={async (days) => {
            try {
              setProcessing(true);

              await updateReservationSettings({
                storeId: STORE_ID,
                defaultReservationDays: days,
                actor: getCurrentUserActor(),
              });

              setSettingsOpen(false);
            } catch (error) {
              alert(error.message || "No se pudo guardar la configuración.");
            } finally {
              setProcessing(false);
            }
          }}
        />
      )}

      {selectedGroup && paymentOpen && (
        <PaymentModal
          group={selectedGroup}
          form={paymentForm}
          processing={processing}
          onClose={closeActionModals}
          onChange={(field, value) =>
            setPaymentForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onSubmit={async (event) => {
            event.preventDefault();

            try {
              setProcessing(true);

              await addReservationGroupPayment({
                groupId: selectedGroup.id,
                amount: paymentForm.amount,
                paymentMethod: paymentForm.paymentMethod,
                notes: paymentForm.notes,
                actor: getCurrentUserActor(),
              });

              closeActionModals();
              alert("Abono registrado correctamente.");
            } catch (error) {
              alert(error.message || "No se pudo registrar el abono.");
            } finally {
              setProcessing(false);
            }
          }}
        />
      )}

      {detailGroup && (
        <ReservationGroupDetailModal
          group={detailGroup}
          onClose={() => setDetailGroup(null)}
          onPayment={() => {
            setSelectedGroup(detailGroup);
            setPaymentOpen(true);
            setPaymentForm(emptyPaymentForm);
            setDetailGroup(null);
          }}
          onSell={() => {
            setSelectedGroup(detailGroup);
            setPaymentOpen(false);
            setSaleForm(emptySaleForm);
            setDetailGroup(null);
          }}
        />
      )}

      {selectedGroup && !paymentOpen && (
        <SaleModal
          group={selectedGroup}
          form={saleForm}
          processing={processing}
          onClose={closeActionModals}
          onChange={(field, value) =>
            setSaleForm((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onSubmit={async (event) => {
            event.preventDefault();

            const balance = Math.max(
              Number(selectedGroup.balanceDue || 0),
              0
            );

            const confirmed = window.confirm(
              `¿Confirmas la venta de ${selectedGroup.groupNumber}? Se cobrarán ${formatCurrency(
                balance
              )} restantes.`
            );

            if (!confirmed) return;

            try {
              setProcessing(true);

              await completeReservationGroupSale({
                groupId: selectedGroup.id,
                paymentMethod: saleForm.paymentMethod,
                notes: saleForm.notes,
                seller: getCurrentUserActor(),
              });

              closeActionModals();
              alert("Venta finalizada correctamente.");
            } catch (error) {
              alert(error.message || "No se pudo finalizar la venta.");
            } finally {
              setProcessing(false);
            }
          }}
        />
      )}
    </main>
  );
}

function ReservationGroupCard({
  group,
  processing,
  onSell,
  onPayment,
  onCancel,
  onView,
}) {
  const total = Number(group.subtotal || 0);
  const paid = Number(group.amountPaid || 0);
  const balance = Math.max(Number(group.balanceDue ?? total - paid), 0);
  const isActive = group.status === "active";
  const overdue =
    isActive &&
    getDaysLeft(group.expiresAt) !== null &&
    getDaysLeft(group.expiresAt) < 0;
  const lines = Array.isArray(group.lines) ? group.lines : [];
  const visibleLines = lines.slice(0, 3);

  return (
    <article className="overflow-hidden rounded-[24px] bg-white shadow-[0_16px_46px_rgba(0,0,0,0.045)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_24px_62px_rgba(0,0,0,0.075)]">
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-red-600">{group.groupNumber}</p>
            <h3 className="mt-1 truncate text-[16px] font-medium tracking-[-0.025em]">{group.customerName || "Sin cliente"}</h3>
            <p className="mt-1 text-[10px] text-black/42">{group.totalItems || 0} prenda(s) · {group.totalLines || lines.length || 0} línea(s)</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-[9px] font-medium ${getStatusClass(group.status)}`}>{getStatusLabel(group.status)}</span>
        </div>

        <div className="mt-3 space-y-2">
          {visibleLines.map((line) => {
            const quantity = Number(line.quantity || 1);
            const unitPrice = Number(line.unitPrice || 0);
            const subtotal = Number(line.subtotal ?? quantity * unitPrice);
            return (
              <div key={line.id} className="flex items-center gap-2.5 rounded-[16px] border border-black/[0.055] bg-white p-2">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[13px] bg-black/[0.025]">
                  {line.productImageUrl ? <img src={line.productImageUrl} alt={line.productName || "Producto"} className="h-full w-full bg-white object-contain p-1" /> : <Camera size={17} className="text-black/25" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">{line.productName || "Producto"}</p>
                  <p className="mt-0.5 truncate text-[8px] text-black/40">Talla {line.productSize || line.size || "Talla única"} · {quantity} unidad(es)</p>
                </div>
                <p className="shrink-0 text-[10px] font-medium">{formatCurrency(subtotal)}</p>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={onView} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.07] text-[9px] font-medium text-black/60 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600">
          <Eye size={13} />
          Ver todos los productos y detalles
        </button>
      </div>

      <div className="border-t border-black/[0.055] bg-black/[0.015] px-3.5 py-3">
        <div className="grid grid-cols-3 divide-x divide-black/[0.06]">
          <ReservationMetric label="Total" value={formatCurrency(total)} />
          <ReservationMetric label="Pagado" value={formatCurrency(paid)} success />
          <ReservationMetric label="Saldo" value={formatCurrency(balance)} danger={balance > 0} success={balance <= 0} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-black/[0.05]">
          <div><p className="text-[8px] text-black/38">Fecha límite</p><p className="mt-0.5 text-[9px] font-medium">{formatDate(group.expiresAt)}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-[8px] font-medium ${overdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>{getDueText(group)}</span>
        </div>
        <div className="mt-3">
          {isActive && !overdue ? (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={onPayment} disabled={processing || balance <= 0} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-emerald-200 text-[10px] font-medium text-emerald-600 disabled:opacity-30"><HandCoins size={14}/>Abono</button>
              <button type="button" onClick={onSell} disabled={processing} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-red-600 text-[10px] font-medium text-white"><ShoppingBag size={14}/>Vender</button>
              <button type="button" onClick={onCancel} disabled={processing} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-black/[0.08] text-[10px] font-medium"><Trash2 size={14}/>Liberar</button>
            </div>
          ) : group.status === "completed" ? (
            <div className="flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-50 text-[11px] font-medium text-emerald-600"><CheckCircle2 size={15}/>Venta registrada</div>
          ) : (
            <div className="flex h-10 items-center justify-center gap-2 rounded-xl bg-black/[0.035] text-[11px] text-black/55"><Clock size={15}/>Cerrado</div>
          )}
        </div>
      </div>
    </article>
  );
}

function ReservationMetric({ label, value, danger = false, success = false }) {
  return <div className="min-w-0 px-2 text-center"><p className="text-[7px] text-black/36">{label}</p><p className={`mt-1 truncate text-[10px] font-medium ${danger ? "text-red-600" : success ? "text-emerald-600" : "text-black"}`}>{value}</p></div>;
}

function ReservationGroupDetailModal({ group, onClose, onPayment, onSell }) {
  const lines = Array.isArray(group.lines) ? group.lines : [];
  const total = Number(group.subtotal || 0);
  const paid = Number(group.amountPaid || 0);
  const balance = Math.max(Number(group.balanceDue ?? total - paid), 0);
  const canOperate = group.status === "active" && (getDaysLeft(group.expiresAt) === null || getDaysLeft(group.expiresAt) >= 0);

  return (
    <ModalShell title={`Detalle · ${group.groupNumber}`} subtitle={`${group.customerName || "Sin cliente"} · ${group.totalItems || 0} prenda(s)`} onClose={onClose} maxWidth="max-w-[860px]">
      <div className="grid gap-3 sm:grid-cols-4">
        <DetailSummary label="Productos" value={String(group.totalLines || lines.length)} />
        <DetailSummary label="Unidades" value={String(group.totalItems || 0)} />
        <DetailSummary label="Pagado" value={formatCurrency(paid)} success />
        <DetailSummary label="Saldo" value={formatCurrency(balance)} danger={balance > 0} />
      </div>
      <div className="mt-4 max-h-[48vh] space-y-2 overflow-y-auto pr-1">
        {lines.map((line) => {
          const quantity = Number(line.quantity || 1);
          const unitPrice = Number(line.unitPrice || 0);
          const subtotal = Number(line.subtotal ?? quantity * unitPrice);
          return (
            <article key={line.id} className="grid gap-3 rounded-[18px] border border-black/[0.06] bg-white p-3 sm:grid-cols-[70px_minmax(0,1fr)_auto] sm:items-center">
              <div className="flex h-[70px] w-[70px] items-center justify-center overflow-hidden rounded-[16px] bg-black/[0.025]">{line.productImageUrl ? <img src={line.productImageUrl} alt={line.productName || "Producto"} className="h-full w-full bg-white object-contain p-1.5"/> : <Camera size={22} className="text-black/25"/>}</div>
              <div className="min-w-0"><p className="truncate text-[13px] font-medium">{line.productName || "Producto"}</p><p className="mt-1 text-[9px] text-black/42">Código: {line.productCode || "Sin código"} · Talla {line.productSize || line.size || "Talla única"}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-black/[0.035] px-2.5 py-1 text-[8px] text-black/55">{quantity} unidad(es)</span><span className="rounded-full bg-red-50 px-2.5 py-1 text-[8px] text-red-600">{formatCurrency(unitPrice)} c/u</span></div></div>
              <div className="text-left sm:text-right"><p className="text-[8px] text-black/38">Subtotal</p><p className="mt-1 text-[13px] font-medium">{formatCurrency(subtotal)}</p></div>
            </article>
          );
        })}
      </div>
      <div className="mt-4 grid gap-3 rounded-[18px] bg-black/[0.025] p-3 sm:grid-cols-2"><InfoRow label="Documento" value={group.customerDocument || "Sin documento"}/><InfoRow label="Teléfono" value={group.customerPhone || "Sin teléfono"}/><InfoRow label="Vencimiento" value={`${formatDate(group.expiresAt)} · ${getDueText(group)}`}/><InfoRow label="Origen" value={group.source === "manual" ? "Tienda física" : "Catálogo público"}/></div>
      {canOperate && <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={onPayment} disabled={balance <= 0} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 text-[11px] font-medium text-emerald-600 disabled:opacity-35"><HandCoins size={15}/>Registrar abono</button><button type="button" onClick={onSell} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 text-[11px] font-medium text-white"><ShoppingBag size={15}/>Finalizar venta</button></div>}
    </ModalShell>
  );
}

function DetailSummary({ label, value, danger = false, success = false }) {
  return <div className="rounded-[16px] bg-black/[0.025] px-3 py-2.5"><p className="text-[8px] text-black/38">{label}</p><p className={`mt-1 truncate text-[12px] font-medium ${danger ? "text-red-600" : success ? "text-emerald-600" : ""}`}>{value}</p></div>;
}

function normalizeManualVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

function getManualAvailableVariants(product) {
  return normalizeManualVariants(product).filter(
    (variant) => Number(variant.stock || 0) > 0
  );
}

function getManualTotalStock(product) {
  return normalizeManualVariants(product).reduce(
    (total, variant) => total + Number(variant.stock || 0),
    0
  );
}

function getManualStockStatus(stock) {
  const value = Number(stock || 0);

  if (value <= 0) {
    return {
      label: "Agotado",
      filter: "empty",
      badgeClass: "bg-red-50 text-red-600",
      stockClass: "text-red-600",
    };
  }

  if (value <= 3) {
    return {
      label: "Stock bajo",
      filter: "low",
      badgeClass: "bg-orange-50 text-orange-600",
      stockClass: "text-orange-600",
    };
  }

  return {
    label: "Disponible",
    filter: "available",
    badgeClass: "bg-emerald-50 text-emerald-600",
    stockClass: "text-emerald-600",
  };
}

function ManualReservationModal({
  products,
  categories,
  defaultDays,
  processing,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState({
    customerName: "",
    customerDocument: "",
    customerPhone: "",
    reservationDays: String(defaultDays || 7),
    initialPayment: "",
    initialPaymentMethod: "efectivo",
    notes: "",
  });

  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("available");
  const [variantProduct, setVariantProduct] = useState(null);

  const availableSizes = useMemo(() => {
    const sizes = products.flatMap((product) =>
      normalizeManualVariants(product).map((variant) => variant.size)
    );

    return [...new Set(sizes)]
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b)));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const variants = normalizeManualVariants(product);
      const stock = getManualTotalStock(product);
      const stockStatus = getManualStockStatus(stock);

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "")
          .toLowerCase()
          .includes(cleanSearch) ||
        variants.some((variant) =>
          String(variant.size || "").toLowerCase().includes(cleanSearch)
        );

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize =
        sizeFilter === "all" ||
        variants.some((variant) => variant.size === sizeFilter);

      const matchesStock =
        stockFilter === "all" || stockStatus.filter === stockFilter;

      return matchesSearch && matchesCategory && matchesSize && matchesStock;
    });
  }, [products, search, categoryFilter, sizeFilter, stockFilter]);

  const subtotal = useMemo(
    () =>
      items.reduce(
        (total, item) =>
          total + Number(item.unitPrice || 0) * Number(item.quantity || 0),
        0
      ),
    [items]
  );

  const initialPayment = Math.max(Number(form.initialPayment || 0), 0);
  const balance = Math.max(subtotal - initialPayment, 0);
  const totalItems = items.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

  function openProduct(product) {
    const variants = getManualAvailableVariants(product);

    if (variants.length === 0) {
      alert("Este producto no tiene stock disponible.");
      return;
    }

    if (variants.length === 1) {
      addToCart(product, variants[0]);
      return;
    }

    setVariantProduct(product);
  }

  function addToCart(product, variant) {
    const stock = Number(variant.stock || 0);

    if (stock <= 0) {
      alert(`La talla ${variant.size} está agotada.`);
      return;
    }

    const key = `${product.id}__${variant.id}`;

    setItems((current) => {
      const existing = current.find((item) => item.key === key);

      if (existing) {
        if (existing.quantity >= stock) {
          alert(
            `Solo hay ${stock} unidad(es) disponibles de ${product.name} talla ${variant.size}.`
          );
          return current;
        }

        return current.map((item) =>
          item.key === key
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [
        ...current,
        {
          key,
          productId: product.id,
          productName: product.name,
          productCode: product.code || "",
          product,
          variantId: variant.id,
          size: variant.size || "Talla única",
          variant,
          quantity: 1,
          stock,
          unitPrice: Number(product.salePrice || 0),
        },
      ];
    });

    setVariantProduct(null);
  }

  function updateItemQuantity(key, nextQuantity) {
    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) return item;

        const safeQuantity = Math.min(
          Math.max(Number(nextQuantity || 1), 1),
          Number(item.stock || 1)
        );

        return { ...item, quantity: safeQuantity };
      })
    );
  }

  function removeItem(key) {
    setItems((current) => current.filter((item) => item.key !== key));
  }

  function submit(event) {
    event.preventDefault();

    if (!form.customerName.trim()) {
      alert("Escribe el nombre del cliente.");
      return;
    }

    if (!form.customerDocument.trim()) {
      alert("Escribe la cédula del cliente.");
      return;
    }

    if (items.length === 0) {
      alert("Agrega al menos un producto.");
      return;
    }

    if (initialPayment > subtotal) {
      alert("El valor entregado no puede superar el total.");
      return;
    }

    onSubmit({
      items: items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        size: item.size,
        quantity: item.quantity,
      })),
      customerName: form.customerName,
      customerDocument: form.customerDocument,
      customerPhone: form.customerPhone,
      reservationDays: form.reservationDays,
      initialPayment,
      initialPaymentMethod: form.initialPaymentMethod,
      notes: form.notes,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 px-3 py-3 backdrop-blur-sm sm:px-5 sm:py-5">
      <section className="mx-auto flex h-full w-full max-w-[1580px] flex-col overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.055),_transparent_28%),linear-gradient(180deg,#fafafa_0%,#f5f5f6_100%)] shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/[0.06] bg-white/95 px-5 py-4 backdrop-blur-xl sm:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-red-600">
              Tienda física
            </p>

            <h2 className="mt-1 text-[24px] font-medium tracking-[-0.04em]">
              Crear nuevo apartado
            </h2>

            <p className="mt-1 text-[12px] text-black/45">
              Selecciona productos visualmente, registra el pago inicial y define la vigencia.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-black/[0.07] bg-white text-black/55 transition hover:bg-red-50 hover:text-red-600"
            aria-label="Cerrar nuevo apartado"
          >
            <X size={19} />
          </button>
        </header>

        <form
          onSubmit={submit}
          className="grid min-h-0 flex-1 gap-4 overflow-hidden p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_400px]"
        >
          <section className="min-h-0 overflow-y-auto rounded-[28px] border border-white bg-white/95 p-3 shadow-[0_20px_65px_rgba(0,0,0,0.055)] ring-1 ring-black/[0.045] sm:p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_.8fr_.7fr_.7fr]">
              <label className="relative block">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
                />

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  placeholder="Buscar producto, código, categoría o talla..."
                />
              </label>

              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="all">Todas las categorías</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>

              <select
                value={sizeFilter}
                onChange={(event) => setSizeFilter(event.target.value)}
                className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="all">Todas las tallas</option>
                {availableSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>

              <select
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value)}
                className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="available">Disponibles</option>
                <option value="low">Stock bajo</option>
                <option value="empty">Agotados</option>
                <option value="all">Todos</option>
              </select>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium">Productos</p>
                <p className="mt-0.5 text-[12px] text-black/45">
                  {filteredProducts.length} resultado(s)
                </p>
              </div>

              <div className="rounded-full bg-red-50 px-3 py-1.5 text-[11px] text-red-600">
                Selecciona para apartar
              </div>
            </div>

            <section className="mt-4">
              {filteredProducts.length === 0 ? (
                <div className="rounded-[22px] bg-black/[0.025] p-10 text-center">
                  <PackageSearch size={34} className="mx-auto text-black/30" />
                  <h3 className="mt-4 text-[17px] font-medium">
                    No hay productos para mostrar
                  </h3>
                  <p className="mt-2 text-[13px] text-black/45">
                    Ajusta los filtros o revisa el inventario.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {filteredProducts.map((product) => (
                    <ManualProductCard
                      key={product.id}
                      product={product}
                      onAdd={() => openProduct(product)}
                    />
                  ))}
                </div>
              )}
            </section>
          </section>

          <aside className="min-h-0 overflow-hidden rounded-[28px] bg-white shadow-[0_18px_55px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.07]">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
                <div>
                  <h3 className="text-[16px] font-medium">Apartado actual</h3>
                  <p className="mt-0.5 text-[11px] text-black/45">
                    {totalItems} unidad(es) · {items.length} línea(s)
                  </p>
                </div>

                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setItems([])}
                    className="rounded-xl px-3 py-2 text-[11px] text-red-600 transition hover:bg-red-50"
                  >
                    Vaciar
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {items.length === 0 ? (
                  <div className="rounded-[22px] bg-black/[0.025] px-5 py-8 text-center">
                    <ShoppingBag size={30} className="mx-auto text-black/25" />
                    <p className="mt-3 text-[14px] font-medium">
                      El apartado está vacío
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-black/45">
                      Selecciona productos y tallas para comenzar.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((item) => (
                      <ManualCartItem
                        key={item.key}
                        item={item}
                        onUpdateQuantity={updateItemQuantity}
                        onRemove={removeItem}
                      />
                    ))}
                  </div>
                )}

                <section className="mt-4 border-t border-black/[0.06] pt-4">
                  <div className="grid gap-2">
                    <Input
                      label="Nombre completo"
                      value={form.customerName}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          customerName: value,
                        }))
                      }
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Cédula"
                        value={form.customerDocument}
                        onChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            customerDocument: value,
                          }))
                        }
                      />

                      <Input
                        label="Teléfono"
                        value={form.customerPhone}
                        onChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            customerPhone: value,
                          }))
                        }
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Días del apartado"
                        type="number"
                        min="1"
                        max="365"
                        value={form.reservationDays}
                        onChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            reservationDays: value,
                          }))
                        }
                      />

                      <Select
                        label="Método pago inicial"
                        value={form.initialPaymentMethod}
                        onChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            initialPaymentMethod: value,
                          }))
                        }
                      />
                    </div>

                    <Input
                      label="Valor entregado"
                      type="number"
                      min="0"
                      max={subtotal}
                      value={form.initialPayment}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          initialPayment: value,
                        }))
                      }
                    />

                    <Input
                      label="Notas"
                      value={form.notes}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          notes: value,
                        }))
                      }
                    />
                  </div>
                </section>
              </div>

              <div className="border-t border-black/[0.06] bg-white px-5 py-4">
                <div className="space-y-2 text-[12px]">
                  <div className="flex justify-between gap-4">
                    <span className="text-black/50">Total</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-black/50">Valor entregado</span>
                    <span className="text-emerald-600">
                      {formatCurrency(initialPayment)}
                    </span>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-t border-black/[0.07] pt-3">
                    <div>
                      <p className="text-[11px] text-black/45">
                        Saldo pendiente
                      </p>

                      <p className="mt-0.5 text-[25px] font-medium tracking-[-0.05em] text-red-600">
                        {formatCurrency(balance)}
                      </p>
                    </div>

                    <span className="rounded-full bg-red-50 px-3 py-1.5 text-[10px] text-red-600">
                      {form.reservationDays || 0} día(s)
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={processing || items.length === 0}
                  className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/15 disabled:shadow-none"
                >
                  <ShoppingBag size={17} />
                  {processing
                    ? "Creando apartado..."
                    : "Crear apartado manual"}
                </button>
              </div>
            </div>
          </aside>
        </form>
      </section>

      {variantProduct && (
        <ManualVariantSelectorModal
          product={variantProduct}
          onClose={() => setVariantProduct(null)}
          onSelect={(variant) => addToCart(variantProduct, variant)}
        />
      )}
    </div>
  );
}

function ManualProductCard({ product, onAdd }) {
  const stock = getManualTotalStock(product);
  const variants = getManualAvailableVariants(product);
  const coverImage = getProductCoverImage(product);
  const stockStatus = getManualStockStatus(stock);

  return (
    <article className="group overflow-hidden rounded-[22px] bg-white shadow-[0_12px_35px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_20px_55px_rgba(0,0,0,0.07)]">
      <button
        type="button"
        onClick={onAdd}
        disabled={stock <= 0}
        className="block w-full text-left disabled:cursor-not-allowed"
      >
        <div className="relative aspect-[4/3.2] overflow-hidden bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={product.name}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera size={28} className="text-black/25" />
            </div>
          )}

          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] ${stockStatus.badgeClass}`}
          >
            {stockStatus.label}
          </span>

          <span className="absolute bottom-3 right-3 rounded-full bg-black/75 px-2.5 py-1 text-[10px] text-white backdrop-blur">
            {variants.length} talla(s)
          </span>
        </div>

        <div className="p-3">
          <p className="text-[11px] text-black/45">
            {product.code || "Sin código"} ·{" "}
            {product.categoryName || "Sin categoría"}
          </p>

          <h3 className="mt-1 truncate text-[14px] font-medium">
            {product.name}
          </h3>

          <div className="mt-2 flex flex-wrap gap-1">
            {variants.slice(0, 4).map((variant) => (
              <span
                key={variant.id}
                className="rounded-full bg-black/[0.035] px-2 py-1 text-[10px] text-black/60"
              >
                {variant.size}
              </span>
            ))}

            {variants.length > 4 && (
              <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] text-red-600">
                +{variants.length - 4}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[17px] font-medium tracking-[-0.035em]">
                {formatCurrency(product.salePrice)}
              </p>

              <p className={`mt-1 text-[11px] ${stockStatus.stockClass}`}>
                {stock} unidad(es)
              </p>
            </div>

            <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-3 text-[11px] font-medium text-white shadow-lg shadow-red-600/15">
              <Plus size={14} />
              Agregar
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}

function ManualCartItem({
  item,
  onUpdateQuantity,
  onRemove,
}) {
  const coverImage = getProductCoverImage(item.product);
  const subtotal =
    Number(item.unitPrice || 0) * Number(item.quantity || 0);

  return (
    <article className="rounded-[19px] border border-black/[0.06] bg-white p-3">
      <div className="flex gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={item.productName}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera size={19} className="text-black/25" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[12px] font-medium">
                {item.productName}
              </h3>

              <p className="mt-1 text-[10px] text-black/45">
                {item.productCode || "Sin código"} · Talla {item.size}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onRemove(item.key)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50"
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  onUpdateQuantity(item.key, item.quantity - 1)
                }
                disabled={item.quantity <= 1}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] disabled:opacity-35"
              >
                <Minus size={12} />
              </button>

              <input
                type="number"
                min="1"
                max={item.stock}
                value={item.quantity}
                onChange={(event) =>
                  onUpdateQuantity(item.key, event.target.value)
                }
                className="h-7 w-10 rounded-lg border border-black/[0.08] text-center text-[11px] outline-none focus:border-red-600"
              />

              <button
                type="button"
                onClick={() =>
                  onUpdateQuantity(item.key, item.quantity + 1)
                }
                disabled={item.quantity >= Number(item.stock || 0)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] disabled:opacity-35"
              >
                <Plus size={12} />
              </button>
            </div>

            <p className="text-[13px] font-medium">
              {formatCurrency(subtotal)}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function ManualVariantSelectorModal({
  product,
  onClose,
  onSelect,
}) {
  const variants = getManualAvailableVariants(product);
  const coverImage = getProductCoverImage(product);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[460px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[12px] text-red-600">Seleccionar variante</p>
            <h2 className="mt-1 text-[19px] font-medium">{product.name}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <div className="flex items-center gap-3 rounded-[20px] bg-black/[0.025] p-3">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white">
              {coverImage.url ? (
                <img
                  src={coverImage.url}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Camera size={22} className="text-black/25" />
              )}
            </div>

            <div>
              <p className="text-[12px] text-black/45">
                {product.code || "Sin código"}
              </p>

              <p className="mt-1 text-[18px] font-medium">
                {formatCurrency(product.salePrice)}
              </p>
            </div>
          </div>

          <p className="mt-5 text-[13px] font-medium">
            ¿Qué talla deseas agregar?
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => onSelect(variant)}
                className="rounded-2xl border border-black/[0.08] bg-white px-3 py-3 text-left transition hover:border-red-400 hover:bg-red-50"
              >
                <p className="text-[14px] font-medium">{variant.size}</p>
                <p className="mt-1 text-[11px] text-emerald-600">
                  {variant.stock} disponible(s)
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsModal({
  currentDays,
  processing,
  onClose,
  onSave,
}) {
  const [days, setDays] = useState(String(currentDays || 7));

  return (
    <ModalShell
      title="Configuración de apartados"
      subtitle="Define los días predeterminados para nuevos apartados."
      onClose={onClose}
    >
      <Input
        label="Días por defecto"
        type="number"
        min="1"
        max="365"
        value={days}
        onChange={setDays}
      />

      <button
        type="button"
        onClick={() => onSave(days)}
        disabled={processing}
        className="mt-4 h-11 w-full rounded-2xl bg-red-600 text-[13px] font-medium text-white"
      >
        Guardar configuración
      </button>
    </ModalShell>
  );
}

function PaymentModal({
  group,
  form,
  processing,
  onClose,
  onSubmit,
  onChange,
}) {
  const balance = Math.max(Number(group.balanceDue || 0), 0);

  return (
    <ModalShell
      title={`Registrar abono · ${group.groupNumber}`}
      subtitle={`Saldo pendiente: ${formatCurrency(balance)}`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Input
          label="Valor del abono"
          type="number"
          min="1"
          max={balance}
          value={form.amount}
          onChange={(value) => onChange("amount", value)}
        />

        <Select
          label="Método de pago"
          value={form.paymentMethod}
          onChange={(value) => onChange("paymentMethod", value)}
        />

        <Input
          label="Notas"
          value={form.notes}
          onChange={(value) => onChange("notes", value)}
        />

        <button
          type="submit"
          disabled={processing}
          className="h-11 w-full rounded-2xl bg-emerald-600 text-[13px] font-medium text-white"
        >
          Registrar abono
        </button>
      </form>
    </ModalShell>
  );
}

function SaleModal({
  group,
  form,
  processing,
  onClose,
  onSubmit,
  onChange,
}) {
  const total = Number(group.subtotal || 0);
  const paid = Number(group.amountPaid || 0);
  const balance = Math.max(
    Number(group.balanceDue ?? total - paid),
    0
  );

  return (
    <ModalShell
      title={`Finalizar venta · ${group.groupNumber}`}
      subtitle="El saldo pendiente se registrará como pago final."
      onClose={onClose}
    >
      <div className="space-y-2 rounded-[22px] bg-black/[0.025] p-4">
        <InfoRow label="Total" value={formatCurrency(total)} />

        <InfoRow
          label="Pagado"
          value={formatCurrency(paid)}
          valueClass="text-emerald-600"
        />

        <InfoRow
          label="Saldo a cobrar"
          value={formatCurrency(balance)}
          valueClass="text-red-600"
        />
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <Select
          label="Método del pago final"
          value={form.paymentMethod}
          onChange={(value) => onChange("paymentMethod", value)}
        />

        <Input
          label="Notas"
          value={form.notes}
          onChange={(value) => onChange("notes", value)}
        />

        <button
          type="submit"
          disabled={processing}
          className="h-11 w-full rounded-2xl bg-red-600 text-[13px] font-medium text-white"
        >
          Confirmar venta
        </button>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = "max-w-[520px]",
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section
        className={`max-h-[92vh] w-full overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl ${maxWidth}`}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[19px] font-medium text-red-600">
              {title}
            </h2>

            <p className="mt-1 text-[12px] text-black/45">
              {subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-red-50 hover:text-red-600"
          >
            <X size={18} />
          </button>
        </div>

        {children}
      </section>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
      <FileClock size={26} className="mx-auto text-black/30" />
      <p className="mt-3 text-[13px] text-black/50">{text}</p>
    </div>
  );
}

function InfoRow({
  label,
  value,
  valueClass = "text-black",
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-[11px]">
      <span className="text-black/45">{label}</span>
      <strong className={`font-medium ${valueClass}`}>
        {value}
      </strong>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
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
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
      />
    </label>
  );
}

function Select({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-black/60">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600"
      >
        <option value="efectivo">Efectivo</option>
        <option value="transferencia">Transferencia</option>
        <option value="nequi">Nequi</option>
        <option value="daviplata">Daviplata</option>
        <option value="tarjeta">Tarjeta</option>
        <option value="otro">Otro</option>
      </select>
    </label>
  );
}