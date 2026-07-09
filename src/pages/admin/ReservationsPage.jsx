import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileClock,
  Phone,
  RefreshCcw,
  Search,
  ShoppingBag,
  Trash2,
  User,
  X,
} from "lucide-react";

import {
  cancelReservation,
  completeReservationSale,
  expireOverdueReservations,
  subscribeReservations,
} from "../../services/reservations.service";

import { STORE_ID } from "../../services/categories.service";
import { formatCurrency } from "../../utils/money";
import { getCurrentUserActor } from "../../services/auth.service";
const emptySaleForm = {
  paymentMethod: "efectivo",
  notes: "",
};

function formatDate(value) {
  const date = value?.toDate?.();

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getDaysLeft(value) {
  const date = value?.toDate?.();

  if (!date) return null;

  const now = new Date();
  const diff = date.getTime() - now.getTime();

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getStatusLabel(status) {
  const labels = {
    active: "Activo",
    completed: "Vendido",
    expired: "Vencido",
    cancelled: "Liberado",
  };

  return labels[status] || "Sin estado";
}

function getStatusClass(status) {
  const classes = {
    active: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    expired: "bg-red-100 text-red-700",
    cancelled: "bg-gray-100 text-gray-700",
  };

  return classes[status] || "bg-gray-100 text-gray-700";
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState([]);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [saleForm, setSaleForm] = useState(emptySaleForm);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [checkingExpired, setCheckingExpired] = useState(false);

  useEffect(() => {
    setLoading(true);

    const unsubscribeReservations = subscribeReservations(
      (reservationsData) => {
        setReservations(reservationsData);
        setLoading(false);
      },
      () => {
        setLoading(false);
        alert("No se pudieron escuchar los apartados en tiempo real.");
      },
      STORE_ID
    );

    return () => {
      unsubscribeReservations();
    };
  }, []);

  useEffect(() => {
    const hasOverdue = reservations.some((reservation) => {
      if (reservation.status !== "active") return false;

      const expiresAtDate = reservation.expiresAt?.toDate?.();
      return expiresAtDate && expiresAtDate < new Date();
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
  }, [reservations, checkingExpired]);

  const filteredReservations = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return reservations.filter((reservation) => {
      const daysLeft = getDaysLeft(reservation.expiresAt);

      const matchesSearch =
        !cleanSearch ||
        String(reservation.productName || "").toLowerCase().includes(cleanSearch) ||
        String(reservation.productCode || "").toLowerCase().includes(cleanSearch) ||
        String(reservation.categoryName || "").toLowerCase().includes(cleanSearch) ||
        String(reservation.customerName || "").toLowerCase().includes(cleanSearch) ||
        String(reservation.customerDocument || "").toLowerCase().includes(cleanSearch) ||
        String(reservation.customerPhone || "").toLowerCase().includes(cleanSearch);

      const matchesStatus =
        statusFilter === "all" || reservation.status === statusFilter;

      const matchesDate =
        dateFilter === "all" ||
        (dateFilter === "today" &&
          reservation.status === "active" &&
          daysLeft !== null &&
          daysLeft <= 1 &&
          daysLeft >= 0) ||
        (dateFilter === "soon" &&
          reservation.status === "active" &&
          daysLeft !== null &&
          daysLeft <= 3 &&
          daysLeft >= 0) ||
        (dateFilter === "overdue" &&
          reservation.status === "active" &&
          daysLeft !== null &&
          daysLeft < 0);

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [reservations, search, statusFilter, dateFilter]);

  const totals = useMemo(() => {
    return reservations.reduce(
      (acc, reservation) => {
        const status = reservation.status || "unknown";
        const total = Number(reservation.unitPrice || 0) * Number(reservation.quantity || 1);

        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;

        if (status === "active") {
          acc.activeValue += total;
        }

        if (status === "completed") {
          acc.completedValue += total;
        }

        return acc;
      },
      {
        total: 0,
        active: 0,
        completed: 0,
        expired: 0,
        cancelled: 0,
        activeValue: 0,
        completedValue: 0,
      }
    );
  }, [reservations]);

  function openSaleModal(reservation) {
    setSelectedReservation(reservation);
    setSaleForm(emptySaleForm);
  }

  function closeSaleModal() {
    setSelectedReservation(null);
    setSaleForm(emptySaleForm);
  }

  function updateSaleForm(field, value) {
    setSaleForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleCompleteSale(event) {
    event.preventDefault();

    if (!selectedReservation) return;

    const confirmSale = window.confirm(
      `¿Confirmas la venta del apartado de "${selectedReservation.productName}"?`
    );

    if (!confirmSale) return;

    try {
      setProcessing(true);
const seller = getCurrentUserActor();
      await completeReservationSale({
  reservationId: selectedReservation.id,
  paymentMethod: saleForm.paymentMethod,
  notes: saleForm.notes,
  seller,
});

      closeSaleModal();
      alert("Apartado vendido correctamente.");
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo vender el apartado.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleCancel(reservation) {
    const confirmCancel = window.confirm(
      `¿Seguro que deseas liberar "${reservation.productName}"? La unidad volverá al inventario.`
    );

    if (!confirmCancel) return;

    try {
      setProcessing(true);
      await cancelReservation(reservation.id);
      alert("Apartado liberado correctamente.");
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo liberar el apartado.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleCheckExpired() {
    try {
      setProcessing(true);
      const count = await expireOverdueReservations(STORE_ID);

      if (count === 0) {
        alert("No hay apartados vencidos por liberar.");
      } else {
        alert(`${count} apartado(s) vencido(s) fueron liberados.`);
      }
    } catch (error) {
      console.error(error);
      alert("No se pudieron revisar los apartados vencidos.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-cream px-4 py-6 sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-black/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-gold">Master Caps</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-brand-black">
              Apartados
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Controla las prendas apartadas desde el catálogo público, vende el
              apartado o libera la prenda cuando venza.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCheckExpired}
            disabled={processing}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-brand-black hover:border-brand-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw size={17} />
            Revisar vencidos
          </button>
        </div>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Apartados activos</p>
            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {totals.active || 0}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Valor activo</p>
            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {formatCurrency(totals.activeValue)}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Vendidos desde apartado</p>
            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {totals.completed || 0}
            </p>
          </div>

          <div className="rounded-3xl bg-black p-5 text-white shadow-sm">
            <p className="text-sm text-white/60">Valor vendido</p>
            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(totals.completedValue)}
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:grid-cols-[1fr_180px_180px]">
          <label className="relative block">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-12 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-4 text-sm outline-none focus:border-brand-black"
              placeholder="Buscar por cliente, cédula, producto, código..."
            />
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
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
            className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
          >
            <option value="all">Todos los vencimientos</option>
            <option value="today">Vencen hoy</option>
            <option value="soon">Vencen pronto</option>
            <option value="overdue">Vencidos activos</option>
          </select>
        </section>

        <section className="mt-6">
          {loading ? (
            <div className="rounded-3xl bg-white p-10 text-center text-sm text-gray-500">
              Cargando apartados en tiempo real...
            </div>
          ) : filteredReservations.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center">
              <FileClock size={38} className="mx-auto text-gray-400" />

              <h2 className="mt-4 text-xl font-semibold text-brand-black">
                No hay apartados
              </h2>

              <p className="mt-2 text-sm text-gray-500">
                Cuando un cliente aparte una prenda desde el catálogo, aparecerá
                aquí automáticamente.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredReservations.map((reservation) => {
                const daysLeft = getDaysLeft(reservation.expiresAt);
                const isActive = reservation.status === "active";
                const isOverdue = isActive && daysLeft !== null && daysLeft < 0;
                const total =
                  Number(reservation.unitPrice || 0) *
                  Number(reservation.quantity || 1);

                return (
                  <article
                    key={reservation.id}
                    className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5"
                  >
                    <div className="grid sm:grid-cols-[160px_1fr]">
                      <div className="aspect-[4/4] bg-gray-100 sm:aspect-auto">
                        {reservation.productImageUrl ? (
                          <img
                            src={reservation.productImageUrl}
                            alt={reservation.productName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full min-h-40 w-full items-center justify-center text-gray-400">
                            <ShoppingBag size={34} />
                          </div>
                        )}
                      </div>

                      <div className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                              {reservation.categoryName}
                            </p>

                            <h3 className="mt-1 text-lg font-semibold text-brand-black">
                              {reservation.productName}
                            </h3>

                            <p className="mt-1 text-xs text-gray-500">
                              Código: {reservation.productCode}
                            </p>
                          </div>

                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusClass(
                              reservation.status
                            )}`}
                          >
                            {getStatusLabel(reservation.status)}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl bg-brand-cream p-3">
                            <div className="flex items-center gap-2 text-gray-500">
                              <User size={15} />
                              <p className="text-xs">Cliente</p>
                            </div>

                            <p className="mt-1 text-sm font-semibold text-brand-black">
                              {reservation.customerName}
                            </p>

                            <p className="mt-1 text-xs text-gray-500">
                              CC: {reservation.customerDocument}
                            </p>
                          </div>

                          <div className="rounded-2xl bg-brand-cream p-3">
                            <div className="flex items-center gap-2 text-gray-500">
                              <Phone size={15} />
                              <p className="text-xs">Contacto</p>
                            </div>

                            <p className="mt-1 text-sm font-semibold text-brand-black">
                              {reservation.customerPhone || "Sin teléfono"}
                            </p>

                            <p className="mt-1 text-xs text-gray-500">
                              Apartado: {formatDate(reservation.reservedAt)}
                            </p>
                          </div>
                        </div>

                        <div
                          className={`mt-4 rounded-2xl p-3 ${
                            isOverdue
                              ? "bg-red-50 text-red-700"
                              : isActive
                                ? "bg-blue-50 text-blue-700"
                                : "bg-gray-50 text-gray-600"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {isOverdue ? (
                              <AlertTriangle size={18} />
                            ) : (
                              <CalendarClock size={18} />
                            )}

                            <div>
                              <p className="text-sm font-semibold">
                                {isOverdue
                                  ? "Apartado vencido"
                                  : isActive
                                    ? daysLeft === 0
                                      ? "Vence hoy"
                                      : `Vence en ${daysLeft} día(s)`
                                    : `Vencimiento: ${formatDate(
                                        reservation.expiresAt
                                      )}`}
                              </p>

                              <p className="mt-1 text-xs opacity-80">
                                Fecha límite: {formatDate(reservation.expiresAt)}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex items-end justify-between gap-4">
                          <div>
                            <p className="text-xs text-gray-500">Valor</p>
                            <p className="text-xl font-semibold text-brand-black">
                              {formatCurrency(total)}
                            </p>
                          </div>

                          {isActive && !isOverdue ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleCancel(reservation)}
                                disabled={processing}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 size={16} />
                                Liberar
                              </button>

                              <button
                                type="button"
                                onClick={() => openSaleModal(reservation)}
                                disabled={processing}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-black px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <BadgeDollarSign size={16} />
                                Vender
                              </button>
                            </div>
                          ) : isOverdue ? (
                            <button
                              type="button"
                              onClick={handleCheckExpired}
                              disabled={processing}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <RefreshCcw size={16} />
                              Liberar vencido
                            </button>
                          ) : reservation.status === "completed" ? (
                            <div className="inline-flex items-center gap-2 rounded-2xl bg-green-100 px-4 py-3 text-sm font-semibold text-green-700">
                              <CheckCircle2 size={16} />
                              Venta registrada
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
                              <Clock size={16} />
                              Cerrado
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>

      {selectedReservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                  Vender apartado
                </p>

                <h2 className="text-xl font-semibold text-brand-black">
                  Confirmar venta
                </h2>
              </div>

              <button
                type="button"
                onClick={closeSaleModal}
                className="rounded-full p-2 hover:bg-gray-100"
              >
                <X size={22} />
              </button>
            </div>

            <form onSubmit={handleCompleteSale} className="p-6">
              <div className="rounded-3xl bg-brand-cream p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                  Producto
                </p>

                <p className="mt-1 font-semibold text-brand-black">
                  {selectedReservation.productName}
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  Cliente: {selectedReservation.customerName} · CC{" "}
                  {selectedReservation.customerDocument}
                </p>

                <p className="mt-3 text-2xl font-semibold text-brand-black">
                  {formatCurrency(selectedReservation.unitPrice)}
                </p>
              </div>

              <div className="mt-5 grid gap-4">
                <label>
                  <span className="text-sm font-medium text-brand-black">
                    Método de pago
                  </span>

                  <select
                    value={saleForm.paymentMethod}
                    onChange={(event) =>
                      updateSaleForm("paymentMethod", event.target.value)
                    }
                    className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
                  >
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="nequi">Nequi</option>
                    <option value="daviplata">Daviplata</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="otro">Otro</option>
                  </select>
                </label>

                <label>
                  <span className="text-sm font-medium text-brand-black">
                    Observaciones
                  </span>

                  <textarea
                    value={saleForm.notes}
                    onChange={(event) =>
                      updateSaleForm("notes", event.target.value)
                    }
                    className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-brand-black"
                    placeholder="Notas internas de la venta..."
                  />
                </label>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeSaleModal}
                  className="rounded-2xl border border-black/10 px-5 py-3 text-sm font-semibold text-brand-black hover:border-brand-black"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={processing}
                  className="rounded-2xl bg-brand-black px-6 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {processing ? "Registrando..." : "Confirmar venta"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}