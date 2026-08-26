import { useEffect, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  BadgePercent,
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
  Sparkles,
  Truck,
} from "lucide-react";

import {
  getProductImages,
  getProductPromotionStock,
  getPromotionStockForVariant,
  isProductNew,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";
import { useReservationCart } from "../../services/reservationCart.store";
import ReservationCartDrawer from "../../components/catalog/ReservationCartDrawer";
import { subscribeReservationSettings } from "../../services/reservations.service";
import { formatCurrency } from "../../utils/money";

const WHATSAPP_NUMBER = "573118169948";

function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

function normalizeDisplayName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es-CO");
}

function safeText(value) {
  return String(value ?? "").trim();
}

function isPromotionProduct(product) {
  return (
    Boolean(product?.isPromotion) &&
    Number(product?.promotionPrice || 0) > 0 &&
    getProductPromotionStock(product) > 0
  );
}

function getNormalStockForVariant(
  product,
  variant
) {
  return Math.max(
    Number(variant?.stock || 0) -
      getPromotionStockForVariant(
        product,
        variant
      ),
    0
  );
}

export default function ReserveProductPage() {
  const {
    storeId = "master-caps",
    productId,
  } = useParams();

  const navigate = useNavigate();
  const location = useLocation();

  const cart = useReservationCart(storeId);

  const catalogUrl = `/catalogo/${storeId}${location.search || ""}`;
  const catalogNavigationState =
    location.state?.catalogNavigation || null;

  const isPromotionRoute = useMemo(
    () =>
      new URLSearchParams(
        location.search
      ).get("especial") ===
      "promotions",
    [location.search]
  );

  const [purchaseMode, setPurchaseMode] =
    useState(
      isPromotionRoute
        ? "promotion"
        : "normal"
    );

  const [products, setProducts] =
    useState([]);

  const [
    reservationSettings,
    setReservationSettings,
  ] = useState({
    defaultReservationDays: 7,
  });

  const [quantity, setQuantity] =
    useState("1");

  const [
    selectedVariantId,
    setSelectedVariantId,
  ] = useState("");

  const [
    activeImageIndex,
    setActiveImageIndex,
  ] = useState(0);

  const [loading, setLoading] =
    useState(true);

  const [cartOpen, setCartOpen] =
    useState(false);

  const [addedMessage, setAddedMessage] =
    useState("");

  function returnToCatalog() {
    navigate(catalogUrl, {
      state: catalogNavigationState
        ? {
            catalogNavigation:
              catalogNavigationState,
          }
        : undefined,
    });
  }

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts =
      subscribeProducts(
        (productsData) => {
          setProducts(productsData);
          setLoading(false);
        },
        () => {
          setLoading(false);

          alert(
            "No se pudo cargar el producto en tiempo real."
          );
        },
        storeId
      );

    const unsubscribeSettings =
      subscribeReservationSettings(
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
    if (!cartOpen) {
      return undefined;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [cartOpen]);

  const product = useMemo(
    () =>
      products.find(
        (item) => item.id === productId
      ) || null,
    [products, productId]
  );

  const newProduct = useMemo(
    () =>
      product ? isProductNew(product) : false,
    [product]
  );

  const promotionActive = useMemo(
    () =>
      product
        ? isPromotionProduct(product)
        : false,
    [product]
  );

  useEffect(() => {
    if (!product) {
      return;
    }

    if (
      isPromotionRoute &&
      isPromotionProduct(product)
    ) {
      setPurchaseMode("promotion");
      return;
    }

    setPurchaseMode("normal");
  }, [
    product,
    isPromotionRoute,
  ]);

  const isPromotionPurchase =
    purchaseMode === "promotion" &&
    promotionActive;

  const effectiveUnitPrice = useMemo(
    () =>
      product
        ? isPromotionPurchase
          ? Number(
              product.promotionPrice || 0
            )
          : Number(
              product.salePrice || 0
            )
        : 0,
    [
      product,
      isPromotionPurchase,
    ]
  );

  const variants = useMemo(
    () =>
      product
        ? getProductVariants(product)
        : [],
    [product]
  );

  const availableVariants =
    useMemo(
      () =>
        variants.filter(
          (variant) => {
            if (
              isPromotionPurchase
            ) {
              return (
                getPromotionStockForVariant(
                  product,
                  variant
                ) > 0
              );
            }

            return (
              getNormalStockForVariant(
                product,
                variant
              ) > 0
            );
          }
        ),
      [
        variants,
        product,
        isPromotionPurchase,
      ]
    );

  const images = useMemo(() => {
    if (!product) {
      return [];
    }

    const normalizedImages =
      getProductImages(product).filter(
        (image) =>
          Boolean(image?.url)
      );

    if (
      normalizedImages.length > 0
    ) {
      return normalizedImages;
    }

    const legacyUrl = safeText(
      product.imageUrl
    );

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
    if (!product) {
      return;
    }

    setSelectedVariantId(
      (current) => {
        const currentVariant =
          variants.find(
            (variant) =>
              variant.id === current
          );

        if (currentVariant) {
          const currentAvailable =
            isPromotionPurchase
              ? getPromotionStockForVariant(
                  product,
                  currentVariant
                )
              : getNormalStockForVariant(
                  product,
                  currentVariant
                );

          if (currentAvailable > 0) {
            return current;
          }
        }

        return (
          availableVariants[0]?.id ||
          variants[0]?.id ||
          ""
        );
      }
    );
  }, [
    product,
    variants,
    availableVariants,
    isPromotionPurchase,
  ]);

  useEffect(() => {
    const preloadUrls = images
      .slice(0, 3)
      .map((image) => image?.url)
      .filter(Boolean);

    preloadUrls.forEach((url) => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    });
  }, [images]);

  const selectedVariant = useMemo(
    () =>
      variants.find(
        (variant) =>
          variant.id ===
          selectedVariantId
      ) ||
      availableVariants[0] ||
      variants[0] ||
      null,
    [
      variants,
      selectedVariantId,
      availableVariants,
    ]
  );

  const availableStock =
    selectedVariant
      ? isPromotionPurchase
        ? getPromotionStockForVariant(
            product,
            selectedVariant
          )
        : getNormalStockForVariant(
            product,
            selectedVariant
          )
      : 0;

  const isAvailable =
    availableStock > 0;

  const cleanQuantity = useMemo(() => {
    const number = Number(
      quantity || 1
    );

    if (
      !Number.isFinite(number) ||
      number <= 0
    ) {
      return 1;
    }

    return Math.min(
      Math.trunc(number),
      availableStock || 1
    );
  }, [
    quantity,
    availableStock,
  ]);

  const totalSelection = useMemo(
    () =>
      effectiveUnitPrice * cleanQuantity,
    [
      effectiveUnitPrice,
      cleanQuantity,
    ]
  );

  useEffect(() => {
    if (!selectedVariant) {
      return;
    }

    setQuantity((current) => {
      const currentNumber = Number(
        current || 1
      );

      if (availableStock <= 0) {
        return "1";
      }

      if (
        !Number.isFinite(
          currentNumber
        ) ||
        currentNumber <= 0
      ) {
        return "1";
      }

      if (
        currentNumber >
        availableStock
      ) {
        return String(
          availableStock
        );
      }

      return current;
    });
  }, [
    selectedVariant,
    availableStock,
  ]);

  function selectVariant(variant) {
    const variantAvailable =
      isPromotionPurchase
        ? getPromotionStockForVariant(
            product,
            variant
          )
        : getNormalStockForVariant(
            product,
            variant
          );

    if (variantAvailable <= 0) {
      return;
    }

    setSelectedVariantId(
      variant.id
    );

    setQuantity("1");
  }

  function increaseQuantity() {
    if (!isAvailable) {
      return;
    }

    setQuantity((current) =>
      String(
        Math.min(
          Number(current || 1) + 1,
          availableStock
        )
      )
    );
  }

  function decreaseQuantity() {
    setQuantity((current) =>
      String(
        Math.max(
          Number(current || 1) - 1,
          1
        )
      )
    );
  }

  function handleQuantityChange(
    value
  ) {
    const number = Number(
      value || 1
    );

    if (!Number.isFinite(number)) {
      setQuantity("1");
      return;
    }

    setQuantity(
      String(
        Math.min(
          Math.max(
            Math.trunc(number),
            1
          ),
          availableStock || 1
        )
      )
    );
  }

  function previousImage() {
    if (images.length <= 1) {
      return;
    }

    setActiveImageIndex(
      (current) =>
        current <= 0
          ? images.length - 1
          : current - 1
    );
  }

  function nextImage() {
    if (images.length <= 1) {
      return;
    }

    setActiveImageIndex(
      (current) =>
        current >=
        images.length - 1
          ? 0
          : current + 1
    );
  }

  function addSelectedToCart({
    openDrawer = true,
  } = {}) {
    if (!product) {
      alert(
        "No se encontró el producto."
      );
      return false;
    }

    if (!selectedVariant) {
      alert("Selecciona una talla.");
      return false;
    }

    if (!isAvailable) {
      alert(
        "La talla seleccionada no está disponible."
      );
      return false;
    }

    try {
      cart.addItem({
        storeId,
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        categoryName:
          product.categoryName,
        variantId:
          selectedVariant.id,
        size: selectedVariant.size,
        quantity: cleanQuantity,
        stock: availableStock,
        unitPrice: effectiveUnitPrice,
        regularUnitPrice: Number(
          product.salePrice || 0
        ),
        isPromotion:
          isPromotionPurchase,
        promotionPrice:
          isPromotionPurchase
            ? Number(
                product.promotionPrice || 0
              )
            : 0,
        promotionNote:
          isPromotionPurchase
            ? safeText(
                product.promotionNote
              )
            : "",
        coverUrl:
          images[0]?.url || "",
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
      alert(
        error?.message ||
          "No se pudo agregar el producto al carrito."
      );

      return false;
    }
  }

  function reserveNow() {
    const added =
      addSelectedToCart({
        openDrawer: false,
      });

    if (added) {
      navigate(
        `/catalogo/${storeId}/checkout${location.search || ""}`
      );
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
        <section className="w-full max-w-md border border-black/[0.08] bg-white p-8 text-center">
          <img
            src="/logo.png"
            alt="Master Caps"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="mx-auto h-24 w-auto object-contain"
          />

          <h1 className="mt-6 text-[26px] font-medium uppercase tracking-[-0.04em]">
            Producto no encontrado
          </h1>

          <p className="mt-3 text-[13px] leading-6 text-black/50">
            La prenda que intentas consultar no existe o fue eliminada.
          </p>

          <button
            type="button"
            onClick={returnToCatalog}
            className="mt-7 inline-flex h-12 w-full items-center justify-center bg-black px-5 text-[11px] font-medium uppercase tracking-[0.16em] text-white transition hover:bg-red-600"
          >
            Volver al catálogo
          </button>
        </section>
      </main>
    );
  }

  const activeImage =
    images[activeImageIndex] || null;

  return (
    <>
      <style>{`
        html {
          scroll-behavior: smooth;
        }

        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(0,0,0,.18) transparent;
        }

        *::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        *::-webkit-scrollbar-track {
          background: transparent;
        }

        *::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,.16);
          border-radius: 999px;
        }
      `}</style>

      <main className="min-h-screen bg-white text-black">
        <div className="bg-black px-4 py-2 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-white sm:text-[11px]">
          Envíos a todo Colombia · Aparta tus productos favoritos
        </div>

        <header className="sticky top-0 z-40 border-b border-black/[0.08] bg-white/95 backdrop-blur-xl">
          <div className="mx-auto flex min-h-[104px] max-w-[1800px] items-center justify-between gap-4 px-4 sm:min-h-[116px] sm:px-6 lg:px-10 xl:px-16">
            <button
              type="button"
              onClick={returnToCatalog}
              className="inline-flex h-11 items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] transition hover:text-red-600"
            >
              <ArrowLeft size={17} />
              <span className="hidden sm:inline">
                Volver al catálogo
              </span>
            </button>

            <img
              src="/logo.png"
              alt="Master Caps"
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="h-[74px] w-auto object-contain sm:h-[88px] lg:h-[104px]"
            />

            <button
              type="button"
              onClick={() =>
                setCartOpen(true)
              }
              className="relative flex h-11 w-11 items-center justify-center transition hover:text-red-600"
              aria-label="Abrir carrito de apartados"
            >
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
            </button>
          </div>
        </header>

        <section className="mx-auto grid max-w-[1800px] lg:grid-cols-[minmax(0,1.48fr)_minmax(390px,.72fr)]">
          <section className="min-w-0 border-b border-black/[0.08] bg-white lg:border-b-0 lg:border-r">
            {/* GALERÍA MÓVIL: una imagen principal + miniaturas horizontales */}
            <div className="lg:hidden">
              <div className="relative flex min-h-[520px] items-center justify-center overflow-hidden bg-white sm:min-h-[620px]">
                {activeImage?.url ? (
                  <img
                    src={activeImage.url}
                    alt={product.name}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    className="h-full w-full object-contain px-3 py-4 sm:px-5"
                  />
                ) : (
                  <Camera size={46} className="text-black/20" />
                )}

                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={previousImage}
                      className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur transition active:scale-95"
                      aria-label="Imagen anterior"
                    >
                      <ChevronLeft size={18} />
                    </button>

                    <button
                      type="button"
                      onClick={nextImage}
                      className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur transition active:scale-95"
                      aria-label="Imagen siguiente"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}

                {(newProduct || promotionActive) && (
                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    {newProduct && (
                      <span className="inline-flex items-center gap-1 bg-red-600 px-2.5 py-1 text-[8px] font-medium uppercase tracking-[0.1em] text-white shadow-sm">
                        <Sparkles size={9} />
                        Nuevo
                      </span>
                    )}

                    {isPromotionPurchase && (
                      <span className="inline-flex items-center gap-1 bg-amber-400 px-2.5 py-1 text-[8px] font-medium uppercase tracking-[0.1em] text-black shadow-sm">
                        <BadgePercent size={9} />
                        Promo
                      </span>
                    )}
                  </div>
                )}

                <span className="absolute bottom-4 right-4 bg-white/95 px-3 py-1.5 text-[9px] font-medium text-black shadow-sm">
                  {images.length > 0 ? activeImageIndex + 1 : 0} / {images.length}
                </span>
              </div>

              {images.length > 1 && (
                <div className="border-y border-black/[0.08] bg-white px-3 py-3">
                  <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {images.map((image, index) => (
                      <button
                        key={image.id || `${image.url}-${index}`}
                        type="button"
                        onClick={() => setActiveImageIndex(index)}
                        className={`h-[88px] w-[72px] shrink-0 snap-start overflow-hidden bg-white transition ${
                          activeImageIndex === index
                            ? "ring-2 ring-black"
                            : "ring-1 ring-black/[0.08]"
                        }`}
                        aria-label={`Ver imagen ${index + 1}`}
                      >
                        <img
                          src={image.url}
                          alt={`${product.name} ${index + 1}`}
                          loading={index < 4 ? "eager" : "lazy"}
                          decoding="async"
                          className="h-full w-full object-contain p-1"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* GALERÍA ESCRITORIO: mantiene las imágenes editoriales en dos columnas */}
            <div className="hidden gap-[2px] bg-black/[0.08] lg:grid lg:grid-cols-2">
              {images.length > 0 ? (
                images.map((image, index) => (
                  <button
                    key={image.id || `${image.url}-${index}`}
                    type="button"
                    onClick={() => setActiveImageIndex(index)}
                    className={`group relative flex min-h-[690px] items-center justify-center overflow-hidden bg-white ${
                      activeImageIndex === index
                        ? "ring-2 ring-inset ring-black"
                        : ""
                    }`}
                  >
                    <img
                      src={image.url}
                      alt={`${product.name} ${index + 1}`}
                      loading={index < 2 ? "eager" : "lazy"}
                      decoding="async"
                      fetchPriority={index === 0 ? "high" : "auto"}
                      className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-[1.015]"
                    />

                    {index === 0 && (
                      <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
                        {newProduct && (
                          <span className="inline-flex items-center gap-1 bg-red-600 px-2.5 py-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-white">
                            <Sparkles size={9} />
                            Nuevo
                          </span>
                        )}

                        {isPromotionPurchase && (
                          <span className="inline-flex items-center gap-1 bg-amber-400 px-2.5 py-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-black">
                            <BadgePercent size={9} />
                            Promo
                          </span>
                        )}

                        {!newProduct && !promotionActive && (
                          <span className="bg-black px-3 py-1.5 text-[8px] font-medium uppercase tracking-[0.16em] text-white">
                            Portada
                          </span>
                        )}
                      </div>
                    )}

                    <span className="absolute bottom-4 right-4 bg-white/95 px-3 py-1.5 text-[9px] text-black shadow-sm">
                      {index + 1} / {images.length}
                    </span>
                  </button>
                ))
              ) : (
                <div className="col-span-2 flex min-h-[620px] items-center justify-center bg-black/[0.025]">
                  <Camera size={46} className="text-black/20" />
                </div>
              )}
            </div>
          </section>

          <aside className="min-w-0 bg-white">
            <div className="lg:sticky lg:top-[126px]">
              <div className="px-5 py-8 sm:px-7 lg:px-8 lg:py-10 xl:px-10">
                {(newProduct || promotionActive) && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {newProduct && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[8px] font-medium uppercase tracking-[0.1em] text-white">
                        <Sparkles size={9} />
                        Nuevo
                      </span>
                    )}

                    {isPromotionPurchase && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[8px] font-medium uppercase tracking-[0.1em] text-black">
                        <BadgePercent size={9} />
                        Promoción
                      </span>
                    )}
                  </div>
                )}

                <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-black/40">
                  {normalizeDisplayName(
                    product.categoryName ||
                      "Colección"
                  )}
                </p>

                <h1 className="mt-4 text-[31px] font-medium uppercase leading-[1.02] tracking-[-0.05em] sm:text-[39px] lg:text-[42px]">
                  {product.name}
                </h1>

                {promotionActive && (
                  <div className="mt-5 grid grid-cols-2 gap-2 rounded-[16px] bg-black/[0.025] p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPurchaseMode("normal");
                        setQuantity("1");
                      }}
                      className={`min-h-11 rounded-[12px] px-3 text-[9px] font-medium uppercase tracking-[0.08em] transition ${
                        !isPromotionPurchase
                          ? "bg-black text-white"
                          : "bg-white text-black/55"
                      }`}
                    >
                      Compra normal
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPurchaseMode("promotion");
                        setQuantity("1");
                      }}
                      className={`min-h-11 rounded-[12px] px-3 text-[9px] font-medium uppercase tracking-[0.08em] transition ${
                        isPromotionPurchase
                          ? "bg-amber-400 text-black"
                          : "bg-white text-black/55"
                      }`}
                    >
                      Promoción · {getProductPromotionStock(product)} u.
                    </button>
                  </div>
                )}

                {isPromotionPurchase ? (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <p className="text-[29px] font-medium tracking-[-0.045em] text-red-600">
                        {formatCurrency(
                          effectiveUnitPrice
                        )}
                      </p>

                      <p className="text-[13px] text-black/35 line-through">
                        {formatCurrency(
                          product.salePrice
                        )}
                      </p>
                    </div>

                    {product.promotionNote && (
                      <div className="mt-3 rounded-[16px] border border-amber-100 bg-amber-50/70 px-3.5 py-3">
                        <div className="flex items-start gap-2">
                          <BadgePercent
                            size={13}
                            className="mt-0.5 shrink-0 text-amber-700"
                          />

                          <div>
                            <p className="text-[8px] font-medium uppercase tracking-[0.1em] text-amber-700">
                              Observación de promoción
                            </p>

                            <p className="mt-1 text-[10px] leading-5 text-black/60">
                              {product.promotionNote}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-5 text-[29px] font-medium tracking-[-0.045em]">
                    {formatCurrency(
                      effectiveUnitPrice
                    )}
                  </p>
                )}

                <div className="mt-7 border-t border-black/[0.1] pt-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em]">
                      Selecciona una talla
                    </p>

                    <span className="text-[10px] text-black/40">
                      {
                        availableVariants.length
                      }{" "}
                      disponible(s)
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
                    {variants.map(
                      (variant) => {
                        const stock =
                          isPromotionPurchase
                            ? getPromotionStockForVariant(
                                product,
                                variant
                              )
                            : getNormalStockForVariant(
                                product,
                                variant
                              );

                        const active =
                          selectedVariant?.id ===
                          variant.id;

                        return (
                          <button
                            key={variant.id}
                            type="button"
                            disabled={
                              stock <= 0
                            }
                            onClick={() =>
                              selectVariant(
                                variant
                              )
                            }
                            className={`relative h-14 border text-[11px] font-medium uppercase transition ${
                              active
                                ? "border-black bg-black text-white"
                                : stock > 0
                                  ? "border-black/[0.16] bg-white hover:border-black"
                                  : "cursor-not-allowed border-black/[0.08] bg-black/[0.025] text-black/25"
                            }`}
                          >
                            <span className="block">
                              {variant.size}
                            </span>

                            {stock > 0 && (
                              <span className={`mt-0.5 block text-[7px] ${
                                active
                                  ? "text-white/65"
                                  : isPromotionPurchase
                                    ? "text-amber-700"
                                    : "text-black/38"
                              }`}>
                                {stock} u.
                              </span>
                            )}

                            {stock <= 0 && (
                              <span className="absolute inset-0 flex items-center justify-center">
                                <span className="h-px w-[74%] -rotate-45 bg-black/25" />
                              </span>
                            )}
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>

                <div className="mt-7 border-t border-black/[0.1] pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.16em]">
                        Cantidad
                      </p>

                      <p className="mt-1 text-[10px] text-black/40">
                        Talla{" "}
                        {selectedVariant?.size ||
                          "sin seleccionar"}
                      </p>
                    </div>

                    <p className={`text-[10px] ${
                      isPromotionPurchase
                        ? "text-amber-700"
                        : "text-black/45"
                    }`}>
                      {isPromotionPurchase
                        ? "Stock promo"
                        : "Stock normal"}
                      : {availableStock}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-[54px_1fr_54px] border border-black/[0.14]">
                    <button
                      type="button"
                      onClick={
                        decreaseQuantity
                      }
                      disabled={
                        !isAvailable ||
                        cleanQuantity <= 1
                      }
                      className="flex h-13 items-center justify-center border-r border-black/[0.14] transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Minus size={16} />
                    </button>

                    <input
                      type="text"
                      inputMode="numeric"
                      value={quantity}
                      onChange={(event) =>
                        handleQuantityChange(
                          event.target.value
                        )
                      }
                      disabled={!isAvailable}
                      className="h-13 min-w-0 text-center text-[13px] outline-none"
                    />

                    <button
                      type="button"
                      onClick={
                        increaseQuantity
                      }
                      disabled={
                        !isAvailable ||
                        cleanQuantity >=
                          availableStock
                      }
                      className="flex h-13 items-center justify-center border-l border-black/[0.14] transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-6 flex items-end justify-between border-y border-black/[0.1] py-5">
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.16em] text-black/40">
                      Total seleccionado
                    </p>

                    <p className={`mt-2 text-[28px] font-medium tracking-[-0.045em] ${
                      isPromotionPurchase ? "text-red-600" : ""
                    }`}>
                      {formatCurrency(
                        totalSelection
                      )}
                    </p>

                    {isPromotionPurchase && (
                      <p className="mt-1 text-[8px] uppercase tracking-[0.08em] text-amber-700">
                        Precio promocional aplicado
                      </p>
                    )}
                  </div>

                  <ShoppingBag
                    size={22}
                    strokeWidth={1.5}
                  />
                </div>

                {addedMessage && (
                  <div className="mt-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-700">
                    {addedMessage}
                  </div>
                )}

                <div className="mt-5 space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      addSelectedToCart({
                        openDrawer: true,
                      })
                    }
                    disabled={!isAvailable}
                    className="inline-flex h-14 w-full items-center justify-center gap-3 border border-black bg-white px-5 text-[10px] font-medium uppercase tracking-[0.18em] text-black transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Plus size={16} />
                    Agregar al carrito
                  </button>

                  <button
                    type="button"
                    onClick={reserveNow}
                    disabled={!isAvailable}
                    className="inline-flex h-14 w-full items-center justify-center gap-3 bg-black px-5 text-[10px] font-medium uppercase tracking-[0.18em] text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-black/20"
                  >
                    <ShoppingBag size={16} />
                    Apartar ahora
                  </button>
                </div>

                <div className="mt-7 space-y-4 border-t border-black/[0.1] pt-6">
                  <BenefitRow
                    icon={Truck}
                    title="Envíos a todo Colombia"
                    description="Consulta tiempos y condiciones con nuestro equipo."
                  />

                  <BenefitRow
                    icon={
                      CalendarClock
                    }
                    title={`Apartado por ${reservationSettings.defaultReservationDays} día(s)`}
                    description="Tus productos se conservarán durante el plazo configurado."
                  />

                  <BenefitRow
                    icon={ShieldCheck}
                    title="Stock verificado"
                    description="La disponibilidad se valida nuevamente antes de confirmar."
                  />
                </div>
              </div>
            </div>
          </aside>
        </section>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.1] bg-white p-3 lg:hidden">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                addSelectedToCart({
                  openDrawer: true,
                })
              }
              disabled={!isAvailable}
              className="h-12 border border-black bg-white text-[9px] font-medium uppercase tracking-[0.12em] disabled:opacity-35"
            >
              Agregar
            </button>

            <button
              type="button"
              onClick={reserveNow}
              disabled={!isAvailable}
              className="h-12 bg-black text-[9px] font-medium uppercase tracking-[0.12em] text-white disabled:bg-black/20"
            >
              Apartar ahora
            </button>
          </div>
        </div>

        <ReservationCartDrawer
          open={cartOpen}
          onClose={() =>
            setCartOpen(false)
          }
          storeId={storeId}
          cart={cart}
        />

        <FixedWhatsAppButton
          productName={
            product.name
          }
        />
      </main>
    </>
  );
}

function BenefitRow({
  icon: Icon,
  title,
  description,
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-black/[0.1]">
        <Icon
          size={16}
          strokeWidth={1.5}
        />
      </div>

      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.08em]">
          {title}
        </p>

        <p className="mt-1 text-[10px] leading-5 text-black/45">
          {description}
        </p>
      </div>
    </div>
  );
}

function CenteredState({
  message,
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5">
      <div className="border border-black/[0.08] bg-white p-9 text-center">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-black/15 border-t-black" />

        <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.16em] text-black/45">
          {message}
        </p>
      </div>
    </main>
  );
}

function FixedWhatsAppButton({
  productName,
}) {
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    `Hola Master Caps, quiero información sobre ${productName}.`
  )}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[calc(82px+env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_18px_45px_rgba(220,38,38,0.34)] ring-4 ring-white transition hover:-translate-y-1 hover:bg-red-700 lg:bottom-6 lg:right-6"
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