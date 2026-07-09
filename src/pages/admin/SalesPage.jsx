import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Minus,
  PackageCheck,
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

  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState(false);

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
        (stockFilter === "empty" && stock <= 0);

      const matchesSize =
        sizeFilter === "all" || productSize === sizeFilter;

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

  const totals = useMemo(() => {
    return sales.reduce(
      (acc, sale) => {
        acc.salesCount += 1;
        acc.units += Number(sale.quantity || 0);
        acc.total += Number(sale.total || 0);
        acc.profit += Number(sale.profit || 0);
        return acc;
      },
      {
        salesCount: 0,
        units: 0,
        total: 0,
        profit: 0,
      }
    );
  }, [sales]);

  function updateSaleForm(field, value) {
    setSaleForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function selectProduct(product) {
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
    <main className="min-h-screen bg-brand-cream px-4 py-6 sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-black/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-gold">Master Caps</p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-brand-black">
              Ventas
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Selecciona productos del inventario, registra ventas y descuenta
              stock automáticamente en tiempo real.
            </p>
          </div>
        </div>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Ventas registradas</p>

            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {totals.salesCount}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Unidades vendidas</p>

            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {totals.units}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Total vendido</p>

            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {formatCurrency(totals.total)}
            </p>
          </div>

          <div className="rounded-3xl bg-black p-5 text-white shadow-sm">
            <p className="text-sm text-white/60">Ganancia estimada</p>

            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(totals.profit)}
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div>
            <div className="grid gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:grid-cols-[1fr_150px_130px_130px_120px_120px]">
              <label className="relative block">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                />

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-4 text-sm outline-none focus:border-brand-black"
                  placeholder="Buscar producto, código o talla..."
                />
              </label>

              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
              >
                <option value="all">Categorías</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>

              <select
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value)}
                className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
              >
                <option value="available">Disponibles</option>
                <option value="empty">Sin stock</option>
                <option value="all">Todos</option>
              </select>

              <select
                value={sizeFilter}
                onChange={(event) => setSizeFilter(event.target.value)}
                className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
              >
                <option value="all">Tallas</option>
                {availableSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>

              <input
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
                className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
                placeholder="Precio mín."
              />

              <input
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
                placeholder="Precio máx."
              />
            </div>

            <div className="mt-5">
              {loading ? (
                <div className="rounded-3xl bg-white p-8 text-center text-sm text-gray-500">
                  Cargando productos en tiempo real...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="rounded-3xl bg-white p-10 text-center">
                  <ShoppingBag size={34} className="mx-auto text-gray-400" />

                  <h2 className="mt-4 text-lg font-semibold text-brand-black">
                    No hay productos para vender
                  </h2>

                  <p className="mt-2 text-sm text-gray-500">
                    Revisa los filtros o crea productos en inventario.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredProducts.map((product) => {
                    const stock = Number(product.stock || 0);
                    const isSelected = selectedProduct?.id === product.id;
                    const productSize = product.size || "Talla única";

                    return (
                      <article
                        key={product.id}
                        className={`overflow-hidden rounded-3xl bg-white shadow-sm ring-1 transition ${
                          isSelected
                            ? "ring-2 ring-brand-black"
                            : "ring-black/5 hover:ring-black/20"
                        }`}
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
                              <ShoppingBag size={34} />
                            </div>
                          )}

                          <span
                            className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold ${
                              stock > 0
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {stock > 0 ? `${stock} disponibles` : "Sin stock"}
                          </span>
                        </div>

                        <div className="p-5">
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
                            Talla: {productSize}
                          </p>

                          <div className="mt-4 flex items-end justify-between gap-3">
                            <div>
                              <p className="text-xs text-gray-500">
                                Precio venta
                              </p>

                              <p className="text-xl font-semibold text-brand-black">
                                {formatCurrency(product.salePrice)}
                              </p>
                            </div>

                            <button
                              type="button"
                              disabled={stock <= 0}
                              onClick={() => selectProduct(product)}
                              className="rounded-2xl bg-brand-black px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                              Vender
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                    Nueva venta
                  </p>

                  <h2 className="text-lg font-semibold text-brand-black">
                    Producto seleccionado
                  </h2>
                </div>

                {selectedProduct && (
                  <button
                    type="button"
                    onClick={clearSelectedProduct}
                    className="rounded-full p-2 hover:bg-gray-100"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>

              {!selectedProduct ? (
                <div className="p-8 text-center">
                  <PackageCheck size={34} className="mx-auto text-gray-400" />

                  <p className="mt-4 text-sm font-medium text-brand-black">
                    Selecciona un producto
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    Haz clic en vender sobre una prenda disponible.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSell} className="p-5">
                  <div className="flex gap-4">
                    <div className="h-24 w-24 overflow-hidden rounded-2xl bg-gray-100">
                      {selectedProduct.imageUrl ? (
                        <img
                          src={selectedProduct.imageUrl}
                          alt={selectedProduct.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-400">
                          <ShoppingBag size={26} />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                        {selectedProduct.categoryName}
                      </p>

                      <h3 className="mt-1 font-semibold text-brand-black">
                        {selectedProduct.name}
                      </h3>

                      <p className="mt-1 text-xs text-gray-500">
                        Código: {selectedProduct.code}
                      </p>

                      <p className="mt-1 text-xs font-medium text-brand-black">
                        Talla: {selectedProduct.size || "Talla única"}
                      </p>

                      <p className="mt-2 text-sm font-semibold text-brand-black">
                        {formatCurrency(selectedProduct.salePrice)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <label className="text-sm font-medium text-brand-black">
                      Cantidad
                    </label>

                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={decreaseQuantity}
                        disabled={Number(saleForm.quantity || 0) <= 1}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 hover:border-brand-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Minus size={17} />
                      </button>

                      <input
                        type="number"
                        min="1"
                        max={selectedProduct.stock}
                        value={saleForm.quantity}
                        onChange={(event) =>
                          updateSaleForm("quantity", event.target.value)
                        }
                        className="h-11 flex-1 rounded-2xl border border-black/10 px-4 text-center text-sm outline-none focus:border-brand-black"
                      />

                      <button
                        type="button"
                        onClick={increaseQuantity}
                        disabled={
                          Number(saleForm.quantity || 0) >=
                          Number(selectedProduct.stock || 0)
                        }
                        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 hover:border-brand-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus size={17} />
                      </button>
                    </div>

                    <p className="mt-2 text-xs text-gray-500">
                      Stock disponible: {selectedProduct.stock}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4">
                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Cliente / referencia opcional
                      </span>

                      <input
                        value={saleForm.customerName}
                        onChange={(event) =>
                          updateSaleForm("customerName", event.target.value)
                        }
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                        placeholder="Ej: Cliente mostrador"
                      />
                    </label>

                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Método de pago
                      </span>

                      <select
                        value={saleForm.paymentMethod}
                        onChange={(event) =>
                          updateSaleForm("paymentMethod", event.target.value)
                        }
                        className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
                      >
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                        <option value="nequi">Nequi</option>
                        <option value="daviplata">Daviplata</option>
                        <option value="tarjeta">Tarjeta</option>
                        <option value="otro">Otro</option>
                      </select>
                    </label>

                    <label>
                      <span className="text-sm font-medium text-brand-black">
                        Observaciones
                      </span>

                      <textarea
                        value={saleForm.notes}
                        onChange={(event) =>
                          updateSaleForm("notes", event.target.value)
                        }
                        className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-brand-black"
                        placeholder="Notas internas de la venta..."
                      />
                    </label>
                  </div>

                  <div className="mt-5 rounded-3xl bg-brand-cream p-4">
                    <div className="flex items-center gap-2">
                      <BadgeDollarSign size={20} className="text-brand-black" />

                      <p className="text-sm font-semibold text-brand-black">
                        Resumen de venta
                      </p>
                    </div>

                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500">Precio unitario</span>

                        <strong className="text-brand-black">
                          {formatCurrency(salePreview.unitPrice)}
                        </strong>
                      </div>

                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500">Cantidad</span>

                        <strong className="text-brand-black">
                          {salePreview.quantity}
                        </strong>
                      </div>

                      <div className="flex justify-between gap-4 border-t border-black/10 pt-3">
                        <span className="text-gray-500">Total</span>

                        <strong className="text-lg text-brand-black">
                          {formatCurrency(salePreview.total)}
                        </strong>
                      </div>

                      <div className="flex justify-between gap-4">
                        <span className="text-gray-500">
                          Ganancia estimada
                        </span>

                        <strong className="text-green-700">
                          {formatCurrency(salePreview.profit)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={selling}
                    className="mt-5 w-full rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {selling ? "Registrando venta..." : "Confirmar venta"}
                  </button>
                </form>
              )}
            </section>

            <section className="mt-5 rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="border-b border-black/10 px-5 py-4">
                <h2 className="text-lg font-semibold text-brand-black">
                  Últimas ventas
                </h2>
              </div>

              <div className="max-h-[420px] overflow-y-auto p-3">
                {sales.length === 0 ? (
                  <p className="p-5 text-center text-sm text-gray-500">
                    Aún no hay ventas registradas.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sales.slice(0, 12).map((sale) => (
                      <article
                        key={sale.id}
                        className="rounded-2xl border border-black/10 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-brand-black">
                              {sale.productName}
                            </p>

                            <p className="mt-1 text-xs text-gray-500">
                              {sale.productCode} · {sale.categoryName} · Talla:{" "}
                              {sale.productSize || "Talla única"}
                            </p>

                            <p className="mt-1 text-xs text-gray-500">
                              Vendedor:{" "}
                              {sale.sellerName ||
                                sale.sellerEmail ||
                                "Sin vendedor"}
                            </p>
                          </div>

                          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                            Vendido
                          </span>
                        </div>

                        <div className="mt-3 flex items-end justify-between gap-4">
                          <div>
                            <p className="text-xs text-gray-500">
                              Cantidad: {sale.quantity}
                            </p>

                            <p className="text-xs text-gray-500">
                              Pago: {sale.paymentMethod || "N/A"}
                            </p>
                          </div>

                          <p className="text-sm font-semibold text-brand-black">
                            {formatCurrency(sale.total)}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}