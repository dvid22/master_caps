import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CalendarDays,
  Camera,
  Grid3X3,
  Headphones,
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
      (categoriesData) => {
        setCategories(categoriesData);
      },
      () => {
        alert("No se pudieron cargar las categorías del catálogo.");
      },
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

      const matchesStock = stock > 0;

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch) ||
        String(productSize || "").toLowerCase().includes(cleanSearch);

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize = sizeFilter === "all" || productSize === sizeFilter;

      return matchesStock && matchesSearch && matchesCategory && matchesSize;
    });
  }, [products, search, categoryFilter, sizeFilter]);

  return (
    <main className="min-h-screen bg-[#f7f7f8] text-black">
      <section className="mx-auto min-h-screen max-w-[1600px] bg-white shadow-[0_18px_55px_rgba(0,0,0,0.04)] lg:grid lg:grid-cols-[300px_1fr]">
        <aside className="hidden border-r border-black/[0.06] bg-white px-5 py-6 lg:flex lg:flex-col">
          <div className="border-b border-black/[0.06] pb-6">
            <img
              src="/logo.png"
              alt="Master Caps"
              className="h-24 w-auto object-contain"
            />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-[13px] font-medium uppercase text-black">
              Filtros
            </h2>

            <SlidersHorizontal size={16} className="text-black/55" />
          </div>

          <div className="mt-6">
            <p className="text-[13px] font-medium text-black">Categorías</p>

            <div className="mt-3 space-y-1.5">
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className={`flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-left text-[13px] transition ${
                  categoryFilter === "all"
                    ? "bg-red-50 text-red-600"
                    : "text-black/65 hover:bg-black/[0.035] hover:text-black"
                }`}
              >
                <Grid3X3 size={15} />
                Todas las categorías
              </button>

              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setCategoryFilter(category.id)}
                  className={`flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-left text-[13px] transition ${
                    categoryFilter === category.id
                      ? "bg-red-50 text-red-600"
                      : "text-black/65 hover:bg-black/[0.035] hover:text-black"
                  }`}
                >
                  <ShoppingBag size={15} />
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-black/[0.06] pt-5">
            <p className="text-[13px] font-medium text-black">Tallas</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSizeFilter("all")}
                className={`h-9 rounded-xl px-3 text-[12px] transition ${
                  sizeFilter === "all"
                    ? "bg-red-600 text-white"
                    : "border border-black/[0.08] bg-white text-black/65 hover:bg-red-50 hover:text-red-600"
                }`}
              >
                Todas
              </button>

              {availableSizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSizeFilter(size)}
                  className={`h-9 rounded-xl px-3 text-[12px] transition ${
                    sizeFilter === size
                      ? "bg-red-600 text-white"
                      : "border border-black/[0.08] bg-white text-black/65 hover:bg-red-50 hover:text-red-600"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto rounded-[24px] border border-black/[0.06] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)]">
            <SideBenefit
              icon={CalendarDays}
              title="Aparta por 7 días"
              text="Reserva segura"
            />
            <SideBenefit icon={Lock} title="Compra segura" text="Datos protegidos" />
            <SideBenefit
              icon={ShieldCheck}
              title="Productos originales"
              text="Calidad garantizada"
            />
          </div>
        </aside>

        <section className="min-w-0 px-3 py-4 sm:px-5 lg:px-7">
          <header className="mb-4 flex items-center justify-between gap-3 lg:hidden">
            <img
              src="/logo.png"
              alt="Master Caps"
              className="h-16 w-auto object-contain"
            />

            <div className="rounded-2xl bg-red-600 px-4 py-2 text-[12px] font-medium text-white shadow-lg shadow-red-600/20">
              Catálogo
            </div>
          </header>

          <div className="grid gap-3 lg:grid-cols-[1fr_48px_185px]">
            <label className="relative block">
              <Search
                size={17}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-12 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Buscar productos, códigos, categorías..."
              />
            </label>

            <button
              type="button"
              className="hidden h-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-50 text-red-600 lg:flex"
            >
              <Grid3X3 size={17} />
            </button>

            <select className="hidden h-12 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none lg:block">
              <option>Más recientes</option>
              <option>Precio menor</option>
              <option>Precio mayor</option>
            </select>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:hidden">
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="all">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <select
              value={sizeFilter}
              onChange={(event) => setSizeFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="all">Todas las tallas</option>
              {availableSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[13px] text-black/50">
              Mostrando{" "}
              <span className="font-medium text-red-600">
                {visibleProducts.length}
              </span>{" "}
              productos disponibles
            </p>

            <select className="h-10 rounded-xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none lg:hidden">
              <option>Más recientes</option>
              <option>Precio menor</option>
              <option>Precio mayor</option>
            </select>
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
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
    </main>
  );
}

function ProductCard({ product, storeId }) {
  const stock = Number(product.stock || 0);
  const productSize = product.size || "Talla única";

  return (
    <article className="group overflow-hidden rounded-[24px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(0,0,0,0.08)]">
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