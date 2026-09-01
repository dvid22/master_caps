import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BadgePercent,
  ChevronRight,
  CreditCard,
  FilePenLine,
  History,
  Minus,
  PackageSearch,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  User,
  WalletCards,
  X,
} from "lucide-react";

import {
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";
import {
  getProductCoverImage,
  getProductPromotionStock,
  getPromotionStockForVariant,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";
import { subscribeSales } from "../../services/sales.service";
import { updateSale } from "../../services/sales-edit.service";
import { normalizeCustomerDocument } from "../../services/customers.service";
import { getCurrentUserActor } from "../../services/auth.service";
import { subscribeUsers } from "../../services/users.service";
import { formatCurrency } from "../../utils/money";
import ThermalReceipt from "../../components/sales/ThermalReceipt";
import {
  isProductImagePreloaded,
  preloadProductCoverImages,
  preloadProductImage,
} from "../../services/product-image-cache.service";

const PAYMENT_OPTIONS = [
  ["efectivo", "Efectivo"],
  ["transferencia", "Transferencia"],
  ["nequi", "Nequi"],
  ["daviplata", "Daviplata"],
  ["tarjeta", "Tarjeta"],
  ["addi", "Addi"],
  ["otro", "Otro"],
];

const PAYMENT_FILTER_OPTIONS = [
  ...PAYMENT_OPTIONS,
  ["mixto", "Pago mixto"],
];

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateMilliseconds(value) {
  return toDate(value)?.getTime() || 0;
}

function formatSaleDate(value) {
  const date = toDate(value);

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getPaymentLabel(value) {
  return (
    PAYMENT_FILTER_OPTIONS.find(([key]) => key === value)?.[1] ||
    value ||
    "Otro"
  );
}

function getSaleItems(sale) {
  return Array.isArray(sale?.items) ? sale.items : [];
}

function getSalePayments(sale) {
  if (Array.isArray(sale?.payments) && sale.payments.length > 0) {
    return sale.payments
      .map((payment, index) => ({
        localId: `payment-${index}-${payment.method || "otro"}`,
        method: payment.method || "otro",
        amount: Number(payment.amount || 0),
        receivedAmount: Number(
          payment.receivedAmount ?? payment.amount ?? 0
        ),
      }))
      .filter((payment) => payment.amount > 0);
  }

  const total = Number(sale?.total || 0);
  const method = sale?.paymentMethod || "efectivo";

  return [
    {
      localId: "payment-legacy",
      method,
      amount: total,
      receivedAmount:
        method === "efectivo"
          ? Number(sale?.amountReceived || total)
          : total,
    },
  ];
}

function parseMoney(value) {
  return Number(String(value || "").replace(/[^\d]/g, "") || 0);
}

function formatMoneyInput(value) {
  const number =
    typeof value === "number"
      ? value
      : parseMoney(value);

  return number
    ? new Intl.NumberFormat("es-CO", {
        maximumFractionDigits: 0,
      }).format(number)
    : "";
}

function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

function isPromotionProduct(product) {
  return (
    Boolean(product?.isPromotion) &&
    Number(product?.promotionPrice || 0) > 0 &&
    getProductPromotionStock(product) > 0
  );
}

function makeLineKey(productId, variantId, isPromotion) {
  return `${productId}__${variantId}__${
    isPromotion ? "promo" : "normal"
  }`;
}

function saleMatchesPayment(sale, paymentFilter) {
  if (paymentFilter === "all") {
    return true;
  }

  if (paymentFilter === "mixto") {
    return sale.paymentMethod === "mixto";
  }

  if (sale.paymentMethod === paymentFilter) {
    return true;
  }

  return getSalePayments(sale).some(
    (payment) => payment.method === paymentFilter
  );
}


function getCategoryLabel(category) {
  const name = String(category?.name || "").trim();
  const parent = String(category?.parentCategoryName || "").trim();

  if (!name) {
    return "Sin nombre";
  }

  return parent ? `${parent} · ${name}` : name;
}

function saleMatchesCategory(sale, categoryFilter, categories) {
  if (categoryFilter === "all") {
    return true;
  }

  const selectedCategory =
    categories.find(
      (category) => category.id === categoryFilter
    ) || null;

  const selectedName = normalizeSearch(
    selectedCategory?.name || ""
  );

  return getSaleItems(sale).some((item) => {
    if (
      String(item.categoryId || "").trim() ===
      categoryFilter
    ) {
      return true;
    }

    if (!selectedName) {
      return false;
    }

    return (
      normalizeSearch(item.categoryName) ===
      selectedName
    );
  });
}

function productMatchesCategory(
  product,
  categoryFilter,
  categories
) {
  if (categoryFilter === "all") {
    return true;
  }

  if (
    String(product?.categoryId || "").trim() ===
    categoryFilter
  ) {
    return true;
  }

  const selectedCategory =
    categories.find(
      (category) => category.id === categoryFilter
    ) || null;

  const selectedName = normalizeSearch(
    selectedCategory?.name || ""
  );

  return (
    Boolean(selectedName) &&
    normalizeSearch(product?.categoryName) ===
      selectedName
  );
}

function getSellerOptionValue(user) {
  const uid = String(user?.uid || user?.id || "").trim();

  if (uid) {
    return `uid:${uid}`;
  }

  const legacyKey = normalizeSearch(
    user?.displayName || user?.email || ""
  );

  return legacyKey
    ? `legacy:${legacyKey}`
    : "";
}

function saleMatchesSeller(sale, sellerFilter) {
  if (sellerFilter === "all") {
    return true;
  }

  if (sellerFilter.startsWith("uid:")) {
    const uid = sellerFilter.slice(4);

    return (
      String(sale?.sellerUid || "").trim() === uid
    );
  }

  if (sellerFilter.startsWith("legacy:")) {
    const key = sellerFilter.slice(7);

    const values = [
      sale?.sellerName,
      sale?.sellerEmail,
    ]
      .map(normalizeSearch)
      .filter(Boolean);

    return values.includes(key);
  }

  return false;
}

export default function SalesHistoryPage() {
  const navigate = useNavigate();

  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [productsReady, setProductsReady] = useState(false);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [loading, setLoading] = useState(true);
  const [editingSale, setEditingSale] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);

  useEffect(() => {
    const unsubscribeSales = subscribeSales(
      (values) => {
        setSales(Array.isArray(values) ? values : []);
        setLoading(false);
      },
      (error) => {
        console.error("No se pudo cargar el historial de ventas:", error);
        setLoading(false);
      },
      STORE_ID
    );

    const unsubscribeProducts = subscribeProducts(
      (values) => {
        const nextProducts =
          Array.isArray(values) ? values : [];

        setProducts(nextProducts);
        setProductsReady(true);

        preloadProductCoverImages(
          nextProducts,
          (product) =>
            getProductCoverImage(product)?.url ||
            ""
        );
      },
      (error) => {
        console.error("No se pudieron cargar los productos:", error);
        setProductsReady(true);
      },
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      (values) => {
        setCategories(Array.isArray(values) ? values : []);
      },
      (error) => {
        console.error("No se pudieron cargar las categorías:", error);
      },
      STORE_ID
    );

    const unsubscribeUsers = subscribeUsers(
      (values) => {
        setUsers(Array.isArray(values) ? values : []);
      },
      (error) => {
        console.error("No se pudieron cargar los vendedores:", error);
      },
      STORE_ID
    );

    return () => {
      unsubscribeSales();
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeUsers();
    };
  }, []);

  const productById = useMemo(
    () =>
      new Map(
        products.map((product) => [
          String(product?.id || "").trim(),
          product,
        ])
      ),
    [products]
  );

  const sellerOptions = useMemo(() => {
    const options = [];
    const knownUids = new Set();
    const knownLegacyKeys = new Set();

    users
      .filter((user) =>
        ["seller", "admin"].includes(
          String(user?.role || "").trim()
        )
      )
      .sort((a, b) =>
        String(
          a?.displayName || a?.email || ""
        ).localeCompare(
          String(
            b?.displayName || b?.email || ""
          ),
          "es-CO"
        )
      )
      .forEach((user) => {
        const value = getSellerOptionValue(user);

        if (!value) {
          return;
        }

        const uid = String(
          user?.uid || user?.id || ""
        ).trim();

        const displayName = String(
          user?.displayName || ""
        ).trim();

        const email = String(
          user?.email || ""
        ).trim();

        const baseLabel =
          displayName && email
            ? `${displayName} · ${email}`
            : displayName || email || "Usuario";

        const label =
          user?.active === false
            ? `${baseLabel} · Inactivo`
            : baseLabel;

        options.push({
          value,
          label,
        });

        if (uid) {
          knownUids.add(uid);
        }

        [
          displayName,
          email,
        ]
          .map(normalizeSearch)
          .filter(Boolean)
          .forEach((key) =>
            knownLegacyKeys.add(key)
          );
      });

    sales.forEach((sale) => {
      const uid = String(
        sale?.sellerUid || ""
      ).trim();

      if (uid && knownUids.has(uid)) {
        return;
      }

      const name = String(
        sale?.sellerName || ""
      ).trim();

      const email = String(
        sale?.sellerEmail || ""
      ).trim();

      const legacyKey = normalizeSearch(
        name || email
      );

      if (
        !legacyKey ||
        knownLegacyKeys.has(legacyKey)
      ) {
        return;
      }

      const value = uid
        ? `uid:${uid}`
        : `legacy:${legacyKey}`;

      const label =
        name && email && name !== email
          ? `${name} · ${email}`
          : name || email;

      options.push({
        value,
        label: `${label} · Histórico`,
      });

      if (uid) {
        knownUids.add(uid);
      }

      knownLegacyKeys.add(legacyKey);
    });

    return options;
  }, [users, sales]);

  const filteredSales = useMemo(() => {
    const cleanSearch = normalizeSearch(search);

    const fromMs = dateFrom
      ? new Date(`${dateFrom}T00:00:00`).getTime()
      : 0;

    const toMs = dateTo
      ? new Date(`${dateTo}T23:59:59.999`).getTime()
      : Number.POSITIVE_INFINITY;

    return sales.filter((sale) => {
      const payments = getSalePayments(sale);

      const searchable = normalizeSearch(
        [
          sale.saleNumber,
          sale.customerName,
          sale.customerDocument,
          sale.customerPhone,
          sale.sellerName,
          sale.sellerEmail,
          sale.paymentMethod,
          ...payments.map((payment) => payment.method),
          ...getSaleItems(sale).flatMap((item) => [
            item.productName,
            item.productCode,
            item.size,
            item.categoryName,
          ]),
        ].join(" ")
      );

      const saleMs = getDateMilliseconds(sale.createdAt);
      return (
        (!cleanSearch || searchable.includes(cleanSearch)) &&
        saleMatchesCategory(
          sale,
          categoryFilter,
          categories
        ) &&
        saleMatchesPayment(sale, paymentFilter) &&
        saleMatchesSeller(sale, sellerFilter) &&
        (!fromMs || saleMs >= fromMs) &&
        saleMs <= toMs
      );
    });
  }, [
    sales,
    search,
    categoryFilter,
    categories,
    paymentFilter,
    sellerFilter,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    if (filteredSales.length === 0) {
      setSelectedSaleId("");
      return;
    }

    const selectedStillVisible = filteredSales.some(
      (sale) => sale.id === selectedSaleId
    );

    if (!selectedStillVisible) {
      setSelectedSaleId(filteredSales[0].id);
    }
  }, [filteredSales, selectedSaleId]);

  const selectedSale =
    filteredSales.find(
      (sale) => sale.id === selectedSaleId
    ) || null;

  const totals = useMemo(() => {
    return filteredSales.reduce(
      (result, sale) => ({
        sales: result.sales + 1,
        units:
          result.units +
          Number(sale.totalItems || 0),
        total:
          result.total +
          Number(sale.total || 0),
      }),
      {
        sales: 0,
        units: 0,
        total: 0,
      }
    );
  }, [filteredSales]);

  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setPaymentFilter("all");
    setSellerFilter("all");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-3 py-4 text-[#171717] sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <header className="flex flex-col gap-4 rounded-[20px] border border-black/[0.055] bg-white/[0.96] px-5 py-4 shadow-[0_12px_34px_rgba(15,23,42,0.035)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate("/admin/ventas")}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.055] bg-[#fafafa] px-3 py-1.5 text-[11px] font-medium text-black/50 transition hover:border-red-100 hover:bg-red-50/60 hover:text-red-600"
            >
              <ArrowLeft size={13} />
              Punto de venta
            </button>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-[28px] font-semibold tracking-[-0.04em] sm:text-[31px]">
                Historial de ventas
              </h1>

              <span className="rounded-full border border-black/[0.045] bg-[#f7f7f8] px-2.5 py-1 text-[10px] font-medium text-black/42">
                {filteredSales.length} resultado(s)
              </span>
            </div>

            <p className="mt-1 text-[12px] leading-5 text-black/43">
              Consulta, imprime y corrige ventas sin perder trazabilidad.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
            <CompactMetric
              label="Ventas"
              value={totals.sales}
            />
            <CompactMetric
              label="Unidades"
              value={totals.units}
            />
            <CompactMetric
              label="Facturado"
              value={formatCurrency(totals.total)}
              emphasized
            />
          </div>
        </header>

        <section className="mt-3 rounded-[18px] border border-black/[0.055] bg-white/[0.96] p-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.025)] backdrop-blur">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-[minmax(280px,1.45fr)_.9fr_.8fr_1fr_.72fr_.72fr_auto]">
            <label className="relative block">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/28"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-full rounded-[12px] border border-black/[0.065] bg-[#fbfbfc] pl-10 pr-3 text-[12px] outline-none transition placeholder:text-black/28 focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-500/[0.08]"
                placeholder="Venta, cliente, vendedor o producto..."
              />
            </label>

            <select
              value={categoryFilter}
              onChange={(event) =>
                setCategoryFilter(event.target.value)
              }
              className="h-11 rounded-[12px] border border-black/[0.065] bg-[#fbfbfc] px-3 text-[11px] outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-500/[0.08]"
            >
              <option value="all">
                Todas las categorías
              </option>

              {categories.map((category) => (
                <option
                  key={category.id}
                  value={category.id}
                >
                  {getCategoryLabel(category)}
                </option>
              ))}
            </select>

            <select
              value={paymentFilter}
              onChange={(event) =>
                setPaymentFilter(event.target.value)
              }
              className="h-11 rounded-[12px] border border-black/[0.065] bg-[#fbfbfc] px-3 text-[11px] outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-500/[0.08]"
            >
              <option value="all">Todos los pagos</option>

              {PAYMENT_FILTER_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={sellerFilter}
              onChange={(event) =>
                setSellerFilter(event.target.value)
              }
              className="h-11 rounded-[12px] border border-black/[0.065] bg-[#fbfbfc] px-3 text-[11px] outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-500/[0.08]"
            >
              <option value="all">Todos los vendedores</option>

              {sellerOptions.map((seller) => (
                <option
                  key={seller.value}
                  value={seller.value}
                >
                  {seller.label}
                </option>
              ))}
            </select>

            <DateFilter
              label="Desde"
              value={dateFrom}
              onChange={setDateFrom}
            />

            <DateFilter
              label="Hasta"
              value={dateTo}
              onChange={setDateTo}
            />

            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[12px] border border-black/[0.065] bg-white px-4 text-[11px] font-medium text-black/55 transition hover:border-black/[0.1] hover:bg-[#fafafa] hover:text-black/75"
            >
              <SlidersHorizontal size={11} />
              Limpiar
            </button>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[20px] border border-black/[0.055] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.03)] xl:sticky xl:top-4 xl:self-start">
            <div className="flex items-center justify-between border-b border-black/[0.055] px-4 py-3.5">
              <div>
                <p className="text-[13px] font-semibold">Ventas</p>
                <p className="mt-0.5 text-[10px] text-black/38">
                  Selecciona una operación
                </p>
              </div>

              <History size={14} className="text-red-600" />
            </div>

            <div className="max-h-[calc(100vh-260px)] min-h-[520px] overflow-y-auto">
              {loading ? (
                <div className="space-y-1 px-2 py-2">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <div
                      key={item}
                      className="h-[74px] animate-pulse rounded-[10px] bg-black/[0.025]"
                    />
                  ))}
                </div>
              ) : filteredSales.length === 0 ? (
                <div className="flex min-h-[360px] items-center justify-center p-7 text-center">
                  <div>
                    <PackageSearch
                      size={26}
                      className="mx-auto text-black/18"
                    />
                    <p className="mt-3 text-[10px] font-medium">
                      Sin resultados
                    </p>
                    <p className="mt-1 text-[8px] text-black/34">
                      Ajusta los filtros.
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  {filteredSales.map((sale) => (
                    <SaleListItem
                      key={sale.id}
                      sale={sale}
                      active={sale.id === selectedSaleId}
                      onClick={() =>
                        setSelectedSaleId(sale.id)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {selectedSale ? (
              <SaleDetail
                key={selectedSale.id}
                sale={selectedSale}
                productById={productById}
                productsReady={productsReady}
                onEdit={() =>
                  setEditingSale(selectedSale)
                }
                onPrint={() =>
                  setReceiptSale(selectedSale)
                }
              />
            ) : (
              <div className="flex min-h-[560px] items-center justify-center rounded-[18px] border border-black/[0.06] bg-white p-8 text-center">
                <div>
                  <ReceiptText
                    size={30}
                    className="mx-auto text-black/18"
                  />
                  <p className="mt-3 text-[11px] font-medium">
                    Selecciona una venta
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </section>

      {editingSale && (
        <SaleEditModal
          key={editingSale.id}
          sale={editingSale}
          products={products}
          categories={categories}
          onClose={() => setEditingSale(null)}
          onSaved={() => setEditingSale(null)}
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

function CompactMetric({
  label,
  value,
  emphasized = false,
}) {
  return (
    <div className="min-w-0 rounded-[13px] border border-black/[0.045] bg-[#fafafa] px-3.5 py-2.5 shadow-sm">
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
        {label}
      </p>
      <p
        className={`mt-1 truncate font-semibold tracking-[-0.035em] ${
          emphasized ? "text-[15px]" : "text-[17px]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute left-3 top-1.5 text-[7px] font-semibold uppercase tracking-[0.08em] text-black/28">
        {label}
      </span>

      <input
        type="date"
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="h-11 w-full rounded-[12px] border border-black/[0.065] bg-[#fbfbfc] px-3 pt-3 text-[10px] outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-500/[0.08]"
      />
    </label>
  );
}

function SaleListItem({
  sale,
  active,
  onClick,
}) {
  const customer =
    sale.customerName ||
    sale.customerDocument ||
    "Venta sin cliente";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full border-b border-black/[0.045] px-3.5 py-3 text-left transition ${
        active
          ? "bg-[#fffafa] shadow-[inset_0_0_0_1px_rgba(239,68,68,0.05)]"
          : "bg-white hover:bg-[#fafafa]"
      }`}
    >
      {active && (
        <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-red-500" />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[11px] font-semibold">
              {sale.saleNumber || "Venta"}
            </p>

            {sale.paymentMethod === "mixto" && (
              <span className="rounded-full border border-blue-100 bg-blue-50/70 px-2 py-0.5 text-[7px] font-semibold text-blue-700">
                MIXTO
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-[11px] font-medium text-black/62">
            {customer}
          </p>

          <p className="mt-1 truncate text-[9px] text-black/34">
            {sale.sellerName ||
              sale.sellerEmail ||
              "Sin vendedor"}{" "}
            · {formatSaleDate(sale.createdAt)}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[13px] font-semibold">
            {formatCurrency(sale.total)}
          </p>
          <p className="mt-1 text-[9px] text-black/32">
            {sale.totalItems || 0} u.
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[9px] font-medium uppercase tracking-[0.06em] text-black/32">
          {getPaymentLabel(sale.paymentMethod)}
        </span>

        <ChevronRight
          size={10}
          className={
            active
              ? "text-red-600"
              : "text-black/20 transition group-hover:text-red-600"
          }
        />
      </div>
    </button>
  );
}

function SaleDetail({
  sale,
  productById,
  productsReady,
  onEdit,
  onPrint,
}) {
  const items = getSaleItems(sale);
  const payments = getSalePayments(sale);

  return (
    <section className="overflow-hidden rounded-[20px] border border-black/[0.055] bg-white shadow-[0_14px_36px_rgba(15,23,42,0.032)]">
      <div className="flex flex-col gap-3 border-b border-black/[0.055] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[23px] font-semibold tracking-[-0.04em]">
              {sale.saleNumber || "Venta"}
            </h2>

            {Number(sale.editCount || 0) > 0 && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[6.5px] font-semibold text-blue-700">
                Editada {sale.editCount} vez/veces
              </span>
            )}
          </div>

          <p className="mt-1 text-[10px] text-black/38">
            {formatSaleDate(sale.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 text-right">
            <p className="text-[6px] font-semibold uppercase tracking-[0.08em] text-black/24">
              Total
            </p>
            <p className="mt-0.5 text-[20px] font-semibold tracking-[-0.04em]">
              {formatCurrency(sale.total)}
            </p>
          </div>

          <button
            type="button"
            onClick={onPrint}
            className="inline-flex h-10 items-center gap-1.5 rounded-[11px] border border-black/[0.065] bg-white px-3.5 text-[10px] font-medium text-black/58 transition hover:border-black/[0.1] hover:bg-[#fafafa]"
          >
            <Printer size={11} />
            Imprimir
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-10 items-center gap-1.5 rounded-[11px] bg-red-600 px-3.5 text-[10px] font-semibold text-white shadow-[0_8px_20px_rgba(220,38,38,0.13)] transition hover:-translate-y-0.5 hover:bg-red-700"
          >
            <Pencil size={11} />
            Editar
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 border-b border-black/[0.055] lg:border-b-0 lg:border-r lg:border-black/[0.055]">
          <div className="grid border-b border-black/[0.05] bg-[#fbfbfc] sm:grid-cols-3">
            <MiniInfo
              icon={User}
              label="Vendedor"
              value={sale.sellerName || "Sin nombre"}
              detail={sale.sellerEmail || "Sin correo"}
            />

            <MiniInfo
              icon={ShoppingBag}
              label="Cliente"
              value={
                sale.customerName ||
                "Venta sin cliente"
              }
              detail={
                sale.customerDocument
                  ? `CC ${sale.customerDocument}${
                      sale.customerPhone
                        ? ` · ${sale.customerPhone}`
                        : ""
                    }`
                  : "Sin cédula"
              }
            />

            <MiniInfo
              icon={CreditCard}
              label="Pago"
              value={getPaymentLabel(
                sale.paymentMethod
              )}
              detail={`${payments.length} medio(s)`}
            />
          </div>

          <div className="px-5 py-4">
            <div>
              <p className="text-[12px] font-semibold">
                Productos
              </p>
              <p className="mt-0.5 text-[9px] text-black/35">
                {items.length} línea(s) ·{" "}
                {sale.totalItems || 0} unidad(es)
              </p>
            </div>

            <div className="mt-3 overflow-hidden rounded-[14px] border border-black/[0.055]">
              {items.length === 0 ? (
                <div className="p-8 text-center text-[8px] text-black/35">
                  Sin productos disponibles.
                </div>
              ) : (
                <div className="divide-y divide-black/[0.045]">
                  {items.map((item, index) => {
                    const product =
                      productById.get(
                        String(item.productId || "").trim()
                      ) || null;

                    const currentCoverUrl = product
                      ? getProductCoverImage(product)?.url || ""
                      : "";

                    const historicalImageUrl =
                      productsReady
                        ? String(
                            item.imageUrl || ""
                          ).trim()
                        : "";

                    const imageUrl =
                      currentCoverUrl ||
                      historicalImageUrl;

                    const fallbackImageUrl =
                      currentCoverUrl &&
                      historicalImageUrl &&
                      currentCoverUrl !==
                        historicalImageUrl
                        ? historicalImageUrl
                        : "";

                    return (
                      <ProductLine
                        key={`${sale.id}__${
                          item.lineId ||
                          item.productId ||
                          "item"
                        }__${index}`}
                        item={item}
                        imageUrl={imageUrl}
                        fallbackImageUrl={
                          fallbackImageUrl
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 border-t border-black/[0.055] px-5 py-4 md:grid-cols-2">
            <section className="rounded-[14px] border border-black/[0.04] bg-[#fbfbfc] p-4">
              <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/30">
                Notas
              </p>

              <p className="mt-1.5 min-h-[38px] whitespace-pre-wrap text-[10px] leading-5 text-black/45">
                {sale.notes ||
                  "Sin observaciones registradas."}
              </p>
            </section>

            <section className="rounded-[14px] border border-black/[0.04] bg-[#fbfbfc] p-4">
              <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/30">
                Trazabilidad
              </p>

              {sale.lastEditedByName ||
              sale.lastEditedByEmail ? (
                <div className="mt-1.5 flex items-start gap-2">
                  <FilePenLine
                    size={11}
                    className="mt-0.5 shrink-0 text-blue-600"
                  />

                  <p className="text-[10px] leading-5 text-black/45">
                    Última edición por{" "}
                    <strong className="font-medium text-black/62">
                      {sale.lastEditedByName ||
                        sale.lastEditedByEmail}
                    </strong>
                    <br />
                    {formatSaleDate(
                      sale.lastEditedAt ||
                        sale.updatedAt
                    )}
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 text-[8px] text-black/38">
                  Venta sin modificaciones.
                </p>
              )}
            </section>
          </div>
        </div>

        <aside className="bg-[#fbfbfc] p-4">
          <section>
            <div className="flex items-center gap-2">
              <WalletCards
                size={12}
                className="text-red-600"
              />
              <p className="text-[11px] font-semibold">
                Distribución del pago
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {payments.map((payment) => (
                <div
                  key={payment.localId}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-[9px] text-black/42">
                    {getPaymentLabel(payment.method)}
                  </span>

                  <strong className="text-[11px] font-semibold">
                    {formatCurrency(payment.amount)}
                  </strong>
                </div>
              ))}
            </div>
          </section>

          <div className="my-4 border-t border-black/[0.055]" />

          <section className="space-y-2">
            <SummaryMoneyRow
              label="Subtotal"
              value={sale.subtotal}
            />

            <SummaryMoneyRow
              label="Descuento"
              value={-Number(sale.discount || 0)}
              negative
            />

            {Number(sale.change || 0) > 0 && (
              <SummaryMoneyRow
                label="Cambio"
                value={sale.change}
              />
            )}
          </section>

          <div className="mt-4 rounded-[14px] border border-red-100 bg-[#fffafa] px-4 py-3.5 shadow-sm">
            <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-red-600">
              Total cobrado
            </p>

            <p className="mt-1 text-[24px] font-semibold tracking-[-0.045em] text-black">
              {formatCurrency(sale.total)}
            </p>
          </div>

          {sale.paymentMethod === "addi" && (
            <div className="mt-3 rounded-[12px] border border-amber-100 bg-amber-50/70 px-3 py-2.5">
              <p className="text-[9px] font-semibold text-amber-800">
                Addi
              </p>

              <p className="mt-1 text-[9px] leading-4 text-amber-900/60">
                {sale.addiStatus === "settled"
                  ? "Desembolso recibido."
                  : "Desembolso pendiente por recibir."}
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function MiniInfo({
  icon: Icon,
  label,
  value,
  detail,
}) {
  return (
    <div className="min-w-0 border-b border-black/[0.045] px-4 py-3.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-red-100 bg-red-50/70 text-red-600">
          <Icon size={12} />
        </div>

        <div className="min-w-0">
          <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
            {label}
          </p>

          <p className="mt-1 truncate text-[11px] font-medium">
            {value}
          </p>

          <p className="mt-0.5 truncate text-[9px] text-black/35">
            {detail}
          </p>
        </div>
      </div>
    </div>
  );
}

function StableProductImage({
  src,
  fallbackSrc = "",
  alt,
}) {
  const primarySrc = String(src || "").trim();
  const secondarySrc = String(
    fallbackSrc || ""
  ).trim();

  const candidates = useMemo(
    () =>
      [...new Set([primarySrc, secondarySrc])]
        .filter(Boolean),
    [primarySrc, secondarySrc]
  );

  const [candidateIndex, setCandidateIndex] =
    useState(0);

  const currentSrc =
    candidates[candidateIndex] || "";

  const [loaded, setLoaded] = useState(() =>
    isProductImagePreloaded(currentSrc)
  );

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCandidateIndex(0);
    setFailed(false);
  }, [primarySrc, secondarySrc]);

  useEffect(() => {
    let cancelled = false;

    if (!currentSrc) {
      setLoaded(false);

      return () => {
        cancelled = true;
      };
    }

    if (
      isProductImagePreloaded(currentSrc)
    ) {
      setLoaded(true);
      setFailed(false);

      return () => {
        cancelled = true;
      };
    }

    setLoaded(false);
    setFailed(false);

    preloadProductImage(currentSrc, {
      priority: "high",
    }).then((ready) => {
      if (cancelled) {
        return;
      }

      if (ready) {
        setLoaded(true);
        setFailed(false);
        return;
      }

      if (
        candidateIndex + 1 <
        candidates.length
      ) {
        setCandidateIndex(
          (current) => current + 1
        );
        return;
      }

      setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentSrc,
    candidateIndex,
    candidates.length,
  ]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {(!currentSrc || !loaded || failed) && (
        <ShoppingBag
          size={14}
          className="absolute text-black/18"
        />
      )}

      {currentSrc && loaded && !failed && (
        <img
          key={currentSrc}
          src={currentSrc}
          alt={alt || "Producto"}
          loading="eager"
          decoding="async"
          draggable={false}
          onError={() => {
            if (
              candidateIndex + 1 <
              candidates.length
            ) {
              setLoaded(false);
              setCandidateIndex(
                (current) => current + 1
              );
              return;
            }

            setLoaded(false);
            setFailed(true);
          }}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function ProductLine({
  item,
  imageUrl,
  fallbackImageUrl = "",
}) {
  return (
    <article className="flex items-center gap-3 bg-white px-4 py-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-black/[0.04] bg-[#f7f7f8]">
        <StableProductImage
          src={imageUrl}
          fallbackSrc={fallbackImageUrl}
          alt={item.productName}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-[10px] font-medium">
            {item.productName || "Producto"}
          </p>

          {item.isPromotion && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[5.8px] font-semibold text-amber-700">
              <BadgePercent size={6} />
              PROMO
            </span>
          )}
        </div>

        <p className="mt-1 text-[8.5px] text-black/35">
          {item.productCode || "Sin código"} · Talla{" "}
          {item.size || "Talla única"} · {item.quantity} ×{" "}
          {formatCurrency(item.unitPrice)}
        </p>
      </div>

      <strong className="shrink-0 text-[11px] font-semibold">
        {formatCurrency(
          item.subtotal ??
            Number(item.unitPrice || 0) *
              Number(item.quantity || 0)
        )}
      </strong>
    </article>
  );
}

function SummaryMoneyRow({
  label,
  value,
  negative = false,
}) {
  const amount = Math.abs(Number(value || 0));

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[8px] text-black/38">
        {label}
      </span>

      <span
        className={`text-[9.5px] font-medium ${
          negative
            ? "text-red-600"
            : "text-black/65"
        }`}
      >
        {negative && amount > 0 ? "- " : ""}
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

function SaleEditModal({
  sale,
  products,
  categories,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(() => ({
    customerName: sale.customerName || "",
    customerDocument: sale.customerDocument || "",
    customerPhone: sale.customerPhone || "",
    customerEmail: sale.customerEmail || "",
    discount: formatMoneyInput(sale.discount),
    notes: sale.notes || "",
  }));

  const [lines, setLines] = useState(() =>
    getSaleItems(sale).map((item, index) => ({
      localId: item.lineId || `existing-${index}`,
      productId: item.productId,
      productName: item.productName,
      productCode: item.productCode,
      variantId: item.variantId,
      size: item.size,
      quantity: Math.max(Number(item.quantity || 1), 1),
      isPromotion: Boolean(item.isPromotion),
      unitPrice: Number(item.unitPrice || 0),
      regularUnitPrice: Number(
        item.regularUnitPrice ??
          item.unitPrice ??
          0
      ),
      promotionPrice: Number(item.promotionPrice || 0),
      imageUrl: item.imageUrl || "",
      historical: true,
      originalIsPromotion: Boolean(item.isPromotion),
      originalUnitPrice: Number(item.unitPrice || 0),
      originalRegularUnitPrice: Number(
        item.regularUnitPrice ??
          item.unitPrice ??
          0
      ),
      originalPromotionPrice: Number(item.promotionPrice || 0),
    }))
  );

  const [payments, setPayments] = useState(() =>
    getSalePayments(sale).map((payment, index) => ({
      ...payment,
      localId: `edit-payment-${index}-${Date.now()}`,
      amount: formatMoneyInput(payment.amount),
      receivedAmount: formatMoneyInput(payment.receivedAmount),
    }))
  );

  const [productCategoryFilter, setProductCategoryFilter] =
    useState("all");
  const [productSearch, setProductSearch] = useState("");
  const [addDraft, setAddDraft] = useState({
    productId: "",
    variantId: "",
    mode: "normal",
    quantity: "1",
  });

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const summary = useMemo(() => {
    const subtotal = lines.reduce(
      (total, line) =>
        total +
        Number(line.unitPrice || 0) *
          Number(line.quantity || 0),
      0
    );

    const discount = Math.min(
      parseMoney(form.discount),
      subtotal
    );

    const total = Math.max(subtotal - discount, 0);

    const allocated = payments.reduce(
      (sum, payment) =>
        sum + parseMoney(payment.amount),
      0
    );

    const cashChange = payments.reduce(
      (sum, payment) => {
        if (payment.method !== "efectivo") {
          return sum;
        }

        return (
          sum +
          Math.max(
            parseMoney(payment.receivedAmount) -
              parseMoney(payment.amount),
            0
          )
        );
      },
      0
    );

    return {
      subtotal,
      discount,
      total,
      allocated,
      remaining: total - allocated,
      cashChange,
      totalItems: lines.reduce(
        (sum, line) =>
          sum + Number(line.quantity || 0),
        0
      ),
    };
  }, [lines, payments, form.discount]);

  const filteredProducts = useMemo(() => {
    const clean = normalizeSearch(productSearch);

    return products.filter((product) => {
      const matchesCategory =
        productMatchesCategory(
          product,
          productCategoryFilter,
          categories
        );

      if (!matchesCategory) {
        return false;
      }

      if (!clean) {
        return true;
      }

      return normalizeSearch(
        [
          product.name,
          product.code,
          product.categoryName,
          ...getProductVariants(product).map(
            (variant) => variant.size
          ),
        ].join(" ")
      ).includes(clean);
    });
  }, [
    products,
    productSearch,
    productCategoryFilter,
    categories,
  ]);

  const draftProduct =
    products.find(
      (product) => product.id === addDraft.productId
    ) || null;

  const draftVariants = draftProduct
    ? getProductVariants(draftProduct)
    : [];

  const draftVariant =
    draftVariants.find(
      (variant) => variant.id === addDraft.variantId
    ) || null;

  const selectableProducts = useMemo(() => {
    if (!draftProduct) {
      return filteredProducts;
    }

    if (
      filteredProducts.some(
        (product) => product.id === draftProduct.id
      )
    ) {
      return filteredProducts;
    }

    return [draftProduct, ...filteredProducts];
  }, [draftProduct, filteredProducts]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function changeProductCategory(categoryId) {
    setProductCategoryFilter(categoryId);
    setProductSearch("");

    setAddDraft({
      productId: "",
      variantId: "",
      mode: "normal",
      quantity: "1",
    });
  }

  function selectProduct(productId) {
    const product =
      products.find(
        (item) => item.id === productId
      ) || null;

    const variants = product
      ? getProductVariants(product)
      : [];

    setAddDraft({
      productId,
      variantId: variants[0]?.id || "",
      mode: "normal",
      quantity: "1",
    });
  }

  function updateLineQuantity(localId, value) {
    const quantity = Math.max(
      Number(
        String(value ?? "").replace(/\D/g, "")
      ) || 1,
      1
    );

    setLines((current) =>
      current.map((line) =>
        line.localId === localId
          ? {
              ...line,
              quantity,
            }
          : line
      )
    );
  }

  function updateLineMode(localId, nextMode) {
    setError("");

    setLines((current) =>
      current.map((line) => {
        if (line.localId !== localId) {
          return line;
        }

        const product =
          products.find(
            (item) => item.id === line.productId
          ) || null;

        const variant = product
          ? getProductVariants(product).find(
              (item) => item.id === line.variantId
            )
          : null;

        const wantsPromotion =
          nextMode === "promotion";

        if (wantsPromotion) {
          const historicalPromotion =
            Boolean(line.originalIsPromotion) ||
            (line.historical && line.isPromotion);

          const currentPromotionAvailable =
            Boolean(
              product &&
                variant &&
                isPromotionProduct(product) &&
                getPromotionStockForVariant(
                  product,
                  variant
                ) > 0
            );

          if (
            !historicalPromotion &&
            !currentPromotionAvailable
          ) {
            setError(
              "La talla seleccionada no tiene unidades promocionales disponibles."
            );
            return line;
          }
        }

        if (wantsPromotion === line.isPromotion) {
          return line;
        }

        const regularPrice = Number(
          line.originalRegularUnitPrice ||
            line.regularUnitPrice ||
            product?.salePrice ||
            line.unitPrice ||
            0
        );

        const promotionPrice = wantsPromotion
          ? Number(
              line.originalIsPromotion
                ? line.originalPromotionPrice ||
                    line.originalUnitPrice ||
                    product?.promotionPrice ||
                    0
                : product?.promotionPrice ||
                    line.promotionPrice ||
                    0
            )
          : 0;

        return {
          ...line,
          isPromotion: wantsPromotion,
          unitPrice: wantsPromotion
            ? promotionPrice
            : regularPrice,
          regularUnitPrice: regularPrice,
          promotionPrice,
          historical: false,
        };
      })
    );
  }

  function addProductLine() {
    setError("");

    if (!draftProduct || !draftVariant) {
      setError("Selecciona un producto y una talla.");
      return;
    }

    const quantity = Math.max(
      Number(
        String(addDraft.quantity || "").replace(
          /\D/g,
          ""
        )
      ) || 0,
      0
    );

    if (quantity <= 0) {
      setError("La cantidad debe ser mayor a cero.");
      return;
    }

    const isPromotion =
      addDraft.mode === "promotion";

    if (
      isPromotion &&
      (!isPromotionProduct(draftProduct) ||
        getPromotionStockForVariant(
          draftProduct,
          draftVariant
        ) <= 0)
    ) {
      setError(
        "Esta talla no tiene promoción disponible."
      );
      return;
    }

    const key = makeLineKey(
      draftProduct.id,
      draftVariant.id,
      isPromotion
    );

    const existing = lines.find(
      (line) =>
        makeLineKey(
          line.productId,
          line.variantId,
          line.isPromotion
        ) === key
    );

    if (existing) {
      setLines((current) =>
        current.map((line) =>
          line.localId === existing.localId
            ? {
                ...line,
                quantity:
                  line.quantity + quantity,
              }
            : line
        )
      );

      setAddDraft((current) => ({
        ...current,
        quantity: "1",
      }));

      return;
    }

    const cover =
      getProductCoverImage(draftProduct);

    const regularUnitPrice = Number(
      draftProduct.salePrice || 0
    );

    const promotionPrice = isPromotion
      ? Number(draftProduct.promotionPrice || 0)
      : 0;

    setLines((current) => [
      ...current,
      {
        localId: `new-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        productId: draftProduct.id,
        productName: draftProduct.name,
        productCode: draftProduct.code,
        variantId: draftVariant.id,
        size: draftVariant.size,
        quantity,
        isPromotion,
        unitPrice: isPromotion
          ? promotionPrice
          : regularUnitPrice,
        regularUnitPrice,
        promotionPrice,
        imageUrl: cover.url || "",
        historical: false,
        originalIsPromotion: isPromotion,
        originalUnitPrice: isPromotion
          ? promotionPrice
          : regularUnitPrice,
        originalRegularUnitPrice:
          regularUnitPrice,
        originalPromotionPrice:
          promotionPrice,
      },
    ]);

    setAddDraft((current) => ({
      ...current,
      quantity: "1",
    }));
  }

  function updatePayment(localId, field, value) {
    setPayments((current) =>
      current.map((payment) => {
        if (payment.localId !== localId) {
          return payment;
        }

        const next = {
          ...payment,
          [field]: value,
        };

        if (
          field === "method" &&
          value !== "efectivo"
        ) {
          next.receivedAmount = next.amount;
        }

        if (
          field === "amount" &&
          payment.method !== "efectivo"
        ) {
          next.receivedAmount = value;
        }

        return next;
      })
    );
  }

  function addPayment() {
    setPayments((current) => [
      ...current,
      {
        localId: `payment-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        method: "transferencia",
        amount: "",
        receivedAmount: "",
      },
    ]);
  }

  function removePayment(localId) {
    setPayments((current) =>
      current.length <= 1
        ? current
        : current.filter(
            (payment) =>
              payment.localId !== localId
          )
    );
  }

  async function handleSave(event) {
    event.preventDefault();
    setError("");

    if (!lines.length) {
      setError(
        "La venta debe conservar al menos un producto."
      );
      return;
    }

    if (Math.abs(summary.remaining) > 0.001) {
      setError(
        `Los medios de pago deben sumar exactamente ${formatCurrency(
          summary.total
        )}. Falta/sobra ${formatCurrency(
          Math.abs(summary.remaining)
        )}.`
      );
      return;
    }

    const normalizedPayments = payments
      .map((payment) => ({
        method: payment.method,
        amount: parseMoney(payment.amount),
        receivedAmount:
          payment.method === "efectivo"
            ? parseMoney(payment.receivedAmount)
            : parseMoney(payment.amount),
      }))
      .filter((payment) => payment.amount > 0);

    if (!normalizedPayments.length) {
      setError(
        "Registra al menos un medio de pago."
      );
      return;
    }

    if (
      normalizedPayments.some(
        (payment) => payment.method === "addi"
      ) &&
      normalizedPayments.length > 1
    ) {
      setError(
        "Por ahora Addi debe quedar como pago único; no lo mezcles con otros medios."
      );
      return;
    }

    if (
      normalizedPayments.some(
        (payment) =>
          payment.method === "efectivo" &&
          payment.receivedAmount <
            payment.amount
      )
    ) {
      setError(
        "El efectivo recibido no puede ser menor al valor asignado a efectivo."
      );
      return;
    }

    const customerDocument =
      normalizeCustomerDocument(
        form.customerDocument
      );

    if (
      customerDocument &&
      !String(form.customerName || "").trim()
    ) {
      setError(
        "Si asocias una cédula, escribe también el nombre del cliente."
      );
      return;
    }

    try {
      setSaving(true);

      await updateSale({
        saleId: sale.id,

        items: lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          size: line.size,
          quantity: line.quantity,
          isPromotion: line.isPromotion,
          pricingMode: line.isPromotion
            ? "promotion"
            : "normal",
        })),

        customerId: "",
        customerName: form.customerName,
        customerDocument,
        customerPhone: form.customerPhone,
        customerEmail: form.customerEmail,

        paymentMethod:
          normalizedPayments.length === 1
            ? normalizedPayments[0].method
            : "mixto",

        payments: normalizedPayments,
        discount: summary.discount,
        amountReceived:
          summary.total +
          summary.cashChange,
        notes: form.notes,

        storeId: STORE_ID,
        actor: getCurrentUserActor(),
      });

      onSaved();
    } catch (saveError) {
      console.error(
        "No se pudo actualizar la venta:",
        saveError
      );

      setError(
        saveError?.message ||
          "No se pudo actualizar la venta."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 p-2 backdrop-blur-[3px] sm:p-4">
      <section className="mx-auto flex h-full max-h-[94vh] max-w-[1320px] flex-col overflow-hidden rounded-[22px] border border-white/70 bg-[#f6f7f9] shadow-[0_30px_110px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between border-b border-black/[0.05] bg-white/[0.98] px-5 py-4 backdrop-blur">
          <div>
            <p className="text-[8px] font-semibold uppercase tracking-[0.09em] text-red-600">
              Corrección transaccional
            </p>

            <h2 className="mt-1 text-[21px] font-semibold tracking-[-0.04em]">
              Editar {sale.saleNumber || "venta"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-black/[0.05] bg-[#fafafa] text-black/48 transition hover:bg-[#f3f3f4] hover:text-black/70"
          >
            <X size={14} />
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {error && (
              <div className="mb-3 rounded-[12px] border border-red-100 bg-red-50/70 px-3.5 py-3 text-[10px] leading-5 text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_390px]">
              <div className="min-w-0 space-y-3">
                <section className="overflow-hidden rounded-[16px] border border-black/[0.05] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.02)]">
                  <div className="flex items-center justify-between border-b border-black/[0.055] px-4 py-3.5">
                    <div>
                      <p className="text-[12px] font-semibold">
                        Productos
                      </p>
                      <p className="mt-0.5 text-[9px] text-black/35">
                        Cantidad y modalidad por línea.
                      </p>
                    </div>

                    <span className="rounded-full bg-black/[0.035] px-2 py-1 text-[8px] font-medium text-black/45">
                      {summary.totalItems} u.
                    </span>
                  </div>

                  <div className="space-y-1.5 p-2">
                    {lines.map((line) => {
                      const product =
                        products.find(
                          (item) =>
                            item.id ===
                            line.productId
                        ) || null;

                      const variant = product
                        ? getProductVariants(product).find(
                            (item) =>
                              item.id ===
                              line.variantId
                          )
                        : null;

                      const canPromotion = Boolean(
                        line.isPromotion ||
                          line.originalIsPromotion ||
                          (product &&
                            variant &&
                            isPromotionProduct(product) &&
                            getPromotionStockForVariant(
                              product,
                              variant
                            ) > 0)
                      );

                      const currentCoverUrl = product
                        ? getProductCoverImage(product)?.url ||
                          ""
                        : "";

                      const historicalImageUrl =
                        String(
                          line.imageUrl || ""
                        ).trim();

                      const currentImageUrl =
                        currentCoverUrl ||
                        historicalImageUrl;

                      const fallbackImageUrl =
                        currentCoverUrl &&
                        historicalImageUrl &&
                        currentCoverUrl !==
                          historicalImageUrl
                          ? historicalImageUrl
                          : "";

                      return (
                        <EditableLine
                          key={`${sale.id}__${line.localId}`}
                          line={line}
                          imageUrl={currentImageUrl}
                          fallbackImageUrl={
                            fallbackImageUrl
                          }
                          canPromotion={canPromotion}
                          onQuantity={
                            updateLineQuantity
                          }
                          onMode={updateLineMode}
                          onRemove={(id) =>
                            setLines((current) =>
                              current.filter(
                                (item) =>
                                  item.localId !== id
                              )
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </section>

                <section className="overflow-hidden rounded-[16px] border border-black/[0.05] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.02)]">
                  <div className="flex items-center gap-2 border-b border-black/[0.055] px-3.5 py-3">
                    <Plus
                      size={12}
                      className="text-red-600"
                    />

                    <div>
                      <p className="text-[9.5px] font-semibold">
                        Agregar producto
                      </p>
                      <p className="mt-1 text-[8px] text-black/35">
                        Filtra por categoría, busca el producto y agrega la talla correcta.
                      </p>
                    </div>
                  </div>

                  <div className="border-b border-black/[0.045] bg-[#fbfbfc] p-3">
                    <div className="grid gap-2 md:grid-cols-[.9fr_1.4fr]">
                      <label>
                        <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
                          Categoría
                        </span>

                        <select
                          value={productCategoryFilter}
                          onChange={(event) =>
                            changeProductCategory(
                              event.target.value
                            )
                          }
                          className="mt-1.5 h-10 w-full rounded-[10px] border border-black/[0.065] bg-white px-3 text-[10px] outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-500/[0.06]"
                        >
                          <option value="all">
                            Todas las categorías
                          </option>

                          {categories.map((category) => (
                            <option
                              key={category.id}
                              value={category.id}
                            >
                              {getCategoryLabel(category)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
                          Buscar
                        </span>

                        <div className="relative mt-1.5">
                          <Search
                            size={13}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/25"
                          />

                          <input
                            value={productSearch}
                            onChange={(event) =>
                              setProductSearch(
                                event.target.value
                              )
                            }
                            className="h-10 w-full rounded-[10px] border border-black/[0.065] bg-white pl-9 pr-3 text-[10px] outline-none transition placeholder:text-black/25 focus:border-red-300 focus:ring-4 focus:ring-red-500/[0.06]"
                            placeholder="Nombre, código o talla..."
                          />
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-2 p-3 lg:grid-cols-[minmax(220px,1.45fr)_1fr_.8fr_.5fr_auto] lg:items-end">
                    <label>
                      <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
                        Producto
                      </span>

                      <select
                        value={addDraft.productId}
                        onChange={(event) =>
                          selectProduct(
                            event.target.value
                          )
                        }
                        className="mt-1.5 h-10 w-full rounded-[10px] border border-black/[0.065] bg-white px-3 text-[10px] outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-500/[0.06]"
                      >
                        <option value="">
                          {filteredProducts.length
                            ? `Seleccionar producto · ${filteredProducts.length} disponible(s)`
                            : "No hay productos con estos filtros"}
                        </option>

                        {selectableProducts.map(
                          (product) => (
                            <option
                              key={product.id}
                              value={product.id}
                            >
                              {product.code || "S/C"} · {product.name}
                              {product.categoryName
                                ? ` · ${product.categoryName}`
                                : ""}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <SelectField
                      label="Talla"
                      value={addDraft.variantId}
                      disabled={!draftProduct}
                      onChange={(value) =>
                        setAddDraft(
                          (current) => ({
                            ...current,
                            variantId: value,
                          })
                        )
                      }
                    >
                      {draftVariants.map(
                        (variant) => (
                          <option
                            key={variant.id}
                            value={variant.id}
                          >
                            {variant.size} ·{" "}
                            {variant.stock} u.
                          </option>
                        )
                      )}
                    </SelectField>

                    <SelectField
                      label="Modalidad"
                      value={addDraft.mode}
                      disabled={!draftProduct}
                      onChange={(value) =>
                        setAddDraft(
                          (current) => ({
                            ...current,
                            mode: value,
                          })
                        )
                      }
                    >
                      <option value="normal">
                        Normal
                      </option>
                      <option
                        value="promotion"
                        disabled={
                          !draftProduct ||
                          !isPromotionProduct(
                            draftProduct
                          )
                        }
                      >
                        Promoción
                      </option>
                    </SelectField>

                    <label>
                      <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
                        Cant.
                      </span>

                      <input
                        value={addDraft.quantity}
                        onChange={(event) =>
                          setAddDraft(
                            (current) => ({
                              ...current,
                              quantity:
                                event.target.value.replace(
                                  /\D/g,
                                  ""
                                ),
                            })
                          )
                        }
                        inputMode="numeric"
                        className="mt-1.5 h-10 w-full rounded-[10px] border border-black/[0.065] bg-white px-3 text-center text-[10px] outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-500/[0.06]"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={addProductLine}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-red-600 px-4 text-[10px] font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.12)] transition hover:-translate-y-0.5 hover:bg-red-700"
                    >
                      <Plus size={10} />
                      Agregar
                    </button>
                  </div>
                </section>
              </div>

              <aside className="space-y-3 xl:sticky xl:top-0 xl:self-start">
                <section className="overflow-hidden rounded-[16px] border border-black/[0.05] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.02)]">
                  <SectionHeader
                    icon={User}
                    title="Cliente"
                  />

                  <div className="grid gap-2.5 p-4">
                    <FieldInput
                      label="Cédula"
                      value={form.customerDocument}
                      onChange={(value) =>
                        updateForm(
                          "customerDocument",
                          normalizeCustomerDocument(
                            value
                          ).slice(0, 15)
                        )
                      }
                      inputMode="numeric"
                      placeholder="Número de documento"
                    />

                    <FieldInput
                      label="Nombre"
                      value={form.customerName}
                      onChange={(value) =>
                        updateForm(
                          "customerName",
                          value
                        )
                      }
                      placeholder="Nombre del cliente"
                    />

                    <FieldInput
                      label="Teléfono"
                      value={form.customerPhone}
                      onChange={(value) =>
                        updateForm(
                          "customerPhone",
                          value.replace(/\D/g, "")
                        )
                      }
                      inputMode="tel"
                      placeholder="Teléfono"
                    />

                    <FieldInput
                      label="Correo"
                      value={form.customerEmail}
                      onChange={(value) =>
                        updateForm(
                          "customerEmail",
                          value
                        )
                      }
                      placeholder="Correo opcional"
                    />
                  </div>
                </section>

                <section className="overflow-hidden rounded-[16px] border border-black/[0.05] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.02)]">
                  <div className="flex items-center justify-between border-b border-black/[0.055] px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <WalletCards
                        size={11}
                        className="text-red-600"
                      />
                      <p className="text-[11px] font-semibold">
                        Formas de pago
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={addPayment}
                      className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-red-100 bg-red-50/70 px-2.5 text-[8px] font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      <Plus size={9} />
                      Medio
                    </button>
                  </div>

                  <div className="p-3">
                    <div className="space-y-1.5">
                      {payments.map((payment) => (
                        <PaymentRow
                          key={payment.localId}
                          payment={payment}
                          canRemove={
                            payments.length > 1
                          }
                          onChange={updatePayment}
                          onRemove={removePayment}
                        />
                      ))}
                    </div>

                    <PaymentStatus
                      remaining={summary.remaining}
                      total={summary.total}
                    />
                  </div>
                </section>

                <section className="rounded-[16px] border border-black/[0.05] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.02)]">
                  <FieldInput
                    label="Descuento"
                    value={form.discount}
                    onChange={(value) =>
                      updateForm(
                        "discount",
                        formatMoneyInput(value)
                      )
                    }
                    inputMode="numeric"
                    placeholder="0"
                    money
                  />

                  <label className="mt-2.5 block">
                    <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
                      Notas
                    </span>

                    <textarea
                      value={form.notes}
                      onChange={(event) =>
                        updateForm(
                          "notes",
                          event.target.value
                        )
                      }
                      rows={2}
                      className="mt-1.5 w-full resize-none rounded-[10px] border border-black/[0.065] bg-[#fbfbfc] px-3 py-2.5 text-[10px] outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-500/[0.06]"
                      placeholder="Observaciones"
                    />
                  </label>
                </section>

                <section className="rounded-[16px] border border-red-100 bg-[#fffafa] p-4 shadow-[0_8px_24px_rgba(15,23,42,0.02)]">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-red-100 bg-white text-red-600">
                      <ReceiptText size={12} />
                    </div>
                    <div>
                      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-red-600">
                        Resumen corregido
                      </p>
                      <p className="mt-0.5 text-[8px] text-black/38">
                        Totales de la venta después de los cambios.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <MoneyRow
                      label="Subtotal"
                      value={summary.subtotal}
                    />

                    <MoneyRow
                      label="Descuento"
                      value={-summary.discount}
                    />
                  </div>

                  <div className="mt-4 flex items-end justify-between border-t border-red-100 pt-4">
                    <span className="text-[9px] font-medium text-black/42">
                      Total corregido
                    </span>

                    <strong className="text-[24px] font-semibold tracking-[-0.045em] text-[#171717]">
                      {formatCurrency(
                        summary.total
                      )}
                    </strong>
                  </div>

                  {summary.cashChange > 0 && (
                    <MoneyRow
                      label="Cambio en efectivo"
                      value={summary.cashChange}
                      className="mt-3"
                    />
                  )}
                </section>
              </aside>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-black/[0.055] bg-white px-4 py-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-10 rounded-[10px] border border-black/[0.065] bg-white px-4 text-[9px] font-medium text-black/55 transition hover:bg-[#fafafa]"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving || !lines.length}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-red-600 px-4 text-[9px] font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.12)] transition hover:-translate-y-0.5 hover:bg-red-700 disabled:translate-y-0 disabled:bg-black/15 disabled:shadow-none"
            >
              <Save size={10} />
              {saving
                ? "Guardando..."
                : "Guardar cambios"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
}) {
  return (
    <div className="flex items-center gap-2 border-b border-black/[0.055] px-3.5 py-2.5">
      <Icon
        size={11}
        className="text-red-600"
      />
      <p className="text-[11px] font-semibold">
        {title}
      </p>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  disabled,
  children,
}) {
  return (
    <label>
      <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        disabled={disabled}
        className="mt-1.5 h-10 w-full rounded-[10px] border border-black/[0.065] bg-white px-3 text-[10px] outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-500/[0.06] disabled:bg-black/[0.025]"
      >
        {children}
      </select>
    </label>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
  money = false,
}) {
  return (
    <label className="block">
      <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/32">
        {label}
      </span>

      <div className="relative mt-1">
        {money && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-black/25">
            $
          </span>
        )}

        <input
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          inputMode={inputMode}
          className={`h-10 w-full rounded-[10px] border border-black/[0.065] bg-[#fbfbfc] pr-3 text-[10px] outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-500/[0.06] ${
            money ? "pl-6" : "pl-2.5"
          }`}
          placeholder={placeholder}
        />
      </div>
    </label>
  );
}

function EditableLine({
  line,
  imageUrl,
  fallbackImageUrl = "",
  canPromotion,
  onQuantity,
  onMode,
  onRemove,
}) {
  return (
    <article className="rounded-[12px] border border-black/[0.05] bg-[#fff] px-3 py-3 transition hover:border-black/[0.08] hover:shadow-[0_6px_18px_rgba(15,23,42,0.025)]">
      <div className="flex gap-2.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-black/[0.04] bg-[#f7f7f8]">
          <StableProductImage
            src={imageUrl}
            fallbackSrc={fallbackImageUrl}
            alt={line.productName}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-[10px] font-semibold">
                  {line.productName || "Producto"}
                </p>

                {line.isPromotion && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[5.8px] font-semibold text-amber-700">
                    PROMO
                  </span>
                )}
              </div>

              <p className="mt-1 text-[8px] text-black/35">
                {line.productCode || "Sin código"} · Talla{" "}
                {line.size} ·{" "}
                {formatCurrency(line.unitPrice)} c/u
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                onRemove(line.localId)
              }
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-black/28 transition hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={10} />
            </button>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-[auto_120px_1fr] sm:items-center">
            <div className="inline-flex w-fit items-center rounded-[8px] border border-black/[0.07] bg-[#fafafa] p-0.5">
              <button
                type="button"
                onClick={() =>
                  onQuantity(
                    line.localId,
                    Math.max(
                      line.quantity - 1,
                      1
                    )
                  )
                }
                disabled={line.quantity <= 1}
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-black/45 disabled:opacity-25"
              >
                <Minus size={9} />
              </button>

              <input
                value={line.quantity}
                onChange={(event) =>
                  onQuantity(
                    line.localId,
                    event.target.value
                  )
                }
                inputMode="numeric"
                className="h-6 w-9 bg-transparent text-center text-[9px] font-medium outline-none"
              />

              <button
                type="button"
                onClick={() =>
                  onQuantity(
                    line.localId,
                    line.quantity + 1
                  )
                }
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-black/45"
              >
                <Plus size={9} />
              </button>
            </div>

            <select
              value={
                line.isPromotion
                  ? "promotion"
                  : "normal"
              }
              onChange={(event) =>
                onMode(
                  line.localId,
                  event.target.value
                )
              }
              className="h-8 rounded-[9px] border border-black/[0.065] bg-white px-2.5 text-[8px] outline-none transition focus:border-red-300"
            >
              <option value="normal">
                Normal
              </option>
              <option
                value="promotion"
                disabled={!canPromotion}
              >
                Promoción
              </option>
            </select>

            <p className="text-right text-[9.5px] font-semibold">
              {formatCurrency(
                line.unitPrice *
                  line.quantity
              )}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function PaymentRow({
  payment,
  canRemove,
  onChange,
  onRemove,
}) {
  return (
    <div className="rounded-[11px] border border-black/[0.045] bg-[#fbfbfc] p-2.5">
      <div className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
        <select
          value={payment.method}
          onChange={(event) =>
            onChange(
              payment.localId,
              "method",
              event.target.value
            )
          }
          className="h-9 rounded-[9px] border border-black/[0.065] bg-white px-2.5 text-[8px] outline-none transition focus:border-red-300"
        >
          {PAYMENT_OPTIONS.map(
            ([value, label]) => (
              <option
                key={value}
                value={value}
              >
                {label}
              </option>
            )
          )}
        </select>

        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] text-black/23">
            $
          </span>

          <input
            value={payment.amount}
            onChange={(event) =>
              onChange(
                payment.localId,
                "amount",
                formatMoneyInput(
                  event.target.value
                )
              )
            }
            inputMode="numeric"
            className="h-9 w-full rounded-[9px] border border-black/[0.065] bg-white pl-6 pr-2.5 text-[9px] outline-none transition focus:border-red-300"
            placeholder="Valor"
          />
        </div>

        <button
          type="button"
          onClick={() =>
            onRemove(payment.localId)
          }
          disabled={!canRemove}
          className="flex h-9 w-9 items-center justify-center rounded-[9px] text-black/28 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-15"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {payment.method === "efectivo" && (
        <label className="mt-1.5 block">
          <span className="text-[6px] font-semibold uppercase tracking-[0.08em] text-black/24">
            Efectivo recibido
          </span>

          <div className="relative mt-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] text-black/23">
              $
            </span>

            <input
              value={payment.receivedAmount}
              onChange={(event) =>
                onChange(
                  payment.localId,
                  "receivedAmount",
                  formatMoneyInput(
                    event.target.value
                  )
                )
              }
              inputMode="numeric"
              className="h-9 w-full rounded-[9px] border border-black/[0.065] bg-white pl-6 pr-2.5 text-[9px] outline-none transition focus:border-red-300"
              placeholder="Dinero entregado"
            />
          </div>
        </label>
      )}
    </div>
  );
}

function PaymentStatus({
  remaining,
  total,
}) {
  const balanced =
    Math.abs(remaining) < 0.001;

  return (
    <div
      className={`mt-2.5 rounded-[10px] px-2.5 py-2 ${
        balanced
          ? "bg-emerald-50"
          : "bg-amber-50"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p
            className={`text-[6.5px] font-semibold uppercase tracking-[0.08em] ${
              balanced
                ? "text-emerald-700"
                : "text-amber-700"
            }`}
          >
            {balanced
              ? "Pago cuadrado"
              : remaining > 0
                ? "Falta asignar"
                : "Pago excedido"}
          </p>

          <p
            className={`mt-0.5 text-[6.5px] ${
              balanced
                ? "text-emerald-700/65"
                : "text-amber-800/65"
            }`}
          >
            Venta: {formatCurrency(total)}
          </p>
        </div>

        <strong
          className={`text-[9px] ${
            balanced
              ? "text-emerald-700"
              : "text-amber-800"
          }`}
        >
          {formatCurrency(
            Math.abs(remaining)
          )}
        </strong>
      </div>
    </div>
  );
}

function MoneyRow({
  label,
  value,
  className = "",
  dark = false,
}) {
  const amount = Number(value || 0);

  return (
    <div
      className={`flex items-center justify-between gap-4 text-[8px] ${className}`}
    >
      <span
        className={
          dark
            ? "text-white/42"
            : "text-black/42"
        }
      >
        {label}
      </span>

      <span
        className={
          amount < 0
            ? dark
              ? "text-red-300"
              : "text-red-600"
            : dark
              ? "text-white/82"
              : "text-black/70"
        }
      >
        {amount < 0 ? "- " : ""}
        {formatCurrency(
          Math.abs(amount)
        )}
      </span>
    </div>
  );
}
