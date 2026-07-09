import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Camera,
  PackageSearch,
  Search,
  ShoppingBag,
  Sparkles,
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

  const visibleProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const stock = Number(product.stock || 0);

      const matchesStock = stock > 0;

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch);

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      return matchesStock && matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

  return (
    <main className="min-h-screen bg-brand-cream">
      <section className="relative overflow-hidden bg-brand-black px-4 py-12 text-white sm:px-6">
        <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-brand-gold/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/80">
                <Sparkles size={16} />
                Catálogo público
              </div>

              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
                Master Caps
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
                Explora las prendas disponibles y aparta la que quieres. Tu
                apartado queda activo durante 7 días.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
              <p className="text-sm text-white/60">Prendas disponibles</p>
              <p className="mt-1 text-3xl font-semibold">
                {visibleProducts.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid gap-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:grid-cols-[1fr_260px]">
          <label className="relative block">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-12 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-4 text-sm outline-none focus:border-brand-black"
              placeholder="Buscar por nombre, código o categoría..."
            />
          </label>

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
          >
            <option value="all">Todas las categorías</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <section className="mt-6">
          {loading ? (
            <div className="rounded-3xl bg-white p-10 text-center text-sm text-gray-500">
              Cargando catálogo en tiempo real...
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center">
              <PackageSearch size={38} className="mx-auto text-gray-400" />
              <h2 className="mt-4 text-xl font-semibold text-brand-black">
                No hay prendas disponibles
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                En este momento no hay productos con stock disponible.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleProducts.map((product) => {
                const stock = Number(product.stock || 0);

                return (
                  <article
                    key={product.id}
                    className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div className="relative aspect-[4/5] bg-gray-100">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-400">
                          <Camera size={34} />
                        </div>
                      )}

                      <span className="absolute right-3 top-3 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                        {stock} disponibles
                      </span>
                    </div>

                    <div className="p-5">
                      <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                        {product.categoryName}
                      </p>

                      <h3 className="mt-1 line-clamp-2 text-lg font-semibold text-brand-black">
                        {product.name}
                      </h3>

                      <p className="mt-1 text-xs text-gray-500">
                        Código: {product.code}
                      </p>

                      <div className="mt-4 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs text-gray-500">Precio</p>
                          <p className="text-xl font-semibold text-brand-black">
                            {formatCurrency(product.salePrice)}
                          </p>
                        </div>

                        <Link
                          to={`/catalogo/${storeId}/apartar/${product.id}`}
                          className="inline-flex items-center gap-2 rounded-2xl bg-brand-black px-4 py-3 text-sm font-semibold text-white hover:bg-black"
                        >
                          <ShoppingBag size={16} />
                          Apartar
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}