import { useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import {
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  Package,
  PieChart,
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

const BRAND_RED = "#c1121f";

const CHART_COLORS = [
  "#c1121f",
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#ea580c",
  "#059669",
  "#64748b",
];

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
    currentDay: String(now.getDate()),
  };
}

function getDaysInMonth(monthKey) {
  if (!monthKey) return 31;

  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) return 31;

  return new Date(year, month, 0).getDate();
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

function formatDayLabel(monthKey, day) {
  if (!monthKey || !day) return "Sin día";

  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1, Number(day));

  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "2-digit",
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

function formatCompactCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function filterSalesByMonth(sales, monthKey) {
  return sales.filter((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return false;

    return getMonthKey(date) === monthKey;
  });
}

function filterSalesByDay(sales, monthKey, day) {
  return sales.filter((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return false;

    return getMonthKey(date) === monthKey && date.getDate() === Number(day);
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
      Number(sale.totalCost || 0) ||
      Number(sale.costPrice || 0) * quantity;
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

function buildDayComparison(salesA, salesB) {
  const mapA = new Map();
  const mapB = new Map();

  salesA.forEach((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return;

    const day = date.getDate();
    mapA.set(day, Number(mapA.get(day) || 0) + Number(sale.total || 0));
  });

  salesB.forEach((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return;

    const day = date.getDate();
    mapB.set(day, Number(mapB.get(day) || 0) + Number(sale.total || 0));
  });

  const days = Array.from({ length: 31 }, (_, index) => index + 1);

  return {
    categories: days.map((day) => String(day)),
    dataA: days.map((day) => Number(mapA.get(day) || 0)),
    dataB: days.map((day) => Number(mapB.get(day) || 0)),
  };
}

function buildInventoryAlerts(products, productRanking) {
  const rankingMap = new Map();

  productRanking.forEach((item) => {
    rankingMap.set(item.key, item);
  });

  const alerts = [];

  products.forEach((product) => {
    const stock = Number(product.stock || 0);
    const key = product.id || product.name;
    const name = product.name || "Producto sin nombre";
    const ranking = rankingMap.get(key);
    const soldUnits = Number(ranking?.units || 0);

    if (stock <= 0) {
      alerts.push({
        key,
        level: "critical",
        title: name,
        message: "Producto agotado",
        color: "#c1121f",
      });
      return;
    }

    if (stock <= 3) {
      alerts.push({
        key,
        level: "warning",
        title: name,
        message: `Stock bajo · quedan ${stock}`,
        color: "#f59e0b",
      });
      return;
    }

    if (soldUnits >= 5 && stock <= 8) {
      alerts.push({
        key,
        level: "success",
        title: name,
        message: "Alta rotación · revisar compra",
        color: "#16a34a",
      });
    }
  });

  return alerts.slice(0, 6);
}

function getBaseChartOptions(extra = {}) {
  return {
    chart: {
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "inherit",
    },
    dataLabels: {
      enabled: false,
    },
    grid: {
      borderColor: "rgba(15,23,42,0.08)",
      strokeDashArray: 4,
    },
    legend: {
      position: "top",
      horizontalAlign: "left",
      labels: {
        colors: "#111827",
      },
      markers: {
        radius: 8,
      },
    },
    tooltip: {
      theme: "light",
    },
    ...extra,
  };
}

function ViewTabs({ activeView, setActiveView }) {
  const tabs = [
    { id: "summary", label: "Resumen" },
    { id: "charts", label: "Gráficos" },
    { id: "daily", label: "Ventas por día" },
    { id: "comparison", label: "Comparativa" },
  ];

  return (
    <div className="flex flex-wrap rounded-2xl bg-white p-1 shadow-sm ring-1 ring-black/[0.08]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveView(tab.id)}
          className={`rounded-xl px-4 py-2 text-[13px] font-medium transition ${
            activeView === tab.id
              ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
              : "text-black/55 hover:bg-black/[0.03] hover:text-black"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  currency = false,
  featured = false,
  color = BRAND_RED,
}) {
  return (
    <article className="rounded-[24px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-normal text-black/45">{title}</p>

          <p className="mt-1 truncate text-[21px] font-medium tracking-[-0.035em] text-black">
            {currency ? formatCurrency(value) : value}
          </p>

          {subtitle && (
            <p className="mt-1 truncate text-[12px] font-normal text-black/40">
              {subtitle}
            </p>
          )}
        </div>

        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: featured ? color : `${color}14`,
            color: featured ? "#fff" : color,
          }}
        >
          <Icon size={19} strokeWidth={1.9} />
        </div>
      </div>
    </article>
  );
}

function SectionCard({ title, subtitle, icon: Icon, children, className = "" }) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-[24px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] ${className}`}
    >
      <div className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3">
        {Icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <Icon size={18} strokeWidth={1.9} />
          </div>
        )}

        <div className="min-w-0">
          <h2 className="text-[15px] font-medium leading-5 text-black">
            {title}
          </h2>

          {subtitle && (
            <p className="mt-0.5 text-[12px] font-normal leading-5 text-black/45">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ text = "Sin información para mostrar." }) {
  return (
    <div className="flex h-[250px] items-center justify-center rounded-[18px] bg-black/[0.025] text-[13px] font-normal text-black/40">
      {text}
    </div>
  );
}

function SummaryStrip({ metrics, inventoryMetrics, monthLabel }) {
  return (
    <section className="rounded-[26px] bg-white p-4 shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <div className="grid gap-4 xl:grid-cols-[1fr_760px] xl:items-center">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-red-600">
            {monthLabel}
          </p>

          <h2 className="mt-1 text-[24px] font-medium tracking-[-0.04em] text-black">
            Estado general del negocio
          </h2>

          <p className="mt-1 max-w-2xl text-[13px] font-normal text-black/50">
            Vista ejecutiva de ventas, utilidad, unidades, inventario y
            rendimiento comercial.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-2xl bg-red-50 p-3">
            <p className="text-[11px] text-red-600">Total vendido</p>
            <p className="mt-1 text-[13px] font-medium text-black">
              {formatCurrency(metrics.revenue)}
            </p>
          </div>

          <div className="rounded-2xl bg-emerald-50 p-3">
            <p className="text-[11px] text-emerald-700">Utilidad</p>
            <p className="mt-1 text-[13px] font-medium text-black">
              {formatCurrency(metrics.profit)}
            </p>
          </div>

          <div className="rounded-2xl bg-blue-50 p-3">
            <p className="text-[11px] text-blue-700">Unidades vendidas</p>
            <p className="mt-1 text-[13px] font-medium text-black">
              {metrics.units}
            </p>
          </div>

          <div className="rounded-2xl bg-violet-50 p-3">
            <p className="text-[11px] text-violet-700">Stock actual</p>
            <p className="mt-1 text-[13px] font-medium text-black">
              {inventoryMetrics.units}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function InventoryAlerts({ alerts }) {
  return (
    <section className="min-w-0 rounded-[24px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
      <div className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <AlertTriangle size={18} strokeWidth={1.9} />
        </div>

        <div className="min-w-0">
          <h2 className="text-[15px] font-medium leading-5 text-black">
            Alertas de inventario
          </h2>

          <p className="mt-0.5 text-[12px] font-normal leading-5 text-black/45">
            Productos que requieren atención
          </p>
        </div>
      </div>

      <div className="p-4">
        {alerts.length === 0 ? (
          <div className="rounded-[18px] bg-black/[0.025] p-5 text-center text-[13px] text-black/40">
            Sin alertas críticas.
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <article
                key={`${alert.key}-${alert.message}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-black/[0.06] bg-white px-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: alert.color }}
                  />

                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-black">
                      {alert.title}
                    </p>

                    <p className="mt-0.5 truncate text-[12px] font-normal text-black/42">
                      {alert.message}
                    </p>
                  </div>
                </div>

                <span
                  className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium"
                  style={{
                    color: alert.color,
                    backgroundColor: `${alert.color}14`,
                  }}
                >
                  Revisar
                </span>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RankingList({
  title,
  subtitle,
  items,
  icon: Icon,
  valueKey = "revenue",
}) {
  return (
    <section className="min-w-0 rounded-[24px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
      <div className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon size={18} strokeWidth={1.9} />
        </div>

        <div className="min-w-0">
          <h2 className="text-[15px] font-medium leading-5 text-black">
            {title}
          </h2>

          {subtitle && (
            <p className="mt-0.5 text-[12px] font-normal leading-5 text-black/45">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="p-4">
        {items.length === 0 ? (
          <div className="rounded-[18px] bg-black/[0.025] p-5 text-center text-[13px] text-black/40">
            Sin información.
          </div>
        ) : (
          <div className="space-y-3">
            {items.slice(0, 5).map((item, index) => {
              const color = CHART_COLORS[index % CHART_COLORS.length];

              return (
                <article
                  key={item.key}
                  className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-black/[0.06] bg-white px-3 py-3"
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-[12px] font-medium text-white"
                    style={{ backgroundColor: color }}
                  >
                    {index + 1}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-black">
                      {item.label}
                    </p>

                    <p className="mt-0.5 truncate text-[12px] font-normal text-black/42">
                      {item.units} unidad(es) · {item.salesCount} venta(s)
                    </p>
                  </div>

                  <p className="shrink-0 text-right text-[13px] font-medium text-black">
                    {valueKey === "units"
                      ? item.units
                      : formatCompactCurrency(item[valueKey])}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function RecentSalesTable({ sales, className = "" }) {
  return (
    <SectionCard
      title="Últimas ventas"
      subtitle="Movimientos recientes"
      icon={ShoppingBag}
      className={className}
    >
      {sales.length === 0 ? (
        <div className="rounded-[18px] bg-black/[0.025] p-5 text-center text-[13px] text-black/40">
          No hay ventas registradas.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[18px] border border-black/[0.06]">
          <table className="min-w-[620px] w-full text-left text-[12px]">
            <thead className="bg-black/[0.025] text-black/45">
              <tr>
                <th className="px-3 py-2 font-normal">Producto</th>
                <th className="px-3 py-2 font-normal">Cantidad</th>
                <th className="px-3 py-2 font-normal">Pago</th>
                <th className="px-3 py-2 text-right font-normal">Total</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-black/[0.06]">
              {sales.slice(0, 8).map((sale) => (
                <tr key={sale.id}>
                  <td className="px-3 py-2">
                    <p className="max-w-[280px] truncate font-medium text-black">
                      {sale.productName}
                    </p>
                    <p className="text-[11px] text-black/40">
                      {sale.productCode} · {sale.productSize || "Talla única"}
                    </p>
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {sale.quantity || 1}
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {sale.paymentMethod || "N/A"}
                  </td>

                  <td className="px-3 py-2 text-right font-medium text-black">
                    {formatCurrency(sale.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function DaySalesTable({ sales }) {
  return (
    <SectionCard
      title="Detalle de ventas del día"
      subtitle="Productos vendidos, utilidad y forma de pago"
      icon={ShoppingBag}
      className="xl:col-span-8"
    >
      {sales.length === 0 ? (
        <div className="rounded-[18px] bg-black/[0.025] p-6 text-center text-[13px] text-black/40">
          No hay ventas registradas para este día.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[18px] border border-black/[0.06]">
          <table className="min-w-[900px] w-full text-left text-[12px]">
            <thead className="bg-black/[0.025] text-black/45">
              <tr>
                <th className="px-3 py-2 font-normal">Producto</th>
                <th className="px-3 py-2 font-normal">Categoría</th>
                <th className="px-3 py-2 font-normal">Cant.</th>
                <th className="px-3 py-2 text-right font-normal">Unitario</th>
                <th className="px-3 py-2 text-right font-normal">Total</th>
                <th className="px-3 py-2 text-right font-normal">Ganancia</th>
                <th className="px-3 py-2 font-normal">Pago</th>
                <th className="px-3 py-2 font-normal">Vendedor</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-black/[0.06]">
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="px-3 py-2">
                    <p className="max-w-[240px] truncate font-medium text-black">
                      {sale.productName}
                    </p>
                    <p className="text-[11px] text-black/40">
                      {sale.productCode} · {sale.productSize || "Talla única"}
                    </p>
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {sale.categoryName || "Sin categoría"}
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {sale.quantity || 1}
                  </td>

                  <td className="px-3 py-2 text-right text-black/55">
                    {formatCurrency(sale.unitPrice)}
                  </td>

                  <td className="px-3 py-2 text-right font-medium text-black">
                    {formatCurrency(sale.total)}
                  </td>

                  <td className="px-3 py-2 text-right font-medium text-emerald-700">
                    {formatCurrency(sale.profit)}
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {sale.paymentMethod || "N/A"}
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {sale.sellerName || sale.sellerEmail || "Sin vendedor"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function ComparisonMetric({ label, previous, current, currency = false }) {
  const change = getPercentChange(previous, current);
  const isPositive = change >= 0;

  return (
    <article className="rounded-[24px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
      <p className="text-[12px] font-normal text-black/45">{label}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl bg-blue-50 p-3">
          <p className="text-[11px] text-blue-700">Mes comparado</p>
          <p className="mt-1 text-[15px] font-medium text-black">
            {currency ? formatCurrency(previous) : previous}
          </p>
        </div>

        <div className="rounded-2xl bg-red-50 p-3">
          <p className="text-[11px] text-red-600">Mes principal</p>
          <p className="mt-1 text-[15px] font-medium text-black">
            {currency ? formatCurrency(current) : current}
          </p>
        </div>
      </div>

      <div
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${
          isPositive
            ? "bg-emerald-50 text-emerald-700"
            : "bg-red-50 text-red-700"
        }`}
      >
        {isPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
        {Math.abs(change).toFixed(1)}%
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const defaults = useMemo(() => getDefaultMonthKeys(), []);

  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);

  const [activeView, setActiveView] = useState("summary");
  const [monthA, setMonthA] = useState(defaults.previousMonth);
  const [monthB, setMonthB] = useState(defaults.currentMonth);

  const [dailyMonth, setDailyMonth] = useState(defaults.currentMonth);
  const [dailyDay, setDailyDay] = useState(defaults.currentDay);

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

  useEffect(() => {
    const daysInMonth = getDaysInMonth(dailyMonth);

    setDailyDay((currentDay) => {
      const numberDay = Number(currentDay || 1);

      if (numberDay > daysInMonth) {
        return String(daysInMonth);
      }

      if (numberDay <= 0) {
        return "1";
      }

      return String(numberDay);
    });
  }, [dailyMonth]);

  const monthASales = useMemo(() => {
    return filterSalesByMonth(sales, monthA);
  }, [sales, monthA]);

  const monthBSales = useMemo(() => {
    return filterSalesByMonth(sales, monthB);
  }, [sales, monthB]);

  const selectedDaySales = useMemo(() => {
    return filterSalesByDay(sales, dailyMonth, dailyDay);
  }, [sales, dailyMonth, dailyDay]);

  const monthAMetrics = useMemo(() => {
    return finalizeMetrics(calculateMetrics(monthASales));
  }, [monthASales]);

  const monthBMetrics = useMemo(() => {
    return finalizeMetrics(calculateMetrics(monthBSales));
  }, [monthBSales]);

  const selectedDayMetrics = useMemo(() => {
    return finalizeMetrics(calculateMetrics(selectedDaySales));
  }, [selectedDaySales]);

  const allTimeMetrics = useMemo(() => {
    return finalizeMetrics(calculateMetrics(sales));
  }, [sales]);

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

  const selectedDayProductRanking = useMemo(() => {
    return buildRanking(
      selectedDaySales,
      (sale) => sale.productId || sale.productName || "sin-producto",
      (sale) => sale.productName || "Producto sin nombre"
    );
  }, [selectedDaySales]);

  const dailySales = useMemo(() => {
    return buildDailySales(monthBSales);
  }, [monthBSales]);

  const previousProductRanking = useMemo(() => {
    return buildRanking(
      monthASales,
      (sale) => sale.productId || sale.productName || "sin-producto",
      (sale) => sale.productName || "Producto sin nombre"
    );
  }, [monthASales]);

  const comparisonDaily = useMemo(() => {
    return buildDayComparison(monthASales, monthBSales);
  }, [monthASales, monthBSales]);

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

        if (stock <= 0) acc.emptyProducts += 1;
        if (stock > 0 && stock <= 3) acc.lowStockProducts += 1;

        return acc;
      },
      {
        products: 0,
        units: 0,
        cost: 0,
        potentialRevenue: 0,
        potentialProfit: 0,
        emptyProducts: 0,
        lowStockProducts: 0,
      }
    );
  }, [products]);

  const inventoryAlerts = useMemo(() => {
    return buildInventoryAlerts(products, productRanking);
  }, [products, productRanking]);

  const salesTrendOptions = useMemo(() => {
    return getBaseChartOptions({
      colors: [BRAND_RED],
      stroke: {
        curve: "smooth",
        width: 3,
      },
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 0.25,
          opacityFrom: 0.35,
          opacityTo: 0.05,
        },
      },
      xaxis: {
        categories: dailySales.map((item) => item.label),
        labels: {
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactCurrency(value),
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      tooltip: {
        y: {
          formatter: (value) => formatCurrency(value),
        },
      },
    });
  }, [dailySales]);

  const salesTrendSeries = useMemo(() => {
    return [
      {
        name: "Ventas",
        data: dailySales.map((item) => Number(item.total || 0)),
      },
    ];
  }, [dailySales]);

  const categoryDonutOptions = useMemo(() => {
    return getBaseChartOptions({
      labels: categoryRanking.slice(0, 8).map((item) => item.label),
      colors: CHART_COLORS,
      legend: {
        position: "bottom",
      },
      plotOptions: {
        pie: {
          donut: {
            size: "62%",
            labels: {
              show: true,
              total: {
                show: true,
                label: "Total",
                formatter: () =>
                  formatCompactCurrency(
                    categoryRanking.reduce(
                      (sum, item) => sum + Number(item.revenue || 0),
                      0
                    )
                  ),
              },
            },
          },
        },
      },
      tooltip: {
        y: {
          formatter: (value) => formatCurrency(value),
        },
      },
    });
  }, [categoryRanking]);

  const categoryDonutSeries = useMemo(() => {
    return categoryRanking
      .slice(0, 8)
      .map((item) => Number(item.revenue || 0));
  }, [categoryRanking]);

  const productBarOptions = useMemo(() => {
    return getBaseChartOptions({
      colors: CHART_COLORS,
      plotOptions: {
        bar: {
          borderRadius: 8,
          columnWidth: "45%",
          distributed: true,
        },
      },
      xaxis: {
        categories: productRanking.slice(0, 8).map((item) => item.label),
        labels: {
          rotate: -20,
          trim: true,
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactCurrency(value),
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      legend: {
        show: false,
      },
      tooltip: {
        y: {
          formatter: (value) => formatCurrency(value),
        },
      },
    });
  }, [productRanking]);

  const productBarSeries = useMemo(() => {
    return [
      {
        name: "Vendido",
        data: productRanking
          .slice(0, 8)
          .map((item) => Number(item.revenue || 0)),
      },
    ];
  }, [productRanking]);

  const selectedDayProductOptions = useMemo(() => {
    return getBaseChartOptions({
      colors: CHART_COLORS,
      plotOptions: {
        bar: {
          borderRadius: 8,
          columnWidth: "45%",
          distributed: true,
        },
      },
      xaxis: {
        categories: selectedDayProductRanking
          .slice(0, 8)
          .map((item) => item.label),
        labels: {
          rotate: -20,
          trim: true,
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactCurrency(value),
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      legend: {
        show: false,
      },
      tooltip: {
        y: {
          formatter: (value) => formatCurrency(value),
        },
      },
    });
  }, [selectedDayProductRanking]);

  const selectedDayProductSeries = useMemo(() => {
    return [
      {
        name: "Vendido",
        data: selectedDayProductRanking
          .slice(0, 8)
          .map((item) => Number(item.revenue || 0)),
      },
    ];
  }, [selectedDayProductRanking]);

  const sizesDonutOptions = useMemo(() => {
    return getBaseChartOptions({
      labels: sizeRanking.slice(0, 8).map((item) => item.label),
      colors: CHART_COLORS,
      legend: {
        position: "bottom",
      },
      plotOptions: {
        pie: {
          donut: {
            size: "62%",
            labels: {
              show: true,
              total: {
                show: true,
                label: "Unidades",
                formatter: () =>
                  sizeRanking
                    .reduce((sum, item) => sum + Number(item.units || 0), 0)
                    .toLocaleString("es-CO"),
              },
            },
          },
        },
      },
      tooltip: {
        y: {
          formatter: (value) => `${value} unidad(es)`,
        },
      },
    });
  }, [sizeRanking]);

  const sizesDonutSeries = useMemo(() => {
    return sizeRanking.slice(0, 8).map((item) => Number(item.units || 0));
  }, [sizeRanking]);

  const sellersBarOptions = useMemo(() => {
    return getBaseChartOptions({
      colors: ["#2563eb"],
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 8,
        },
      },
      xaxis: {
        categories: sellerRanking.slice(0, 7).map((item) => item.label),
        labels: {
          formatter: (value) => formatCompactCurrency(value),
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      yaxis: {
        labels: {
          style: { colors: "#374151", fontSize: "11px" },
        },
      },
      tooltip: {
        y: {
          formatter: (value) => formatCurrency(value),
        },
      },
    });
  }, [sellerRanking]);

  const sellersBarSeries = useMemo(() => {
    return [
      {
        name: "Vendido",
        data: sellerRanking
          .slice(0, 7)
          .map((item) => Number(item.revenue || 0)),
      },
    ];
  }, [sellerRanking]);

  const comparisonLineOptions = useMemo(() => {
    return getBaseChartOptions({
      colors: ["#2563eb", BRAND_RED],
      stroke: {
        curve: "smooth",
        width: 3,
      },
      xaxis: {
        categories: comparisonDaily.categories,
        title: {
          text: "Día del mes",
        },
        labels: {
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactCurrency(value),
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      tooltip: {
        y: {
          formatter: (value) => formatCurrency(value),
        },
      },
    });
  }, [comparisonDaily.categories]);

  const comparisonLineSeries = useMemo(() => {
    return [
      {
        name: formatMonthLabel(monthA),
        data: comparisonDaily.dataA,
      },
      {
        name: formatMonthLabel(monthB),
        data: comparisonDaily.dataB,
      },
    ];
  }, [comparisonDaily, monthA, monthB]);

  const previousProductOptions = useMemo(() => {
    return getBaseChartOptions({
      colors: CHART_COLORS,
      plotOptions: {
        bar: {
          borderRadius: 8,
          columnWidth: "45%",
          distributed: true,
        },
      },
      xaxis: {
        categories: previousProductRanking
          .slice(0, 7)
          .map((item) => item.label),
        labels: {
          rotate: -20,
          style: { colors: "#6b7280", fontSize: "11px" },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactCurrency(value),
        },
      },
      legend: { show: false },
      tooltip: {
        y: {
          formatter: (value) => formatCurrency(value),
        },
      },
    });
  }, [previousProductRanking]);

  const previousProductSeries = useMemo(() => {
    return [
      {
        name: "Vendido",
        data: previousProductRanking
          .slice(0, 7)
          .map((item) => Number(item.revenue || 0)),
      },
    ];
  }, [previousProductRanking]);

  const dailyDays = useMemo(() => {
    return Array.from(
      { length: getDaysInMonth(dailyMonth) },
      (_, index) => index + 1
    );
  }, [dailyMonth]);

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 font-sans sm:px-5 lg:px-6">
      <section className="w-full">
        <section className="flex flex-col gap-3 border-b border-black/[0.06] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
           

            <h1 className="mt-1 text-[28px] font-medium tracking-[-0.045em] text-black">
              Dashboard
            </h1>

            <p className="mt-1 max-w-2xl text-[13px] font-normal text-black/50">
              Ventas, inventario, categorías, tallas y rendimiento comercial.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ViewTabs activeView={activeView} setActiveView={setActiveView} />

            {activeView !== "comparison" && activeView !== "daily" && (
              <div className="rounded-2xl bg-white p-1 shadow-sm ring-1 ring-black/[0.08]">
                <input
                  type="month"
                  value={monthB}
                  onChange={(event) => setMonthB(event.target.value)}
                  className="h-9 rounded-xl border-0 px-3 text-[12px] outline-none focus:ring-2 focus:ring-red-600/20"
                />
              </div>
            )}
          </div>
        </section>

        {loading ? (
          <div className="mt-4 rounded-[24px] bg-white p-8 text-center text-[13px] text-black/45 ring-1 ring-black/[0.08]">
            Cargando analíticas en tiempo real...
          </div>
        ) : activeView === "summary" ? (
          <>
            <section className="mt-4">
              <SummaryStrip
                metrics={monthBMetrics}
                inventoryMetrics={inventoryMetrics}
                monthLabel={formatMonthLabel(monthB)}
              />
            </section>

            <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <MetricCard
                title="Total vendido"
                value={monthBMetrics.revenue}
                subtitle={formatMonthLabel(monthB)}
                icon={BadgeDollarSign}
                currency
                featured
                color="#c1121f"
              />

              <MetricCard
                title="Ventas"
                value={monthBMetrics.salesCount}
                subtitle="Transacciones"
                icon={ShoppingBag}
                color="#2563eb"
              />

              <MetricCard
                title="Unidades"
                value={monthBMetrics.units}
                subtitle="Prendas vendidas"
                icon={Boxes}
                color="#16a34a"
              />

              <MetricCard
                title="Utilidad"
                value={monthBMetrics.profit}
                subtitle={`Margen ${monthBMetrics.margin.toFixed(1)}%`}
                icon={CircleDollarSign}
                currency
                color="#059669"
              />

              <MetricCard
                title="Ticket"
                value={monthBMetrics.averageTicket}
                subtitle="Promedio venta"
                icon={CalendarDays}
                currency
                color="#7c3aed"
              />

              <MetricCard
                title="Alertas"
                value={
                  inventoryMetrics.emptyProducts +
                  inventoryMetrics.lowStockProducts
                }
                subtitle="Stock crítico"
                icon={AlertTriangle}
                color="#f59e0b"
              />
            </section>

            <section className="mt-3 grid gap-3 xl:grid-cols-12">
              <SectionCard
                className="xl:col-span-7"
                title="Evolución de ventas"
                subtitle={`Ventas diarias de ${formatMonthLabel(monthB)}`}
                icon={BarChart3}
              >
                {dailySales.length === 0 ? (
                  <EmptyState text="No hay ventas para graficar en este mes." />
                ) : (
                  <div className="h-[340px]">
                    <Chart
                      type="area"
                      height="100%"
                      options={salesTrendOptions}
                      series={salesTrendSeries}
                    />
                  </div>
                )}
              </SectionCard>

              <SectionCard
                className="xl:col-span-5"
                title="Distribución por categoría"
                subtitle="Participación de ingresos por categoría"
                icon={PieChart}
              >
                {categoryDonutSeries.length === 0 ? (
                  <EmptyState text="No hay categorías vendidas." />
                ) : (
                  <div className="h-[340px]">
                    <Chart
                      type="donut"
                      height="100%"
                      options={categoryDonutOptions}
                      series={categoryDonutSeries}
                    />
                  </div>
                )}
              </SectionCard>
            </section>

            <section className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              <RankingList
                title="Productos más vendidos"
                subtitle={formatMonthLabel(monthB)}
                items={productRanking}
                icon={Trophy}
              />

              <RankingList
                title="Tallas más vendidas"
                subtitle="Rotación por unidades"
                items={sizeRanking}
                icon={Package}
                valueKey="units"
              />

              <RankingList
                title="Vendedores destacados"
                subtitle="Ventas registradas por usuario"
                items={sellerRanking}
                icon={UserCheck}
              />

              <InventoryAlerts alerts={inventoryAlerts} />
            </section>

            <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Ventas históricas"
                value={allTimeMetrics.revenue}
                subtitle={`${allTimeMetrics.salesCount} venta(s) totales`}
                icon={TrendingUp}
                currency
                color="#64748b"
              />

              <MetricCard
                title="Inversión stock"
                value={inventoryMetrics.cost}
                subtitle="Costo del inventario"
                icon={Package}
                currency
                color="#0891b2"
              />

              <MetricCard
                title="Venta potencial"
                value={inventoryMetrics.potentialRevenue}
                subtitle="Si se vende todo"
                icon={BadgeDollarSign}
                currency
                color="#db2777"
              />

              <MetricCard
                title="Ganancia potencial"
                value={inventoryMetrics.potentialProfit}
                subtitle="Utilidad esperada"
                icon={CircleDollarSign}
                currency
                color="#059669"
              />
            </section>
          </>
        ) : activeView === "charts" ? (
          <>
            <section className="mt-4 grid gap-3 xl:grid-cols-12">
              <SectionCard
                className="xl:col-span-7"
                title="Productos más vendidos"
                subtitle="Ranking visual por ingresos"
                icon={BarChart3}
              >
                {productRanking.length === 0 ? (
                  <EmptyState text="No hay productos vendidos en este mes." />
                ) : (
                  <div className="h-[390px]">
                    <Chart
                      type="bar"
                      height="100%"
                      options={productBarOptions}
                      series={productBarSeries}
                    />
                  </div>
                )}
              </SectionCard>

              <SectionCard
                className="xl:col-span-5"
                title="Tallas más vendidas"
                subtitle="Participación por unidades vendidas"
                icon={PieChart}
              >
                {sizesDonutSeries.length === 0 ? (
                  <EmptyState text="No hay tallas vendidas." />
                ) : (
                  <div className="h-[390px]">
                    <Chart
                      type="donut"
                      height="100%"
                      options={sizesDonutOptions}
                      series={sizesDonutSeries}
                    />
                  </div>
                )}
              </SectionCard>
            </section>

            <section className="mt-3 grid gap-3 xl:grid-cols-12">
              <SectionCard
                className="xl:col-span-7"
                title="Vendedores destacados"
                subtitle="Ranking por valor vendido"
                icon={UserCheck}
              >
                {sellerRanking.length === 0 ? (
                  <EmptyState text="No hay ventas por vendedor." />
                ) : (
                  <div className="h-[360px]">
                    <Chart
                      type="bar"
                      height="100%"
                      options={sellersBarOptions}
                      series={sellersBarSeries}
                    />
                  </div>
                )}
              </SectionCard>

              <RecentSalesTable sales={sales} className="xl:col-span-5" />
            </section>
          </>
        ) : activeView === "daily" ? (
          <>
            <section className="mt-4 rounded-[24px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-red-600">
                    Historial diario
                  </p>

                  <h2 className="mt-1 text-[21px] font-medium tracking-[-0.04em] text-black">
                    Ventas por día
                  </h2>

                  <p className="mt-1 max-w-2xl text-[13px] font-normal text-black/50">
                    Selecciona un mes y un día específico para revisar qué se
                    vendió, cuánto se vendió y cuál fue la ganancia.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="text-[12px] text-black/45">Mes</span>

                    <input
                      type="month"
                      value={dailyMonth}
                      onChange={(event) => setDailyMonth(event.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    />
                  </label>

                  <label>
                    <span className="text-[12px] text-black/45">Día</span>

                    <select
                      value={dailyDay}
                      onChange={(event) => setDailyDay(event.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    >
                      {dailyDays.map((day) => (
                        <option key={day} value={String(day)}>
                          Día {day}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </section>

            <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Total vendido"
                value={selectedDayMetrics.revenue}
                subtitle={formatDayLabel(dailyMonth, dailyDay)}
                icon={BadgeDollarSign}
                currency
                featured
                color="#c1121f"
              />

              <MetricCard
                title="Ganancia del día"
                value={selectedDayMetrics.profit}
                subtitle={`Margen ${selectedDayMetrics.margin.toFixed(1)}%`}
                icon={CircleDollarSign}
                currency
                color="#059669"
              />

              <MetricCard
                title="Ventas registradas"
                value={selectedDayMetrics.salesCount}
                subtitle="Transacciones del día"
                icon={ShoppingBag}
                color="#2563eb"
              />

              <MetricCard
                title="Unidades vendidas"
                value={selectedDayMetrics.units}
                subtitle="Prendas vendidas"
                icon={Boxes}
                color="#16a34a"
              />
            </section>

            <section className="mt-3 grid gap-3 xl:grid-cols-12">
              <DaySalesTable sales={selectedDaySales} />

              <SectionCard
                className="xl:col-span-4"
                title="Productos del día"
                subtitle="Ranking visual por ingresos"
                icon={BarChart3}
              >
                {selectedDayProductRanking.length === 0 ? (
                  <EmptyState text="No hay productos vendidos este día." />
                ) : (
                  <div className="h-[360px]">
                    <Chart
                      type="bar"
                      height="100%"
                      options={selectedDayProductOptions}
                      series={selectedDayProductSeries}
                    />
                  </div>
                )}
              </SectionCard>
            </section>
          </>
        ) : (
          <>
            <section className="mt-4 rounded-[24px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-red-600">
                    Comparativa mensual
                  </p>

                  <h2 className="mt-1 text-[21px] font-medium tracking-[-0.04em] text-black">
                    Compara dos meses
                  </h2>

                  <p className="mt-1 max-w-2xl text-[13px] font-normal text-black/50">
                    Vista separada para analizar diferencias entre periodos.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="text-[12px] text-black/45">
                      Mes comparado
                    </span>

                    <input
                      type="month"
                      value={monthA}
                      onChange={(event) => setMonthA(event.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    />
                  </label>

                  <label>
                    <span className="text-[12px] text-black/45">
                      Mes principal
                    </span>

                    <input
                      type="month"
                      value={monthB}
                      onChange={(event) => setMonthB(event.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ComparisonMetric
                label="Total vendido"
                previous={monthAMetrics.revenue}
                current={monthBMetrics.revenue}
                currency
              />

              <ComparisonMetric
                label="Utilidad"
                previous={monthAMetrics.profit}
                current={monthBMetrics.profit}
                currency
              />

              <ComparisonMetric
                label="Ventas"
                previous={monthAMetrics.salesCount}
                current={monthBMetrics.salesCount}
              />

              <ComparisonMetric
                label="Unidades"
                previous={monthAMetrics.units}
                current={monthBMetrics.units}
              />
            </section>

            <section className="mt-3 grid gap-3 xl:grid-cols-12">
              <SectionCard
                className="xl:col-span-8"
                title="Evolución comparada"
                subtitle={`${formatMonthLabel(monthA)} vs ${formatMonthLabel(
                  monthB
                )}`}
                icon={TrendingUp}
              >
                <div className="h-[390px]">
                  <Chart
                    type="line"
                    height="100%"
                    options={comparisonLineOptions}
                    series={comparisonLineSeries}
                  />
                </div>
              </SectionCard>

              <div className="grid gap-3 xl:col-span-4">
                <MetricCard
                  title={formatMonthLabel(monthA)}
                  value={monthAMetrics.revenue}
                  subtitle={`${monthAMetrics.salesCount} venta(s)`}
                  icon={TrendingDown}
                  currency
                  color="#2563eb"
                />

                <MetricCard
                  title={formatMonthLabel(monthB)}
                  value={monthBMetrics.revenue}
                  subtitle={`${monthBMetrics.salesCount} venta(s)`}
                  icon={TrendingUp}
                  currency
                  featured
                  color="#c1121f"
                />

                <MetricCard
                  title="Diferencia"
                  value={monthBMetrics.revenue - monthAMetrics.revenue}
                  subtitle="Mes principal - comparado"
                  icon={BadgeDollarSign}
                  currency
                  color={
                    monthBMetrics.revenue - monthAMetrics.revenue >= 0
                      ? "#16a34a"
                      : "#c1121f"
                  }
                />
              </div>
            </section>

            <section className="mt-3 grid gap-3 xl:grid-cols-2">
              <SectionCard
                title={`Productos · ${formatMonthLabel(monthA)}`}
                subtitle="Mes comparado"
                icon={BarChart3}
              >
                {previousProductRanking.length === 0 ? (
                  <EmptyState text="No hay productos vendidos en el mes comparado." />
                ) : (
                  <div className="h-[350px]">
                    <Chart
                      type="bar"
                      height="100%"
                      options={previousProductOptions}
                      series={previousProductSeries}
                    />
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title={`Productos · ${formatMonthLabel(monthB)}`}
                subtitle="Mes principal"
                icon={BarChart3}
              >
                {productRanking.length === 0 ? (
                  <EmptyState text="No hay productos vendidos en el mes principal." />
                ) : (
                  <div className="h-[350px]">
                    <Chart
                      type="bar"
                      height="100%"
                      options={productBarOptions}
                      series={productBarSeries}
                    />
                  </div>
                )}
              </SectionCard>
            </section>
          </>
        )}
      </section>
    </main>
  );
}