import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  Camera,
  CheckCircle2,
  IdCard,
  Minus,
  Phone,
  Plus,
  ShieldCheck,
  ShoppingBag,
  User,
} from "lucide-react";

import { subscribeProducts } from "../../services/products.service";
import { createReservation } from "../../services/reservations.service";
import { formatCurrency } from "../../utils/money";

const emptyForm = {
  customerName: "",
  customerDocument: "",
  customerPhone: "",
};

export default function ReserveProductPage() {
  const { storeId = "master-caps", productId } = useParams();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [quantity, setQuantity] = useState("1");
  const [reservedQuantity, setReservedQuantity] = useState(1);

  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
        setLoading(false);
      },
      () => {
        setLoading(false);
        alert("No se pudo cargar el producto en tiempo real.");
      },
      storeId
    );

    return () => {
      unsubscribeProducts();
    };
  }, [storeId]);

  const product = useMemo(() => {
    return products.find((item) => item.id === productId) || null;
  }, [products, productId]);

  const availableStock = Number(product?.stock || 0);
  const isAvailable = availableStock > 0;
  const productSize = product?.size || "Talla única";

  const cleanQuantity = useMemo(() => {
    const number = Number(quantity || 1);
    if (!Number.isFinite(number) || number <= 0) return 1;
    return number;
  }, [quantity]);

  const totalReservation = useMemo(() => {
    return Number(product?.salePrice || 0) * cleanQuantity;
  }, [product?.salePrice, cleanQuantity]);

  useEffect(() => {
    if (!product || success) return;

    if (availableStock <= 0) {
      setQuantity("1");
      return;
    }

    setQuantity((current) => {
      const currentNumber = Number(current || 1);

      if (!Number.isFinite(currentNumber) || currentNumber <= 0) return "1";
      if (currentNumber > availableStock) return String(availableStock);

      return current;
    });
  }, [product, availableStock, success]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function increaseQuantity() {
    if (!isAvailable) return;

    const current = Number(quantity || 1);
    const next = Math.min(current + 1, availableStock);

    setQuantity(String(next || 1));
  }

  function decreaseQuantity() {
    const current = Number(quantity || 1);
    const next = Math.max(current - 1, 1);

    setQuantity(String(next));
  }

  function handleQuantityChange(value) {
    const number = Number(value || 1);

    if (!Number.isFinite(number)) {
      setQuantity("1");
      return;
    }

    const safeQuantity = Math.min(Math.max(number, 1), availableStock || 1);
    setQuantity(String(safeQuantity));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!product) {
      alert("No se encontró el producto.");
      return;
    }

    if (!isAvailable) {
      alert("Esta prenda ya no está disponible.");
      return;
    }

    const finalQuantity = Number(quantity || 1);

    if (!Number.isFinite(finalQuantity) || finalQuantity <= 0) {
      alert("La cantidad debe ser mayor a cero.");
      return;
    }

    if (finalQuantity > availableStock) {
      alert(`Solo hay ${availableStock} unidad(es) disponibles.`);
      return;
    }

    const customerName = form.customerName.trim();
    const customerDocument = form.customerDocument.trim();
    const customerPhone = form.customerPhone.trim();

    if (!customerName) {
      alert("Escribe tu nombre.");
      return;
    }

    if (!customerDocument) {
      alert("Escribe tu cédula.");
      return;
    }

    try {
      setReserving(true);

      await createReservation({
        productId: product.id,
        quantity: finalQuantity,
        customerName,
        customerDocument,
        customerPhone,
        storeId,
      });

      setReservedQuantity(finalQuantity);
      setSuccess(true);
      setForm(emptyForm);
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo apartar la prenda.");
    } finally {
      setReserving(false);
    }
  }

  if (loading) {
    return (
      <CenteredState message="Cargando producto en tiempo real..." />
    );
  }

  if (!product) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-5">
        <section className="w-full max-w-md rounded-[30px] bg-white p-7 text-center shadow-[0_18px_55px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06]">
          <img
            src="/logo.png"
            alt="Master Caps"
            className="mx-auto h-24 w-auto object-contain"
          />

          <h1 className="mt-5 text-[24px] font-medium tracking-[-0.04em] text-black">
            Producto no encontrado
          </h1>

          <p className="mt-2 text-[13px] leading-6 text-black/50">
            La prenda que intentas apartar no existe o fue eliminada.
          </p>

          <Link
            to={`/catalogo/${storeId}`}
            className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
          >
            Volver al catálogo
          </Link>
        </section>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-5 py-7">
        <section className="w-full max-w-lg rounded-[32px] bg-white p-6 text-center shadow-[0_18px_55px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] sm:p-8">
          <img
            src="/logo.png"
            alt="Master Caps"
            className="mx-auto h-24 w-auto object-contain"
          />

          <div className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 size={34} className="text-emerald-600" />
          </div>

          <h1 className="mt-5 text-[25px] font-medium tracking-[-0.04em] text-black">
            Prenda apartada correctamente
          </h1>

          <p className="mt-3 text-[14px] leading-6 text-black/55">
            Tu apartado quedó registrado. Tienes 7 días para retirar o pagar la
            prenda. Después de ese tiempo, podrá volver a estar disponible.
          </p>

          <div className="mt-6 rounded-[26px] bg-black/[0.025] p-4 text-left">
            <p className="text-[12px] font-medium text-red-600">Producto</p>

            <p className="mt-1 text-[16px] font-medium text-black">
              {product.name}
            </p>

            <p className="mt-1 text-[13px] text-black/50">
              Código: {product.code} · Talla: {productSize}
            </p>

            <p className="mt-1 text-[13px] text-black/50">
              Cantidad apartada: {reservedQuantity}
            </p>

            <p className="mt-3 text-[22px] font-medium tracking-[-0.04em] text-black">
              {formatCurrency(
                Number(product.salePrice || 0) * Number(reservedQuantity || 1)
              )}
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link
              to={`/catalogo/${storeId}`}
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-black/[0.08] px-5 text-[14px] font-medium text-black transition hover:bg-black/[0.035]"
            >
              Ver más prendas
            </Link>

            <button
              type="button"
              onClick={() => navigate(`/catalogo/${storeId}`)}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
            >
              Finalizar
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <section className="mx-auto min-h-screen w-full max-w-[1500px] px-5 py-6 sm:px-6 lg:px-7">
        <header className="mb-5 flex items-center justify-between gap-4">
          <Link
            to={`/catalogo/${storeId}`}
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-medium text-black shadow-[0_10px_30px_rgba(0,0,0,0.025)] transition hover:bg-red-50 hover:text-red-600"
          >
            <ArrowLeft size={17} />
            Volver
          </Link>

          <img
            src="/logo.png"
            alt="Master Caps"
            className="h-16 w-auto object-contain sm:h-20"
          />
        </header>

        <section className="grid overflow-hidden rounded-[32px] bg-white shadow-[0_18px_55px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] lg:grid-cols-[minmax(0,1.05fr)_minmax(390px,480px)]">
          <div className="min-w-0 bg-black/[0.025]">
            <div className="relative aspect-[4/4.2] lg:h-full lg:min-h-[700px]">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-black/30">
                  <Camera size={48} />
                </div>
              )}

              <span className="absolute left-4 top-4 rounded-full bg-red-600 px-4 py-1.5 text-[12px] font-medium text-white shadow-lg shadow-red-600/20">
                Disponible
              </span>
            </div>
          </div>

          <div className="min-w-0 p-5 sm:p-6 lg:p-7">
            <p className="text-[12px] font-normal text-black/45">
              {product.code || "Sin código"} · {product.categoryName}
            </p>

            <h1 className="mt-2 text-[30px] font-medium leading-tight tracking-[-0.05em] text-black sm:text-[36px]">
              {product.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black/[0.035] px-3 py-1.5 text-[12px] text-black/60">
                {productSize}
              </span>

              <span
                className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${
                  isAvailable
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-red-50 text-red-600"
                }`}
              >
                {isAvailable
                  ? `${availableStock} disponible(s)`
                  : "No disponible"}
              </span>
            </div>

            <p className="mt-5 text-[32px] font-medium tracking-[-0.05em] text-black">
              {formatCurrency(product.salePrice)}
            </p>

            <div className="mt-5 rounded-[24px] bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <CalendarClock size={22} className="mt-0.5 text-red-600" />

                <div>
                  <p className="text-[14px] font-medium text-black">
                    Apartado por 7 días
                  </p>

                  <p className="mt-1 text-[13px] leading-5 text-black/55">
                    Registra tus datos para separar esta prenda. Si no se retira
                    durante la semana, volverá a estar disponible.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <section className="rounded-[24px] border border-black/[0.06] bg-white p-4">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-black">
                    Cantidad
                  </label>

                  <p className="text-[12px] text-black/45">
                    Stock: {availableStock}
                  </p>
                </div>

                <div className="mt-3 grid grid-cols-[44px_1fr_44px] items-center gap-3">
                  <button
                    type="button"
                    onClick={decreaseQuantity}
                    disabled={!isAvailable || cleanQuantity <= 1}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/[0.08] transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Minus size={17} />
                  </button>

                  <input
                    type="number"
                    min="1"
                    max={availableStock}
                    value={quantity}
                    onChange={(event) =>
                      handleQuantityChange(event.target.value)
                    }
                    disabled={!isAvailable}
                    className="h-11 min-w-0 rounded-2xl border border-black/[0.08] px-4 text-center text-[14px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025]"
                  />

                  <button
                    type="button"
                    onClick={increaseQuantity}
                    disabled={!isAvailable || cleanQuantity >= availableStock}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/[0.08] transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Plus size={17} />
                  </button>
                </div>

                <div className="mt-4 rounded-2xl bg-black/[0.025] p-4">
                  <p className="text-[12px] text-black/45">Total apartado</p>

                  <p className="mt-1 text-[24px] font-medium tracking-[-0.04em] text-black">
                    {formatCurrency(totalReservation)}
                  </p>
                </div>
              </section>

              <InputField
                icon={User}
                label="Nombre completo"
                value={form.customerName}
                onChange={(value) => updateForm("customerName", value)}
                placeholder="Ej: Juan Pérez"
              />

              <InputField
                icon={IdCard}
                label="Cédula"
                value={form.customerDocument}
                onChange={(value) => updateForm("customerDocument", value)}
                placeholder="Ej: 1000000000"
              />

              <InputField
                icon={Phone}
                label="Teléfono opcional"
                value={form.customerPhone}
                onChange={(value) => updateForm("customerPhone", value)}
                placeholder="Ej: 3000000000"
              />

              <button
                type="submit"
                disabled={reserving || !isAvailable}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/20 disabled:shadow-none"
              >
                <ShoppingBag size={17} />
                {reserving ? "Apartando prenda..." : "Confirmar apartado"}
              </button>
            </form>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MiniBenefit icon={ShieldCheck} title="Compra segura" />
              <MiniBenefit icon={CalendarClock} title="Reserva por 7 días" />
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function CenteredState({ message }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5">
      <div className="rounded-[28px] bg-white p-8 text-center text-[14px] text-black/50 shadow-[0_18px_55px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06]">
        {message}
      </div>
    </main>
  );
}

function InputField({ icon: Icon, label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-black">{label}</span>

      <div className="relative mt-2">
        <Icon
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
        />

        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[14px] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
          placeholder={placeholder}
        />
      </div>
    </label>
  );
}

function MiniBenefit({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-black/[0.025] px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
        <Icon size={17} />
      </div>

      <p className="text-[13px] font-medium text-black">{title}</p>
    </div>
  );
}