import { useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  Camera,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Minus,
  PackageSearch,
  Plus,
  Printer,
  ReceiptText,
  ScanLine,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  User,
  X,
} from "lucide-react";

import {
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";

import {
  getProductCoverImage,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";

import {
  createMultiItemSale,
  subscribeSales,
} from "../../services/sales.service";

import { formatCurrency, toNumber } from "../../utils/money";
import { getCurrentUserActor } from "../../services/auth.service";
import ThermalReceipt from "../../components/sales/ThermalReceipt";

const emptyCheckout = {
  customerName: "",
  customerDocument: "",
  customerPhone: "",
  paymentMethod: "efectivo",
  discount: "",
  amountReceived: "",
  notes: "",
};

function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

function getTotalStock(product) {
  return getProductVariants(product).reduce(
    (total, variant) => total + Number(variant.stock || 0),
    0
  );
}

function getAvailableVariants(product) {
  return getProductVariants(product).filter(
    (variant) => Number(variant.stock || 0) > 0
  );
}

function getStockStatus(stock) {
  const value = Number(stock || 0);

  if (value <= 0) {
    return {
      label: "Agotado",
      filter: "empty",
      badgeClass: "bg-red-50 text-red-600",
      stockClass: "text-red-600",
    };
  }

  if (value <= 3) {
    return {
      label: "Stock bajo",
      filter: "low",
      badgeClass: "bg-orange-50 text-orange-600",
      stockClass: "text-orange-600",
    };
  }

  return {
    label: "Disponible",
    filter: "available",
    badgeClass: "bg-emerald-50 text-emerald-600",
    stockClass: "text-emerald-600",
  };
}

function normalizeScannerValue(value) {
  return String(value || "").trim().toUpperCase();
}

function makeCartKey(productId, variantId) {
  return `${productId}__${variantId}`;
}

export default function SalesPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sales, setSales] = useState([]);

  const [cart, setCart] = useState([]);
  const [checkout, setCheckout] = useState(emptyCheckout);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("available");

  const [scannerValue, setScannerValue] = useState("");
  const [scannerStatus, setScannerStatus] = useState(null);

  const [variantProduct, setVariantProduct] = useState(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [completedSale, setCompletedSale] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);

  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState(false);

  const scannerInputRef = useRef(null);
  const scannerLockRef = useRef({ code: "", timestamp: 0 });

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
        setLoading(false);

        setCart((currentCart) =>
          currentCart
            .map((item) => {
              const product = productsData.find(
                (candidate) => candidate.id === item.productId
              );

              if (!product) return null;

              const variant = getProductVariants(product).find(
                (candidate) => candidate.id === item.variantId
              );

              if (!variant || Number(variant.stock || 0) <= 0) return null;

              return {
                ...item,
                product,
                variant,
                quantity: Math.min(
                  Number(item.quantity || 1),
                  Number(variant.stock || 0)
                ),
              };
            })
            .filter(Boolean)
        );
      },
      () => {
        setLoading(false);
        alert("No se pudieron escuchar los productos en tiempo real.");
      },
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      (categoriesData) => setCategories(categoriesData),
      () => alert("No se pudieron escuchar las categorías en tiempo real."),
      STORE_ID
    );

    const unsubscribeSales = subscribeSales(
      (salesData) => setSales(salesData),
      () => alert("No se pudieron escuchar las ventas en tiempo real."),
      STORE_ID
    );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeSales();
    };
  }, []);

  useEffect(() => {
    const focusScanner = (event) => {
      const target = event.target;
      const isTypingField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (!isTypingField && !variantProduct && !mobileCartOpen) {
        scannerInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", focusScanner);

    return () => window.removeEventListener("keydown", focusScanner);
  }, [variantProduct, mobileCartOpen]);

  const availableSizes = useMemo(() => {
    const sizes = products.flatMap((product) =>
      getProductVariants(product).map((variant) => variant.size)
    );

    return [...new Set(sizes)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const variants = getProductVariants(product);
      const stock = getTotalStock(product);
      const stockStatus = getStockStatus(stock);

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "")
          .toLowerCase()
          .includes(cleanSearch) ||
        variants.some((variant) =>
          String(variant.size || "").toLowerCase().includes(cleanSearch)
        );

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize =
        sizeFilter === "all" ||
        variants.some((variant) => variant.size === sizeFilter);

      const matchesStock =
        stockFilter === "all" || stockStatus.filter === stockFilter;

      return matchesSearch && matchesCategory && matchesSize && matchesStock;
    });
  }, [products, search, categoryFilter, sizeFilter, stockFilter]);

  const cartSummary = useMemo(() => {
    const subtotal = cart.reduce(
      (total, item) =>
        total +
        Number(item.product.salePrice || 0) * Number(item.quantity || 0),
      0
    );

    const totalCost = cart.reduce(
      (total, item) =>
        total +
        Number(item.product.costPrice || 0) * Number(item.quantity || 0),
      0
    );

    const totalItems = cart.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    );

    const discount = Math.min(Math.max(toNumber(checkout.discount), 0), subtotal);
    const total = Math.max(subtotal - discount, 0);
    const amountReceived =
      checkout.paymentMethod === "efectivo"
        ? Math.max(toNumber(checkout.amountReceived), 0)
        : total;
    const change =
      checkout.paymentMethod === "efectivo"
        ? Math.max(amountReceived - total, 0)
        : 0;

    return {
      subtotal,
      totalCost,
      profit: total - totalCost,
      totalItems,
      uniqueItems: cart.length,
      discount,
      total,
      amountReceived,
      change,
    };
  }, [cart, checkout]);

  function updateCheckout(field, value) {
    setCheckout((current) => ({ ...current, [field]: value }));
  }

  function openProduct(product) {
    const variants = getAvailableVariants(product);

    if (variants.length === 0) {
      alert("Este producto no tiene stock disponible.");
      return;
    }

    if (variants.length === 1) {
      addToCart(product, variants[0]);
      return;
    }

    setVariantProduct(product);
  }

  function addToCart(product, variant) {
    const stock = Number(variant.stock || 0);

    if (stock <= 0) {
      alert(`La talla ${variant.size} está agotada.`);
      return;
    }

    const cartKey = makeCartKey(product.id, variant.id);

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.cartKey === cartKey);

      if (existing) {
        if (existing.quantity >= stock) {
          alert(
            `Solo hay ${stock} unidad(es) disponibles de ${product.name} talla ${variant.size}.`
          );
          return currentCart;
        }

        return currentCart.map((item) =>
          item.cartKey === cartKey
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [
        ...currentCart,
        {
          cartKey,
          productId: product.id,
          variantId: variant.id,
          product,
          variant,
          quantity: 1,
        },
      ];
    });

    setVariantProduct(null);
    setScannerStatus({
      type: "success",
      message: `${product.name} · ${variant.size} agregado`,
    });
  }

  function updateCartQuantity(cartKey, nextQuantity) {
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (item.cartKey !== cartKey) return item;

        const stock = Number(item.variant.stock || 0);
        const safeQuantity = Math.min(
          Math.max(Number(nextQuantity || 1), 1),
          stock
        );

        return { ...item, quantity: safeQuantity };
      })
    );
  }

  function removeCartItem(cartKey) {
    setCart((currentCart) =>
      currentCart.filter((item) => item.cartKey !== cartKey)
    );
  }

  function clearCart() {
    if (cart.length === 0) return;

    if (!window.confirm("¿Seguro que deseas vaciar la venta actual?")) return;

    setCart([]);
    setCheckout(emptyCheckout);
  }

  function findProductFromScanner(rawValue) {
    const scannedCode = normalizeScannerValue(rawValue);

    if (!scannedCode) return null;

    const exactProduct = products.find(
      (product) =>
        normalizeScannerValue(product.code) === scannedCode ||
        normalizeScannerValue(product.barcode) === scannedCode
    );

    if (exactProduct) {
      return { product: exactProduct, variant: null };
    }

    for (const product of products) {
      const productCode = normalizeScannerValue(product.code);
      const variants = getProductVariants(product);

      for (const variant of variants) {
        const variantSize = normalizeScannerValue(variant.size);
        const possibleCodes = [
          `MC-${productCode}-${variantSize}`,
          `${productCode}-${variantSize}`,
          normalizeScannerValue(variant.barcode),
        ].filter(Boolean);

        if (possibleCodes.includes(scannedCode)) {
          return { product, variant };
        }
      }
    }

    return null;
  }

  function processScannedCode(rawValue) {
    const scannedCode = normalizeScannerValue(rawValue);
    if (!scannedCode) return;

    const now = Date.now();

    if (
      scannerLockRef.current.code === scannedCode &&
      now - scannerLockRef.current.timestamp < 650
    ) {
      return;
    }

    scannerLockRef.current = { code: scannedCode, timestamp: now };

    const match = findProductFromScanner(scannedCode);

    if (!match) {
      setScannerStatus({
        type: "error",
        message: `No se encontró el código ${scannedCode}`,
      });
      return;
    }

    if (match.variant) {
      addToCart(match.product, match.variant);
      return;
    }

    openProduct(match.product);
  }

  function handleScannerSubmit(event) {
    event.preventDefault();
    processScannedCode(scannerValue);
    setScannerValue("");

    window.setTimeout(() => scannerInputRef.current?.focus(), 30);
  }

  async function handleCheckout(event) {
    event.preventDefault();

    if (cart.length === 0) {
      alert("Agrega al menos un producto a la venta.");
      return;
    }

    if (
      checkout.paymentMethod === "efectivo" &&
      cartSummary.amountReceived < cartSummary.total
    ) {
      alert("El dinero recibido no puede ser menor al total de la venta.");
      return;
    }

    try {
      setSelling(true);

      const seller = getCurrentUserActor();

      const sale = await createMultiItemSale({
        items: cart.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          size: item.variant.size,
          quantity: item.quantity,
        })),

        customerName: checkout.customerName,
        customerDocument: checkout.customerDocument,
        customerPhone: checkout.customerPhone,
        paymentMethod: checkout.paymentMethod,
        discount: cartSummary.discount,
        amountReceived:
          checkout.paymentMethod === "efectivo"
            ? cartSummary.amountReceived
            : cartSummary.total,
        notes: checkout.notes,
        source: "pos",
        storeId: STORE_ID,
        seller,
      });

      setCompletedSale(sale);
      setCart([]);
      setCheckout(emptyCheckout);
      setMobileCartOpen(false);
      setScannerStatus(null);
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo registrar la venta.");
    } finally {
      setSelling(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.055),_transparent_30%),linear-gradient(180deg,#fafafa_0%,#f5f5f6_100%)] px-3 py-4 text-black sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1640px]">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-[29px] font-medium tracking-[-0.045em]">
              Punto de venta
            </h1>

            <p className="mt-1 text-[13px] text-black/50">
              Escanea, agrega productos y registra ventas completas
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-medium shadow-[0_10px_30px_rgba(0,0,0,0.035)] transition hover:bg-black/[0.025]"
            >
              <ReceiptText size={16} />
              Historial
              <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] text-black/55">
                {sales.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => scannerInputRef.current?.focus()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
            >
              <ScanLine size={17} />
              Activar escáner
            </button>
          </div>
        </header>

        <form
          onSubmit={handleScannerSubmit}
          className="relative mt-5 overflow-hidden rounded-[28px] border border-red-100/80 bg-white p-3 shadow-[0_22px_70px_rgba(239,68,68,0.10)]"
        >
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-red-100/55 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 left-1/3 h-28 w-52 rounded-full bg-orange-50 blur-3xl" />

          <div className="relative grid gap-3 xl:grid-cols-[210px_minmax(0,1fr)_auto] xl:items-center">
            <div className="flex items-center gap-3 rounded-[20px] bg-gradient-to-br from-red-600 to-red-500 px-4 py-3 text-white shadow-lg shadow-red-600/15">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                <ScanLine size={20} />
              </div>

              <div className="min-w-0">
                <p className="text-[12px] font-semibold">Escaneo inteligente</p>
                <p className="mt-0.5 truncate text-[10px] text-white/70">
                  Lector USB o código manual
                </p>
              </div>
            </div>

            <label className="relative block">
              <Barcode
                size={19}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-red-500"
              />

              <input
                ref={scannerInputRef}
                value={scannerValue}
                onChange={(event) => setScannerValue(event.target.value)}
                className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfbfc] pl-12 pr-4 text-[14px] text-black outline-none transition placeholder:text-black/35 focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-600/10"
                placeholder="Escanea o escribe el código del producto..."
                autoComplete="off"
              />
            </label>

            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 text-[13px] font-semibold text-white shadow-lg shadow-red-600/20 transition hover:-translate-y-0.5 hover:bg-red-700"
            >
              <Plus size={17} />
              Agregar producto
            </button>
          </div>

          {scannerStatus && (
            <div
              className={`relative mt-3 flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-[12px] ${
                scannerStatus.type === "success"
                  ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                  : "border-red-100 bg-red-50 text-red-700"
              }`}
            >
              {scannerStatus.type === "success" ? (
                <CheckCircle2 size={15} />
              ) : (
                <X size={15} />
              )}
              {scannerStatus.message}
            </div>
          )}
        </form>

        <section className="mt-4 grid min-h-[calc(100vh-245px)] gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 rounded-[30px] border border-white bg-white/95 p-3 shadow-[0_20px_65px_rgba(0,0,0,0.055)] ring-1 ring-black/[0.045] backdrop-blur sm:p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_.8fr_.7fr_.7fr]">
              <label className="relative block">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
                />

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  placeholder="Buscar producto, código, categoría o talla..."
                />
              </label>

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

              <select
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value)}
                className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="available">Disponibles</option>
                <option value="low">Stock bajo</option>
                <option value="empty">Agotados</option>
                <option value="all">Todos</option>
              </select>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium">Productos</p>
                <p className="mt-0.5 text-[12px] text-black/45">
                  {filteredProducts.length} resultado(s)
                </p>
              </div>

              <div className="rounded-full bg-red-50 px-3 py-1.5 text-[11px] text-red-600">
                Selecciona para agregar
              </div>
            </div>

            <section className="mt-4">
              {loading ? (
                <div className="rounded-[22px] bg-black/[0.025] p-10 text-center text-[13px] text-black/45">
                  Cargando productos en tiempo real...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="rounded-[22px] bg-black/[0.025] p-10 text-center">
                  <PackageSearch size={34} className="mx-auto text-black/30" />
                  <h2 className="mt-4 text-[17px] font-medium">
                    No hay productos para mostrar
                  </h2>
                  <p className="mt-2 text-[13px] text-black/45">
                    Ajusta los filtros o revisa el inventario.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {filteredProducts.map((product) => (
                    <ProductSaleCard
                      key={product.id}
                      product={product}
                      onAdd={() => openProduct(product)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="hidden xl:block">
            <CartPanel
              cart={cart}
              checkout={checkout}
              summary={cartSummary}
              selling={selling}
              onUpdateCheckout={updateCheckout}
              onUpdateQuantity={updateCartQuantity}
              onRemoveItem={removeCartItem}
              onClear={clearCart}
              onSubmit={handleCheckout}
            />
          </aside>
        </section>
      </section>

      <MobileCartBar
        summary={cartSummary}
        onOpen={() => setMobileCartOpen(true)}
      />

      {mobileCartOpen && (
        <MobileCartDrawer
          cart={cart}
          checkout={checkout}
          summary={cartSummary}
          selling={selling}
          onClose={() => setMobileCartOpen(false)}
          onUpdateCheckout={updateCheckout}
          onUpdateQuantity={updateCartQuantity}
          onRemoveItem={removeCartItem}
          onClear={clearCart}
          onSubmit={handleCheckout}
        />
      )}

      {variantProduct && (
        <VariantSelectorModal
          product={variantProduct}
          onClose={() => setVariantProduct(null)}
          onSelect={(variant) => addToCart(variantProduct, variant)}
        />
      )}

      {showHistory && (
        <SalesHistoryModal
          sales={sales}
          onClose={() => setShowHistory(false)}
          onSelectSale={(sale) => {
            setCompletedSale(sale);
            setShowHistory(false);
          }}
        />
      )}

      {completedSale && (
        <CompletedSaleModal
          sale={completedSale}
          onClose={() => setCompletedSale(null)}
          onPrint={() => setReceiptSale(completedSale)}
          onNewSale={() => {
            setCompletedSale(null);
            setReceiptSale(null);
            scannerInputRef.current?.focus();
          }}
        />
      )}

      {receiptSale && (
       <ThermalReceipt
  sale={receiptSale}
  open={Boolean(receiptSale)}
  onClose={() => setReceiptSale(null)}
  defaultPaperSize="80mm"
  store={{
    name: "MASTER CAPS",
    logoUrl: "/logo.png",
    footerMessage: "Gracias por tu compra",
    secondaryMessage:
      "Conserva este recibo para cambios o garantías",
  }}
/>
      )}
    </main>
  );
}

function ProductSaleCard({ product, onAdd }) {
  const stock = getTotalStock(product);
  const variants = getAvailableVariants(product);
  const coverImage = getProductCoverImage(product);
  const stockStatus = getStockStatus(stock);

  return (
    <article className="group overflow-hidden rounded-[22px] bg-white shadow-[0_12px_35px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_20px_55px_rgba(0,0,0,0.07)]">
      <button
        type="button"
        onClick={onAdd}
        disabled={stock <= 0}
        className="block w-full text-left disabled:cursor-not-allowed"
      >
        <div className="relative aspect-[4/3.2] overflow-hidden bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={product.name}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera size={28} className="text-black/25" />
            </div>
          )}

          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] ${stockStatus.badgeClass}`}
          >
            {stockStatus.label}
          </span>

          <span className="absolute bottom-3 right-3 rounded-full bg-black/75 px-2.5 py-1 text-[10px] text-white backdrop-blur">
            {variants.length} talla(s)
          </span>
        </div>

        <div className="p-3">
          <p className="text-[11px] text-black/45">
            {product.code || "Sin código"} · {product.categoryName || "Sin categoría"}
          </p>

          <h3 className="mt-1 truncate text-[14px] font-medium">
            {product.name}
          </h3>

          <div className="mt-2 flex flex-wrap gap-1">
            {variants.slice(0, 4).map((variant) => (
              <span
                key={variant.id}
                className="rounded-full bg-black/[0.035] px-2 py-1 text-[10px] text-black/60"
              >
                {variant.size}
              </span>
            ))}

            {variants.length > 4 && (
              <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] text-red-600">
                +{variants.length - 4}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[17px] font-medium tracking-[-0.035em]">
                {formatCurrency(product.salePrice)}
              </p>

              <p className={`mt-1 text-[11px] ${stockStatus.stockClass}`}>
                {stock} unidad(es)
              </p>
            </div>

            <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-3 text-[11px] font-medium text-white shadow-lg shadow-red-600/15">
              <Plus size={14} />
              Agregar
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}

function CartPanel(props) {
  const {
    cart,
    checkout,
    summary,
    selling,
    onUpdateCheckout,
    onUpdateQuantity,
    onRemoveItem,
    onClear,
    onSubmit,
  } = props;

  return (
    <section className="sticky top-4 flex max-h-[calc(100vh-32px)] flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_18px_55px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.07]">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <ShoppingCart size={19} />
          </div>

          <div>
            <h2 className="text-[16px] font-medium">Venta actual</h2>
            <p className="mt-0.5 text-[11px] text-black/45">
              {summary.totalItems} unidad(es) · {summary.uniqueItems} línea(s)
            </p>
          </div>
        </div>

        {cart.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-xl px-3 py-2 text-[11px] text-red-600 transition hover:bg-red-50"
          >
            Vaciar
          </button>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {cart.length === 0 ? (
            <EmptyCart />
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <CartItem
                  key={item.cartKey}
                  item={item}
                  onUpdateQuantity={onUpdateQuantity}
                  onRemove={onRemoveItem}
                />
              ))}
            </div>
          )}

          <CheckoutFields
            checkout={checkout}
            summary={summary}
            onUpdate={onUpdateCheckout}
          />
        </div>

        <CartTotals
          summary={summary}
          selling={selling}
          disabled={cart.length === 0}
        />
      </form>
    </section>
  );
}

function EmptyCart() {
  return (
    <div className="rounded-[22px] bg-black/[0.025] px-5 py-8 text-center">
      <ShoppingBag size={30} className="mx-auto text-black/25" />
      <p className="mt-3 text-[14px] font-medium">El carrito está vacío</p>
      <p className="mt-1 text-[12px] leading-5 text-black/45">
        Escanea un código o selecciona productos para iniciar la venta.
      </p>
    </div>
  );
}

function CartItem({ item, onUpdateQuantity, onRemove }) {
  const coverImage = getProductCoverImage(item.product);
  const subtotal =
    Number(item.product.salePrice || 0) * Number(item.quantity || 0);

  return (
    <article className="rounded-[19px] border border-black/[0.06] bg-white p-3">
      <div className="flex gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={item.product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera size={19} className="text-black/25" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[12px] font-medium">
                {item.product.name}
              </h3>
              <p className="mt-1 text-[10px] text-black/45">
                {item.product.code} · Talla {item.variant.size}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onRemove(item.cartKey)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50"
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateQuantity(item.cartKey, item.quantity - 1)}
                disabled={item.quantity <= 1}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] disabled:opacity-35"
              >
                <Minus size={12} />
              </button>

              <input
                type="number"
                min="1"
                max={item.variant.stock}
                value={item.quantity}
                onChange={(event) =>
                  onUpdateQuantity(item.cartKey, event.target.value)
                }
                className="h-7 w-10 rounded-lg border border-black/[0.08] text-center text-[11px] outline-none focus:border-red-600"
              />

              <button
                type="button"
                onClick={() => onUpdateQuantity(item.cartKey, item.quantity + 1)}
                disabled={item.quantity >= Number(item.variant.stock || 0)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] disabled:opacity-35"
              >
                <Plus size={12} />
              </button>
            </div>

            <p className="text-[13px] font-medium">
              {formatCurrency(subtotal)}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function CheckoutFields({ checkout, summary, onUpdate }) {
  return (
    <section className="mt-4 border-t border-black/[0.06] pt-4">
      <div className="flex items-center gap-2">
        <User size={15} className="text-black/50" />
        <p className="text-[12px] font-medium">Datos de la venta</p>
      </div>

      <div className="mt-3 grid gap-2">
        <input
          value={checkout.customerName}
          onChange={(event) => onUpdate("customerName", event.target.value)}
          className="h-10 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
          placeholder="Cliente opcional"
        />

        <div className="grid grid-cols-2 gap-2">
          <input
            value={checkout.customerDocument}
            onChange={(event) =>
              onUpdate("customerDocument", event.target.value)
            }
            className="h-10 min-w-0 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            placeholder="Documento"
          />

          <input
            value={checkout.customerPhone}
            onChange={(event) => onUpdate("customerPhone", event.target.value)}
            className="h-10 min-w-0 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            placeholder="Teléfono"
          />
        </div>

        <select
          value={checkout.paymentMethod}
          onChange={(event) => onUpdate("paymentMethod", event.target.value)}
          className="h-10 rounded-xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
        >
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="nequi">Nequi</option>
          <option value="daviplata">Daviplata</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="otro">Otro</option>
        </select>

        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-[10px] text-black/45">Descuento</span>
            <input
              type="number"
              min="0"
              max={summary.subtotal}
              value={checkout.discount}
              onChange={(event) => onUpdate("discount", event.target.value)}
              className="mt-1 h-10 w-full min-w-0 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="0"
            />
          </label>

          <label>
            <span className="text-[10px] text-black/45">
              {checkout.paymentMethod === "efectivo"
                ? "Dinero recibido"
                : "Total pagado"}
            </span>
            <input
              type="number"
              min="0"
              value={
                checkout.paymentMethod === "efectivo"
                  ? checkout.amountReceived
                  : summary.total
              }
              onChange={(event) =>
                onUpdate("amountReceived", event.target.value)
              }
              disabled={checkout.paymentMethod !== "efectivo"}
              className="mt-1 h-10 w-full min-w-0 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45"
              placeholder="0"
            />
          </label>
        </div>

        {checkout.paymentMethod === "efectivo" && (
          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2">
            <span className="text-[11px] text-emerald-700">Cambio</span>
            <strong className="text-[13px] font-medium text-emerald-700">
              {formatCurrency(summary.change)}
            </strong>
          </div>
        )}

        <input
          value={checkout.notes}
          onChange={(event) => onUpdate("notes", event.target.value)}
          className="h-10 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
          placeholder="Notas opcionales"
        />
      </div>
    </section>
  );
}

function CartTotals({ summary, selling, disabled }) {
  return (
    <div className="border-t border-black/[0.06] bg-white px-5 py-4">
      <div className="space-y-2 text-[12px]">
        <div className="flex justify-between gap-4">
          <span className="text-black/50">Subtotal</span>
          <span>{formatCurrency(summary.subtotal)}</span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-black/50">Descuento</span>
          <span>- {formatCurrency(summary.discount)}</span>
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-black/[0.07] pt-3">
          <div>
            <p className="text-[11px] text-black/45">Total a pagar</p>
            <p className="mt-0.5 text-[25px] font-medium tracking-[-0.05em]">
              {formatCurrency(summary.total)}
            </p>
          </div>

          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] text-emerald-600">
            Ganancia {formatCurrency(summary.profit)}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={disabled || selling}
        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/15 disabled:shadow-none"
      >
        <CreditCard size={17} />
        {selling ? "Procesando venta..." : "Cobrar venta"}
      </button>
    </div>
  );
}

function MobileCartBar({ summary, onOpen }) {
  return (
    <div className="fixed inset-x-3 bottom-3 z-40 xl:hidden">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-16 w-full items-center justify-between rounded-[22px] border border-red-100 bg-white px-4 text-black shadow-[0_18px_55px_rgba(0,0,0,0.16)]"
      >
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-red-600">
            <ShoppingCart size={19} />
            {summary.totalItems > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[9px] font-medium text-red-600">
                {summary.totalItems}
              </span>
            )}
          </div>

          <div className="text-left">
            <p className="text-[10px] text-black/45">Venta actual</p>
            <p className="text-[16px] font-medium">
              {formatCurrency(summary.total)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px]">
          Ver carrito
          <ChevronRight size={17} />
        </div>
      </button>
    </div>
  );
}

function MobileCartDrawer(props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm xl:hidden">
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-hidden rounded-t-[30px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[12px] text-red-600">Punto de venta</p>
            <h2 className="mt-0.5 text-[18px] font-medium">Carrito</h2>
          </div>

          <button
            type="button"
            onClick={props.onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-73px)] overflow-y-auto">
          <CartPanel
            cart={props.cart}
            checkout={props.checkout}
            summary={props.summary}
            selling={props.selling}
            onUpdateCheckout={props.onUpdateCheckout}
            onUpdateQuantity={props.onUpdateQuantity}
            onRemoveItem={props.onRemoveItem}
            onClear={props.onClear}
            onSubmit={props.onSubmit}
          />
        </div>
      </div>
    </div>
  );
}

function VariantSelectorModal({ product, onClose, onSelect }) {
  const variants = getAvailableVariants(product);
  const coverImage = getProductCoverImage(product);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[460px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[12px] text-red-600">Seleccionar variante</p>
            <h2 className="mt-1 text-[19px] font-medium">{product.name}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <div className="flex items-center gap-3 rounded-[20px] bg-black/[0.025] p-3">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white">
              {coverImage.url ? (
                <img
                  src={coverImage.url}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Camera size={22} className="text-black/25" />
              )}
            </div>

            <div>
              <p className="text-[12px] text-black/45">
                {product.code || "Sin código"}
              </p>
              <p className="mt-1 text-[18px] font-medium">
                {formatCurrency(product.salePrice)}
              </p>
            </div>
          </div>

          <p className="mt-5 text-[13px] font-medium">
            ¿Qué talla deseas agregar?
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => onSelect(variant)}
                className="rounded-2xl border border-black/[0.08] bg-white px-3 py-3 text-left transition hover:border-red-400 hover:bg-red-50"
              >
                <p className="text-[14px] font-medium">{variant.size}</p>
                <p className="mt-1 text-[11px] text-emerald-600">
                  {variant.stock} disponible(s)
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SalesHistoryModal({ sales, onClose, onSelectSale }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[90vh] w-full max-w-[820px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[12px] text-red-600">Registro comercial</p>
            <h2 className="mt-1 text-[20px] font-medium">
              Historial de ventas
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-73px)] overflow-y-auto p-5">
          {sales.length === 0 ? (
            <div className="rounded-[22px] bg-black/[0.025] p-10 text-center">
              <ReceiptText size={32} className="mx-auto text-black/25" />
              <p className="mt-3 text-[14px] font-medium">
                Aún no hay ventas registradas
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sales.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => onSelectSale(sale)}
                  className="flex w-full items-center justify-between gap-4 rounded-[20px] border border-black/[0.06] bg-white p-4 text-left transition hover:bg-black/[0.02]"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {sale.saleNumber || "Venta anterior"}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-black/45">
                      {sale.totalItems || 0} artículo(s) · {sale.paymentMethod || "efectivo"} · {sale.sellerName || "Sin vendedor"}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[15px] font-medium">
                      {formatCurrency(sale.total)}
                    </p>
                    <p className="mt-1 text-[10px] text-black/45">
                      Ver comprobante
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CompletedSaleModal({ sale, onClose, onNewSale, onPrint }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] overflow-hidden rounded-[30px] bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 size={34} />
        </div>

        <p className="mt-5 text-[12px] text-red-600">
          {sale.saleNumber || "Venta registrada"}
        </p>

        <h2 className="mt-1 text-[25px] font-medium tracking-[-0.045em]">
          Venta completada
        </h2>

        <p className="mt-2 text-[13px] text-black/50">
          El inventario fue actualizado correctamente.
        </p>

        <div className="mt-5 rounded-[22px] bg-black/[0.025] p-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-black/45">Artículos</span>
            <strong className="text-[13px] font-medium">
              {sale.totalItems || 0}
            </strong>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px] text-black/45">Método</span>
            <strong className="text-[13px] font-medium capitalize">
              {sale.paymentMethod}
            </strong>
          </div>

          <div className="mt-3 flex items-end justify-between border-t border-black/[0.07] pt-3">
            <span className="text-[12px] text-black/45">Total</span>
            <strong className="text-[24px] font-medium tracking-[-0.04em]">
              {formatCurrency(sale.total)}
            </strong>
          </div>

          {Number(sale.change || 0) > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2">
              <span className="text-[11px] text-emerald-700">Cambio</span>
              <strong className="text-[13px] text-emerald-700">
                {formatCurrency(sale.change)}
              </strong>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onPrint}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-[13px] font-medium text-red-600 transition hover:border-red-300 hover:bg-red-100"
        >
          <Printer size={16} />
          Ver e imprimir recibo
        </button>

        <button
          type="button"
          onClick={onNewSale}
          className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
        >
          <ShoppingBag size={16} />
          Nueva venta
        </button>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 text-[12px] text-black/45 transition hover:text-black"
        >
          Cerrar
        </button>
      </section>
    </div>
  );
}
