import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  Camera,
  ChevronRight,
  Grid3X3,
  Images,
  Menu,
  PackageSearch,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

import { subscribeCategories } from "../../services/categories.service";
import {
  getProductCoverImage,
  getProductImages,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";
import { formatCurrency } from "../../utils/money";
import { useReservationCart } from "../../services/reservationCart.store";
import ReservationCartDrawer from "../../components/catalog/ReservationCartDrawer";
import { subscribeReservationSettings } from "../../services/reservations.service";

const WHATSAPP_NUMBER = "573118169948";
const WHATSAPP_MESSAGE =
  "Hola Master Caps, quiero recibir asesoría sobre los productos del catálogo.";

function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

function getAvailableVariants(product) {
  return getProductVariants(product).filter(
    (variant) => Number(variant.stock || 0) > 0
  );
}

function getTotalStock(product) {
  return getProductVariants(product).reduce(
    (total, variant) => total + Number(variant.stock || 0),
    0
  );
}

export default function CatalogPage() {
  const { storeId = "master-caps" } = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [reservationSettings, setReservationSettings] = useState({
    defaultReservationDays: 7,
  });

  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get("categoria") || "all");
  const [sizeFilter, setSizeFilter] = useState(() => searchParams.get("talla") || "all");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const cart = useReservationCart(storeId);

  const [loading, setLoading] = useState(true);
  const restorationDoneRef = useRef(false);

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
        setLoading(false);
      },
      () => {
        setLoading(false);
        alert("No se pudo cargar el catálogo en tiempo real.");
      },
      storeId
    );

    const unsubscribeCategories = subscribeCategories(
      (categoriesData) => setCategories(categoriesData),
      () => alert("No se pudieron cargar las categorías del catálogo."),
      storeId
    );

    const unsubscribeSettings = subscribeReservationSettings(
      setReservationSettings,
      () => {},
      storeId
    );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeSettings();
    };
  }, [storeId]);

  useEffect(() => {
    if (!mobileSidebarOpen && !cartOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileSidebarOpen, cartOpen]);

  useEffect(() => {
    const nextParams = new URLSearchParams();

    if (categoryFilter !== "all") {
      nextParams.set("categoria", categoryFilter);
    }

    if (sizeFilter !== "all") {
      nextParams.set("talla", sizeFilter);
    }

    const cleanSearch = search.trim();

    if (cleanSearch) {
      nextParams.set("q", cleanSearch);
    }

    setSearchParams(nextParams, { replace: true });
  }, [categoryFilter, sizeFilter, search, setSearchParams]);

  useEffect(() => {
    if (loading || restorationDoneRef.current) return;

    restorationDoneRef.current = true;

    const savedScrollY = Number(
      location.state?.catalogNavigation?.scrollY ||
        sessionStorage.getItem(
          `catalog-scroll:${storeId}:${location.search}`
        ) ||
        0
    );

    if (savedScrollY > 0) {
      requestAnimationFrame(() => {
        window.scrollTo({
          top: savedScrollY,
          behavior: "auto",
        });
      });
    }
  }, [loading, location.search, location.state, storeId]);

  useEffect(() => {
    const storageKey = `catalog-scroll:${storeId}:${location.search}`;

    const saveScroll = () => {
      sessionStorage.setItem(storageKey, String(window.scrollY));
    };

    window.addEventListener("scroll", saveScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", saveScroll);
      saveScroll();
    };
  }, [location.search, storeId]);

  const availableSizes = useMemo(() => {
    const sizes = products.flatMap((product) =>
      getAvailableVariants(product).map((variant) => variant.size)
    );

    return [...new Set(sizes)]
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b)));
  }, [products]);

  const visibleProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const variants = getAvailableVariants(product);
      const stock = getTotalStock(product);

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch) ||
        variants.some((variant) =>
          String(variant.size || "").toLowerCase().includes(cleanSearch)
        );

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize =
        sizeFilter === "all" ||
        variants.some((variant) => variant.size === sizeFilter);

      return stock > 0 && matchesSearch && matchesCategory && matchesSize;
    });
  }, [products, search, categoryFilter, sizeFilter]);

  function selectCategory(value) {
    setCategoryFilter(value);
    setMobileSidebarOpen(false);
  }

  function selectSize(value) {
    setSizeFilter(value);
    setMobileSidebarOpen(false);
  }

  return (
    <>
      <style>{`
        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.22) transparent;
        }

        *::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        *::-webkit-scrollbar-track {
          background: transparent;
        }

        *::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.18);
          border-radius: 999px;
        }

        *::-webkit-scrollbar-thumb:hover {
          background: rgba(239, 68, 68, 0.55);
        }
      `}</style>

      <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(239,68,68,0.06),_transparent_30%),linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] text-black">
      <section className="min-h-screen w-full lg:grid lg:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="hidden border-r border-black/[0.06] bg-white/95 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
          <CatalogSidebar
            categories={categories}
            availableSizes={availableSizes}
            categoryFilter={categoryFilter}
            sizeFilter={sizeFilter}
            onCategoryChange={selectCategory}
            onSizeChange={selectSize}
            reservationDays={reservationSettings.defaultReservationDays}
          />
        </aside>

        <section className="min-w-0 px-4 pb-10 pt-4 sm:px-6 lg:px-7 lg:py-7">
          <header className="sticky top-0 z-30 -mx-4 mb-5 border-b border-black/[0.05] bg-white/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <div className="flex items-center justify-between gap-3 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/[0.08] bg-white shadow-[0_10px_30px_rgba(0,0,0,0.04)]"
                aria-label="Abrir filtros"
              >
                <Menu size={20} />
              </button>

              <img
                src="/logo.png"
                alt="Master Caps"
                className="h-14 w-auto object-contain"
              />

              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600 transition hover:bg-red-100"
                aria-label="Abrir carrito de apartados"
              >
                <ShoppingBag size={19} />

                {cart.summary.totalItems > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-medium text-white ring-2 ring-white">
                    {cart.summary.totalItems}
                  </span>
                )}
              </button>
            </div>

            <div className="hidden items-end justify-between gap-6 lg:flex">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-600">
                  <Sparkles size={13} />
                  Colección disponible
                </div>

                <h1 className="mt-3 text-[31px] font-medium tracking-[-0.05em]">
                  Catálogo Master Caps
                </h1>

                <p className="mt-1 text-[13px] text-black/45">
                  Explora cada producto, sus tallas y su galería completa.
                </p>
              </div>

              <div className="flex items-stretch gap-3">
                <div className="rounded-[22px] border border-black/[0.06] bg-white px-5 py-3 shadow-[0_12px_35px_rgba(0,0,0,0.035)]">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-black/35">
                    Productos disponibles
                  </p>

                  <p className="mt-1 text-[22px] font-medium text-red-600">
                    {visibleProducts.length}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setCartOpen(true)}
                  className="group relative flex min-w-[210px] items-center gap-3 rounded-[22px] border border-black/[0.06] bg-white px-4 py-3 text-left shadow-[0_12px_35px_rgba(0,0,0,0.035)] transition hover:border-red-200 hover:bg-red-50"
                >
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600 transition group-hover:bg-red-600 group-hover:text-white">
                    <ShoppingBag size={18} />

                    {cart.summary.totalItems > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-medium text-white ring-2 ring-white">
                        {cart.summary.totalItems}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-black/35">
                      Carrito
                    </p>

                    <p className="mt-1 truncate text-[13px] font-medium text-black">
                      {cart.summary.uniqueItems > 0
                        ? `${cart.summary.uniqueItems} producto(s)`
                        : "Sin productos"}
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </header>

          <div className="grid gap-3 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative block">
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-12 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] shadow-[0_12px_35px_rgba(0,0,0,0.025)] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Buscar producto, código, categoría o talla..."
              />
            </label>

            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="hidden h-12 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-5 text-[13px] font-medium shadow-[0_12px_35px_rgba(0,0,0,0.025)] transition hover:bg-red-50 hover:text-red-600 md:inline-flex lg:hidden"
            >
              <SlidersHorizontal size={16} />
              Filtros
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ActiveFilter
              label={
                categoryFilter === "all"
                  ? "Todas las categorías"
                  : categories.find((category) => category.id === categoryFilter)
                      ?.name || "Categoría"
              }
            />

            <ActiveFilter
              label={sizeFilter === "all" ? "Todas las tallas" : `Talla ${sizeFilter}`}
            />

            <span className="ml-auto text-[12px] text-black/45">
              {visibleProducts.length} resultado(s)
            </span>
          </div>

          <section className="mt-5">
            {loading ? (
              <div className="rounded-[26px] border border-black/[0.05] bg-white p-12 text-center text-[13px] text-black/45 shadow-sm">
                Cargando catálogo en tiempo real...
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="rounded-[28px] border border-black/[0.05] bg-white p-12 text-center shadow-sm">
                <PackageSearch size={38} className="mx-auto text-black/25" />
                <h2 className="mt-4 text-[19px] font-medium">
                  No encontramos productos
                </h2>
                <p className="mt-2 text-[13px] text-black/45">
                  Ajusta la búsqueda, la categoría o la talla seleccionada.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    storeId={storeId}
                    catalogSearch={location.search}
                    categoryFilter={categoryFilter}
                    sizeFilter={sizeFilter}
                    search={search}
                  />
                ))}
              </div>
            )}
          </section>
        </section>
      </section>

      {mobileSidebarOpen && (
        <MobileSidebar
          categories={categories}
          availableSizes={availableSizes}
          categoryFilter={categoryFilter}
          sizeFilter={sizeFilter}
          onCategoryChange={selectCategory}
          onSizeChange={selectSize}
          reservationDays={reservationSettings.defaultReservationDays}
          onClose={() => setMobileSidebarOpen(false)}
        />
      )}

      <ReservationCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        storeId={storeId}
        cart={cart}
      />

      <FixedWhatsAppButton />
      </main>
    </>
  );
}

function CatalogSidebar(props) {
  const {
    categories,
    availableSizes,
    categoryFilter,
    sizeFilter,
    onCategoryChange,
    onSizeChange,
    reservationDays = 7,
    onClose,
    mobile = false,
  } = props;

  return (
    <div className="flex min-h-full flex-col px-5 py-5 sm:px-6 lg:px-6 lg:py-7">
      <div className="flex items-center justify-between border-b border-black/[0.06] pb-5">
        <img
          src="/logo.png"
          alt="Master Caps"
          className="h-24 w-auto object-contain lg:mx-auto lg:h-28"
        />

        {mobile && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.035]"
          >
            <X size={19} />
          </button>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.12em]">
          Navegar catálogo
        </h2>
        <SlidersHorizontal size={16} className="text-black/45" />
      </div>

      <div className="mt-6">
        <p className="text-[12px] font-medium">Categorías</p>

        <div className="mt-3 space-y-1.5">
          <FilterButton
            active={categoryFilter === "all"}
            icon={Grid3X3}
            label="Todas las categorías"
            onClick={() => onCategoryChange("all")}
          />

          {categories.map((category) => (
            <FilterButton
              key={category.id}
              active={categoryFilter === category.id}
              icon={ShoppingBag}
              label={category.name}
              onClick={() => onCategoryChange(category.id)}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-black/[0.06] pt-5">
        <div className="rounded-[20px] border border-red-100 bg-red-50/70 p-4">
          <div className="flex items-center gap-2 text-red-600">
            <CalendarClock size={16} />
            <p className="text-[12px] font-medium">
              Apartados por {reservationDays} día(s)
            </p>
          </div>

          <p className="mt-2 text-[10px] leading-5 text-black/50">
            Las prendas reservadas se conservarán durante el plazo configurado por la tienda.
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-black/[0.06] pt-5">
        <p className="text-[12px] font-medium">Tallas disponibles</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <SizeButton
            active={sizeFilter === "all"}
            label="Todas"
            onClick={() => onSizeChange("all")}
          />

          {availableSizes.map((size) => (
            <SizeButton
              key={size}
              active={sizeFilter === size}
              label={size}
              onClick={() => onSizeChange(size)}
            />
          ))}
        </div>
      </div>

    </div>
  );
}

function MobileSidebar(props) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm lg:hidden">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={props.onClose}
        aria-label="Cerrar filtros"
      />

      <aside className="relative h-full w-[88%] max-w-[360px] overflow-y-auto bg-white shadow-2xl [scrollbar-gutter:stable]">
        <CatalogSidebar {...props} mobile />
      </aside>
    </div>
  );
}

function ProductCard({
  product,
  storeId,
  catalogSearch,
  categoryFilter,
  sizeFilter,
  search,
}) {
  const variants = getAvailableVariants(product);
  const totalStock = getTotalStock(product);
  const coverImage = getProductCoverImage(product);
  const images = getProductImages(product);

  return (
    <article className="group overflow-hidden rounded-[22px] border border-black/[0.055] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.045)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_70px_rgba(0,0,0,0.09)] sm:rounded-[26px]">
      <Link
        to={`/catalogo/${storeId}/apartar/${product.id}${catalogSearch || ""}`}
        state={{
          catalogNavigation: {
            categoryFilter,
            sizeFilter,
            search,
            scrollY: window.scrollY,
          },
        }}
        className="block"
      >
        <div className="relative aspect-[4/4.7] overflow-hidden bg-black/[0.025] sm:aspect-[4/4.2]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={product.name}
              className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera size={32} className="text-black/25" />
            </div>
          )}

          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2.5 sm:p-3">
            <span className="rounded-full bg-white/92 px-2.5 py-1 text-[9px] font-medium text-emerald-600 shadow-sm backdrop-blur sm:text-[10px]">
              Disponible
            </span>

            {images.length > 1 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[9px] text-white backdrop-blur sm:text-[10px]">
                <Images size={11} />
                {images.length}
              </span>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent p-3 pt-12">
            <p className="line-clamp-1 text-[11px] text-white/75">
              {product.categoryName || "Colección"}
            </p>
            <h3 className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-tight text-white sm:text-[16px]">
              {product.name}
            </h3>
          </div>
        </div>

        <div className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.08em] text-black/35">
                {product.code || "Sin código"}
              </p>

              <p className="mt-1 text-[17px] font-medium tracking-[-0.035em] sm:text-[19px]">
                {formatCurrency(product.salePrice)}
              </p>
            </div>

            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600 transition group-hover:bg-red-600 group-hover:text-white">
              <ChevronRight size={17} />
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {variants.slice(0, 4).map((variant) => (
              <span
                key={variant.id}
                className="rounded-full bg-black/[0.035] px-2 py-1 text-[9px] text-black/60 sm:text-[10px]"
              >
                {variant.size}
              </span>
            ))}

            {variants.length > 4 && (
              <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] text-red-600 sm:text-[10px]">
                +{variants.length - 4}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-black/[0.055] pt-3">
            <p className="text-[10px] text-emerald-600 sm:text-[11px]">
              {totalStock} unidad(es) disponibles
            </p>

            <span className="text-[10px] font-medium text-red-600 sm:text-[11px]">
              Ver producto
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function ActiveFilter({ label }) {
  return (
    <span className="rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[10px] text-black/55 shadow-sm">
      {label}
    </span>
  );
}

function FilterButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-left text-[12px] transition ${
        active
          ? "bg-red-50 font-medium text-red-600"
          : "text-black/60 hover:bg-black/[0.035] hover:text-black"
      }`}
    >
      <Icon size={15} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function SizeButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-xl px-3 text-[11px] transition ${
        active
          ? "bg-red-600 text-white shadow-lg shadow-red-600/15"
          : "border border-black/[0.08] bg-white text-black/60 hover:bg-red-50 hover:text-red-600"
      }`}
    >
      {label}
    </button>
  );
}

function FixedWhatsAppButton() {
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    WHATSAPP_MESSAGE
  )}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group fixed bottom-[calc(18px+env(safe-area-inset-bottom))] right-4 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_18px_45px_rgba(37,211,102,0.36)] ring-4 ring-white transition duration-300 hover:-translate-y-1 hover:scale-[1.03] hover:bg-[#1ebe5d] sm:bottom-6 sm:right-6 sm:h-[60px] sm:w-[60px]"
      aria-label="Contactar por WhatsApp"
      title="Asesoría por WhatsApp"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8 fill-current sm:h-9 sm:w-9"
        aria-hidden="true"
      >
        <path d="M16.04 4C9.41 4 4 9.38 4 15.98c0 2.1.56 4.16 1.62 5.97L4 28l6.23-1.63a12.08 12.08 0 0 0 5.81 1.48h.01C22.68 27.85 28 22.49 28 15.89 28 9.31 22.67 4 16.04 4Zm.01 21.83h-.01c-1.74 0-3.45-.47-4.94-1.36l-.35-.21-3.7.97.99-3.6-.23-.37a9.86 9.86 0 0 1-1.52-5.28c0-5.47 4.48-9.93 9.99-9.93 2.67 0 5.18 1.04 7.06 2.91a9.83 9.83 0 0 1 2.93 7.01c0 5.47-4.47 9.86-10.22 9.86Zm5.46-7.37c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.03-1.05 2.51s1.08 2.91 1.23 3.11c.15.2 2.13 3.25 5.16 4.55.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.08-.12-.27-.2-.57-.35Z" />
      </svg>

      <span className="pointer-events-none absolute right-[68px] hidden whitespace-nowrap rounded-2xl bg-black px-3 py-2 text-[11px] font-medium text-white opacity-0 shadow-xl transition group-hover:opacity-100 sm:block">
        ¿Necesitas ayuda?
      </span>
    </a>
  );
}