import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  Boxes,
  CalendarDays,
  CircleDollarSign,
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
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  return {
    previousMonth: getMonthKey(previous),
    currentMonth: getMonthKey(now),
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
        Number(sale.totalCost || 0) || Number(sale.costPrice || 0) * quantity;
      const profit = Number(sale.profit || 0) || total - totalCost;

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
      Number(sale.totalCost || 0) || Number(sale.costPrice || 0) * quantity;
    const profit = Number(sale.profit || 0) || revenue - cost;

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
        day: date.getDate(),
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

function buildInventoryAlerts(products, productRanking) {
  const rankingMap = new Map();

  productRanking.forEach((item) => {
    rankingMap.set(item.key, item);
  });

  const alerts = [];

  products.forEach((product) => {
    const stock = Number(product.stock || 0);
    const key = product.id || product.productId || product.name;
    const name = product.name || product.productName || "Producto sin nombre";
    const ranking = rankingMap.get(key);
    const soldUnits = Number(ranking?.units || 0);

    if (stock <= 0) {
      alerts.push({
        key,
        level: "critical",
        title: name,
        message: "Producto agotado",
        action: "Reponer",
      });
      return;
    }

    if (stock <= 3) {
      alerts.push({
        key,
        level: "warning",
        title: name,
        message: `Stock bajo · quedan ${stock}`,
        action: "Reponer",
      });
      return;
    }

    if (soldUnits >= 5 && stock <= 8) {
      alerts.push({
        key,
        level: "success",
        title: name,
        message: "Alta rotación · revisar compra",
        action: "Comprar",
      });
      return;
    }

    if (stock >= 20 && soldUnits === 0) {
      alerts.push({
        key,
        level: "neutral",
        title: name,
        message: `Stock alto · ${stock} sin rotación`,
        action: "Promocionar",
      });
    }
  });

  return alerts.slice(0, 4);
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  previousValue,
  currentValue,
  currency = false,
  color = "red",
}) {
  const change = getPercentChange(previousValue, currentValue);
  const isPositive = change >= 0;

  const colors = {
    red: "bg-red-50 text-red-600",
    orange: "bg-orange-50 text-orange-500",
    purple: "bg-violet-50 text-violet-600",
    green: "bg-emerald-50 text-emerald-600",
  };

  return (
    <article className="rounded-[28px] bg-white p-5 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
            colors[color] || colors.red
          }`}
        >
          <Icon size={24} strokeWidth={1.8} />
        </div>

        <div className="min-w-0">
          <p className="text-[13px] font-normal text-black/52">{title}</p>

          <p className="mt-1 truncate text-[24px] font-medium tracking-[-0.04em] text-black">
            {currency ? formatCurrency(value) : value}
          </p>

          <div className="mt-2 flex items-center gap-1.5 text-[12px]">
            <span
              className={`inline-flex items-center gap-1 font-normal ${
                isPositive ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {isPositive ? (
                <TrendingUp size={13} />
              ) : (
                <TrendingDown size={13} />
              )}
              {Math.abs(change).toFixed(1)}%
            </span>

            <span className="text-black/42">{subtitle}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function LineChart({ previousDailySales, currentDailySales }) {
  const maxValue = Math.max(
    ...previousDailySales.map((item) => Number(item.total || 0)),
    ...currentDailySales.map((item) => Number(item.total || 0)),
    1
  );

  function buildPoints(items) {
    if (items.length === 0) return "";

    const limited = items.slice(-30);
    const maxIndex = Math.max(limited.length - 1, 1);

    return limited
      .map((item, index) => {
        const x = (index / maxIndex) * 100;
        const y = 100 - (Number(item.total || 0) / maxValue) * 82 - 8;
        return `${x},${y}`;
      })
      .join(" ");
  }

  const currentPoints = buildPoints(currentDailySales);
  const previousPoints = buildPoints(previousDailySales);

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06] xl:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[17px] font-medium tracking-[-0.02em] text-black">
            Resumen de ventas
          </h2>

          <div className="mt-3 flex items-center gap-4 text-[12px] text-black/50">
            <span className="flex items-center gap-2">
              <span className="h-2 w-4 rounded-full bg-red-600" />
              Mes principal
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-4 rounded-full bg-black/20" />
              Mes comparado
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 h-[285px]">
        {currentDailySales.length === 0 && previousDailySales.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl bg-black/[0.025] text-[13px] text-black/45">
            No hay datos para graficar.
          </div>
        ) : (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
            {[20, 40, 60, 80].map((y) => (
              <line
                key={y}
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke="rgba(0,0,0,.08)"
                strokeWidth=".35"
              />
            ))}

            {previousPoints && (
              <polyline
                fill="none"
                points={previousPoints}
                stroke="rgba(0,0,0,.28)"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
            )}

            {currentPoints && (
              <>
                <polyline
                  fill="none"
                  points={currentPoints}
                  stroke="#dc2626"
                  strokeWidth="1.35"
                />
                <polyline
                  fill="rgba(220,38,38,.08)"
                  points={`0,100 ${currentPoints} 100,100`}
                  stroke="none"
                />
              </>
            )}
          </svg>
        )}
      </div>
    </section>
  );
}

function CategoryChart({ items }) {
  const colors = ["#dc2626", "#fb923c", "#8b5cf6", "#10b981", "#d4d4d8"];
  const total = items.reduce((acc, item) => acc + Number(item.revenue || 0), 0);

  let current = 0;

  const gradient =
    total > 0
      ? items
          .slice(0, 5)
          .map((item, index) => {
            const value = Number(item.revenue || 0);
            const percent = (value / total) * 100;
            const start = current;
            const end = current + percent;
            current = end;
            return `${colors[index]} ${start}% ${end}%`;
          })
          .join(", ")
      : "#f3f4f6 0% 100%";

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <h2 className="text-[17px] font-medium tracking-[-0.02em] text-black">
        Ventas por categoría
      </h2>

      <div className="mt-6 grid items-center gap-5 sm:grid-cols-[180px_1fr] xl:grid-cols-1 2xl:grid-cols-[180px_1fr]">
        <div className="mx-auto flex h-[180px] w-[180px] items-center justify-center rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="h-[88px] w-[88px] rounded-full bg-white" />
        </div>

        <div className="space-y-3">
          {items.length === 0 ? (
            <p className="rounded-2xl bg-black/[0.025] p-4 text-center text-[13px] text-black/45">
              Sin categorías vendidas.
            </p>
          ) : (
            items.slice(0, 5).map((item, index) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-3 text-[13px]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colors[index] }}
                  />
                  <span className="truncate text-black/72">{item.label}</span>
                </div>
                <span className="shrink-0 font-normal text-black">
                  {formatCurrency(item.revenue)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ProductRanking({ items }) {
  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-medium tracking-[-0.02em] text-black">
          Productos más vendidos
        </h2>
        <Trophy size={18} className="text-red-600" />
      </div>

      <div className="mt-5 space-y-4">
        {items.length === 0 ? (
          <p className="rounded-2xl bg-black/[0.025] p-4 text-center text-[13px] text-black/45">
            Sin productos vendidos.
          </p>
        ) : (
          items.slice(0, 3).map((item, index) => (
            <article
              key={item.key}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 text-[12px] text-red-600">
                  {index + 1}
                </span>

                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035]">
                  <Package size={18} className="text-black/55" />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-black">
                    {item.label}
                  </p>
                  <p className="text-[12px] text-black/45">
                    {item.units} unidades vendidas
                  </p>
                </div>
              </div>

              <p className="shrink-0 text-[13px] font-medium text-black">
                {formatCurrency(item.revenue)}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function DailyBarChart({ dailySales, maxDailyTotal }) {
  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <h2 className="text-[17px] font-medium tracking-[-0.02em] text-black">
        Ventas por día
      </h2>

      <div className="mt-6 flex h-[205px] items-end gap-3 overflow-x-auto pb-1">
        {dailySales.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center rounded-2xl bg-black/[0.025] text-[13px] text-black/45">
            No hay ventas registradas.
          </div>
        ) : (
          dailySales.slice(-8).map((item) => {
            const height = Math.max((item.total / maxDailyTotal) * 100, 10);

            return (
              <div
                key={item.key}
                className="flex min-w-[34px] flex-1 flex-col items-center justify-end gap-2"
              >
                <div className="flex h-[155px] w-full items-end justify-center rounded-full bg-black/[0.025] px-1">
                  <div
                    className="w-full rounded-full bg-gradient-to-t from-red-600 to-red-300"
                    style={{ height: `${height}%` }}
                    title={`${item.label}: ${formatCurrency(item.total)}`}
                  />
                </div>
                <p className="text-[11px] text-black/45">{item.day}</p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function InventoryAlerts({ alerts }) {
  const styles = {
    critical: "bg-red-50 text-red-600",
    warning: "bg-orange-50 text-orange-600",
    success: "bg-emerald-50 text-emerald-600",
    neutral: "bg-violet-50 text-violet-600",
  };

  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-medium tracking-[-0.02em] text-black">
          Alertas de inventario
        </h2>
        <AlertTriangle size={18} className="text-red-600" />
      </div>

      <div className="mt-5 space-y-3">
        {alerts.length === 0 ? (
          <p className="rounded-2xl bg-black/[0.025] p-4 text-center text-[13px] text-black/45">
            No hay alertas críticas.
          </p>
        ) : (
          alerts.map((alert) => (
            <article
              key={`${alert.key}-${alert.message}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-black/[0.05] px-3 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                    styles[alert.level] || styles.neutral
                  }`}
                >
                  <AlertTriangle size={17} />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-black">
                    {alert.title}
                  </p>
                  <p className="truncate text-[12px] text-black/45">
                    {alert.message}
                  </p>
                </div>
              </div>

              <span
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] ${
                  styles[alert.level] || styles.neutral
                }`}
              >
                {alert.action}
              </span>
            </article>
          ))
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

  const monthASales = useMemo(() => filterSalesByMonth(sales, monthA), [
    sales,
    monthA,
  ]);

  const monthBSales = useMemo(() => filterSalesByMonth(sales, monthB), [
    sales,
    monthB,
  ]);

  const monthAMetrics = useMemo(
    () => finalizeMetrics(calculateMetrics(monthASales)),
    [monthASales]
  );

  const monthBMetrics = useMemo(
    () => finalizeMetrics(calculateMetrics(monthBSales)),
    [monthBSales]
  );

  const productRanking = useMemo(() => {
    return buildRanking(
      monthBSales,
      (sale) => sale.productId || sale.productName || "sin-producto",
      (sale) => sale.productName || "Producto sin nombre"
    );
  }, [monthBSales]);

  const categoryRanking = useMemo(() => {
    return buildRanking(
      monthBSales,
      (sale) => sale.categoryId || sale.categoryName || "sin-categoria",
      (sale) => sale.categoryName || "Sin categoría"
    );
  }, [monthBSales]);

  const previousDailySales = useMemo(() => buildDailySales(monthASales), [
    monthASales,
  ]);

  const currentDailySales = useMemo(() => buildDailySales(monthBSales), [
    monthBSales,
  ]);

  const inventoryAlerts = useMemo(
    () => buildInventoryAlerts(products, productRanking),
    [products, productRanking]
  );

  const maxDailyTotal = Math.max(
    ...currentDailySales.map((item) => Number(item.total || 0)),
    1
  );

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-4 py-5 sm:px-6 lg:px-7">
      <section className="mx-auto max-w-[1500px]">
        <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-[30px] font-medium tracking-[-0.045em] text-black">
              Dashboard
            </h1>
            <p className="mt-1 text-[14px] text-black/50">
              Resumen real de ventas, productos, categorías e inventario.
            </p>
          </div>

          <div className="grid gap-3 rounded-[22px] bg-white p-3 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06] sm:grid-cols-2">
            <input
              type="month"
              value={monthA}
              onChange={(event) => setMonthA(event.target.value)}
              className="h-10 rounded-2xl border border-black/[0.08] px-4 text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            />

            <input
              type="month"
              value={monthB}
              onChange={(event) => setMonthB(event.target.value)}
              className="h-10 rounded-2xl border border-black/[0.08] px-4 text-[13px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            />
          </div>
        </section>

        {loading ? (
          <div className="mt-5 rounded-[28px] bg-white p-10 text-center text-[14px] text-black/45 shadow-[0_18px_55px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
            Cargando analíticas en tiempo real...
          </div>
        ) : (
          <>
            <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Total vendido"
                value={monthBMetrics.revenue}
                previousValue={monthAMetrics.revenue}
                currentValue={monthBMetrics.revenue}
                subtitle="vs mes comparado"
                icon={BadgeDollarSign}
                currency
                color="red"
              />

              <MetricCard
                title="Ventas"
                value={`${monthBMetrics.salesCount} ventas`}
                previousValue={monthAMetrics.salesCount}
                currentValue={monthBMetrics.salesCount}
                subtitle="vs mes comparado"
                icon={ShoppingBag}
                color="orange"
              />

              <MetricCard
                title="Unidades vendidas"
                value={`${monthBMetrics.units} unidades`}
                previousValue={monthAMetrics.units}
                currentValue={monthBMetrics.units}
                subtitle="vs mes comparado"
                icon={Boxes}
                color="purple"
              />

              <MetricCard
                title="Utilidad"
                value={monthBMetrics.profit}
                previousValue={monthAMetrics.profit}
                currentValue={monthBMetrics.profit}
                subtitle={`Margen ${monthBMetrics.margin.toFixed(1)}%`}
                icon={CircleDollarSign}
                currency
                color="green"
              />
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_0.9fr]">
              <LineChart
                previousDailySales={previousDailySales}
                currentDailySales={currentDailySales}
              />

              <CategoryChart items={categoryRanking} />
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-3">
              <ProductRanking items={productRanking} />

              <DailyBarChart
                dailySales={currentDailySales}
                maxDailyTotal={maxDailyTotal}
              />

              <InventoryAlerts alerts={inventoryAlerts} />
            </section>
          </>
        )}
      </section>
    </main>
  );
}