import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CalendarDays,
  Camera,
  ChevronDown,
  Grid3X3,
  Lock,
  PackageSearch,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";

import { subscribeCategories } from "../../services/categories.service";
import { subscribeProducts } from "../../services/products.service";
import { formatCurrency } from "../../utils/money";

const WHATSAPP_NUMBER = "573118169948";
const WHATSAPP_MESSAGE =
  "Hola Master Caps, quiero recibir asesoría sobre los productos del catálogo.";

export default function CatalogPage() {
  const { storeId = "master-caps" } = useParams();

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");

  const [loading, setLoading] = useState(true);

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

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
    };
  }, [storeId]);

  const availableSizes = useMemo(() => {
    const sizes = products
      .filter((product) => Number(product.stock || 0) > 0)
      .map((product) => product.size || "Talla única")
      .filter(Boolean);

    return [...new Set(sizes)].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const visibleProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const stock = Number(product.stock || 0);
      const productSize = product.size || "Talla única";

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch) ||
        String(productSize || "").toLowerCase().includes(cleanSearch);

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize = sizeFilter === "all" || productSize === sizeFilter;

      return stock > 0 && matchesSearch && matchesCategory && matchesSize;
    });
  }, [products, search, categoryFilter, sizeFilter]);

  const categoryOptions = [
    { value: "all", label: "Todas las categorías" },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];

  const sizeOptions = [
    { value: "all", label: "Todas las tallas" },
    ...availableSizes.map((size) => ({
      value: size,
      label: size,
    })),
  ];

  return (
    <main className="min-h-screen bg-white text-black">
      <section className="min-h-screen w-full bg-white lg:grid lg:grid-cols-[330px_1fr]">
        <aside className="hidden border-r border-black/[0.06] bg-white px-7 py-7 lg:flex lg:flex-col">
          <div className="border-b border-black/[0.06] pb-8">
            <img
              src="/logo.png"
              alt="Master Caps"
              className="mx-auto h-36 w-auto object-contain"
            />
          </div>

          <div className="mt-7 flex items-center justify-between">
            <h2 className="text-[13px] font-medium uppercase text-black">
              Filtros
            </h2>
            <SlidersHorizontal size={16} className="text-black/55" />
          </div>

          <div className="mt-7">
            <p className="text-[13px] font-medium text-black">Categorías</p>

            <div className="mt-3 space-y-1.5">
              <FilterButton
                active={categoryFilter === "all"}
                icon={Grid3X3}
                label="Todas las categorías"
                onClick={() => setCategoryFilter("all")}
              />

              {categories.map((category) => (
                <FilterButton
                  key={category.id}
                  active={categoryFilter === category.id}
                  icon={ShoppingBag}
                  label={category.name}
                  onClick={() => setCategoryFilter(category.id)}
                />
              ))}
            </div>
          </div>

          <div className="mt-7 border-t border-black/[0.06] pt-6">
            <p className="text-[13px] font-medium text-black">Tallas</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <SizeButton
                active={sizeFilter === "all"}
                label="Todas"
                onClick={() => setSizeFilter("all")}
              />

              {availableSizes.map((size) => (
                <SizeButton
                  key={size}
                  active={sizeFilter === size}
                  label={size}
                  onClick={() => setSizeFilter(size)}
                />
              ))}
            </div>
          </div>

          <div className="mt-auto rounded-[26px] border border-black/[0.06] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)]">
            <SideBenefit icon={CalendarDays} title="Aparta por 7 días" text="Reserva segura" />
            <SideBenefit icon={Lock} title="Compra segura" text="Datos protegidos" />
            <SideBenefit icon={ShieldCheck} title="Productos originales" text="Calidad garantizada" />
          </div>
        </aside>

        <section className="min-w-0 px-5 py-6 sm:px-6 lg:px-7 lg:py-7">
          <header className="mb-7 flex items-center justify-center lg:hidden">
            <img
              src="/logo.png"
              alt="Master Caps"
              className="h-[120px] w-auto object-contain"
            />
          </header>

          <label className="relative block">
            <Search
              size={20}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-black/40 lg:left-4 lg:h-[17px] lg:w-[17px]"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-[64px] w-full rounded-[22px] border border-black/[0.09] bg-white pl-14 pr-5 text-[15px] text-black shadow-[0_12px_35px_rgba(0,0,0,0.025)] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 lg:h-12 lg:rounded-2xl lg:pl-11 lg:text-[13px]"
              placeholder="Buscar productos, códigos, categorías..."
            />
          </label>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:hidden">
            <CustomSelect
              value={categoryFilter}
              options={categoryOptions}
              onChange={setCategoryFilter}
            />

            <CustomSelect
              value={sizeFilter}
              options={sizeOptions}
              onChange={setSizeFilter}
            />
          </div>

          <div className="mt-7 lg:mt-5">
            <p className="text-[18px] text-black/55 lg:text-[13px]">
              Mostrando{" "}
              <span className="font-medium text-red-600">
                {visibleProducts.length}
              </span>{" "}
              productos disponibles
            </p>
          </div>

          <section className="mt-5">
            {loading ? (
              <div className="rounded-[24px] bg-black/[0.025] p-10 text-center text-[13px] text-black/45">
                Cargando catálogo en tiempo real...
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="rounded-[24px] bg-black/[0.025] p-10 text-center">
                <PackageSearch size={36} className="mx-auto text-black/35" />

                <h2 className="mt-4 text-[18px] font-medium text-black">
                  No hay prendas disponibles
                </h2>

                <p className="mt-2 text-[13px] text-black/45">
                  En este momento no hay productos con stock disponible.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    storeId={storeId}
                  />
                ))}
              </div>
            )}
          </section>
        </section>
      </section>

      <DraggableWhatsAppButton />
    </main>
  );
}

function CustomSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) || options[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-[58px] w-full items-center justify-between gap-3 rounded-[20px] border bg-white px-4 text-left text-[14px] font-medium shadow-[0_10px_30px_rgba(0,0,0,0.025)] transition ${
          open
            ? "border-red-500 ring-4 ring-red-600/10"
            : "border-black/[0.09]"
        }`}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-black/55 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-[66px] z-40 max-h-64 w-full overflow-y-auto rounded-[20px] border border-black/[0.08] bg-white p-2 shadow-[0_18px_55px_rgba(0,0,0,0.14)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`flex h-11 w-full items-center rounded-2xl px-3 text-left text-[14px] transition ${
                option.value === value
                  ? "bg-red-600 text-white"
                  : "text-black/75 hover:bg-red-50 hover:text-red-600"
              }`}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-left text-[13px] transition ${
        active
          ? "bg-red-50 text-red-600"
          : "text-black/65 hover:bg-black/[0.035] hover:text-black"
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
      className={`h-9 rounded-xl px-3 text-[12px] transition ${
        active
          ? "bg-red-600 text-white"
          : "border border-black/[0.08] bg-white text-black/65 hover:bg-red-50 hover:text-red-600"
      }`}
    >
      {label}
    </button>
  );
}

function ProductCard({ product, storeId }) {
  const stock = Number(product.stock || 0);
  const productSize = product.size || "Talla única";

  return (
    <article className="group overflow-hidden rounded-[24px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.045)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(0,0,0,0.08)]">
      <div className="relative aspect-[4/3.7] overflow-hidden bg-black/[0.025]">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-black/30">
            <Camera size={32} />
          </div>
        )}

        <span className="absolute left-3 top-3 rounded-full bg-red-600 px-3 py-1 text-[11px] font-medium text-white">
          Disponible
        </span>
      </div>

      <div className="p-4">
        <p className="text-[12px] font-normal text-black/45">
          {product.code || "Sin código"} · {product.categoryName}
        </p>

        <h3 className="mt-1 line-clamp-1 text-[15px] font-medium text-black">
          {product.name}
        </h3>

        <p className="mt-2 inline-flex rounded-full bg-black/[0.035] px-2.5 py-1 text-[11px] text-black/60">
          {productSize}
        </p>

        <div className="mt-3">
          <p className="text-[18px] font-medium tracking-[-0.03em] text-black">
            {formatCurrency(product.salePrice)}
          </p>

          <p className="mt-1 text-[12px] text-emerald-600">
            En stock ({stock})
          </p>
        </div>

        <Link
          to={`/catalogo/${storeId}/apartar/${product.id}`}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
        >
          <ShoppingBag size={15} />
          Apartar ahora
        </Link>
      </div>
    </article>
  );
}

function SideBenefit({ icon: Icon, title, text }) {
  return (
    <div className="flex items-center gap-3 border-b border-black/[0.06] py-3 last:border-b-0">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <Icon size={18} />
      </div>

      <div>
        <p className="text-[13px] font-medium text-black">{title}</p>
        <p className="text-[12px] text-black/45">{text}</p>
      </div>
    </div>
  );
}

function DraggableWhatsAppButton() {
  const [position, setPosition] = useState({
    x: window.innerWidth - 86,
    y: window.innerHeight - 110,
  });

  const dragRef = useRef({
    dragging: false,
    moved: false,
    offsetX: 0,
    offsetY: 0,
  });

  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    WHATSAPP_MESSAGE
  )}`;

  function clampPosition(nextX, nextY) {
    const size = 64;
    const padding = 12;

    return {
      x: Math.min(Math.max(nextX, padding), window.innerWidth - size - padding),
      y: Math.min(Math.max(nextY, padding), window.innerHeight - size - padding),
    };
  }

  function handlePointerDown(event) {
    dragRef.current.dragging = true;
    dragRef.current.moved = false;
    dragRef.current.offsetX = event.clientX - position.x;
    dragRef.current.offsetY = event.clientY - position.y;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragRef.current.dragging) return;

    dragRef.current.moved = true;

    const next = clampPosition(
      event.clientX - dragRef.current.offsetX,
      event.clientY - dragRef.current.offsetY
    );

    setPosition(next);
  }

  function handlePointerUp(event) {
    dragRef.current.dragging = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleClick(event) {
    if (dragRef.current.moved) {
      event.preventDefault();
      dragRef.current.moved = false;
    }
  }

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="fixed z-50 flex h-16 w-16 touch-none select-none items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_16px_45px_rgba(37,211,102,0.35)] transition hover:scale-[1.04] hover:bg-[#1ebe5d]"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      aria-label="Contactar por WhatsApp"
    >
      <svg viewBox="0 0 32 32" className="h-10 w-10 fill-current" aria-hidden="true">
        <path d="M16.04 4C9.41 4 4 9.38 4 15.98c0 2.1.56 4.16 1.62 5.97L4 28l6.23-1.63a12.08 12.08 0 0 0 5.81 1.48h.01C22.68 27.85 28 22.49 28 15.89 28 9.31 22.67 4 16.04 4Zm.01 21.83h-.01c-1.74 0-3.45-.47-4.94-1.36l-.35-.21-3.7.97.99-3.6-.23-.37a9.86 9.86 0 0 1-1.52-5.28c0-5.47 4.48-9.93 9.99-9.93 2.67 0 5.18 1.04 7.06 2.91a9.83 9.83 0 0 1 2.93 7.01c0 5.47-4.47 9.86-10.22 9.86Zm5.46-7.37c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.03-1.05 2.51s1.08 2.91 1.23 3.11c.15.2 2.13 3.25 5.16 4.55.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.08-.12-.27-.2-.57-.35Z" />
      </svg>
    </a>
  );
}