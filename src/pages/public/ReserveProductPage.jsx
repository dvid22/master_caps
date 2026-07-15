import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Images,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";

import {
  getProductImages,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";
import { useReservationCart } from "../../services/reservationCart.store";
import ReservationCartDrawer from "../../components/catalog/ReservationCartDrawer";
import { subscribeReservationSettings } from "../../services/reservations.service";
import { formatCurrency } from "../../utils/money";

function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

export default function ReserveProductPage() {
  const { storeId = "master-caps", productId } = useParams();
  const navigate = useNavigate();

  const cart = useReservationCart(storeId);

  const [products, setProducts] = useState([]);
  const [reservationSettings, setReservationSettings] = useState({
    defaultReservationDays: 7,
  });
  const [quantity, setQuantity] = useState("1");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const [loading, setLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [addedMessage, setAddedMessage] = useState("");

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

    const unsubscribeSettings = subscribeReservationSettings(
      setReservationSettings,
      () => {},
      storeId
    );

    return () => {
      unsubscribeProducts();
      unsubscribeSettings();
    };
  }, [storeId]);

  useEffect(() => {
    if (!cartOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cartOpen]);

  const product = useMemo(
    () => products.find((item) => item.id === productId) || null,
    [products, productId]
  );

  const variants = useMemo(
    () => (product ? getProductVariants(product) : []),
    [product]
  );

  const availableVariants = useMemo(
    () => variants.filter((variant) => Number(variant.stock || 0) > 0),
    [variants]
  );

  const images = useMemo(() => {
    if (!product) return [];

    const normalizedImages = getProductImages(product).filter(
      (image) => Boolean(image?.url)
    );

    if (normalizedImages.length > 0) return normalizedImages;

    const legacyUrl = String(product.imageUrl || "").trim();

    return legacyUrl
      ? [
          {
            id: "legacy-cover",
            type: "cover",
            url: legacyUrl,
          },
        ]
      : [];
  }, [product]);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [productId]);

  useEffect(() => {
    if (!product) return;

    setSelectedVariantId((current) => {
      const currentVariant = variants.find((variant) => variant.id === current);

      if (currentVariant && Number(currentVariant.stock || 0) > 0) {
        return current;
      }

      return availableVariants[0]?.id || variants[0]?.id || "";
    });
  }, [product, variants, availableVariants]);

  const selectedVariant = useMemo(
    () =>
      variants.find((variant) => variant.id === selectedVariantId) ||
      availableVariants[0] ||
      variants[0] ||
      null,
    [variants, selectedVariantId, availableVariants]
  );

  const availableStock = Number(selectedVariant?.stock || 0);
  const isAvailable = availableStock > 0;

  const cleanQuantity = useMemo(() => {
    const number = Number(quantity || 1);

    if (!Number.isFinite(number) || number <= 0) return 1;

    return Math.min(Math.trunc(number), availableStock || 1);
  }, [quantity, availableStock]);

  const totalSelection = useMemo(
    () => Number(product?.salePrice || 0) * cleanQuantity,
    [product?.salePrice, cleanQuantity]
  );

  useEffect(() => {
    if (!selectedVariant) return;

    setQuantity((current) => {
      const currentNumber = Number(current || 1);

      if (availableStock <= 0) return "1";
      if (!Number.isFinite(currentNumber) || currentNumber <= 0) return "1";
      if (currentNumber > availableStock) return String(availableStock);

      return current;
    });
  }, [selectedVariant, availableStock]);

  function selectVariant(variant) {
    if (Number(variant.stock || 0) <= 0) return;

    setSelectedVariantId(variant.id);
    setQuantity("1");
  }

  function increaseQuantity() {
    if (!isAvailable) return;

    setQuantity((current) =>
      String(Math.min(Number(current || 1) + 1, availableStock))
    );
  }

  function decreaseQuantity() {
    setQuantity((current) =>
      String(Math.max(Number(current || 1) - 1, 1))
    );
  }

  function handleQuantityChange(value) {
    const number = Number(value || 1);

    if (!Number.isFinite(number)) {
      setQuantity("1");
      return;
    }

    setQuantity(
      String(Math.min(Math.max(Math.trunc(number), 1), availableStock || 1))
    );
  }

  function previousImage() {
    if (images.length <= 1) return;

    setActiveImageIndex((current) =>
      current <= 0 ? images.length - 1 : current - 1
    );
  }

  function nextImage() {
    if (images.length <= 1) return;

    setActiveImageIndex((current) =>
      current >= images.length - 1 ? 0 : current + 1
    );
  }

  function addSelectedToCart({ openDrawer = true } = {}) {
    if (!product) {
      alert("No se encontró el producto.");
      return false;
    }

    if (!selectedVariant) {
      alert("Selecciona una talla.");
      return false;
    }

    if (!isAvailable) {
      alert("La talla seleccionada no está disponible.");
      return false;
    }

    try {
      cart.addItem({
        storeId,
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        categoryName: product.categoryName,
        variantId: selectedVariant.id,
        size: selectedVariant.size,
        quantity: cleanQuantity,
        stock: availableStock,
        unitPrice: Number(product.salePrice || 0),
        coverUrl: images[0]?.url || "",
      });

      setAddedMessage(
        `${product.name} · talla ${selectedVariant.size} agregado al carrito`
      );

      window.setTimeout(() => {
        setAddedMessage("");
      }, 2600);

      if (openDrawer) {
        setCartOpen(true);
      }

      return true;
    } catch (error) {
      alert(error?.message || "No se pudo agregar el producto al carrito.");
      return false;
    }
  }

  function reserveNow() {
    const added = addSelectedToCart({ openDrawer: false });

    if (added) {
      navigate(`/catalogo/${storeId}/checkout`);
    }
  }

  if (loading) {
    return <CenteredState message="Cargando producto en tiempo real..." />;
  }

  if (!product) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-5">
        <section className="w-full max-w-md rounded-[30px] border border-black/[0.06] bg-white p-7 text-center shadow-[0_18px_55px_rgba(0,0,0,0.06)]">
          <img
            src="/logo.png"
            alt="Master Caps"
            className="mx-auto h-24 w-auto object-contain"
          />

          <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.04em]">
            Producto no encontrado
          </h1>

          <p className="mt-2 text-[13px] leading-6 text-black/50">
            La prenda que intentas consultar no existe o fue eliminada.
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

  const activeImage = images[activeImageIndex] || null;

  return (
    <>
      <style>{`
        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.18) transparent;
        }

        *::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        *::-webkit-scrollbar-track {
          background: transparent;
        }

        *::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.16);
          border-radius: 999px;
        }

        *::-webkit-scrollbar-thumb:hover {
          background: rgba(239, 68, 68, 0.5);
        }
      `}</style>

      <main className="min-h-screen bg-white text-black">
        <header className="sticky top-0 z-40 flex h-[72px] items-center justify-between gap-4 border-b border-black/[0.06] bg-white/95 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <Link
            to={`/catalogo/${storeId}`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-4 text-[13px] font-medium transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <ArrowLeft size={16} />
            Volver
          </Link>

          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Master Caps"
              className="h-12 w-auto object-contain sm:h-14"
            />

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 transition hover:bg-red-100"
              aria-label="Abrir carrito de apartados"
            >
              <ShoppingBag size={17} />

              {cart.summary.totalItems > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-medium text-white ring-2 ring-white">
                  {cart.summary.totalItems}
                </span>
              )}
            </button>
          </div>
        </header>

        <section className="grid min-h-[calc(100vh-72px)] bg-white lg:grid-cols-[minmax(0,1.3fr)_430px] xl:grid-cols-[minmax(0,1.4fr)_460px]">
          <div className="min-w-0 bg-white p-3 sm:p-4 lg:p-5 xl:p-6">
            <div
              className={`grid gap-3 ${
                images.length > 1
                  ? "lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[84px_minmax(0,1fr)]"
                  : "grid-cols-1"
              }`}
            >
              {images.length > 1 && (
                <div className="order-2 flex gap-2 overflow-x-auto pb-1 lg:order-1 lg:flex-col lg:overflow-visible lg:pb-0">
                  {images.map((image, index) => (
                    <button
                      key={image.id || `${image.url}-${index}`}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-[18px] border-2 bg-white transition lg:h-[76px] lg:w-[76px] xl:h-[84px] xl:w-[84px] ${
                        activeImageIndex === index
                          ? "border-red-600 shadow-lg shadow-red-600/10"
                          : "border-transparent hover:border-red-200"
                      }`}
                    >
                      <img
                        src={image.url}
                        alt={`${product.name} ${index + 1}`}
                        className="h-full w-full bg-white object-contain p-1"
                      />

                      {activeImageIndex === index && (
                        <span className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white">
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className={images.length > 1 ? "order-1 lg:order-2" : "order-1"}>
                <div
                  className={`relative flex items-center justify-center overflow-hidden rounded-[24px] border border-black/[0.05] bg-white ${
                    images.length > 1
                      ? "min-h-[430px] sm:min-h-[560px] lg:h-[calc(100vh-112px)]"
                      : "min-h-[430px] sm:min-h-[560px] lg:h-[calc(100vh-112px)]"
                  }`}
                >
                  {activeImage?.url ? (
                    <img
                      src={activeImage.url}
                      alt={product.name}
                      className="max-h-full max-w-full object-contain p-3 sm:p-5 lg:p-6"
                    />
                  ) : (
                    <Camera size={48} className="text-black/25" />
                  )}

                  <span className="absolute left-4 top-4 rounded-full bg-white/92 px-3 py-1.5 text-[11px] font-medium text-emerald-600 shadow-sm backdrop-blur">
                    Disponible
                  </span>

                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={previousImage}
                        className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 shadow-lg transition hover:bg-white"
                        aria-label="Imagen anterior"
                      >
                        <ChevronLeft size={19} />
                      </button>

                      <button
                        type="button"
                        onClick={nextImage}
                        className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 shadow-lg transition hover:bg-white"
                        aria-label="Imagen siguiente"
                      >
                        <ChevronRight size={19} />
                      </button>

                      <span className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[10px] text-white backdrop-blur">
                        <Images size={12} />
                        {activeImageIndex + 1} / {images.length}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside className="min-w-0 overflow-x-hidden border-t border-black/[0.06] bg-white lg:border-l lg:border-t-0">
            <div className="p-4 sm:p-5 lg:p-5 xl:p-6">
              <p className="text-[11px] uppercase tracking-[0.1em] text-black/35">
                {product.code || "Sin código"} ·{" "}
                {product.categoryName || "Colección"}
              </p>

              <h1 className="mt-1.5 text-[27px] font-semibold leading-[1.02] tracking-[-0.05em] sm:text-[31px]">
                {product.name}
              </h1>

              <p className="mt-2.5 text-[28px] font-semibold tracking-[-0.045em]">
                {formatCurrency(product.salePrice)}
              </p>

              <section className="mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium">Selecciona una talla</p>

                  <span className="text-[11px] text-black/40">
                    {availableVariants.length} disponible(s)
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  {variants.map((variant) => {
                    const stock = Number(variant.stock || 0);
                    const active = selectedVariant?.id === variant.id;

                    return (
                      <button
                        key={variant.id}
                        type="button"
                        disabled={stock <= 0}
                        onClick={() => selectVariant(variant)}
                        className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                          active
                            ? "border-red-600 bg-red-50 text-red-600 ring-4 ring-red-600/10"
                            : stock > 0
                              ? "border-black/[0.08] bg-white hover:border-red-300 hover:bg-red-50/50"
                              : "cursor-not-allowed border-black/[0.05] bg-black/[0.025] text-black/25"
                        }`}
                      >
                        <p className="text-[13px] font-medium">{variant.size}</p>

                        <p className="mt-1 text-[9px]">
                          {stock > 0 ? `${stock} disponibles` : "Agotada"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="mt-4 rounded-[18px] border border-red-100 bg-red-50/70 p-3.5">
                <div className="flex items-start gap-3">
                  <CalendarClock
                    size={20}
                    className="mt-0.5 shrink-0 text-red-600"
                  />

                  <div>
                    <p className="text-[13px] font-medium">
                      Apartado por {reservationSettings.defaultReservationDays} día(s)
                    </p>

                    <p className="mt-1 text-[11px] leading-5 text-black/55">
                      Agrega esta talla al carrito y continúa explorando. Tus
                      datos se pedirán una sola vez al finalizar.
                    </p>
                  </div>
                </div>
              </div>

              <section className="mt-4 rounded-[20px] border border-black/[0.06] p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-medium">Cantidad</p>

                    <p className="mt-0.5 text-[10px] text-black/40">
                      Talla {selectedVariant?.size || "sin seleccionar"}
                    </p>
                  </div>

                  <p className="text-[11px] text-black/45">
                    Stock: {availableStock}
                  </p>
                </div>

                <div className="mt-2.5 grid grid-cols-[40px_1fr_40px] items-center gap-2">
                  <button
                    type="button"
                    onClick={decreaseQuantity}
                    disabled={!isAvailable || cleanQuantity <= 1}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Minus size={16} />
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
                    className="h-9 min-w-0 rounded-xl border border-black/[0.08] text-center text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025]"
                  />

                  <button
                    type="button"
                    onClick={increaseQuantity}
                    disabled={!isAvailable || cleanQuantity >= availableStock}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                <div className="mt-2.5 flex items-end justify-between rounded-2xl bg-black/[0.025] p-3">
                  <div>
                    <p className="text-[10px] text-black/40">
                      Total seleccionado
                    </p>

                    <p className="mt-1 text-[22px] font-medium tracking-[-0.04em]">
                      {formatCurrency(totalSelection)}
                    </p>
                  </div>

                  <ShoppingBag size={21} className="text-red-600" />
                </div>
              </section>

              {addedMessage && (
                <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[11px] font-medium text-emerald-700">
                  {addedMessage}
                </div>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => addSelectedToCart({ openDrawer: true })}
                  disabled={!isAvailable}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 text-[13px] font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={16} />
                  Agregar al carrito
                </button>

                <button
                  type="button"
                  onClick={reserveNow}
                  disabled={!isAvailable}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/20 disabled:shadow-none"
                >
                  <ShoppingBag size={16} />
                  Apartar ahora
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniBenefit icon={ShieldCheck} title="Compra segura" />
                <MiniBenefit
                  icon={CalendarClock}
                  title={`Reserva por ${reservationSettings.defaultReservationDays} día(s)`}
                />
              </div>
            </div>
          </aside>
        </section>

        <ReservationCartDrawer
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          storeId={storeId}
          cart={cart}
        />

        <FixedWhatsAppButton productName={product.name} />
      </main>
    </>
  );
}

function CenteredState({ message }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5">
      <div className="rounded-[28px] border border-black/[0.06] bg-white p-8 text-center text-[14px] text-black/50 shadow-[0_18px_55px_rgba(0,0,0,0.06)]">
        {message}
      </div>
    </main>
  );
}

function MiniBenefit({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-black/[0.025] px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
        <Icon size={16} />
      </div>

      <p className="min-w-0 break-words text-[11px] font-medium leading-4">{title}</p>
    </div>
  );
}

function FixedWhatsAppButton({ productName }) {
  const whatsappUrl = `https://wa.me/573118169948?text=${encodeURIComponent(
    `Hola Master Caps, quiero información sobre ${productName}.`
  )}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[calc(18px+env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_18px_45px_rgba(37,211,102,0.34)] ring-4 ring-white transition hover:-translate-y-1 hover:scale-[1.03] hover:bg-[#1ebe5d] sm:bottom-6 sm:right-6"
      aria-label="Consultar por WhatsApp"
      title="Consultar por WhatsApp"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8 fill-current"
        aria-hidden="true"
      >
        <path d="M16.04 4C9.41 4 4 9.38 4 15.98c0 2.1.56 4.16 1.62 5.97L4 28l6.23-1.63a12.08 12.08 0 0 0 5.81 1.48h.01C22.68 27.85 28 22.49 28 15.89 28 9.31 22.67 4 16.04 4Zm.01 21.83h-.01c-1.74 0-3.45-.47-4.94-1.36l-.35-.21-3.7.97.99-3.6-.23-.37a9.86 9.86 0 0 1-1.52-5.28c0-5.47 4.48-9.93 9.99-9.93 2.67 0 5.18 1.04 7.06 2.91a9.83 9.83 0 0 1 2.93 7.01c0 5.47-4.47 9.86-10.22 9.86Zm5.46-7.37c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.03-1.05 2.51s1.08 2.91 1.23 3.11c.15.2 2.13 3.25 5.16 4.55.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.08-.12-.27-.2-.57-.35Z" />
      </svg>
    </a>
  );
}