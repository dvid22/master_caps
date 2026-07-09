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

      if (!Number.isFinite(currentNumber) || currentNumber <= 0) {
        return "1";
      }

      if (currentNumber > availableStock) {
        return String(availableStock);
      }

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
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <div className="rounded-3xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          Cargando producto en tiempo real...
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <h1 className="text-2xl font-semibold text-brand-black">
            Producto no encontrado
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            La prenda que intentas apartar no existe o fue eliminada.
          </p>

          <Link
            to={`/catalogo/${storeId}`}
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white"
          >
            Volver al catálogo
          </Link>
        </section>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4 py-8">
        <section className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 size={34} className="text-green-700" />
          </div>

          <h1 className="mt-5 text-2xl font-semibold text-brand-black">
            Prenda apartada correctamente
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-600">
            Tu apartado quedó registrado. Tienes 7 días para retirar o pagar la
            prenda. Después de ese tiempo, podrá volver a estar disponible.
          </p>

          <div className="mt-6 rounded-3xl bg-brand-cream p-4 text-left">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
              Producto
            </p>

            <p className="mt-1 font-semibold text-brand-black">
              {product.name}
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Código: {product.code} · Talla: {productSize}
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Cantidad apartada: {reservedQuantity}
            </p>

            <p className="mt-2 text-lg font-semibold text-brand-black">
              {formatCurrency(
                Number(product.salePrice || 0) * Number(reservedQuantity || 1)
              )}
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              to={`/catalogo/${storeId}`}
              className="flex-1 rounded-2xl border border-black/10 px-5 py-3 text-sm font-semibold text-brand-black hover:border-brand-black"
            >
              Ver más prendas
            </Link>

            <button
              type="button"
              onClick={() => navigate(`/catalogo/${storeId}`)}
              className="flex-1 rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white hover:bg-black"
            >
              Finalizar
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-brand-cream px-4 py-6 sm:px-6">
      <section className="mx-auto w-full max-w-7xl">
        <Link
          to={`/catalogo/${storeId}`}
          className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-brand-black hover:border-brand-black"
        >
          <ArrowLeft size={17} />
          Volver al catálogo
        </Link>

        <section className="mt-6 grid w-full overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
          <div className="min-w-0 bg-gray-100">
            <div className="aspect-[4/5] lg:h-full lg:min-h-[640px]">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-400">
                  <Camera size={44} />
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 p-6 sm:p-8">
            <p className="break-words text-xs font-medium uppercase tracking-wide text-brand-gold">
              {product.categoryName}
            </p>

            <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-brand-black">
              {product.name}
            </h1>

            <p className="mt-2 break-words text-sm text-gray-500">
              Código: {product.code}
            </p>

            <p className="mt-1 break-words text-sm font-medium text-brand-black">
              Talla: {productSize}
            </p>

            <p className="mt-5 text-3xl font-semibold text-brand-black">
              {formatCurrency(product.salePrice)}
            </p>

            <div
              className={`mt-5 rounded-3xl p-4 ${
                isAvailable
                  ? "bg-green-50 text-green-800"
                  : "bg-red-50 text-red-700"
              }`}
            >
              <p className="break-words text-sm font-semibold">
                {isAvailable
                  ? `${availableStock} unidad(es) disponible(s)`
                  : "Esta prenda ya no está disponible"}
              </p>
            </div>

            <div className="mt-5 rounded-3xl bg-brand-cream p-4">
              <div className="flex min-w-0 items-start gap-3">
                <CalendarClock
                  size={22}
                  className="mt-0.5 shrink-0 text-brand-black"
                />

                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-black">
                    Apartado por 7 días
                  </p>

                  <p className="mt-1 break-words text-sm leading-6 text-gray-600">
                    Registra tus datos para separar esta prenda. Si no se retira
                    durante la semana, volverá a estar disponible.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-brand-black">
                  Cantidad a apartar
                </label>

                <div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3">
                  <button
                    type="button"
                    onClick={decreaseQuantity}
                    disabled={!isAvailable || cleanQuantity <= 1}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 hover:border-brand-black disabled:cursor-not-allowed disabled:opacity-50"
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
                    className="h-11 min-w-0 rounded-2xl border border-black/10 px-4 text-center text-sm outline-none focus:border-brand-black disabled:bg-gray-100"
                  />

                  <button
                    type="button"
                    onClick={increaseQuantity}
                    disabled={!isAvailable || cleanQuantity >= availableStock}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 hover:border-brand-black disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={17} />
                  </button>
                </div>

                <div className="mt-3 rounded-3xl bg-brand-cream p-4">
                  <p className="text-xs text-gray-500">Total apartado</p>

                  <p className="mt-1 text-2xl font-semibold text-brand-black">
                    {formatCurrency(totalReservation)}
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    Stock disponible: {availableStock}
                  </p>
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-brand-black">
                  Nombre completo
                </span>

                <div className="relative mt-2">
                  <User
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    value={form.customerName}
                    onChange={(event) =>
                      updateForm("customerName", event.target.value)
                    }
                    className="h-12 w-full rounded-2xl border border-black/10 pl-11 pr-4 text-sm outline-none focus:border-brand-black"
                    placeholder="Ej: Juan Pérez"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-brand-black">
                  Cédula
                </span>

                <div className="relative mt-2">
                  <IdCard
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    value={form.customerDocument}
                    onChange={(event) =>
                      updateForm("customerDocument", event.target.value)
                    }
                    className="h-12 w-full rounded-2xl border border-black/10 pl-11 pr-4 text-sm outline-none focus:border-brand-black"
                    placeholder="Ej: 1000000000"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-brand-black">
                  Teléfono opcional
                </span>

                <div className="relative mt-2">
                  <Phone
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    value={form.customerPhone}
                    onChange={(event) =>
                      updateForm("customerPhone", event.target.value)
                    }
                    className="h-12 w-full rounded-2xl border border-black/10 pl-11 pr-4 text-sm outline-none focus:border-brand-black"
                    placeholder="Ej: 3000000000"
                  />
                </div>
              </label>

              <button
                type="submit"
                disabled={reserving || !isAvailable}
                className="w-full rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {reserving ? "Apartando prenda..." : "Confirmar apartado"}
              </button>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}