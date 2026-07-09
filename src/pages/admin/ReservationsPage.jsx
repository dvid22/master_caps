import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock,
  FileClock,
  MoreVertical,
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
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getDaysLeft(value) {
  const date = value?.toDate?.();

  if (!date) return null;

  const now = new Date();
  const diff = date.getTime() - now.getTime();

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getReservationTotal(reservation) {
  return Number(reservation?.unitPrice || 0) * Number(reservation?.quantity || 1);
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
    active: "bg-emerald-50 text-emerald-600",
    completed: "bg-emerald-50 text-emerald-600",
    expired: "bg-red-50 text-red-600",
    cancelled: "bg-black/[0.04] text-black/55",
  };

  return classes[status] || "bg-black/[0.04] text-black/55";
}

function getDueText(reservation) {
  const daysLeft = getDaysLeft(reservation.expiresAt);
  const isActive = reservation.status === "active";

  if (!isActive) {
    if (reservation.status === "completed") return "Completado";
    if (reservation.status === "cancelled") return "Liberado";
    if (reservation.status === "expired") return "Vencido";
    return "Cerrado";
  }

  if (daysLeft === null) return "Sin vencimiento";
  if (daysLeft < 0) return `${Math.abs(daysLeft)} día(s) vencido`;
  if (daysLeft === 0) return "Vence hoy";
  if (daysLeft === 1) return "1 día restante";

  return `${daysLeft} días restantes`;
}

function getDueClass(reservation) {
  const daysLeft = getDaysLeft(reservation.expiresAt);

  if (reservation.status === "completed") return "text-emerald-600";
  if (reservation.status === "cancelled") return "text-black/45";
  if (reservation.status === "expired") return "text-red-600";

  if (daysLeft === null) return "text-black/45";
  if (daysLeft < 0) return "text-red-600";
  if (daysLeft <= 1) return "text-orange-600";

  return "text-emerald-600";
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState([]);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [saleForm, setSaleForm] = useState(emptySaleForm);

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
      const productSize = reservation.productSize || "Talla única";

      const matchesSearch =
        !cleanSearch ||
        String(reservation.productName || "").toLowerCase().includes(cleanSearch) ||
        String(reservation.productCode || "").toLowerCase().includes(cleanSearch) ||
        String(productSize || "").toLowerCase().includes(cleanSearch) ||
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

  const totalPages = Math.max(
    Math.ceil(filteredReservations.length / reservationsPerPage),
    1
  );

  const paginatedReservations = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * reservationsPerPage;

    return filteredReservations.slice(start, start + reservationsPerPage);
  }, [filteredReservations, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFilter]);

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
      `¿Confirmas la venta del apartado de "${selectedReservation.productName}" por ${formatCurrency(
        getReservationTotal(selectedReservation)
      )}?`
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
    const quantity = Number(reservation.quantity || 1);

    const confirmCancel = window.confirm(
      `¿Seguro que deseas liberar "${reservation.productName}"? Volverán ${quantity} unidad(es) al inventario.`
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
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-medium tracking-[-0.045em] text-black">
              Apartados
            </h1>

            <p className="mt-1 text-[13px] font-normal text-black/50">
              Gestiona los productos apartados por tus clientes
            </p>
          </div>

          <button
            type="button"
            onClick={handleCheckExpired}
            disabled={processing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-5 text-[13px] font-medium text-black shadow-[0_12px_35px_rgba(0,0,0,0.04)] transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw size={16} strokeWidth={1.9} />
            Actualizar vencidos
          </button>
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
                className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] font-normal text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Buscar cliente, producto, código..."
              />
            </label>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
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
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="all">Fecha límite</option>
              <option value="today">Vencen hoy</option>
              <option value="soon">Vencen pronto</option>
              <option value="overdue">Vencidos activos</option>
            </select>
          </div>

          <section className="mt-4">
            {loading ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center text-[13px] text-black/45">
                Cargando apartados en tiempo real...
              </div>
            ) : filteredReservations.length === 0 ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black/50 ring-1 ring-black/[0.06]">
                  <FileClock size={24} />
                </div>

                <h2 className="mt-4 text-[17px] font-medium text-black">
                  No hay apartados
                </h2>

                <p className="mt-2 text-[13px] text-black/45">
                  Cuando un cliente aparte una prenda desde el catálogo,
                  aparecerá aquí automáticamente.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {paginatedReservations.map((reservation) => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                      processing={processing}
                      onSell={() => openSaleModal(reservation)}
                      onCancel={() => handleCancel(reservation)}
                      onCheckExpired={handleCheckExpired}
                    />
                  ))}
                </div>

                <footer className="mt-4 flex flex-col gap-3 border-t border-black/[0.06] pt-4 md:flex-row md:items-center md:justify-between">
                  <p className="text-[12px] font-normal text-black/50">
                    Mostrando{" "}
                    {filteredReservations.length === 0
                      ? 0
                      : (Math.min(page, totalPages) - 1) * reservationsPerPage +
                        1}{" "}
                    a{" "}
                    {Math.min(
                      Math.min(page, totalPages) * reservationsPerPage,
                      filteredReservations.length
                    )}{" "}
                    de {filteredReservations.length} apartados
                  </p>

                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => current - 1)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ‹
                    </button>

                    {Array.from({ length: Math.min(totalPages, 5) }).map(
                      (_, index) => {
                        const pageNumber = index + 1;

                        return (
                          <button
                            key={pageNumber}
                            type="button"
                            onClick={() => setPage(pageNumber)}
                            className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                              page === pageNumber
                                ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                                : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
                            }`}
                          >
                            {pageNumber}
                          </button>
                        );
                      }
                    )}

                    {totalPages > 5 && (
                      <span className="px-1 text-[12px] text-black/40">
                        ...
                      </span>
                    )}

                    {totalPages > 5 && (
                      <button
                        type="button"
                        onClick={() => setPage(totalPages)}
                        className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                          page === totalPages
                            ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                            : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
                        }`}
                      >
                        {totalPages}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => current + 1)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ›
                    </button>
                  </div>

                  <div className="hidden h-9 items-center rounded-xl border border-black/[0.08] bg-white px-4 text-[12px] text-black/70 md:flex">
                    8 por página
                  </div>
                </footer>
              </>
            )}
          </section>
        </section>
      </section>

      {selectedReservation && (
        <ReservationSaleModal
          selectedReservation={selectedReservation}
          saleForm={saleForm}
          processing={processing}
          onClose={closeSaleModal}
          onSubmit={handleCompleteSale}
          updateSaleForm={updateSaleForm}
        />
      )}
    </main>
  );
}

function ReservationCard({
  reservation,
  processing,
  onSell,
  onCancel,
  onCheckExpired,
}) {
  const daysLeft = getDaysLeft(reservation.expiresAt);
  const isActive = reservation.status === "active";
  const isOverdue = isActive && daysLeft !== null && daysLeft < 0;
  const total = getReservationTotal(reservation);
  const productSize = reservation.productSize || "Talla única";
  const quantity = Number(reservation.quantity || 1);

  return (
    <article className="rounded-[24px] bg-white p-3 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(0,0,0,0.07)]">
      <div className="flex gap-3">
        <div className="flex h-[86px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[20px] bg-black/[0.025]">
          {reservation.productImageUrl ? (
            <img
              src={reservation.productImageUrl}
              alt={reservation.productName}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera size={25} className="text-black/30" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-medium text-black">
                {reservation.productName}
              </h3>

              <p className="mt-1 text-[12px] text-black/45">
                {reservation.productCode || "Sin código"} ·{" "}
                {reservation.categoryName || "Sin categoría"}
              </p>
            </div>

            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] text-black/45 transition hover:bg-black/[0.035] hover:text-black"
              title="Más opciones"
            >
              <MoreVertical size={15} />
            </button>
          </div>

          <p className="mt-2 inline-flex rounded-full bg-black/[0.025] px-2.5 py-1 text-[11px] text-black/60">
            {productSize}
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-black/[0.06] pt-3">
        <div className="grid gap-2">
          <InfoLine icon={User} value={reservation.customerName || "Sin cliente"} />
          <InfoLine
            icon={Phone}
            value={reservation.customerPhone || "Sin teléfono"}
          />
          <InfoLine
            icon={CalendarClock}
            value={formatDate(reservation.expiresAt)}
            helper={getDueText(reservation)}
            helperClass={getDueClass(reservation)}
          />
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[17px] font-medium tracking-[-0.03em] text-black">
              {formatCurrency(total)}
            </p>

            <p className="mt-1 text-[12px] text-black/45">
              {quantity} unidad(es) · {formatCurrency(reservation.unitPrice)}
            </p>
          </div>

          <span
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-normal ${getStatusClass(
              reservation.status
            )}`}
          >
            {getStatusLabel(reservation.status)}
          </span>
        </div>

        <div className="mt-3">
          {isActive && !isOverdue ? (
            <div className="grid grid-cols-[1fr_0.78fr] gap-2">
              <button
                type="button"
                onClick={onSell}
                disabled={processing}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-red-500/35 bg-white text-[13px] font-medium text-red-600 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ShoppingBag size={15} />
                Vender
              </button>

              <button
                type="button"
                onClick={onCancel}
                disabled={processing}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white text-[13px] font-medium text-black/70 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={15} />
                Liberar
              </button>
            </div>
          ) : isOverdue ? (
            <button
              type="button"
              onClick={onCheckExpired}
              disabled={processing}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw size={15} />
              Liberar vencido
            </button>
          ) : reservation.status === "completed" ? (
            <div className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-50 text-[13px] font-medium text-emerald-600">
              <CheckCircle2 size={15} />
              Venta registrada
            </div>
          ) : (
            <div className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-black/[0.035] text-[13px] font-medium text-black/55">
              <Clock size={15} />
              Cerrado
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function InfoLine({ icon: Icon, value, helper, helperClass = "text-black/45" }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[12px]">
      <div className="flex min-w-0 items-center gap-2 text-black/55">
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{value}</span>
      </div>

      {helper && (
        <span className={`shrink-0 text-[11px] font-medium ${helperClass}`}>
          {helper}
        </span>
      )}
    </div>
  );
}

function ReservationSaleModal({
  selectedReservation,
  saleForm,
  processing,
  onClose,
  onSubmit,
  updateSaleForm,
}) {
  const total = getReservationTotal(selectedReservation);
  const quantity = Number(selectedReservation.quantity || 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-medium tracking-[-0.025em] text-red-600">
              Finalizar venta
            </h2>

            <p className="mt-1 text-[12px] text-black/45">
              Completa los datos para vender este producto
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-5">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-black/[0.06] bg-white p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/[0.025]">
                {selectedReservation.productImageUrl ? (
                  <img
                    src={selectedReservation.productImageUrl}
                    alt={selectedReservation.productName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Camera size={24} className="text-black/30" />
                )}
              </div>

              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-medium text-black">
                  {selectedReservation.productName}
                </h3>

                <p className="mt-1 text-[12px] text-black/45">
                  {selectedReservation.productCode || "Sin código"} ·{" "}
                  {selectedReservation.categoryName || "Sin categoría"}
                </p>

                <p className="mt-1 inline-flex rounded-full bg-black/[0.035] px-2.5 py-1 text-[11px] text-black/55">
                  {selectedReservation.productSize || "Talla única"}
                </p>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-[14px] font-medium text-black">
                {formatCurrency(selectedReservation.unitPrice)}
              </p>

              <p className="mt-1 text-[11px] text-emerald-600">
                {quantity} unidad(es)
              </p>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="text-[12px] font-normal text-black/55">
              Método de pago
            </span>

            <select
              value={saleForm.paymentMethod}
              onChange={(event) =>
                updateSaleForm("paymentMethod", event.target.value)
              }
              className="mt-2 h-10 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="nequi">Nequi</option>
              <option value="daviplata">Daviplata</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </label>

          <label className="mt-3 block">
            <span className="text-[12px] font-normal text-black/55">
              Notas opcionales
            </span>

            <input
              value={saleForm.notes}
              onChange={(event) => updateSaleForm("notes", event.target.value)}
              className="mt-2 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[13px] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="Alguna nota adicional..."
            />
          </label>

          <div className="mt-4 rounded-2xl bg-black/[0.025] p-4">
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-4">
                <span className="text-black/55">Precio unitario</span>
                <strong className="font-medium text-black">
                  {formatCurrency(selectedReservation.unitPrice)}
                </strong>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-black/55">Cantidad</span>
                <strong className="font-medium text-black">
                  {quantity} unidad(es)
                </strong>
              </div>

              <div className="flex justify-between gap-4 border-t border-black/[0.08] pt-3">
                <span className="text-black">Total a cobrar</span>
                <strong className="text-[18px] font-medium text-black">
                  {formatCurrency(total)}
                </strong>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-black/[0.08] text-[14px] font-medium text-black/70 transition hover:bg-black/[0.035]"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={processing}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShoppingBag size={16} />
              {processing ? "Registrando..." : "Confirmar venta"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}