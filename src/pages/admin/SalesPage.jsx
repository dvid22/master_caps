import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Camera,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";

import {
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";

import { subscribeProducts } from "../../services/products.service";

import {
  createDirectSale,
  subscribeSales,
} from "../../services/sales.service";

import { formatCurrency, toNumber } from "../../utils/money";
import { getCurrentUserActor } from "../../services/auth.service";

const emptySaleForm = {
  quantity: "1",
  customerName: "",
  paymentMethod: "efectivo",
  notes: "",
};

function getStockStatus(stock) {
  const value = Number(stock || 0);

  if (value <= 0) {
    return {
      label: "Sin stock",
      text: "Stock: 0 unidades",
      filter: "empty",
      stockClass: "text-red-600",
      badgeClass: "bg-red-50 text-red-600",
    };
  }

  if (value <= 3) {
    return {
      label: "Stock bajo",
      text: `Stock: ${value} unidad(es)`,
      filter: "low",
      stockClass: "text-orange-600",
      badgeClass: "bg-orange-50 text-orange-600",
    };
  }

  return {
    label: "En stock",
    text: `Stock: ${value} unidad(es)`,
    filter: "available",
    stockClass: "text-emerald-600",
    badgeClass: "bg-emerald-50 text-emerald-600",
  };
}

export default function SalesPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sales, setSales] = useState([]);

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [saleForm, setSaleForm] = useState(emptySaleForm);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("available");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState(false);

  const productsPerPage = 8;

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
        setLoading(false);

        setSelectedProduct((currentSelected) => {
          if (!currentSelected) return null;

          const updatedSelected = productsData.find(
            (product) => product.id === currentSelected.id
          );

          return updatedSelected || null;
        });
      },
      () => {
        setLoading(false);
        alert("No se pudieron escuchar los productos en tiempo real.");
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

    const unsubscribeSales = subscribeSales(
      (salesData) => {
        setSales(salesData);
      },
      () => {
        alert("No se pudieron escuchar las ventas en tiempo real.");
      },
      STORE_ID
    );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeSales();
    };
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;

    const currentQuantity = Number(saleForm.quantity || 0);
    const currentStock = Number(selectedProduct.stock || 0);

    if (currentStock <= 0) {
      setSaleForm((current) => ({
        ...current,
        quantity: "1",
      }));
      return;
    }

    if (currentQuantity > currentStock) {
      setSaleForm((current) => ({
        ...current,
        quantity: String(currentStock),
      }));
    }
  }, [selectedProduct, saleForm.quantity]);

  const availableSizes = useMemo(() => {
    const sizes = products
      .map((product) => product.size || "Talla única")
      .filter(Boolean);

    return [...new Set(sizes)].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();
    const cleanMinPrice = toNumber(minPrice);
    const cleanMaxPrice = toNumber(maxPrice);

    return products.filter((product) => {
      const salePrice = Number(product.salePrice || 0);
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

      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "available" && stock > 0) ||
        (stockFilter === "empty" && stock <= 0) ||
        (stockFilter === "low" && stock > 0 && stock <= 3);

      const matchesSize = sizeFilter === "all" || productSize === sizeFilter;

      const matchesMinPrice = !cleanMinPrice || salePrice >= cleanMinPrice;
      const matchesMaxPrice = !cleanMaxPrice || salePrice <= cleanMaxPrice;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStock &&
        matchesSize &&
        matchesMinPrice &&
        matchesMaxPrice
      );
    });
  }, [
    products,
    search,
    categoryFilter,
    stockFilter,
    sizeFilter,
    minPrice,
    maxPrice,
  ]);

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
  }, [search, categoryFilter, stockFilter, sizeFilter, minPrice, maxPrice]);

  const salePreview = useMemo(() => {
    if (!selectedProduct) {
      return {
        quantity: 0,
        unitPrice: 0,
        total: 0,
        profit: 0,
      };
    }

    const quantity = Number(saleForm.quantity || 0);
    const unitPrice = Number(selectedProduct.salePrice || 0);
    const costPrice = Number(selectedProduct.costPrice || 0);
    const total = unitPrice * quantity;
    const profit = (unitPrice - costPrice) * quantity;

    return {
      quantity,
      unitPrice,
      total,
      profit,
    };
  }, [selectedProduct, saleForm.quantity]);

  function updateSaleForm(field, value) {
    setSaleForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function selectProduct(product) {
    if (Number(product.stock || 0) <= 0) {
      alert("Este producto no tiene stock disponible.");
      return;
    }

    setSelectedProduct(product);
    setSaleForm(emptySaleForm);
  }

  function clearSelectedProduct() {
    setSelectedProduct(null);
    setSaleForm(emptySaleForm);
  }

  function increaseQuantity() {
    const current = Number(saleForm.quantity || 0);
    const max = Number(selectedProduct?.stock || 0);
    const next = Math.min(current + 1, max);

    updateSaleForm("quantity", String(next || 1));
  }

  function decreaseQuantity() {
    const current = Number(saleForm.quantity || 0);
    const next = Math.max(current - 1, 1);

    updateSaleForm("quantity", String(next));
  }

  async function handleSell(event) {
    event.preventDefault();

    if (!selectedProduct) {
      alert("Selecciona un producto para vender.");
      return;
    }

    const quantity = Number(saleForm.quantity || 0);
    const stock = Number(selectedProduct.stock || 0);

    if (stock <= 0) {
      alert("Este producto ya no tiene stock disponible.");
      return;
    }

    if (quantity <= 0) {
      alert("La cantidad debe ser mayor a cero.");
      return;
    }

    if (quantity > stock) {
      alert(`Solo hay ${stock} unidades disponibles.`);
      return;
    }

    try {
      setSelling(true);

      const seller = getCurrentUserActor();

      await createDirectSale({
        productId: selectedProduct.id,
        quantity,
        customerName: saleForm.customerName,
        paymentMethod: saleForm.paymentMethod,
        notes: saleForm.notes,
        storeId: STORE_ID,
        seller,
      });

      clearSelectedProduct();

      alert("Venta registrada correctamente.");
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo registrar la venta.");
    } finally {
      setSelling(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-medium tracking-[-0.045em] text-black">
              Ventas
            </h1>

            <p className="mt-1 text-[13px] font-normal text-black/50">
              Realiza ventas y gestiona el historial
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (filteredProducts.length === 0) {
                alert("No hay productos disponibles para vender.");
                return;
              }

              const firstAvailableProduct = filteredProducts.find(
                (product) => Number(product.stock || 0) > 0
              );

              if (!firstAvailableProduct) {
                alert("No hay productos con stock disponible.");
                return;
              }

              selectProduct(firstAvailableProduct);
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 lg:min-w-[150px]"
          >
            <Plus size={17} strokeWidth={1.9} />
            Nueva venta
          </button>
        </header>

        <section className="mt-5 rounded-[26px] bg-white p-3 shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
          <div className="grid gap-3 lg:grid-cols-[1.45fr_0.82fr_0.78fr_0.72fr]">
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
              <option value="available">En stock</option>
              <option value="low">Stock bajo</option>
              <option value="empty">Sin stock</option>
              <option value="all">Todos</option>
            </select>
          </div>

          <section className="mt-4">
            {loading ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center text-[13px] text-black/45">
                Cargando productos en tiempo real...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black/50 ring-1 ring-black/[0.06]">
                  <ShoppingBag size={24} />
                </div>

                <h2 className="mt-4 text-[17px] font-medium text-black">
                  No hay productos para vender
                </h2>

                <p className="mt-2 text-[13px] text-black/45">
                  Revisa los filtros o crea productos en inventario.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {paginatedProducts.map((product) => (
                    <SaleProductCard
                      key={product.id}
                      product={product}
                      selected={selectedProduct?.id === product.id}
                      onSell={() => selectProduct(product)}
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

      {selectedProduct && (
        <SaleModal
          selectedProduct={selectedProduct}
          saleForm={saleForm}
          salePreview={salePreview}
          selling={selling}
          onClose={clearSelectedProduct}
          onSubmit={handleSell}
          updateSaleForm={updateSaleForm}
          increaseQuantity={increaseQuantity}
          decreaseQuantity={decreaseQuantity}
        />
      )}
    </main>
  );
}

function SaleProductCard({ product, selected, onSell }) {
  const stock = Number(product.stock || 0);
  const productSize = product.size || "Talla única";
  const stockStatus = getStockStatus(stock);

  return (
    <article
      className={`rounded-[24px] bg-white p-3 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(0,0,0,0.07)] ${
        selected ? "ring-2 ring-red-600" : "ring-black/[0.06]"
      }`}
    >
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
          <h3 className="truncate text-[14px] font-medium text-black">
            {product.name}
          </h3>

          <p className="mt-1 text-[12px] text-black/45">
            {product.code || "Sin código"} ·{" "}
            {product.categoryName || "Sin categoría"}
          </p>

          <p className="mt-2 inline-flex rounded-full bg-black/[0.025] px-2.5 py-1 text-[11px] text-black/60">
            {productSize}
          </p>

          <p className={`mt-2 text-[12px] font-normal ${stockStatus.stockClass}`}>
            {stockStatus.text}
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-black/[0.06] pt-3">
        <p className="text-[17px] font-medium tracking-[-0.03em] text-black">
          {formatCurrency(product.salePrice)}
        </p>

        <button
          type="button"
          disabled={stock <= 0}
          onClick={onSell}
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/35 bg-white text-[13px] font-medium text-red-600 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:border-black/[0.08] disabled:bg-black/[0.035] disabled:text-black/35"
        >
          <ShoppingBag size={15} />
          Vender
        </button>
      </div>
    </article>
  );
}

function SaleModal({
  selectedProduct,
  saleForm,
  salePreview,
  selling,
  onClose,
  onSubmit,
  updateSaleForm,
  increaseQuantity,
  decreaseQuantity,
}) {
  const stock = Number(selectedProduct.stock || 0);
  const stockStatus = getStockStatus(stock);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-medium tracking-[-0.025em] text-red-600">
              Realizar venta
            </h2>

            <p className="mt-1 text-[12px] text-black/45">
              Completa la información de la venta
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-5">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-black/[0.06] bg-white p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/[0.025]">
                {selectedProduct.imageUrl ? (
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Camera size={24} className="text-black/30" />
                )}
              </div>

              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-medium text-black">
                  {selectedProduct.name}
                </h3>

                <p className="mt-1 text-[12px] text-black/45">
                  {selectedProduct.code || "Sin código"} ·{" "}
                  {selectedProduct.categoryName || "Sin categoría"}
                </p>

                <p className="mt-1 inline-flex rounded-full bg-black/[0.035] px-2.5 py-1 text-[11px] text-black/55">
                  {selectedProduct.size || "Talla única"}
                </p>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-[14px] font-medium text-black">
                {formatCurrency(selectedProduct.salePrice)}
              </p>

              <p className={stockStatus.stockClass + " mt-1 text-[11px]"}>
                Stock disponible
              </p>

              <p className="mt-0.5 text-[11px] text-emerald-600">
                {stock} unidad(es)
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[13px] font-normal text-black/65">Cantidad</p>

            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={decreaseQuantity}
                disabled={Number(saleForm.quantity || 0) <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.08] text-black transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus size={16} />
              </button>

              <input
                type="number"
                min="1"
                max={selectedProduct.stock}
                value={saleForm.quantity}
                onChange={(event) =>
                  updateSaleForm("quantity", event.target.value)
                }
                className="h-10 w-20 rounded-xl border border-black/[0.08] px-3 text-center text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              />

              <button
                type="button"
                onClick={increaseQuantity}
                disabled={
                  Number(saleForm.quantity || 0) >=
                  Number(selectedProduct.stock || 0)
                }
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.08] text-black transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={16} />
              </button>

              <p className="text-[12px] text-black/45">
                Máx: {selectedProduct.stock} unidad(es)
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="text-[12px] font-normal text-black/55">
                Cliente opcional
              </span>

              <input
                value={saleForm.customerName}
                onChange={(event) =>
                  updateSaleForm("customerName", event.target.value)
                }
                className="mt-2 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[13px] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Nombre del cliente"
              />
            </label>

            <label>
              <span className="text-[12px] font-normal text-black/55">
                Método de pago
              </span>

              <select
                value={saleForm.paymentMethod}
                onChange={(event) =>
                  updateSaleForm("paymentMethod", event.target.value)
                }
                className="mt-2 h-10 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="nequi">Nequi</option>
                <option value="daviplata">Daviplata</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </label>
          </div>

          <label className="mt-3 block">
            <span className="text-[12px] font-normal text-black/55">
              Notas opcionales
            </span>

            <input
              value={saleForm.notes}
              onChange={(event) => updateSaleForm("notes", event.target.value)}
              className="mt-2 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[13px] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="Alguna nota adicional..."
            />
          </label>

          <div className="mt-4 rounded-2xl bg-black/[0.025] p-4">
            <div className="flex items-center gap-2">
              <BadgeDollarSign size={18} className="text-black/70" />
              <p className="text-[13px] font-medium text-black">
                Resumen de la venta
              </p>
            </div>

            <div className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between gap-4">
                <span className="text-black/55">Precio unitario</span>
                <strong className="font-medium text-black">
                  {formatCurrency(salePreview.unitPrice)}
                </strong>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-black/55">Cantidad</span>
                <strong className="font-medium text-black">
                  {salePreview.quantity}
                </strong>
              </div>

              <div className="flex justify-between gap-4 border-t border-black/[0.08] pt-3">
                <span className="text-black">Total</span>
                <strong className="text-[18px] font-medium text-black">
                  {formatCurrency(salePreview.total)}
                </strong>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-emerald-600">Ganancia estimada</span>
                <strong className="text-[15px] font-medium text-emerald-600">
                  {formatCurrency(salePreview.profit)}
                </strong>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={selling}
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShoppingBag size={17} />
            {selling ? "Registrando venta..." : "Confirmar venta"}
          </button>
        </form>
      </section>
    </div>
  );
}