import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";
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
  if (!value) {
    return "";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "es-CO",
    {
      dateStyle: "long",
      timeStyle: "short",
    }
  ).format(date);
}

export default function ReservationCheckoutPage() {
  const { storeId = "master-caps" } =
    useParams();

  const navigate = useNavigate();
  const cart = useReservationCart(storeId);

  const [
    reservationSettings,
    setReservationSettings,
  ] = useState({
    defaultReservationDays: 7,
  });

  const [form, setForm] =
    useState(emptyForm);

  const [submitting, setSubmitting] =
    useState(false);

  const [
    completedReservation,
    setCompletedReservation,
  ] = useState(null);

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
      form.customerName.trim().length >
        0 &&
      form.customerDocument.trim()
        .length > 0 &&
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

    const customerName =
      form.customerName.trim();

    const customerDocument =
      form.customerDocument.trim();

    const customerPhone =
      form.customerPhone.trim();

    if (!customerName) {
      alert(
        "Escribe tu nombre completo."
      );
      return;
    }

    if (!customerDocument) {
      alert("Escribe tu cédula.");
      return;
    }

    try {
      setSubmitting(true);

      const result =
        await createReservationCart({
          storeId,
          customerName,
          customerDocument,
          customerPhone,
          reservationDays:
            reservationSettings.defaultReservationDays,
          clientVisitorId:
            cart.visitorId,
          clientSessionId:
            cart.sessionId,
          items: cart.items.map(
            (item) => ({
              productId:
                item.productId,
              variantId:
                item.variantId,
              size: item.size,
              quantity:
                item.quantity,
            })
          ),
        });

      setCompletedReservation({
        ...result,
        items: cart.items,
        customerName,
      });

      cart.finishSession();
      setForm(emptyForm);
    } catch (error) {
      console.error(
        "Error creando el apartado del carrito:",
        error
      );

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
      <main className="min-h-screen bg-white text-black">
        <div className="bg-black px-4 py-2 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-white sm:text-[11px]">
          Apartado confirmado · Master Caps
        </div>

        <header className="border-b border-black/[0.08] bg-white">
          <div className="mx-auto flex min-h-[104px] max-w-[1500px] items-center justify-center px-4 sm:min-h-[116px]">
            <img
              src="/logo.png"
              alt="Master Caps"
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="h-[76px] w-auto object-contain sm:h-[94px]"
            />
          </div>
        </header>

        <section className="mx-auto max-w-[1120px] px-4 py-10 sm:px-6 sm:py-14">
          <div className="mx-auto max-w-[760px] text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={34} />
            </div>

            <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-700">
              Apartado confirmado
            </p>

            <h1 className="mt-3 text-[32px] font-medium uppercase leading-tight tracking-[-0.045em] sm:text-[48px]">
              Tus productos quedaron separados
            </h1>

            <p className="mx-auto mt-4 max-w-[620px] text-[13px] leading-6 text-black/50">
              Hola{" "}
              <span className="font-medium text-black">
                {
                  completedReservation.customerName
                }
              </span>
              , tu apartado fue registrado correctamente.
            </p>
          </div>

          <div className="mt-9 grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Número de apartado"
              value={
                completedReservation.reservationGroupNumber
              }
              highlighted
            />

            <SummaryCard
              label="Productos"
              value={`${completedReservation.totalItems} unidad(es)`}
            />

            <SummaryCard
              label="Total"
              value={formatCurrency(
                completedReservation.subtotal
              )}
            />
          </div>

          <section className="mt-5 border border-black/[0.08] bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <CalendarClock
                size={20}
                className="mt-0.5 shrink-0 text-red-600"
              />

              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.1em]">
                  Vigencia del apartado
                </p>

                <p className="mt-2 text-[12px] leading-6 text-black/50">
                  Este apartado fue creado por{" "}
                  <span className="font-medium text-black">
                    {
                      completedReservation.reservationDays
                    }{" "}
                    día(s)
                  </span>
                  . Puedes retirar o pagar tus productos hasta{" "}
                  <span className="font-medium text-black">
                    {formatExpirationDate(
                      completedReservation.expiresAt
                    )}
                  </span>
                  .
                </p>
              </div>
            </div>
          </section>

          <section className="mt-5 border border-black/[0.08] bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.08] pb-4">
              <div>
                <p className="text-[9px] uppercase tracking-[0.18em] text-black/40">
                  Resumen
                </p>

                <h2 className="mt-1 text-[20px] font-medium uppercase tracking-[-0.03em]">
                  Productos apartados
                </h2>
              </div>

              <span className="text-[10px] text-black/45">
                {
                  completedReservation.items
                    .length
                }{" "}
                referencia(s)
              </span>
            </div>

            <div className="divide-y divide-black/[0.08]">
              {completedReservation.items.map(
                (item) => (
                  <article
                    key={item.cartKey}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-20 w-16 shrink-0 overflow-hidden bg-white ring-1 ring-black/[0.08]">
                        {item.coverUrl ? (
                          <img
                            src={
                              item.coverUrl
                            }
                            alt={
                              item.productName
                            }
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-contain p-1"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <ShoppingBag
                              size={19}
                              className="text-black/20"
                            />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="line-clamp-2 text-[11px] font-medium uppercase leading-5">
                          {
                            item.productName
                          }
                        </p>

                        <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-black/42">
                          Talla {item.size} ·{" "}
                          {item.quantity} unidad(es)
                        </p>
                      </div>
                    </div>

                    <p className="shrink-0 text-[12px] font-medium">
                      {formatCurrency(
                        item.unitPrice *
                          item.quantity
                      )}
                    </p>
                  </article>
                )
              )}
            </div>
          </section>

          <button
            type="button"
            onClick={() =>
              navigate(
                `/catalogo/${storeId}`
              )
            }
            className="mt-6 h-14 w-full bg-black text-[10px] font-medium uppercase tracking-[0.18em] text-white transition hover:bg-red-600"
          >
            Volver al catálogo
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white pb-24 text-black lg:pb-0">
      <div className="bg-black px-4 py-2 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-white sm:text-[11px]">
        Aparta tus productos favoritos · Stock real
      </div>

      <header className="sticky top-0 z-30 border-b border-black/[0.08] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[104px] max-w-[1500px] items-center justify-between gap-4 px-4 sm:min-h-[116px] sm:px-6 lg:px-8">
          <Link
            to={`/catalogo/${storeId}`}
            className="inline-flex h-11 items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] transition hover:text-red-600"
          >
            <ArrowLeft size={17} />
            <span className="hidden sm:inline">
              Volver al catálogo
            </span>
          </Link>

          <img
            src="/logo.png"
            alt="Master Caps"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="h-[74px] w-auto object-contain sm:h-[90px] lg:h-[100px]"
          />

          <div className="relative flex h-11 w-11 items-center justify-center">
            <ShoppingBag size={21} />

            {cart.summary.totalItems >
              0 && (
              <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-medium text-white ring-2 ring-white">
                {
                  cart.summary
                    .totalItems
                }
              </span>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1320px] gap-8 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_430px] lg:px-8 lg:py-10">
        <section>
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-red-600">
              Último paso
            </p>

            <h1 className="mt-2 text-[30px] font-medium uppercase leading-tight tracking-[-0.045em] sm:text-[42px]">
              Datos para el apartado
            </h1>

            <p className="mt-3 max-w-[640px] text-[12px] leading-6 text-black/48">
              Ingresa tus datos una sola vez para reservar todos los productos del carrito.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-8 border-t border-black/[0.1] pt-7"
          >
            <div className="grid gap-5">
              <InputField
                icon={User}
                label="Nombre completo"
                value={
                  form.customerName
                }
                onChange={(value) =>
                  updateForm(
                    "customerName",
                    value
                  )
                }
                placeholder="Ej: Sergio Martínez"
                autoComplete="name"
              />

              <InputField
                icon={IdCard}
                label="Cédula"
                value={
                  form.customerDocument
                }
                onChange={(value) =>
                  updateForm(
                    "customerDocument",
                    value
                  )
                }
                placeholder="Ej: 1000000000"
                inputMode="numeric"
              />

              <InputField
                icon={Phone}
                label="Teléfono"
                value={
                  form.customerPhone
                }
                onChange={(value) =>
                  updateForm(
                    "customerPhone",
                    value
                  )
                }
                placeholder="Ej: 3000000000"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>

            <div className="mt-6 border border-red-100 bg-red-50/70 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  size={20}
                  className="mt-0.5 shrink-0 text-red-600"
                />

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em]">
                    Reserva protegida
                  </p>

                  <p className="mt-1 text-[10px] leading-5 text-black/52">
                    Antes de confirmar, el sistema valida nuevamente todas las tallas y cantidades. Si alguna no tiene stock, no se registrará ningún apartado parcial.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-6 hidden h-14 w-full items-center justify-center gap-3 bg-black text-[10px] font-medium uppercase tracking-[0.18em] text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-black/20 lg:inline-flex"
            >
              <ShoppingBag size={17} />

              {submitting
                ? "Validando y registrando..."
                : "Confirmar apartado completo"}
            </button>
          </form>
        </section>

        <aside className="h-fit border border-black/[0.08] bg-white p-4 lg:sticky lg:top-[145px] sm:p-5">
          <div className="flex items-center justify-between gap-3 border-b border-black/[0.08] pb-4">
            <div>
              <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-red-600">
                Resumen
              </p>

              <h2 className="mt-1 text-[20px] font-medium uppercase tracking-[-0.03em]">
                Tu carrito
              </h2>
            </div>

            <span className="text-[10px] text-black/45">
              {
                cart.summary.totalItems
              }{" "}
              unidad(es)
            </span>
          </div>

          {cart.items.length === 0 ? (
            <div className="py-10 text-center">
              <ShoppingBag
                size={29}
                className="mx-auto text-black/20"
              />

              <p className="mt-4 text-[12px] font-medium uppercase">
                Tu carrito está vacío
              </p>

              <p className="mt-2 text-[10px] leading-5 text-black/40">
                Agrega productos y tallas desde el catálogo.
              </p>

              <Link
                to={`/catalogo/${storeId}`}
                className="mt-5 inline-flex border-b border-black pb-1 text-[9px] font-medium uppercase tracking-[0.16em]"
              >
                Volver al catálogo
              </Link>
            </div>
          ) : (
            <div className="mt-4 max-h-[470px] space-y-1 overflow-y-auto pr-1">
              {cart.items.map((item) => (
                <article
                  key={item.cartKey}
                  className="flex gap-3 border-b border-black/[0.07] py-3 last:border-0"
                >
                  <div className="h-[88px] w-[70px] shrink-0 overflow-hidden bg-white ring-1 ring-black/[0.08]">
                    {item.coverUrl ? (
                      <img
                        src={
                          item.coverUrl
                        }
                        alt={
                          item.productName
                        }
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain p-1"
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
                    <p className="line-clamp-2 text-[10px] font-medium uppercase leading-5">
                      {
                        item.productName
                      }
                    </p>

                    <p className="mt-1 text-[9px] uppercase tracking-[0.06em] text-black/42">
                      Talla {item.size} ·{" "}
                      {item.quantity} unidad(es)
                    </p>

                    <p className="mt-2 text-[12px] font-medium">
                      {formatCurrency(
                        item.unitPrice *
                          item.quantity
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      cart.removeItem(
                        item.cartKey
                      )
                    }
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-red-600 transition hover:bg-red-50"
                    aria-label={`Eliminar ${item.productName}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </article>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-black/[0.08] pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.08em] text-black/42">
                Productos diferentes
              </span>

              <span className="text-[11px] font-medium">
                {
                  cart.summary
                    .uniqueItems
                }
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.08em] text-black/42">
                Total de productos
              </span>

              <span className="text-[11px] font-medium">
                {
                  cart.summary
                    .totalItems
                }
              </span>
            </div>

            <div className="mt-5 flex items-end justify-between border-t border-black/[0.08] pt-5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-black/42">
                Total
              </span>

              <strong className="text-[28px] font-medium tracking-[-0.05em]">
                {formatCurrency(
                  cart.summary.total
                )}
              </strong>
            </div>
          </div>
        </aside>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.1] bg-white px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-14px_40px_rgba(0,0,0,0.08)] lg:hidden">
        <button
          type="button"
          onClick={() => {
            const formElement =
              document.querySelector(
                "form"
              );

            formElement?.requestSubmit();
          }}
          disabled={!canSubmit}
          className="flex min-h-[58px] w-full items-center justify-center bg-black px-4 py-4 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-black/20"
        >
          {submitting
            ? "Validando y registrando..."
            : `Confirmar apartado · ${formatCurrency(
                cart.summary.total
              )}`}
        </button>
      </div>
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
      <span className="text-[10px] font-medium uppercase tracking-[0.12em]">
        {label}
      </span>

      <div className="relative mt-2">
        <Icon
          size={17}
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-black/35"
        />

        <input
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value
            )
          }
          className="h-13 w-full border-b border-black/[0.22] bg-white pl-8 pr-2 text-[13px] outline-none transition placeholder:text-black/28 focus:border-black"
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
        />
      </div>
    </label>
  );
}

function SummaryCard({
  label,
  value,
  highlighted = false,
}) {
  return (
    <div
      className={`min-h-[126px] border p-5 ${
        highlighted
          ? "border-black bg-black text-white"
          : "border-black/[0.08] bg-white text-black"
      }`}
    >
      <p
        className={`text-[9px] uppercase tracking-[0.16em] ${
          highlighted
            ? "text-white/60"
            : "text-black/40"
        }`}
      >
        {label}
      </p>

      <p className="mt-4 break-words text-[15px] font-medium">
        {value}
      </p>
    </div>
  );
}