import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Edit3,
  ExternalLink,
  Eye,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  getOrCreateCategory,
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";

import {
  createProduct,
  deleteProduct,
  getNextProductCodePreview,
  subscribeProducts,
  updateProduct,
} from "../../services/products.service";

import {
  calculateProfit,
  formatCurrency,
  toNumber,
} from "../../utils/money";

import { getCurrentUserActor } from "../../services/auth.service";

const emptyForm = {
  name: "",
  code: "",
  size: "",
  categoryId: "",
  categoryName: "",
  newCategoryName: "",
  costPrice: "",
  salePrice: "",
  stock: "1",
};

function normalizeSize(value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return "Talla única";
  return cleanValue.toUpperCase();
}

function getStockStatus(stock) {
  const value = Number(stock || 0);

  if (value <= 0) {
    return {
      label: "Agotado",
      text: "Stock: 0 unidades",
      filter: "out",
      badgeClass: "bg-red-50 text-red-600",
      stockClass: "text-red-600",
    };
  }

  if (value <= 6) {
    return {
      label: "Stock bajo",
      text: `Stock: ${value} unidades`,
      filter: "low",
      badgeClass: "bg-orange-50 text-orange-600",
      stockClass: "text-orange-600",
    };
  }

  return {
    label: "En stock",
    text: `Stock: ${value} unidades`,
    filter: "available",
    badgeClass: "bg-emerald-50 text-emerald-600",
    stockClass: "text-emerald-600",
  };
}

export default function InventoryPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");

  const [editingProduct, setEditingProduct] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [suggestedCode, setSuggestedCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");

  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const productsPerPage = 8;

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
        setLoading(false);
      },
      () => {
        setLoading(false);
        alert("No se pudo escuchar el inventario en tiempo real.");
      },
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      (categoriesData) => {
        setCategories(categoriesData);
      },
      () => {
        alert("No se pudieron escuchar las categorías en tiempo real.");
      },
      STORE_ID
    );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
    };
  }, []);

  const profit = useMemo(() => {
    return calculateProfit(form.costPrice, form.salePrice);
  }, [form.costPrice, form.salePrice]);

  const availableSizes = useMemo(() => {
    const sizes = products
      .map((product) => product.size || "Talla única")
      .filter(Boolean);

    return [...new Set(sizes)].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const productSize = product.size || "Talla única";
      const stockStatus = getStockStatus(product.stock);

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch) ||
        String(productSize || "").toLowerCase().includes(cleanSearch);

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize = sizeFilter === "all" || productSize === sizeFilter;

      const matchesStock =
        stockFilter === "all" || stockStatus.filter === stockFilter;

      return matchesSearch && matchesCategory && matchesSize && matchesStock;
    });
  }, [products, search, categoryFilter, sizeFilter, stockFilter]);

  const totalPages = Math.max(
    Math.ceil(filteredProducts.length / productsPerPage),
    1
  );

  const paginatedProducts = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * productsPerPage;
    return filteredProducts.slice(start, start + productsPerPage);
  }, [filteredProducts, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, sizeFilter, stockFilter]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm() {
    setForm(emptyForm);
    setImageFile(null);
    setImagePreview("");
    setEditingProduct(null);
    setSuggestedCode("");
    setCodeTouched(false);
    setLoadingCode(false);
  }

  async function loadSuggestedCode() {
    try {
      setLoadingCode(true);

      const nextCode = await getNextProductCodePreview(STORE_ID);

      setSuggestedCode(nextCode);
      setCodeTouched(false);

      setForm((current) => ({
        ...current,
        code: nextCode,
      }));
    } catch (error) {
      console.error(error);

      setSuggestedCode("");
      setCodeTouched(false);

      setForm((current) => ({
        ...current,
        code: "",
      }));

      alert("No se pudo calcular el siguiente código automático.");
    } finally {
      setLoadingCode(false);
    }
  }

  async function openCreateForm() {
    resetForm();
    setShowForm(true);

    setForm({
      ...emptyForm,
      code: "Calculando...",
    });

    await loadSuggestedCode();
  }

  function closeForm() {
    resetForm();
    setShowForm(false);
  }

  function openPublicCatalog() {
    const catalogUrl = `${window.location.origin}/catalogo/${STORE_ID}`;

    window.open(catalogUrl, "_blank", "noopener,noreferrer");

    navigator.clipboard
      ?.writeText(catalogUrl)
      .then(() => {
        console.log("Link del catálogo copiado:", catalogUrl);
      })
      .catch(() => {
        console.log("No se pudo copiar automáticamente:", catalogUrl);
      });
  }

  function handleImageChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function handleEdit(product) {
    setEditingProduct(product);
    setSuggestedCode("");
    setCodeTouched(true);

    setForm({
      name: product.name || "",
      code: product.code || "",
      size: product.size === "Talla única" ? "" : product.size || "",
      categoryId: product.categoryId || "",
      categoryName: product.categoryName || "",
      newCategoryName: "",
      costPrice: String(product.costPrice || ""),
      salePrice: String(product.salePrice || ""),
      stock: String(product.stock || "1"),
    });

    setImageFile(null);
    setImagePreview(product.imageUrl || "");
    setShowForm(true);
  }

  function handleCodeChange(value) {
    setCodeTouched(true);
    updateForm("code", value);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const name = form.name.trim();

    const code =
      !editingProduct && !codeTouched && form.code === suggestedCode
        ? ""
        : form.code.trim();

    const size = normalizeSize(form.size);
    const costPrice = toNumber(form.costPrice);
    const salePrice = toNumber(form.salePrice);
    const stock = Number(form.stock || 0);

    if (!name) {
      alert("Escribe el nombre del producto.");
      return;
    }

    if (!form.categoryId && !form.newCategoryName.trim()) {
      alert("Selecciona o crea una categoría.");
      return;
    }

    if (costPrice <= 0) {
      alert("El precio de llegada debe ser mayor a cero.");
      return;
    }

    if (salePrice <= 0) {
      alert("El precio de venta debe ser mayor a cero.");
      return;
    }

    if (stock < 0) {
      alert("El stock no puede ser negativo.");
      return;
    }

    try {
      setSaving(true);

      let selectedCategory = null;

      if (form.newCategoryName.trim()) {
        selectedCategory = await getOrCreateCategory(
          form.newCategoryName,
          STORE_ID
        );
      } else {
        selectedCategory = categories.find(
          (category) => category.id === form.categoryId
        );
      }

      if (!selectedCategory) {
        alert("No se encontró la categoría seleccionada.");
        return;
      }

      const productPayload = {
        storeId: STORE_ID,
        name,
        code,
        size,
        categoryId: selectedCategory.id,
        categoryName: selectedCategory.name,
        costPrice,
        salePrice,
        profitMargin: profit.profitMargin,
        profitPercent: profit.profitPercent,
        stock,
      };

      const actor = getCurrentUserActor();

      if (editingProduct) {
        await updateProduct(
          editingProduct.id,
          productPayload,
          imageFile,
          editingProduct.imagePath,
          actor
        );
      } else {
        await createProduct(productPayload, imageFile, STORE_ID, actor);
      }

      closeForm();
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo guardar el producto.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product) {
    const confirmDelete = window.confirm(
      `¿Seguro que deseas eliminar "${product.name}"?`
    );

    if (!confirmDelete) return;

    try {
      await deleteProduct(product.id, product.imagePath);
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo eliminar el producto.");
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-medium tracking-[-0.045em] text-black">
              Inventario
            </h1>

            <p className="mt-1 text-[13px] font-normal text-black/50">
              Gestiona todos los productos de tu tienda
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={openPublicCatalog}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-5 text-[13px] font-medium text-black shadow-[0_12px_35px_rgba(0,0,0,0.04)] transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
            >
              <ExternalLink size={16} strokeWidth={1.9} />
              Publicar catálogo
            </button>

            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
            >
              <Plus size={17} strokeWidth={1.9} />
              Nuevo producto
            </button>
          </div>
        </header>

        <section className="mt-5 rounded-[26px] bg-white p-3 shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
          <div className="grid gap-3 lg:grid-cols-[1.45fr_0.82fr_0.78fr_0.78fr]">
            <label className="relative block">
              <Search
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] font-normal text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Buscar producto, código o categoría..."
              />
            </label>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
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
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="all">Todas las tallas</option>

              {availableSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>

            <select
              value={stockFilter}
              onChange={(event) => setStockFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="all">Estado de stock</option>
              <option value="available">En stock</option>
              <option value="low">Stock bajo</option>
              <option value="out">Agotado</option>
            </select>
          </div>

          <section className="mt-4">
            {loading ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center text-[13px] text-black/45">
                Cargando inventario en tiempo real...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black/50 ring-1 ring-black/[0.06]">
                  <Package size={24} />
                </div>

                <h2 className="mt-4 text-[17px] font-medium text-black">
                  No hay productos todavía
                </h2>

                <p className="mt-2 text-[13px] text-black/45">
                  Crea el primer producto del inventario.
                </p>

                <button
                  type="button"
                  onClick={openCreateForm}
                  className="mt-5 rounded-2xl bg-red-600 px-5 py-3 text-[13px] font-medium text-white hover:bg-red-700"
                >
                  Crear producto
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {paginatedProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onView={() => setDetailProduct(product)}
                      onEdit={() => handleEdit(product)}
                      onDelete={() => handleDelete(product)}
                    />
                  ))}
                </div>

                <footer className="mt-4 flex flex-col gap-3 border-t border-black/[0.06] pt-4 md:flex-row md:items-center md:justify-between">
                  <p className="text-[12px] font-normal text-black/50">
                    Mostrando{" "}
                    {filteredProducts.length === 0
                      ? 0
                      : (Math.min(page, totalPages) - 1) * productsPerPage + 1}{" "}
                    a{" "}
                    {Math.min(
                      Math.min(page, totalPages) * productsPerPage,
                      filteredProducts.length
                    )}{" "}
                    de {filteredProducts.length} productos
                  </p>

                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => current - 1)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ‹
                    </button>

                    {Array.from({ length: Math.min(totalPages, 5) }).map(
                      (_, index) => {
                        const pageNumber = index + 1;

                        return (
                          <button
                            key={pageNumber}
                            type="button"
                            onClick={() => setPage(pageNumber)}
                            className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                              page === pageNumber
                                ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                                : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
                            }`}
                          >
                            {pageNumber}
                          </button>
                        );
                      }
                    )}

                    {totalPages > 5 && (
                      <span className="px-1 text-[12px] text-black/40">
                        ...
                      </span>
                    )}

                    {totalPages > 5 && (
                      <button
                        type="button"
                        onClick={() => setPage(totalPages)}
                        className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                          page === totalPages
                            ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                            : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
                        }`}
                      >
                        {totalPages}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => current + 1)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ›
                    </button>
                  </div>

                  <div className="hidden h-9 items-center rounded-xl border border-black/[0.08] bg-white px-4 text-[12px] text-black/70 md:flex">
                    8 por página
                  </div>
                </footer>
              </>
            )}
          </section>
        </section>
      </section>

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onEdit={() => {
            setDetailProduct(null);
            handleEdit(detailProduct);
          }}
        />
      )}

      {showForm && (
        <ProductFormModal
          editingProduct={editingProduct}
          closeForm={closeForm}
          handleSubmit={handleSubmit}
          handleImageChange={handleImageChange}
          imagePreview={imagePreview}
          form={form}
          updateForm={updateForm}
          handleCodeChange={handleCodeChange}
          loadingCode={loadingCode}
          categories={categories}
          saving={saving}
          profit={profit}
        />
      )}
    </main>
  );
}

function ProductCard({ product, onView, onEdit, onDelete }) {
  const stockStatus = getStockStatus(product.stock);

  return (
    <article className="rounded-[24px] bg-white p-3 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(0,0,0,0.07)]">
      <div className="flex gap-3">
        <div className="flex h-[86px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[20px] bg-black/[0.025]">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera size={25} className="text-black/30" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-medium text-black">
                {product.name}
              </h3>

              <p className="mt-1 text-[12px] text-black/45">
                {product.code || "Sin código"}
              </p>

              <p className="mt-1 truncate text-[12px] text-black/50">
                {product.categoryName || "Sin categoría"}
              </p>
            </div>

            <button
              type="button"
              onClick={onView}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] text-black/45 transition hover:bg-black/[0.035] hover:text-black"
              title="Ver detalles"
            >
              <Eye size={15} />
            </button>
          </div>

          <p className="mt-2 inline-flex rounded-full bg-black/[0.025] px-2.5 py-1 text-[11px] text-black/60">
            {product.size || "Talla única"}
          </p>

          <p className={`mt-2 text-[12px] font-normal ${stockStatus.stockClass}`}>
            {stockStatus.text}
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-black/[0.06] pt-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[16px] font-medium tracking-[-0.03em] text-black">
              {formatCurrency(product.salePrice)}
            </p>

            <p className="mt-1 text-[12px] text-black/45">
              Costo: {formatCurrency(product.costPrice)}
            </p>

            <p className="mt-1 text-[12px] text-black/45">
              Ganancia:{" "}
              <span className="text-emerald-600">
                {formatCurrency(product.profitMargin)}
              </span>
            </p>
          </div>

          <span
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-normal ${stockStatus.badgeClass}`}
          >
            {stockStatus.label}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_0.8fr_40px] gap-2">
          <button
            type="button"
            onClick={onView}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-[12px] font-medium text-black transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
          >
            <Eye size={14} />
            Ver detalles
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-[12px] font-medium text-black transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
          >
            <Edit3 size={14} />
            Editar
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-red-100 bg-white text-red-600 transition hover:bg-red-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductDetailModal({ product, onClose, onEdit }) {
  const stockStatus = getStockStatus(product.stock);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[720px] overflow-hidden rounded-[26px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[12px] font-normal text-red-600">
              Detalles del producto
            </p>

            <h2 className="mt-0.5 truncate text-[21px] font-medium tracking-[-0.035em] text-black">
              {product.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={19} />
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-[190px_1fr]">
          <div className="flex aspect-[4/5] max-h-[250px] items-center justify-center overflow-hidden rounded-[22px] bg-black/[0.025]">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Camera size={32} className="text-black/30" />
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <DetailItem label="Código" value={product.code || "Sin código"} />
            <DetailItem
              label="Categoría"
              value={product.categoryName || "Sin categoría"}
            />
            <DetailItem label="Talla" value={product.size || "Talla única"} />
            <DetailItem label="Estado" value={stockStatus.label} />
            <DetailItem
              label="Stock"
              value={`${Number(product.stock || 0)} unidad(es)`}
            />
            <DetailItem
              label="Precio llegada"
              value={formatCurrency(product.costPrice)}
            />
            <DetailItem
              label="Precio venta"
              value={formatCurrency(product.salePrice)}
            />
            <DetailItem
              label="Ganancia"
              value={`${formatCurrency(product.profitMargin)} · ${Number(
                product.profitPercent || 0
              ).toFixed(1)}%`}
              highlight
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-black/[0.06] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-black/[0.08] px-5 text-[13px] font-medium text-black/70 transition hover:bg-black/[0.035]"
          >
            Cerrar
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="h-10 rounded-xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
          >
            Editar producto
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailItem({ label, value, highlight = false }) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 ${
        highlight ? "bg-red-600 text-white" : "bg-black/[0.025] text-black"
      }`}
    >
      <p
        className={`text-[12px] ${
          highlight ? "text-white/65" : "text-black/45"
        }`}
      >
        {label}
      </p>

      <p className="mt-0.5 truncate text-[14px] font-medium">{value}</p>
    </div>
  );
}

function ProductFormModal({
  editingProduct,
  closeForm,
  handleSubmit,
  handleImageChange,
  imagePreview,
  form,
  updateForm,
  handleCodeChange,
  loadingCode,
  categories,
  saving,
  profit,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[30px] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/[0.06] bg-white/90 px-6 py-5 backdrop-blur-xl">
          <div>
            <p className="text-[13px] font-normal text-red-600">
              {editingProduct ? "Editar producto" : "Nuevo producto"}
            </p>

            <h2 className="mt-1 text-[22px] font-medium tracking-[-0.035em] text-black">
              Información de la prenda
            </h2>
          </div>

          <button
            type="button"
            onClick={closeForm}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid gap-6 md:grid-cols-[250px_1fr]">
            <label className="block cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />

              <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[26px] border border-dashed border-black/15 bg-black/[0.025]">
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt="Vista previa"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-center">
                    <Camera size={32} className="mx-auto text-black/35" />

                    <p className="mt-3 text-[14px] font-medium text-black">
                      Subir foto
                    </p>

                    <p className="mt-1 text-[12px] text-black/40">
                      JPG, PNG o WEBP
                    </p>
                  </div>
                )}
              </div>
            </label>

            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <InputField
                  label="Nombre"
                  value={form.name}
                  onChange={(value) => updateForm("name", value)}
                  placeholder="Ej: Gorra NY negra"
                />

                <InputField
                  label="Código"
                  value={form.code}
                  onChange={handleCodeChange}
                  disabled={loadingCode}
                  placeholder="Ej: CAP-0001"
                />

                <InputField
                  label="Talla"
                  value={form.size}
                  onChange={(value) => updateForm("size", value)}
                  placeholder="Ej: S, XL, 32"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="text-[13px] font-normal text-black/65">
                    Categoría existente
                  </span>

                  <select
                    value={form.categoryId}
                    onChange={(event) => {
                      const selected = categories.find(
                        (category) => category.id === event.target.value
                      );

                      updateForm("categoryId", event.target.value);
                      updateForm("categoryName", selected?.name || "");
                      updateForm("newCategoryName", "");
                    }}
                    className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  >
                    <option value="">
                      {categories.length === 0
                        ? "No hay categorías creadas"
                        : "Seleccionar categoría"}
                    </option>

                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                <InputField
                  label="Crear nueva categoría"
                  value={form.newCategoryName}
                  onChange={(value) => {
                    updateForm("newCategoryName", value);
                    updateForm("categoryId", "");
                    updateForm("categoryName", "");
                  }}
                  placeholder="Ej: Gorras"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <InputField
                  label="Precio llegada"
                  value={form.costPrice}
                  onChange={(value) => updateForm("costPrice", value)}
                  placeholder="45000"
                />

                <InputField
                  label="Precio venta"
                  value={form.salePrice}
                  onChange={(value) => updateForm("salePrice", value)}
                  placeholder="85000"
                />

                <InputField
                  label="Stock"
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={(value) => updateForm("stock", value)}
                  placeholder="1"
                />
              </div>

              <div className="rounded-[24px] bg-black/[0.025] p-4">
                <p className="text-[14px] font-medium text-black">
                  Margen calculado automáticamente
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white p-4 ring-1 ring-black/[0.06]">
                    <p className="text-[12px] text-black/45">
                      Ganancia por unidad
                    </p>

                    <p className="mt-1 text-[18px] font-medium text-black">
                      {formatCurrency(profit.profitMargin)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-red-600 p-4 text-white">
                    <p className="text-[12px] text-white/65">
                      Porcentaje de ganancia
                    </p>

                    <p className="mt-1 text-[18px] font-medium">
                      {profit.profitPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-col-reverse gap-3 border-t border-black/[0.06] pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeForm}
              className="h-11 rounded-2xl border border-black/[0.08] px-5 text-[14px] font-medium text-black/70 transition hover:bg-black/[0.035]"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving || loadingCode}
              className="h-11 rounded-2xl bg-red-600 px-6 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? "Guardando..."
                : editingProduct
                  ? "Actualizar producto"
                  : "Guardar producto"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  min,
}) {
  return (
    <label>
      <span className="text-[13px] font-normal text-black/65">{label}</span>

      <input
        type={type}
        min={min}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45"
        placeholder={placeholder}
      />
    </label>
  );
}