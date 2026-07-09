import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Edit3,
  ExternalLink,
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

export default function InventoryPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");

  const [editingProduct, setEditingProduct] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [suggestedCode, setSuggestedCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch) ||
        String(productSize || "").toLowerCase().includes(cleanSearch);

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize = sizeFilter === "all" || productSize === sizeFilter;

      return matchesSearch && matchesCategory && matchesSize;
    });
  }, [products, search, categoryFilter, sizeFilter]);

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
    <main className="min-h-screen bg-brand-cream px-4 py-6 sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-black/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-gold">Master Caps</p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-brand-black">
              Inventario
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Crea productos, sube fotos, administra categorías dinámicas y
              controla el stock disponible en tiempo real.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={openPublicCatalog}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-brand-black hover:border-brand-black"
            >
              <ExternalLink size={17} />
              Publicar catálogo
            </button>

            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white hover:bg-black"
            >
              <Plus size={18} />
              Nuevo producto
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_220px_220px]">
          <label className="relative block">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-12 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-4 text-sm outline-none focus:border-brand-black"
              placeholder="Buscar por nombre, código, categoría o talla..."
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

          <select
            value={sizeFilter}
            onChange={(event) => setSizeFilter(event.target.value)}
            className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
          >
            <option value="all">Todas las tallas</option>

            {availableSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <section className="mt-6">
          {loading ? (
            <div className="rounded-3xl bg-white p-8 text-center text-sm text-gray-500">
              Cargando inventario en tiempo real...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-cream">
                <Package size={26} className="text-brand-black" />
              </div>

              <h2 className="mt-4 text-lg font-semibold text-brand-black">
                No hay productos todavía
              </h2>

              <p className="mt-2 text-sm text-gray-500">
                Crea el primer producto del inventario.
              </p>

              <button
                type="button"
                onClick={openCreateForm}
                className="mt-5 rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white"
              >
                Crear producto
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProducts.map((product) => (
                <article
                  key={product.id}
                  className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5"
                >
                  <div className="relative aspect-[4/3] bg-gray-100">
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

                    <span
                      className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold ${
                        Number(product.stock || 0) > 0
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {Number(product.stock || 0) > 0
                        ? `${product.stock} disponibles`
                        : "Sin stock"}
                    </span>
                  </div>

                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                          {product.categoryName}
                        </p>

                        <h3 className="mt-1 text-lg font-semibold text-brand-black">
                          {product.name}
                        </h3>

                        <p className="mt-1 text-xs text-gray-500">
                          Código: {product.code}
                        </p>

                        <p className="mt-1 text-xs font-medium text-brand-black">
                          Talla: {product.size || "Talla única"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-2xl bg-brand-cream p-3">
                        <p className="text-xs text-gray-500">Llegada</p>

                        <p className="font-semibold text-brand-black">
                          {formatCurrency(product.costPrice)}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-brand-cream p-3">
                        <p className="text-xs text-gray-500">Venta</p>

                        <p className="font-semibold text-brand-black">
                          {formatCurrency(product.salePrice)}
                        </p>
                      </div>

                      <div className="col-span-2 rounded-2xl bg-black p-3 text-white">
                        <p className="text-xs text-white/60">Ganancia</p>

                        <p className="font-semibold">
                          {formatCurrency(product.profitMargin)} ·{" "}
                          {Number(product.profitPercent || 0).toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(product)}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-black/10 px-4 py-3 text-sm font-medium text-brand-black hover:border-brand-black"
                      >
                        <Edit3 size={16} />
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(product)}
                        className="inline-flex items-center justify-center rounded-2xl border border-red-200 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-6 py-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                  {editingProduct ? "Editar producto" : "Nuevo producto"}
                </p>

                <h2 className="text-xl font-semibold text-brand-black">
                  Información de la prenda
                </h2>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="rounded-full p-2 hover:bg-gray-100"
              >
                <X size={22} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                <div>
                  <label className="block cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                    />

                    <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-3xl border border-dashed border-black/20 bg-brand-cream">
                      {imagePreview ? (
                        <img
                          src={imagePreview}
                          alt="Vista previa"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="text-center">
                          <Camera
                            size={34}
                            className="mx-auto text-gray-400"
                          />

                          <p className="mt-3 text-sm font-medium text-brand-black">
                            Subir foto
                          </p>

                          <p className="mt-1 text-xs text-gray-500">
                            JPG, PNG o WEBP
                          </p>
                        </div>
                      )}
                    </div>
                  </label>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Nombre del producto
                      </span>

                      <input
                        value={form.name}
                        onChange={(event) =>
                          updateForm("name", event.target.value)
                        }
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                        placeholder="Ej: Camiseta negra oversize"
                      />
                    </label>

                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Código
                      </span>

                      <input
                        value={form.code}
                        onChange={(event) =>
                          handleCodeChange(event.target.value)
                        }
                        disabled={loadingCode}
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black disabled:bg-gray-100"
                        placeholder="Ej: 0001"
                      />

                      <p className="mt-1 text-xs text-gray-500">
                        {editingProduct
                          ? "Puedes editar el código, pero no puede repetirse."
                          : codeTouched
                            ? "Código personalizado. Se validará que no exista."
                            : "Código automático sugerido. Al guardar se confirmará el consecutivo disponible."}
                      </p>
                    </label>

                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Talla
                      </span>

                      <input
                        value={form.size}
                        onChange={(event) =>
                          updateForm("size", event.target.value)
                        }
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                        placeholder="Ej: S, XL, 32"
                      />

                      <p className="mt-1 text-xs text-gray-500">
                        Si lo dejas vacío será Talla única.
                      </p>
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="text-sm font-medium text-brand-black">
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
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
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

                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Crear nueva categoría
                      </span>

                      <input
                        value={form.newCategoryName}
                        onChange={(event) => {
                          updateForm("newCategoryName", event.target.value);
                          updateForm("categoryId", "");
                          updateForm("categoryName", "");
                        }}
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                        placeholder="Ej: Camisetas"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Precio llegada
                      </span>

                      <input
                        value={form.costPrice}
                        onChange={(event) =>
                          updateForm("costPrice", event.target.value)
                        }
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                        placeholder="30000"
                      />
                    </label>

                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Precio venta
                      </span>

                      <input
                        value={form.salePrice}
                        onChange={(event) =>
                          updateForm("salePrice", event.target.value)
                        }
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                        placeholder="60000"
                      />
                    </label>

                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Stock
                      </span>

                      <input
                        type="number"
                        min="0"
                        value={form.stock}
                        onChange={(event) =>
                          updateForm("stock", event.target.value)
                        }
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                        placeholder="1"
                      />
                    </label>
                  </div>

                  <div className="rounded-3xl bg-brand-cream p-4">
                    <p className="text-sm font-medium text-brand-black">
                      Margen calculado automáticamente
                    </p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-gray-500">
                          Ganancia por unidad
                        </p>

                        <p className="text-lg font-semibold text-brand-black">
                          {formatCurrency(profit.profitMargin)}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500">
                          Porcentaje de ganancia
                        </p>

                        <p className="text-lg font-semibold text-brand-black">
                          {profit.profitPercent.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-7 flex flex-col-reverse gap-3 border-t border-black/10 pt-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-2xl border border-black/10 px-5 py-3 text-sm font-medium text-brand-black hover:border-brand-black"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={saving || loadingCode}
                  className="rounded-2xl bg-brand-black px-6 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
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
      )}
    </main>
  );
}