import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  IdCard,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  User,
} from "lucide-react";

import {
  createReservationCart,
  subscribeReservationSettings,
} from "../../services/reservations.service";
import { useReservationCart } from "../../services/reservationCart.store";
import { formatCurrency } from "../../utils/money";

const emptyForm = {
  customerName: "",
  customerDocument: "",
  customerPhone: "",
};

function formatExpirationDate(value) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

export default function ReservationCheckoutPage() {
  const { storeId = "master-caps" } = useParams();
  const navigate = useNavigate();

  const cart = useReservationCart(storeId);

  const [reservationSettings, setReservationSettings] = useState({
    defaultReservationDays: 7,
  });

  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [completedReservation, setCompletedReservation] = useState(null);

  useEffect(() => {
    return subscribeReservationSettings(
      setReservationSettings,
      () => {},
      storeId
    );
  }, [storeId]);

  const canSubmit = useMemo(() => {
    return (
      cart.items.length > 0 &&
      form.customerName.trim().length > 0 &&
      form.customerDocument.trim().length > 0 &&
      !submitting
    );
  }, [
    cart.items.length,
    form.customerName,
    form.customerDocument,
    submitting,
  ]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (cart.items.length === 0) {
      alert("Tu carrito está vacío.");
      return;
    }

    const customerName = form.customerName.trim();
    const customerDocument = form.customerDocument.trim();
    const customerPhone = form.customerPhone.trim();

    if (!customerName) {
      alert("Escribe tu nombre completo.");
      return;
    }

    if (!customerDocument) {
      alert("Escribe tu cédula.");
      return;
    }

    try {
      setSubmitting(true);

      const result = await createReservationCart({
        storeId,
        customerName,
        customerDocument,
        customerPhone,
        reservationDays: reservationSettings.defaultReservationDays,
        clientVisitorId: cart.visitorId,
        clientSessionId: cart.sessionId,
        items: cart.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          size: item.size,
          quantity: item.quantity,
        })),
      });

      setCompletedReservation({
        ...result,
        items: cart.items,
        customerName,
      });

      cart.finishSession();
      setForm(emptyForm);
    } catch (error) {
      console.error("Error creando el apartado del carrito:", error);

      alert(
        error?.message ||
          "No se pudo registrar el apartado. Revisa el stock e inténtalo nuevamente."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (completedReservation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-4 py-8 text-black">
        <section className="w-full max-w-2xl rounded-[32px] border border-black/[0.06] bg-white p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.08)] sm:p-8">
          <img
            src="/logo.png"
            alt="Master Caps"
            className="mx-auto h-24 w-auto object-contain"
          />

          <div className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={34} />
          </div>

          <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-600">
            Apartado confirmado
          </p>

          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.045em]">
            Tus prendas quedaron separadas
          </h1>

          <p className="mt-3 text-[14px] leading-6 text-black/50">
            Hola {completedReservation.customerName}, tu apartado fue registrado
            correctamente.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Número de apartado"
              value={completedReservation.reservationGroupNumber}
              highlighted
            />

            <SummaryCard
              label="Prendas"
              value={`${completedReservation.totalItems} unidad(es)`}
            />

            <SummaryCard
              label="Total"
              value={formatCurrency(completedReservation.subtotal)}
            />
          </div>

          <div className="mt-5 rounded-[26px] bg-black/[0.025] p-4 text-left">
            <div className="flex items-center gap-2">
              <CalendarClock size={17} className="text-red-600" />

              <p className="text-[12px] font-medium">
                Vigencia del apartado
              </p>
            </div>

            <p className="mt-2 text-[12px] leading-5 text-black/50">
              Este apartado fue creado por{" "}
              <span className="font-medium text-black">
                {completedReservation.reservationDays} día(s)
              </span>
              . Puedes retirar o pagar tus prendas hasta{" "}
              <span className="font-medium text-black">
                {formatExpirationDate(completedReservation.expiresAt)}
              </span>
              .
            </p>
          </div>

          <div className="mt-5 rounded-[26px] border border-black/[0.06] bg-white p-4 text-left">
            <p className="text-[12px] font-medium">Resumen de productos</p>

            <div className="mt-3 divide-y divide-black/[0.06]">
              {completedReservation.items.map((item) => (
                <div
                  key={item.cartKey}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-black/[0.025]">
                      {item.coverUrl ? (
                        <img
                          src={item.coverUrl}
                          alt={item.productName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ShoppingBag
                            size={20}
                            className="text-black/20"
                          />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium">
                        {item.productName}
                      </p>

                      <p className="mt-1 text-[10px] text-black/45">
                        Talla {item.size} · {item.quantity} unidad(es)
                      </p>
                    </div>
                  </div>

                  <p className="shrink-0 text-[12px] font-medium">
                    {formatCurrency(item.unitPrice * item.quantity)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate(`/catalogo/${storeId}`)}
            className="mt-6 h-12 w-full rounded-2xl bg-red-600 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
          >
            Volver al catálogo
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fafafa] text-black">
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-black/[0.06] bg-white/95 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <Link
          to={`/catalogo/${storeId}`}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-4 text-[13px] font-medium transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <ArrowLeft size={16} />
          Catálogo
        </Link>

        <img
          src="/logo.png"
          alt="Master Caps"
          className="h-12 w-auto object-contain"
        />
      </header>

      <section className="mx-auto grid w-full max-w-[1240px] gap-5 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_410px] lg:px-6">
        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/[0.06] sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <User size={19} />
            </div>

            <div>
              <p className="text-[11px] font-medium text-red-600">
                Último paso
              </p>

              <h1 className="text-[24px] font-semibold tracking-[-0.04em]">
                Datos para el apartado
              </h1>
            </div>
          </div>

          <p className="mt-4 text-[12px] leading-5 text-black/45">
            Ingresa los datos una sola vez para reservar todos los productos del
            carrito.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <InputField
              icon={User}
              label="Nombre completo"
              value={form.customerName}
              onChange={(value) => updateForm("customerName", value)}
              placeholder="Ej: Sergio Martínez"
              autoComplete="name"
            />

            <InputField
              icon={IdCard}
              label="Cédula"
              value={form.customerDocument}
              onChange={(value) => updateForm("customerDocument", value)}
              placeholder="Ej: 1000000000"
              inputMode="numeric"
            />

            <InputField
              icon={Phone}
              label="Teléfono"
              value={form.customerPhone}
              onChange={(value) => updateForm("customerPhone", value)}
              placeholder="Ej: 3000000000"
              inputMode="tel"
              autoComplete="tel"
            />

            <div className="rounded-[22px] border border-red-100 bg-red-50/70 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  size={20}
                  className="mt-0.5 shrink-0 text-red-600"
                />

                <div>
                  <p className="text-[12px] font-medium">
                    Reserva protegida
                  </p>

                  <p className="mt-1 text-[11px] leading-5 text-black/55">
                    Antes de confirmar, el sistema valida nuevamente todas las
                    tallas y cantidades. Si alguna no tiene stock, no se
                    registrará ningún apartado parcial.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/20 disabled:shadow-none"
            >
              <ShoppingBag size={17} />

              {submitting
                ? "Validando y registrando..."
                : "Confirmar apartado completo"}
            </button>
          </form>
        </section>

        <aside className="h-fit rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-black/[0.06] lg:sticky lg:top-[92px]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-red-600">
                Resumen
              </p>

              <h2 className="text-[19px] font-semibold tracking-[-0.03em]">
                Tu carrito
              </h2>
            </div>

            <span className="rounded-full bg-red-50 px-3 py-1.5 text-[10px] font-medium text-red-600">
              {cart.summary.totalItems} unidad(es)
            </span>
          </div>

          {cart.items.length === 0 ? (
            <div className="mt-4 rounded-[22px] bg-black/[0.025] p-7 text-center">
              <ShoppingBag size={29} className="mx-auto text-black/20" />

              <p className="mt-3 text-[13px] font-medium">
                Tu carrito está vacío
              </p>

              <p className="mt-1 text-[10px] leading-5 text-black/40">
                Agrega productos y tallas desde el catálogo.
              </p>

              <Link
                to={`/catalogo/${storeId}`}
                className="mt-4 inline-flex text-[12px] font-medium text-red-600"
              >
                Volver al catálogo
              </Link>
            </div>
          ) : (
            <div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.18)_transparent]">
              {cart.items.map((item) => (
                <article
                  key={item.cartKey}
                  className="flex gap-3 rounded-[18px] border border-black/[0.06] p-3"
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-black/[0.025]">
                    {item.coverUrl ? (
                      <img
                        src={item.coverUrl}
                        alt={item.productName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ShoppingBag
                          size={18}
                          className="text-black/20"
                        />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[11px] font-medium">
                      {item.productName}
                    </p>

                    <p className="mt-1 text-[9px] text-black/45">
                      Talla {item.size} · {item.quantity} unidad(es)
                    </p>

                    <p className="mt-2 text-[12px] font-medium">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => cart.removeItem(item.cartKey)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50"
                    aria-label={`Eliminar ${item.productName}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </article>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-black/[0.07] pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-black/45">
                Productos diferentes
              </span>

              <span className="text-[12px] font-medium">
                {cart.summary.uniqueItems}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-black/45">
                Total de prendas
              </span>

              <span className="text-[12px] font-medium">
                {cart.summary.totalItems}
              </span>
            </div>

            <div className="mt-4 flex items-end justify-between border-t border-black/[0.07] pt-4">
              <span className="text-[11px] text-black/45">Total</span>

              <strong className="text-[27px] font-semibold tracking-[-0.05em]">
                {formatCurrency(cart.summary.total)}
              </strong>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function InputField({
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  autoComplete,
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium">{label}</span>

      <div className="relative mt-2">
        <Icon
          size={17}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/30"
        />

        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] outline-none transition placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
        />
      </div>
    </label>
  );
}

function SummaryCard({ label, value, highlighted = false }) {
  return (
    <div
      className={`rounded-[20px] p-4 text-left ${
        highlighted
          ? "bg-red-600 text-white"
          : "bg-black/[0.025] text-black"
      }`}
    >
      <p
        className={`text-[10px] ${
          highlighted ? "text-white/70" : "text-black/40"
        }`}
      >
        {label}
      </p>

      <p className="mt-2 break-words text-[14px] font-medium">{value}</p>
    </div>
  );
}