import { useEffect, useMemo, useState } from "react";
import {
  Barcode,
  Camera,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  Eye,
  ImagePlus,
  Images,
  Package,
  Plus,
  Search,
  Star,
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
  getProductCoverImage,
  getProductImages,
  normalizeProductVariants,
  subscribeProducts,
  updateProduct,
  MAX_PRODUCT_IMAGES,
} from "../../services/products.service";

import {
  calculateProfit,
  formatCurrency,
  toNumber,
} from "../../utils/money";

import { getCurrentUserActor } from "../../services/auth.service";
import BarcodeLabel from "../../components/products/BarcodeLabel";

const createVariantId = () =>
  `variant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const createLocalImageId = () =>
  `image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const createInitialVariants = () => [
  {
    id: createVariantId(),
    size: "Talla única",
    stock: "1",
  },
];

const createEmptyForm = () => ({
  name: "",
  code: "",
  categoryId: "",
  categoryName: "",
  newCategoryName: "",
  costPrice: "",
  salePrice: "",
  variants: createInitialVariants(),
});

function normalizeSize(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "Talla única";

  const normalized = cleanValue.toUpperCase();

  if (
    normalized === "TALLA UNICA" ||
    normalized === "TALLA ÚNICA" ||
    normalized === "UNICA" ||
    normalized === "ÚNICA"
  ) {
    return "Talla única";
  }

  return normalized;
}

function getTotalStock(product) {
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return product.variants.reduce(
      (total, variant) => total + Number(variant.stock || 0),
      0
    );
  }

  return Number(product?.stock || 0);
}

function getProductSizes(product) {
  const variants = normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );

  return variants.map((variant) => variant.size);
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

function revokePreview(preview) {
  if (preview?.startsWith("blob:")) {
    URL.revokeObjectURL(preview);
  }
}

export default function InventoryPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [form, setForm] = useState(createEmptyForm());

  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");

  const [existingImages, setExistingImages] = useState([]);
  const [galleryFiles, setGalleryFiles] = useState([]);
  const [removedImagePaths, setRemovedImagePaths] = useState([]);

  const [editingProduct, setEditingProduct] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [labelProduct, setLabelProduct] = useState(null);
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

        setDetailProduct((current) => {
          if (!current) return null;
          return productsData.find((product) => product.id === current.id) || null;
        });

        setLabelProduct((current) => {
          if (!current) return null;
          return productsData.find((product) => product.id === current.id) || null;
        });
      },
      () => {
        setLoading(false);
        alert("No se pudo escuchar el inventario en tiempo real.");
      },
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      (categoriesData) => setCategories(categoriesData),
      () => alert("No se pudieron escuchar las categorías en tiempo real."),
      STORE_ID
    );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
    };
  }, []);

  useEffect(() => {
    return () => {
      revokePreview(coverPreview);
      galleryFiles.forEach((image) => revokePreview(image.preview));
    };
  }, []);

  const profit = useMemo(() => {
    return calculateProfit(form.costPrice, form.salePrice);
  }, [form.costPrice, form.salePrice]);

  const formTotalStock = useMemo(() => {
    return form.variants.reduce(
      (total, variant) => total + Number(variant.stock || 0),
      0
    );
  }, [form.variants]);

  const availableSizes = useMemo(() => {
    const sizes = products.flatMap((product) => getProductSizes(product));

    return [...new Set(sizes)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const productSizes = getProductSizes(product);
      const totalStock = getTotalStock(product);
      const stockStatus = getStockStatus(totalStock);

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch) ||
        productSizes.some((size) =>
          String(size || "").toLowerCase().includes(cleanSearch)
        );

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize =
        sizeFilter === "all" || productSizes.includes(sizeFilter);

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
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateVariant(variantId, field, value) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) =>
        variant.id === variantId ? { ...variant, [field]: value } : variant
      ),
    }));
  }

  function addVariant() {
    setForm((current) => ({
      ...current,
      variants: [
        ...current.variants,
        {
          id: createVariantId(),
          size: "",
          stock: "0",
        },
      ],
    }));
  }

  function removeVariant(variantId) {
    setForm((current) => {
      if (current.variants.length <= 1) return current;

      return {
        ...current,
        variants: current.variants.filter(
          (variant) => variant.id !== variantId
        ),
      };
    });
  }

  function clearMediaPreviews() {
    revokePreview(coverPreview);
    galleryFiles.forEach((image) => revokePreview(image.preview));
  }

  function resetForm() {
    clearMediaPreviews();

    setForm(createEmptyForm());
    setCoverFile(null);
    setCoverPreview("");
    setExistingImages([]);
    setGalleryFiles([]);
    setRemovedImagePaths([]);

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

    setForm((current) => ({
      ...current,
      code: "Calculando...",
    }));

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
      .then(() => console.log("Link del catálogo copiado:", catalogUrl))
      .catch(() =>
        console.log("No se pudo copiar automáticamente:", catalogUrl)
      );
  }

  function handleCoverChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    revokePreview(coverPreview);

    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  function handleGalleryChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (files.length === 0) return;

    const currentCount =
      existingImages.length +
      galleryFiles.length +
      Number(Boolean(coverFile));

    const availableSlots = MAX_PRODUCT_IMAGES - currentCount;

    if (availableSlots <= 0) {
      alert(`Puedes tener máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`);
      return;
    }

    const acceptedFiles = files.slice(0, availableSlots);

    if (acceptedFiles.length < files.length) {
      alert(
        `Solo se agregaron ${acceptedFiles.length} imágenes porque el máximo es ${MAX_PRODUCT_IMAGES}.`
      );
    }

    const newImages = acceptedFiles.map((file) => ({
      id: createLocalImageId(),
      file,
      preview: URL.createObjectURL(file),
    }));

    setGalleryFiles((current) => [...current, ...newImages]);
  }

  function removeNewGalleryImage(imageId) {
    setGalleryFiles((current) => {
      const imageToRemove = current.find((image) => image.id === imageId);

      if (imageToRemove) {
        revokePreview(imageToRemove.preview);
      }

      return current.filter((image) => image.id !== imageId);
    });
  }

  function removeExistingImage(imageId) {
    setExistingImages((current) => {
      const imageToRemove = current.find((image) => image.id === imageId);

      if (imageToRemove?.path) {
        setRemovedImagePaths((paths) => [
          ...new Set([...paths, imageToRemove.path]),
        ]);
      }

      const remainingImages = current.filter((image) => image.id !== imageId);

      return remainingImages.map((image, index) => ({
        ...image,
        type: index === 0 ? "cover" : "gallery",
        sortOrder: index,
      }));
    });
  }

  function makeExistingImageCover(imageId) {
    revokePreview(coverPreview);

    setCoverFile(null);
    setCoverPreview("");

    setExistingImages((current) => {
      const selectedImage = current.find((image) => image.id === imageId);
      if (!selectedImage) return current;

      const remainingImages = current.filter((image) => image.id !== imageId);

      return [selectedImage, ...remainingImages].map((image, index) => ({
        ...image,
        type: index === 0 ? "cover" : "gallery",
        sortOrder: index,
      }));
    });
  }

  function makeNewGalleryImageCover(imageId) {
    const selectedImage = galleryFiles.find((image) => image.id === imageId);
    if (!selectedImage) return;

    revokePreview(coverPreview);

    setCoverFile(selectedImage.file);
    setCoverPreview(selectedImage.preview);

    setGalleryFiles((current) =>
      current.filter((image) => image.id !== imageId)
    );
  }

  function removeNewCover() {
    revokePreview(coverPreview);
    setCoverFile(null);
    setCoverPreview("");
  }

  function handleEdit(product) {
    resetForm();

    const normalizedVariants = normalizeProductVariants(
      product.variants,
      product.size,
      product.stock
    );

    const images = getProductImages(product);
    const coverImage = getProductCoverImage(product);

    setEditingProduct(product);
    setSuggestedCode("");
    setCodeTouched(true);

    setForm({
      name: product.name || "",
      code: product.code || "",
      categoryId: product.categoryId || "",
      categoryName: product.categoryName || "",
      newCategoryName: "",
      costPrice: String(product.costPrice || ""),
      salePrice: String(product.salePrice || ""),
      variants: normalizedVariants.map((variant) => ({
        id: variant.id || createVariantId(),
        size: variant.size || "Talla única",
        stock: String(variant.stock || 0),
      })),
    });

    setExistingImages(images);
    setCoverPreview(coverImage.url || "");
    setCoverFile(null);
    setGalleryFiles([]);
    setRemovedImagePaths([]);

    setShowForm(true);
  }

  function handleCodeChange(value) {
    setCodeTouched(true);
    updateForm("code", value);
  }

  function validateVariants() {
    if (!Array.isArray(form.variants) || form.variants.length === 0) {
      alert("Agrega al menos una talla al producto.");
      return null;
    }

    const normalizedVariants = form.variants.map((variant) => ({
      id: variant.id || createVariantId(),
      size: normalizeSize(variant.size),
      stock: Number(variant.stock || 0),
    }));

    const invalidStock = normalizedVariants.some(
      (variant) =>
        !Number.isFinite(variant.stock) ||
        variant.stock < 0 ||
        !Number.isInteger(variant.stock)
    );

    if (invalidStock) {
      alert(
        "El stock de cada talla debe ser un número entero mayor o igual a 0."
      );
      return null;
    }

    const sizes = normalizedVariants.map((variant) => variant.size);
    const uniqueSizes = new Set(sizes);

    if (uniqueSizes.size !== sizes.length) {
      alert("No puedes repetir la misma talla dentro del producto.");
      return null;
    }

    return normalizedVariants;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const name = form.name.trim();

    const code =
      !editingProduct && !codeTouched && form.code === suggestedCode
        ? ""
        : form.code.trim();

    const costPrice = toNumber(form.costPrice);
    const salePrice = toNumber(form.salePrice);
    const normalizedVariants = validateVariants();

    if (!normalizedVariants) return;

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

    const totalImages =
      existingImages.length +
      galleryFiles.length +
      Number(Boolean(coverFile));

    if (totalImages > MAX_PRODUCT_IMAGES) {
      alert(`Puedes subir máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`);
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
        categoryId: selectedCategory.id,
        categoryName: selectedCategory.name,
        costPrice,
        salePrice,
        profitMargin: profit.profitMargin,
        profitPercent: profit.profitPercent,
        variants: normalizedVariants,
      };

      const actor = getCurrentUserActor();

      const mediaPayload = {
        coverFile,
        galleryFiles: galleryFiles.map((image) => image.file),
        retainedImages: existingImages,
        removedImagePaths,
      };

      if (editingProduct) {
        await updateProduct(
          editingProduct.id,
          productPayload,
          mediaPayload,
          editingProduct,
          actor
        );
      } else {
        await createProduct(
          productPayload,
          mediaPayload,
          STORE_ID,
          actor
        );
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
      `¿Seguro que deseas eliminar "${product.name}"? También se eliminarán todas sus imágenes y variantes.`
    );

    if (!confirmDelete) return;

    try {
      await deleteProduct(product.id);
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
              Gestiona productos, imágenes, tallas y existencias
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
                placeholder="Buscar producto, código, categoría o talla..."
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
              <EmptyInventory onCreate={openCreateForm} />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {paginatedProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onView={() => setDetailProduct(product)}
                      onPrintLabels={() => setLabelProduct(product)}
                      onEdit={() => handleEdit(product)}
                      onDelete={() => handleDelete(product)}
                    />
                  ))}
                </div>

                <Pagination
                  page={page}
                  totalPages={totalPages}
                  totalItems={filteredProducts.length}
                  itemsPerPage={productsPerPage}
                  onPageChange={setPage}
                />
              </>
            )}
          </section>
        </section>
      </section>

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onPrintLabels={() => setLabelProduct(detailProduct)}
          onEdit={() => {
            const productToEdit = detailProduct;
            setDetailProduct(null);
            handleEdit(productToEdit);
          }}
        />
      )}

      {labelProduct && (
        <BarcodeLabel
          product={labelProduct}
          open={Boolean(labelProduct)}
          onClose={() => setLabelProduct(null)}
          defaultPreset="thermal58"
          store={{
            name: "MASTER CAPS",
            logoUrl: "/logo.png",
            showStoreName: false,
          }}
        />
      )}

      {showForm && (
        <ProductFormModal
          editingProduct={editingProduct}
          closeForm={closeForm}
          handleSubmit={handleSubmit}
          handleCoverChange={handleCoverChange}
          handleGalleryChange={handleGalleryChange}
          removeNewCover={removeNewCover}
          removeNewGalleryImage={removeNewGalleryImage}
          removeExistingImage={removeExistingImage}
          makeExistingImageCover={makeExistingImageCover}
          makeNewGalleryImageCover={makeNewGalleryImageCover}
          coverPreview={coverPreview}
          coverFile={coverFile}
          existingImages={existingImages}
          galleryFiles={galleryFiles}
          form={form}
          updateForm={updateForm}
          updateVariant={updateVariant}
          addVariant={addVariant}
          removeVariant={removeVariant}
          handleCodeChange={handleCodeChange}
          loadingCode={loadingCode}
          categories={categories}
          saving={saving}
          profit={profit}
          formTotalStock={formTotalStock}
        />
      )}
    </main>
  );
}

function EmptyInventory({ onCreate }) {
  return (
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
        onClick={onCreate}
        className="mt-5 rounded-2xl bg-red-600 px-5 py-3 text-[13px] font-medium text-white hover:bg-red-700"
      >
        Crear producto
      </button>
    </div>
  );
}

function ProductCard({ product, onView, onPrintLabels, onEdit, onDelete }) {
  const stock = getTotalStock(product);
  const stockStatus = getStockStatus(stock);
  const coverImage = getProductCoverImage(product);
  const images = getProductImages(product);
  const sizes = getProductSizes(product);

  return (
    <article className="rounded-[24px] bg-white p-3 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(0,0,0,0.07)]">
      <div className="flex gap-3">
        <div className="relative flex h-[86px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[20px] bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera size={25} className="text-black/30" />
          )}

          {images.length > 1 && (
            <span className="absolute bottom-1.5 right-1.5 rounded-lg bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
              {images.length}
            </span>
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

          <div className="mt-2 flex flex-wrap gap-1">
            {sizes.slice(0, 3).map((size) => (
              <span
                key={size}
                className="inline-flex rounded-full bg-black/[0.025] px-2 py-1 text-[10px] text-black/60"
              >
                {size}
              </span>
            ))}

            {sizes.length > 3 && (
              <span className="inline-flex rounded-full bg-red-50 px-2 py-1 text-[10px] text-red-600">
                +{sizes.length - 3}
              </span>
            )}
          </div>

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

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onView}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-[11px] font-medium text-black transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
          >
            <Eye size={14} />
            Ver detalles
          </button>

          <button
            type="button"
            onClick={onPrintLabels}
            disabled={!product.code || stock <= 0}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-red-100 bg-red-50 text-[11px] font-medium text-red-600 transition hover:border-red-200 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              !product.code
                ? "El producto necesita un código"
                : stock <= 0
                  ? "El producto no tiene stock"
                  : "Generar e imprimir etiquetas"
            }
          >
            <Barcode size={14} />
            Etiquetas
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-[11px] font-medium text-black transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
          >
            <Edit3 size={14} />
            Editar
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-red-100 bg-white text-[11px] font-medium text-red-600 transition hover:bg-red-50"
            title="Eliminar producto"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductDetailModal({ product, onClose, onEdit, onPrintLabels }) {
  const images = getProductImages(product);
  const variants = normalizeProductVariants(
    product.variants,
    product.size,
    product.stock
  );
  const totalStock = getTotalStock(product);
  const stockStatus = getStockStatus(totalStock);

  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [product.id]);

  const activeImage = images[activeImageIndex] || null;

  function previousImage() {
    setActiveImageIndex((current) =>
      current <= 0 ? images.length - 1 : current - 1
    );
  }

  function nextImage() {
    setActiveImageIndex((current) =>
      current >= images.length - 1 ? 0 : current + 1
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[92vh] w-full max-w-[920px] overflow-y-auto rounded-[28px] bg-white shadow-2xl">
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-black/[0.06] bg-white/95 px-5 py-4 backdrop-blur-xl">
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

        <div className="grid gap-5 p-5 lg:grid-cols-[340px_1fr]">
          <div>
            <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[24px] bg-black/[0.025]">
              {activeImage?.url ? (
                <img
                  src={activeImage.url}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Camera size={38} className="text-black/30" />
              )}

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={previousImage}
                    className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition hover:bg-white"
                  >
                    <ChevronLeft size={18} />
                  </button>

                  <button
                    type="button"
                    onClick={nextImage}
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition hover:bg-white"
                  >
                    <ChevronRight size={18} />
                  </button>
                </>
              )}

              {activeImage?.type === "cover" && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-[11px] text-white shadow-lg">
                  <Star size={12} fill="currentColor" />
                  Portada
                </span>
              )}
            </div>

            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-5 gap-2">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setActiveImageIndex(index)}
                    className={`relative aspect-square overflow-hidden rounded-xl border-2 transition ${
                      activeImageIndex === index
                        ? "border-red-600"
                        : "border-transparent"
                    }`}
                  >
                    <img
                      src={image.url}
                      alt={`${product.name} ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="grid gap-2 sm:grid-cols-2">
              <DetailItem label="Código" value={product.code || "Sin código"} />
              <DetailItem
                label="Categoría"
                value={product.categoryName || "Sin categoría"}
              />
              <DetailItem label="Estado" value={stockStatus.label} />
              <DetailItem
                label="Stock total"
                value={`${totalStock} unidad(es)`}
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
              <DetailItem
                label="Imágenes"
                value={`${images.length} archivo(s)`}
              />
            </div>

            <div className="mt-4 rounded-[22px] bg-black/[0.025] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-medium text-black">
                    Tallas y existencias
                  </p>

                  <p className="mt-1 text-[12px] text-black/45">
                    Stock independiente por variante
                  </p>
                </div>

                <span className="rounded-full bg-white px-3 py-1.5 text-[11px] text-black/60 ring-1 ring-black/[0.06]">
                  {variants.length} talla(s)
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {variants.map((variant) => (
                  <div
                    key={variant.id}
                    className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-black/[0.06]"
                  >
                    <span className="text-[13px] font-medium text-black">
                      {variant.size}
                    </span>

                    <span
                      className={`text-[12px] ${
                        Number(variant.stock || 0) > 0
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {variant.stock} unidad(es)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-black/[0.06] bg-white/95 px-5 py-4 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-black/[0.08] px-5 text-[13px] font-medium text-black/70 transition hover:bg-black/[0.035]"
          >
            Cerrar
          </button>

          <button
            type="button"
            onClick={onPrintLabels}
            disabled={!product.code || totalStock <= 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 text-[13px] font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Barcode size={15} />
            Imprimir etiquetas
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
  handleCoverChange,
  handleGalleryChange,
  removeNewCover,
  removeNewGalleryImage,
  removeExistingImage,
  makeExistingImageCover,
  makeNewGalleryImageCover,
  coverPreview,
  coverFile,
  existingImages,
  galleryFiles,
  form,
  updateForm,
  updateVariant,
  addVariant,
  removeVariant,
  handleCodeChange,
  loadingCode,
  categories,
  saving,
  profit,
  formTotalStock,
}) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  const totalImages =
    existingImages.length +
    galleryFiles.length +
    Number(Boolean(coverFile));

  const currentCoverImage =
    coverPreview ||
    existingImages.find((image) => image.type === "cover")?.url ||
    existingImages[0]?.url ||
    "";

  const stepMeta = [
    {
      number: 1,
      title: "Información",
      description: "Nombre, código y categoría",
    },
    {
      number: 2,
      title: "Imágenes",
      description: "Portada y galería",
    },
    {
      number: 3,
      title: "Tallas",
      description: "Variantes y existencias",
    },
    {
      number: 4,
      title: "Precios",
      description: "Valores y confirmación",
    },
  ];

  function validateCurrentStep() {
    if (step === 1) {
      if (!form.name.trim()) {
        alert("Escribe el nombre del producto.");
        return false;
      }

      if (!form.categoryId && !form.newCategoryName.trim()) {
        alert("Selecciona o crea una categoría.");
        return false;
      }
    }

    if (step === 2) {
      if (totalImages > MAX_PRODUCT_IMAGES) {
        alert(`Puedes subir máximo ${MAX_PRODUCT_IMAGES} imágenes.`);
        return false;
      }
    }

    if (step === 3) {
      if (!Array.isArray(form.variants) || form.variants.length === 0) {
        alert("Agrega al menos una talla.");
        return false;
      }

      const normalizedSizes = form.variants.map((variant) =>
        normalizeSize(variant.size)
      );

      if (new Set(normalizedSizes).size !== normalizedSizes.length) {
        alert("No puedes repetir la misma talla.");
        return false;
      }

      const hasInvalidStock = form.variants.some((variant) => {
        const stock = Number(variant.stock || 0);
        return !Number.isInteger(stock) || stock < 0;
      });

      if (hasInvalidStock) {
        alert("El stock debe ser un número entero mayor o igual a cero.");
        return false;
      }
    }

    if (step === 4) {
      if (toNumber(form.costPrice) <= 0) {
        alert("El precio de llegada debe ser mayor a cero.");
        return false;
      }

      if (toNumber(form.salePrice) <= 0) {
        alert("El precio de venta debe ser mayor a cero.");
        return false;
      }
    }

    return true;
  }

  function goNext() {
    if (!validateCurrentStep()) return;
    setStep((current) => Math.min(current + 1, totalSteps));
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 1));
  }

  function goToStep(nextStep) {
    if (nextStep < step) {
      setStep(nextStep);
      return;
    }

    if (nextStep === step + 1 && validateCurrentStep()) {
      setStep(nextStep);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-3 py-3 backdrop-blur-sm sm:px-4">
      <section className="flex h-[min(760px,94vh)] w-full max-w-[980px] flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[12px] font-normal text-red-600">
              {editingProduct ? "Editar producto" : "Nuevo producto"}
            </p>

            <h2 className="mt-0.5 truncate text-[21px] font-medium tracking-[-0.035em] text-black">
              Registro guiado de producto
            </h2>
          </div>

          <button
            type="button"
            onClick={closeForm}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={20} />
          </button>
        </header>

        <nav className="shrink-0 border-b border-black/[0.06] bg-[#fafafa] px-4 py-3 sm:px-6">
          <div className="grid grid-cols-4 gap-2">
            {stepMeta.map((item) => {
              const active = step === item.number;
              const completed = step > item.number;

              return (
                <button
                  key={item.number}
                  type="button"
                  onClick={() => goToStep(item.number)}
                  className={`min-w-0 rounded-2xl px-2 py-2.5 text-left transition sm:px-3 ${
                    active
                      ? "bg-red-600 text-white shadow-lg shadow-red-600/15"
                      : completed
                        ? "bg-red-50 text-red-600"
                        : "bg-white text-black/45 ring-1 ring-black/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[11px] font-medium ${
                        active
                          ? "bg-white/18 text-white"
                          : completed
                            ? "bg-red-600 text-white"
                            : "bg-black/[0.04] text-black/45"
                      }`}
                    >
                      {item.number}
                    </span>

                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium sm:text-[12px]">
                        {item.title}
                      </p>
                      <p
                        className={`hidden truncate text-[10px] sm:block ${
                          active ? "text-white/65" : "text-black/35"
                        }`}
                      >
                        {item.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {step === 1 && (
              <section className="mx-auto max-w-[760px]">
                <StepHeading
                  title="Información general"
                  description="Define los datos básicos con los que identificarás el producto."
                />

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <InputField
                    label="Nombre del producto"
                    value={form.name}
                    onChange={(value) => updateForm("name", value)}
                    placeholder="Ej: Camiseta oversize negra"
                  />

                  <InputField
                    label="Código"
                    value={form.code}
                    onChange={handleCodeChange}
                    disabled={loadingCode}
                    placeholder="Ej: CAM-0001"
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
                    placeholder="Ej: Camisetas"
                  />
                </div>

                <div className="mt-5 rounded-[24px] bg-black/[0.025] p-4">
                  <p className="text-[13px] font-medium text-black">
                    Resumen inicial
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <SummaryBox label="Producto" value={form.name || "Pendiente"} />
                    <SummaryBox label="Código" value={form.code || "Automático"} />
                    <SummaryBox
                      label="Categoría"
                      value={
                        form.newCategoryName ||
                        form.categoryName ||
                        "Pendiente"
                      }
                    />
                  </div>
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="mx-auto max-w-[820px]">
                <StepHeading
                  title="Imágenes del producto"
                  description="Elige una portada y agrega fotografías adicionales para el catálogo."
                />

                <div className="mt-5 grid gap-5 md:grid-cols-[250px_1fr]">
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-medium text-black">
                        Imagen de portada
                      </p>
                      {currentCoverImage && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1.5 text-[10px] text-red-600">
                          <Star size={11} fill="currentColor" />
                          Portada
                        </span>
                      )}
                    </div>

                    <label className="mt-3 block cursor-pointer">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        onChange={handleCoverChange}
                        className="hidden"
                      />

                      <div className="relative flex aspect-[4/5] max-h-[310px] items-center justify-center overflow-hidden rounded-[24px] border border-dashed border-black/15 bg-black/[0.025] transition hover:border-red-400 hover:bg-red-50/30">
                        {currentCoverImage ? (
                          <img
                            src={currentCoverImage}
                            alt="Vista previa de portada"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="px-5 text-center">
                            <Camera size={30} className="mx-auto text-black/35" />
                            <p className="mt-3 text-[13px] font-medium text-black">
                              Seleccionar portada
                            </p>
                            <p className="mt-1 text-[11px] text-black/40">
                              JPG, PNG, WEBP o AVIF
                            </p>
                          </div>
                        )}

                        {currentCoverImage && (
                          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 px-3 py-2 text-center text-[10px] text-white backdrop-blur">
                            Pulsa para reemplazar
                          </div>
                        )}
                      </div>
                    </label>

                    {coverFile && (
                      <button
                        type="button"
                        onClick={removeNewCover}
                        className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-white text-[11px] text-red-600 transition hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                        Quitar nueva portada
                      </button>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium text-black">
                          Galería
                        </p>
                        <p className="mt-1 text-[11px] text-black/45">
                          {totalImages} de {MAX_PRODUCT_IMAGES} imágenes
                        </p>
                      </div>

                      <label
                        className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl px-3 text-[11px] transition ${
                          totalImages >= MAX_PRODUCT_IMAGES
                            ? "pointer-events-none bg-black/[0.04] text-black/30"
                            : "bg-red-50 text-red-600 hover:bg-red-100"
                        }`}
                      >
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif"
                          multiple
                          onChange={handleGalleryChange}
                          className="hidden"
                          disabled={totalImages >= MAX_PRODUCT_IMAGES}
                        />
                        <ImagePlus size={14} />
                        Agregar imágenes
                      </label>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {existingImages.map((image) => (
                        <GalleryImageItem
                          key={image.id}
                          imageUrl={image.url}
                          isCover={image.type === "cover" && !coverFile}
                          onSetCover={() => makeExistingImageCover(image.id)}
                          onRemove={() => removeExistingImage(image.id)}
                        />
                      ))}

                      {galleryFiles.map((image) => (
                        <GalleryImageItem
                          key={image.id}
                          imageUrl={image.preview}
                          isCover={false}
                          onSetCover={() => makeNewGalleryImageCover(image.id)}
                          onRemove={() => removeNewGalleryImage(image.id)}
                          isNew
                        />
                      ))}

                      {totalImages < MAX_PRODUCT_IMAGES && (
                        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-black/40 transition hover:border-red-400 hover:bg-red-50 hover:text-red-600">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/avif"
                            multiple
                            onChange={handleGalleryChange}
                            className="hidden"
                          />
                          <Images size={21} />
                          <span className="mt-1 text-[9px]">Añadir fotos</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {step === 3 && (
              <section className="mx-auto max-w-[780px]">
                <StepHeading
                  title="Tallas y existencias"
                  description="Registra todas las variantes del mismo producto y su stock."
                />

                <div className="mt-5 rounded-[24px] border border-black/[0.06] bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[13px] font-medium text-black">
                        Variantes del producto
                      </p>
                      <p className="mt-1 text-[11px] text-black/45">
                        Ejemplos: S, M, L, XL, 30, 32 o Talla única
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={addVariant}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-red-50 px-3 text-[11px] font-medium text-red-600 transition hover:bg-red-100"
                    >
                      <Plus size={14} />
                      Agregar talla
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {form.variants.map((variant, index) => (
                      <div
                        key={variant.id}
                        className="grid gap-2 rounded-2xl bg-black/[0.025] p-3 sm:grid-cols-[1fr_160px_40px]"
                      >
                        <InputField
                          label={`Talla ${index + 1}`}
                          value={variant.size}
                          onChange={(value) =>
                            updateVariant(variant.id, "size", value)
                          }
                          placeholder="Ej: S, M, L, XL, 32"
                          compact
                        />

                        <InputField
                          label="Stock"
                          type="number"
                          min="0"
                          value={variant.stock}
                          onChange={(value) =>
                            updateVariant(variant.id, "stock", value)
                          }
                          placeholder="0"
                          compact
                        />

                        <button
                          type="button"
                          onClick={() => removeVariant(variant.id)}
                          disabled={form.variants.length <= 1}
                          className="mt-6 flex h-10 w-10 items-center justify-center rounded-xl border border-red-100 bg-white text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
                          title="Eliminar talla"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-2xl bg-red-50 px-4 py-3">
                    <div>
                      <p className="text-[11px] text-red-600/70">
                        Stock total calculado
                      </p>
                      <p className="mt-0.5 text-[18px] font-medium text-red-600">
                        {formTotalStock} unidad(es)
                      </p>
                    </div>
                    <Package size={22} className="text-red-600" />
                  </div>
                </div>
              </section>
            )}

            {step === 4 && (
              <section className="mx-auto max-w-[780px]">
                <StepHeading
                  title="Precios y confirmación"
                  description="Completa los valores y revisa el producto antes de guardarlo."
                />

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] bg-black/[0.025] p-4">
                    <p className="text-[11px] text-black/45">
                      Ganancia por unidad
                    </p>
                    <p className="mt-1 text-[20px] font-medium text-black">
                      {formatCurrency(profit.profitMargin)}
                    </p>
                  </div>

                  <div className="rounded-[22px] bg-red-600 p-4 text-white">
                    <p className="text-[11px] text-white/65">
                      Porcentaje de ganancia
                    </p>
                    <p className="mt-1 text-[20px] font-medium">
                      {profit.profitPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-[24px] border border-black/[0.06] bg-white p-4">
                  <p className="text-[13px] font-medium text-black">
                    Resumen final
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryBox label="Producto" value={form.name || "Pendiente"} />
                    <SummaryBox
                      label="Categoría"
                      value={
                        form.newCategoryName ||
                        form.categoryName ||
                        "Pendiente"
                      }
                    />
                    <SummaryBox
                      label="Tallas"
                      value={`${form.variants.length} variante(s)`}
                    />
                    <SummaryBox
                      label="Stock total"
                      value={`${formTotalStock} unidad(es)`}
                    />
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <SummaryBox
                      label="Imágenes"
                      value={`${totalImages} archivo(s)`}
                    />
                    <SummaryBox
                      label="Precio venta"
                      value={formatCurrency(toNumber(form.salePrice))}
                    />
                  </div>
                </div>
              </section>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] bg-white px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={step === 1 ? closeForm : goBack}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-black/[0.08] px-5 text-[13px] font-medium text-black/70 transition hover:bg-black/[0.035]"
            >
              {step === 1 ? "Cancelar" : "Anterior"}
            </button>

            <div className="hidden text-center sm:block">
              <p className="text-[11px] text-black/40">
                Paso {step} de {totalSteps}
              </p>
            </div>

            {step < totalSteps ? (
              <button
                type="button"
                onClick={goNext}
                disabled={loadingCode}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Siguiente
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={saving || loadingCode}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-red-600 px-6 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? "Guardando..."
                  : editingProduct
                    ? "Actualizar producto"
                    : "Guardar producto"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}

function StepHeading({ title, description }) {
  return (
    <div>
      <p className="text-[18px] font-medium tracking-[-0.025em] text-black">
        {title}
      </p>
      <p className="mt-1 text-[12px] text-black/45">{description}</p>
    </div>
  );
}

function SummaryBox({ label, value }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white px-4 py-3 ring-1 ring-black/[0.06]">
      <p className="text-[10px] text-black/40">{label}</p>
      <p className="mt-1 truncate text-[12px] font-medium text-black">
        {value}
      </p>
    </div>
  );
}

function GalleryImageItem({
  imageUrl,
  isCover,
  onSetCover,
  onRemove,
  isNew = false,
}) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-2xl bg-black/[0.025] ring-1 ring-black/[0.06]">
      <img
        src={imageUrl}
        alt="Imagen del producto"
        className="h-full w-full object-cover"
      />

      <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/35" />

      {isCover && (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-[9px] text-white">
          <Star size={9} fill="currentColor" />
          Portada
        </span>
      )}

      {isNew && (
        <span className="absolute right-1.5 top-1.5 rounded-lg bg-white/90 px-2 py-1 text-[9px] text-black">
          Nueva
        </span>
      )}

      <div className="absolute inset-x-1.5 bottom-1.5 grid grid-cols-2 gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={onSetCover}
          className="flex h-7 items-center justify-center rounded-lg bg-white/95 text-black transition hover:text-red-600"
          title="Usar como portada"
        >
          <Star size={12} />
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="flex h-7 items-center justify-center rounded-lg bg-white/95 text-red-600 transition hover:bg-red-50"
          title="Eliminar imagen"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
}) {
  const safePage = Math.min(page, totalPages);
  const firstItem =
    totalItems === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const lastItem = Math.min(safePage * itemsPerPage, totalItems);

  return (
    <footer className="mt-4 flex flex-col gap-3 border-t border-black/[0.06] pt-4 md:flex-row md:items-center md:justify-between">
      <p className="text-[12px] font-normal text-black/50">
        Mostrando {firstItem} a {lastItem} de {totalItems} productos
      </p>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange((current) => current - 1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹
        </button>

        {Array.from({ length: Math.min(totalPages, 5) }).map((_, index) => {
          const pageNumber = index + 1;

          return (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                page === pageNumber
                  ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                  : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
              }`}
            >
              {pageNumber}
            </button>
          );
        })}

        {totalPages > 5 && (
          <>
            <span className="px-1 text-[12px] text-black/40">...</span>

            <button
              type="button"
              onClick={() => onPageChange(totalPages)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                page === totalPages
                  ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                  : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
              }`}
            >
              {totalPages}
            </button>
          </>
        )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange((current) => current + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ›
        </button>
      </div>

      <div className="hidden h-9 items-center rounded-xl border border-black/[0.08] bg-white px-4 text-[12px] text-black/70 md:flex">
        {itemsPerPage} por página
      </div>
    </footer>
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
  compact = false,
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
        className={`mt-2 w-full rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45 ${
          compact ? "h-10" : "h-11"
        }`}
        placeholder={placeholder}
      />
    </label>
  );
}