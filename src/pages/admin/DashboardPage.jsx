import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Boxes,
  CalendarDays,
  Package,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserCheck,
} from "lucide-react";

import { STORE_ID } from "../../services/categories.service";
import { subscribeProducts } from "../../services/products.service";
import { subscribeSales } from "../../services/sales.service";
import { formatCurrency } from "../../utils/money";

function toDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getDefaultMonthKeys() {
  const now = new Date();
  const currentMonth = getMonthKey(now);

  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonth = getMonthKey(previous);

  return {
    previousMonth,
    currentMonth,
  };
}

function formatMonthLabel(monthKey) {
  if (!monthKey) return "Sin mes";

  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);

  return new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDateShort(value) {
  const date = toDate(value);

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function filterSalesByMonth(sales, monthKey) {
  return sales.filter((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return false;

    return getMonthKey(date) === monthKey;
  });
}

function calculateMetrics(sales) {
  return sales.reduce(
    (acc, sale) => {
      const quantity = Number(sale.quantity || 0);
      const total = Number(sale.total || 0);
      const totalCost =
        Number(sale.totalCost || 0) ||
        Number(sale.costPrice || 0) * quantity;
      const profit =
        Number(sale.profit || 0) ||
        total - totalCost;

      acc.salesCount += 1;
      acc.units += quantity;
      acc.revenue += total;
      acc.cost += totalCost;
      acc.profit += profit;

      return acc;
    },
    {
      salesCount: 0,
      units: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      margin: 0,
      averageTicket: 0,
    }
  );
}

function finalizeMetrics(metrics) {
  const margin =
    metrics.revenue > 0 ? (metrics.profit / metrics.revenue) * 100 : 0;

  const averageTicket =
    metrics.salesCount > 0 ? metrics.revenue / metrics.salesCount : 0;

  return {
    ...metrics,
    margin,
    averageTicket,
  };
}

function getPercentChange(previous, current) {
  const cleanPrevious = Number(previous || 0);
  const cleanCurrent = Number(current || 0);

  if (cleanPrevious === 0 && cleanCurrent === 0) return 0;
  if (cleanPrevious === 0 && cleanCurrent > 0) return 100;

  return ((cleanCurrent - cleanPrevious) / Math.abs(cleanPrevious)) * 100;
}

function buildRanking(sales, getKey, getLabel) {
  const map = new Map();

  sales.forEach((sale) => {
    const key = getKey(sale);
    const label = getLabel(sale);
    const quantity = Number(sale.quantity || 0);
    const revenue = Number(sale.total || 0);
    const cost =
      Number(sale.totalCost || 0) ||
      Number(sale.costPrice || 0) * quantity;
    const profit =
      Number(sale.profit || 0) ||
      revenue - cost;

    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        salesCount: 0,
        units: 0,
        revenue: 0,
        profit: 0,
      });
    }

    const item = map.get(key);

    item.salesCount += 1;
    item.units += quantity;
    item.revenue += revenue;
    item.profit += profit;
  });

  return Array.from(map.values()).sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return b.units - a.units;
  });
}

function buildDailySales(sales) {
  const map = new Map();

  sales.forEach((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return;

    const key = date.toISOString().slice(0, 10);
    const total = Number(sale.total || 0);
    const quantity = Number(sale.quantity || 0);

    if (!map.has(key)) {
      map.set(key, {
        key,
        date,
        label: formatDateShort(date),
        total: 0,
        units: 0,
      });
    }

    const item = map.get(key);

    item.total += total;
    item.units += quantity;
  });

  return Array.from(map.values()).sort((a, b) => a.date - b.date);
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  previousValue,
  currentValue,
  currency = false,
  dark = false,
}) {
  const change = getPercentChange(previousValue, currentValue);
  const isPositive = change >= 0;

  return (
    <article
      className={`rounded-3xl p-5 shadow-sm ring-1 ${
        dark
          ? "bg-brand-black text-white ring-black/5"
          : "bg-white text-brand-black ring-black/5"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-sm ${dark ? "text-white/60" : "text-gray-500"}`}>
            {title}
          </p>

          <p className="mt-2 text-2xl font-semibold">
            {currency ? formatCurrency(value) : value}
          </p>

          {subtitle && (
            <p
              className={`mt-1 text-xs ${
                dark ? "text-white/50" : "text-gray-500"
              }`}
            >
              {subtitle}
            </p>
          )}
        </div>

        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
            dark ? "bg-white/10" : "bg-brand-cream"
          }`}
        >
          <Icon size={22} />
        </div>
      </div>

      <div
        className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
          isPositive
            ? dark
              ? "bg-green-400/15 text-green-200"
              : "bg-green-100 text-green-700"
            : dark
              ? "bg-red-400/15 text-red-200"
              : "bg-red-100 text-red-700"
        }`}
      >
        {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        {Math.abs(change).toFixed(1)}% vs mes comparado
      </div>
    </article>
  );
}

function RankingList({ title, subtitle, items, valueType = "revenue" }) {
  const maxValue = Math.max(
    ...items.map((item) => Number(item[valueType] || 0)),
    1
  );

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-brand-black">{title}</h2>

          {subtitle && (
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          )}
        </div>

        <Trophy size={22} className="text-brand-gold" />
      </div>

      <div className="mt-5 space-y-4">
        {items.length === 0 ? (
          <p className="rounded-2xl bg-brand-cream p-4 text-center text-sm text-gray-500">
            Sin datos para este mes.
          </p>
        ) : (
          items.slice(0, 6).map((item, index) => {
            const value = Number(item[valueType] || 0);
            const width = Math.max((value / maxValue) * 100, 7);

            return (
              <article key={item.key}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-brand-black">
                      {index + 1}. {item.label}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      {item.units} unidad(es) · {item.salesCount} venta(s)
                    </p>
                  </div>

                  <p className="text-sm font-semibold text-brand-black">
                    {formatCurrency(value)}
                  </p>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-cream">
                  <div
                    className="h-full rounded-full bg-brand-black"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const defaults = useMemo(() => getDefaultMonthKeys(), []);

  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);

  const [monthA, setMonthA] = useState(defaults.previousMonth);
  const [monthB, setMonthB] = useState(defaults.currentMonth);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    const unsubscribeSales = subscribeSales(
      (salesData) => {
        setSales(salesData);
        setLoading(false);
      },
      () => {
        setLoading(false);
        alert("No se pudieron escuchar las ventas en tiempo real.");
      },
      STORE_ID
    );

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
      },
      () => {
        alert("No se pudo escuchar el inventario en tiempo real.");
      },
      STORE_ID
    );

    return () => {
      unsubscribeSales();
      unsubscribeProducts();
    };
  }, []);

  const monthASales = useMemo(() => {
    return filterSalesByMonth(sales, monthA);
  }, [sales, monthA]);

  const monthBSales = useMemo(() => {
    return filterSalesByMonth(sales, monthB);
  }, [sales, monthB]);

  const monthAMetrics = useMemo(() => {
    return finalizeMetrics(calculateMetrics(monthASales));
  }, [monthASales]);

  const monthBMetrics = useMemo(() => {
    return finalizeMetrics(calculateMetrics(monthBSales));
  }, [monthBSales]);

  const productRanking = useMemo(() => {
    return buildRanking(
      monthBSales,
      (sale) => sale.productId || sale.productName || "sin-producto",
      (sale) => sale.productName || "Producto sin nombre"
    );
  }, [monthBSales]);

  const sellerRanking = useMemo(() => {
    return buildRanking(
      monthBSales,
      (sale) =>
        sale.sellerUid ||
        sale.sellerEmail ||
        sale.sellerName ||
        "sin-vendedor",
      (sale) => sale.sellerName || sale.sellerEmail || "Sin vendedor"
    );
  }, [monthBSales]);

  const categoryRanking = useMemo(() => {
    return buildRanking(
      monthBSales,
      (sale) => sale.categoryId || sale.categoryName || "sin-categoria",
      (sale) => sale.categoryName || "Sin categoría"
    );
  }, [monthBSales]);

  const sizeRanking = useMemo(() => {
    return buildRanking(
      monthBSales,
      (sale) => sale.productSize || "Talla única",
      (sale) => sale.productSize || "Talla única"
    );
  }, [monthBSales]);

  const dailySales = useMemo(() => {
    return buildDailySales(monthBSales);
  }, [monthBSales]);

  const inventoryMetrics = useMemo(() => {
    return products.reduce(
      (acc, product) => {
        const stock = Number(product.stock || 0);
        const costPrice = Number(product.costPrice || 0);
        const salePrice = Number(product.salePrice || 0);

        acc.products += 1;
        acc.units += stock;
        acc.cost += costPrice * stock;
        acc.potentialRevenue += salePrice * stock;
        acc.potentialProfit += (salePrice - costPrice) * stock;

        return acc;
      },
      {
        products: 0,
        units: 0,
        cost: 0,
        potentialRevenue: 0,
        potentialProfit: 0,
      }
    );
  }, [products]);

  const bestProduct = productRanking[0];
  const bestSeller = sellerRanking[0];
  const bestSize = sizeRanking[0];

  const maxDailyTotal = Math.max(
    ...dailySales.map((item) => Number(item.total || 0)),
    1
  );

  return (
    <main className="min-h-screen bg-brand-cream px-4 py-6 sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-black/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-gold">Master Caps</p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-brand-black">
              Dashboard
            </h1>

            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Analiza ventas, inversión, utilidad, productos más vendidos,
              vendedores destacados, tallas con mayor rotación y comparación
              entre meses.
            </p>
          </div>

          <div className="grid gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 sm:grid-cols-2">
            <label>
              <span className="text-xs font-medium text-gray-500">
                Mes comparado
              </span>

              <input
                type="month"
                value={monthA}
                onChange={(event) => setMonthA(event.target.value)}
                className="mt-2 h-11 rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
              />
            </label>

            <label>
              <span className="text-xs font-medium text-gray-500">
                Mes principal
              </span>

              <input
                type="month"
                value={monthB}
                onChange={(event) => setMonthB(event.target.value)}
                className="mt-2 h-11 rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
              />
            </label>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 rounded-3xl bg-white p-10 text-center text-sm text-gray-500">
            Cargando analíticas en tiempo real...
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-3xl bg-brand-black p-6 text-white shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-sm text-white/60">
                    Comparación de meses
                  </p>

                  <h2 className="mt-1 text-2xl font-semibold">
                    {formatMonthLabel(monthA)} vs {formatMonthLabel(monthB)}
                  </h2>
                </div>

                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
                  Mes principal: <strong>{formatMonthLabel(monthB)}</strong>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl bg-white/10 p-5">
                  <p className="text-sm text-white/60">
                    {formatMonthLabel(monthA)}
                  </p>

                  <p className="mt-2 text-3xl font-semibold">
                    {formatCurrency(monthAMetrics.revenue)}
                  </p>

                  <p className="mt-2 text-sm text-white/60">
                    {monthAMetrics.salesCount} venta(s) ·{" "}
                    {monthAMetrics.units} unidad(es)
                  </p>
                </div>

                <div className="rounded-3xl bg-white p-5 text-brand-black">
                  <p className="text-sm text-gray-500">
                    {formatMonthLabel(monthB)}
                  </p>

                  <p className="mt-2 text-3xl font-semibold">
                    {formatCurrency(monthBMetrics.revenue)}
                  </p>

                  <p className="mt-2 text-sm text-gray-500">
                    {monthBMetrics.salesCount} venta(s) ·{" "}
                    {monthBMetrics.units} unidad(es)
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Total vendido"
                value={monthBMetrics.revenue}
                previousValue={monthAMetrics.revenue}
                currentValue={monthBMetrics.revenue}
                subtitle={formatMonthLabel(monthB)}
                icon={BadgeDollarSign}
                currency
                dark
              />

              <MetricCard
                title="Ganancia"
                value={monthBMetrics.profit}
                previousValue={monthAMetrics.profit}
                currentValue={monthBMetrics.profit}
                subtitle={`Margen: ${monthBMetrics.margin.toFixed(1)}%`}
                icon={TrendingUp}
                currency
              />

              <MetricCard
                title="Inversión / costo"
                value={monthBMetrics.cost}
                previousValue={monthAMetrics.cost}
                currentValue={monthBMetrics.cost}
                subtitle="Costo de productos vendidos"
                icon={Boxes}
                currency
              />

              <MetricCard
                title="Unidades vendidas"
                value={monthBMetrics.units}
                previousValue={monthAMetrics.units}
                currentValue={monthBMetrics.units}
                subtitle={`${monthBMetrics.salesCount} venta(s) registradas`}
                icon={ShoppingBag}
              />
            </section>

            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500">
                      Producto más vendido
                    </p>

                    <p className="mt-2 text-xl font-semibold text-brand-black">
                      {bestProduct?.label || "Sin datos"}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      {bestProduct
                        ? `${bestProduct.units} unidad(es) · ${formatCurrency(
                            bestProduct.revenue
                          )}`
                        : "No hay ventas en este mes"}
                    </p>
                  </div>

                  <Package size={22} className="text-brand-black" />
                </div>
              </article>

              <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Mejor vendedor</p>

                    <p className="mt-2 text-xl font-semibold text-brand-black">
                      {bestSeller?.label || "Sin datos"}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      {bestSeller
                        ? `${bestSeller.salesCount} venta(s) · ${formatCurrency(
                            bestSeller.revenue
                          )}`
                        : "No hay ventas en este mes"}
                    </p>
                  </div>

                  <UserCheck size={22} className="text-brand-black" />
                </div>
              </article>

              <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Talla más vendida</p>

                    <p className="mt-2 text-xl font-semibold text-brand-black">
                      {bestSize?.label || "Sin datos"}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      {bestSize
                        ? `${bestSize.units} unidad(es) · ${formatCurrency(
                            bestSize.revenue
                          )}`
                        : "No hay ventas en este mes"}
                    </p>
                  </div>

                  <Package size={22} className="text-brand-black" />
                </div>
              </article>

              <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Ticket promedio</p>

                    <p className="mt-2 text-xl font-semibold text-brand-black">
                      {formatCurrency(monthBMetrics.averageTicket)}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      Promedio por venta
                    </p>
                  </div>

                  <CalendarDays size={22} className="text-brand-black" />
                </div>
              </article>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-black">
                      Ventas por día
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      Movimiento diario de {formatMonthLabel(monthB)}.
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  {dailySales.length === 0 ? (
                    <p className="rounded-2xl bg-brand-cream p-4 text-center text-sm text-gray-500">
                      No hay ventas registradas en este mes.
                    </p>
                  ) : (
                    dailySales.map((item) => {
                      const width = Math.max(
                        (item.total / maxDailyTotal) * 100,
                        7
                      );

                      return (
                        <article key={item.key}>
                          <div className="mb-2 flex items-center justify-between gap-4">
                            <p className="text-sm font-medium text-brand-black">
                              {item.label}
                            </p>

                            <p className="text-sm font-semibold text-brand-black">
                              {formatCurrency(item.total)}
                            </p>
                          </div>

                          <div className="h-3 overflow-hidden rounded-full bg-brand-cream">
                            <div
                              className="h-full rounded-full bg-brand-black"
                              style={{ width: `${width}%` }}
                            />
                          </div>

                          <p className="mt-1 text-xs text-gray-500">
                            {item.units} unidad(es)
                          </p>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <h2 className="text-lg font-semibold text-brand-black">
                  Inventario actual
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  Valor estimado del stock disponible.
                </p>

                <div className="mt-5 space-y-3">
                  <div className="rounded-3xl bg-brand-cream p-4">
                    <p className="text-xs text-gray-500">
                      Productos registrados
                    </p>

                    <p className="mt-1 text-2xl font-semibold text-brand-black">
                      {inventoryMetrics.products}
                    </p>
                  </div>

                  <div className="rounded-3xl bg-brand-cream p-4">
                    <p className="text-xs text-gray-500">
                      Inversión en stock
                    </p>

                    <p className="mt-1 text-2xl font-semibold text-brand-black">
                      {formatCurrency(inventoryMetrics.cost)}
                    </p>
                  </div>

                  <div className="rounded-3xl bg-black p-4 text-white">
                    <p className="text-xs text-white/60">
                      Ganancia potencial
                    </p>

                    <p className="mt-1 text-2xl font-semibold">
                      {formatCurrency(inventoryMetrics.potentialProfit)}
                    </p>

                    <p className="mt-1 text-xs text-white/50">
                      Si se vende todo el stock actual.
                    </p>
                  </div>
                </div>
              </section>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-4">
              <RankingList
                title="Productos más vendidos"
                subtitle={`Ranking de ${formatMonthLabel(monthB)}`}
                items={productRanking}
                valueType="revenue"
              />

              <RankingList
                title="Vendedores con más ventas"
                subtitle="Según ventas registradas por usuario"
                items={sellerRanking}
                valueType="revenue"
              />

              <RankingList
                title="Categorías más vendidas"
                subtitle="Ingreso por categoría"
                items={categoryRanking}
                valueType="revenue"
              />

              <RankingList
                title="Tallas más vendidas"
                subtitle="Rotación por talla"
                items={sizeRanking}
                valueType="revenue"
              />
            </section>
          </>
        )}
      </section>
    </main>
  );
}