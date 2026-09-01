import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Chart from "react-apexcharts";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  CreditCard,
  Landmark,
  Package,
  PieChart,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserCheck,
  WalletCards,
} from "lucide-react";

import { STORE_ID } from "../../services/categories.service";
import { subscribeProducts } from "../../services/products.service";
import { subscribeSales } from "../../services/sales.service";
import {
  CASH_METHODS,
  CASH_METHOD_LABELS,
  buildCashSessionSummary,
  getBogotaBusinessDate,
  normalizeSalePayments,
  subscribeCashMovements,
  subscribeCashSessions,
} from "../../services/cash.service";
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
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrZero(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getDefaultMonthKeys() {
  const now = new Date();
  const previous = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );

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

function formatDateTime(value) {
  const date = toDate(value);

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
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

    return (
      getMonthKey(date) === monthKey &&
      date.getDate() === Number(day)
    );
  });
}

function getSaleItems(sale) {
  if (
    Array.isArray(sale?.items) &&
    sale.items.length > 0
  ) {
    return sale.items;
  }

  if (!sale) return [];

  return [
    {
      lineId: "legacy-1",
      productId: sale.productId || "",
      productName: sale.productName || "Producto",
      productCode: sale.productCode || "",
      categoryId: sale.categoryId || "",
      categoryName: sale.categoryName || "Sin categoría",
      size:
        sale.productSize || sale.size || "Talla única",
      quantity: numberOrZero(sale.quantity),
      unitPrice: numberOrZero(sale.unitPrice),
      costPrice: numberOrZero(sale.costPrice),
      subtotal: numberOrZero(sale.total),
      totalCost: numberOrZero(sale.totalCost),
      profit: numberOrZero(sale.profit),
    },
  ];
}

function getSaleUnits(sale) {
  if (sale?.totalItems !== undefined) {
    return numberOrZero(sale.totalItems);
  }

  return getSaleItems(sale).reduce(
    (sum, item) => sum + numberOrZero(item.quantity),
    0
  );
}

function getSaleCost(sale) {
  if (sale?.totalCost !== undefined) {
    return numberOrZero(sale.totalCost);
  }

  return getSaleItems(sale).reduce((sum, item) => {
    const quantity = numberOrZero(item.quantity);
    const totalCost =
      item?.totalCost !== undefined
        ? numberOrZero(item.totalCost)
        : numberOrZero(item.costPrice) * quantity;

    return sum + totalCost;
  }, 0);
}

function getSaleProfit(sale) {
  if (sale?.profit !== undefined) {
    return Number(sale.profit || 0);
  }

  return numberOrZero(sale?.total) - getSaleCost(sale);
}

function calculateMetrics(sales) {
  return sales.reduce(
    (acc, sale) => {
      const total = numberOrZero(sale.total);
      const totalCost = getSaleCost(sale);
      const profit = getSaleProfit(sale);

      acc.salesCount += 1;
      acc.units += getSaleUnits(sale);
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
    metrics.revenue > 0
      ? (metrics.profit / metrics.revenue) * 100
      : 0;

  const averageTicket =
    metrics.salesCount > 0
      ? metrics.revenue / metrics.salesCount
      : 0;

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

  return (
    ((cleanCurrent - cleanPrevious) /
      Math.abs(cleanPrevious)) *
    100
  );
}

function getAllocatedSaleLines(sale) {
  const items = getSaleItems(sale);
  const saleSubtotal = numberOrZero(sale?.subtotal);
  const saleTotal = numberOrZero(sale?.total);

  const grossSubtotal =
    saleSubtotal > 0
      ? saleSubtotal
      : items.reduce(
          (sum, item) =>
            sum +
            (item?.subtotal !== undefined
              ? numberOrZero(item.subtotal)
              : numberOrZero(item.unitPrice) *
                numberOrZero(item.quantity)),
          0
        );

  const revenueFactor =
    grossSubtotal > 0 ? saleTotal / grossSubtotal : 1;

  return items.map((item, index) => {
    const quantity = numberOrZero(item.quantity);
    const grossRevenue =
      item?.subtotal !== undefined
        ? numberOrZero(item.subtotal)
        : numberOrZero(item.unitPrice) * quantity;

    const cost =
      item?.totalCost !== undefined
        ? numberOrZero(item.totalCost)
        : numberOrZero(item.costPrice) * quantity;

    const netRevenue = grossRevenue * revenueFactor;

    return {
      ...item,
      analyticsKey:
        item.lineId ||
        `${item.productId || "product"}-${index}`,
      quantity,
      grossRevenue,
      revenue: netRevenue,
      cost,
      profit: netRevenue - cost,
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      sellerUid: sale.sellerUid,
      sellerName: sale.sellerName,
      sellerEmail: sale.sellerEmail,
      paymentMethod: sale.paymentMethod,
      payments: sale.payments,
      createdAt: sale.createdAt,
      customerName: sale.customerName,
      customerDocument: sale.customerDocument,
    };
  });
}

function buildItemRanking(
  sales,
  getKey,
  getLabel
) {
  const map = new Map();

  sales.forEach((sale) => {
    getAllocatedSaleLines(sale).forEach((line) => {
      const key = getKey(line);
      const label = getLabel(line);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label,
          units: 0,
          revenue: 0,
          profit: 0,
          saleIds: new Set(),
        });
      }

      const item = map.get(key);
      item.units += line.quantity;
      item.revenue += line.revenue;
      item.profit += line.profit;
      item.saleIds.add(sale.id);
    });
  });

  return Array.from(map.values())
    .map((item) => ({
      key: item.key,
      label: item.label,
      units: item.units,
      revenue: item.revenue,
      profit: item.profit,
      salesCount: item.saleIds.size,
    }))
    .sort((a, b) => {
      if (b.revenue !== a.revenue) {
        return b.revenue - a.revenue;
      }

      return b.units - a.units;
    });
}

function buildSellerRanking(sales) {
  const map = new Map();

  sales.forEach((sale) => {
    const key =
      sale.sellerUid ||
      sale.sellerEmail ||
      sale.sellerName ||
      "sin-vendedor";

    const label =
      sale.sellerName ||
      sale.sellerEmail ||
      "Sin vendedor";

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
    item.units += getSaleUnits(sale);
    item.revenue += numberOrZero(sale.total);
    item.profit += getSaleProfit(sale);
  });

  return Array.from(map.values()).sort((a, b) => {
    if (b.revenue !== a.revenue) {
      return b.revenue - a.revenue;
    }

    return b.units - a.units;
  });
}

function buildDailySales(sales) {
  const map = new Map();

  sales.forEach((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return;

    const key = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

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
    item.total += numberOrZero(sale.total);
    item.units += getSaleUnits(sale);
  });

  return Array.from(map.values()).sort(
    (a, b) => a.date - b.date
  );
}

function buildDayComparison(salesA, salesB) {
  const mapA = new Map();
  const mapB = new Map();

  salesA.forEach((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return;

    const day = date.getDate();
    mapA.set(
      day,
      numberOrZero(mapA.get(day)) +
        numberOrZero(sale.total)
    );
  });

  salesB.forEach((sale) => {
    const date = toDate(sale.createdAt);
    if (!date) return;

    const day = date.getDate();
    mapB.set(
      day,
      numberOrZero(mapB.get(day)) +
        numberOrZero(sale.total)
    );
  });

  const maxDays = Math.max(
    ...[
      ...mapA.keys(),
      ...mapB.keys(),
      1,
    ]
  );

  const days = Array.from(
    { length: maxDays },
    (_, index) => index + 1
  );

  return {
    categories: days.map((day) => String(day)),
    dataA: days.map((day) =>
      numberOrZero(mapA.get(day))
    ),
    dataB: days.map((day) =>
      numberOrZero(mapB.get(day))
    ),
  };
}

function buildPaymentBreakdown(sales) {
  const totals = CASH_METHODS.reduce((result, method) => {
    result[method] = 0;
    return result;
  }, {});

  let pendingAddi = 0;

  sales.forEach((sale) => {
    normalizeSalePayments(sale).forEach((payment) => {
      totals[payment.method] += numberOrZero(
        payment.amount
      );

      if (
        payment.method === "addi" &&
        String(sale.addiStatus || "") !== "settled"
      ) {
        pendingAddi += numberOrZero(payment.amount);
      }
    });
  });

  return {
    totals,
    pendingAddi,
    total: Object.values(totals).reduce(
      (sum, value) => sum + numberOrZero(value),
      0
    ),
  };
}

function buildInventoryAlerts(
  products,
  productRanking
) {
  const rankingMap = new Map();

  productRanking.forEach((item) => {
    rankingMap.set(item.key, item);
  });

  const alerts = [];

  products.forEach((product) => {
    const stock = numberOrZero(product.stock);
    const key = product.id || product.name;
    const name = product.name || "Producto sin nombre";
    const ranking = rankingMap.get(key);
    const soldUnits = numberOrZero(ranking?.units);

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
    <article className="rounded-[22px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-normal text-black/45">
            {title}
          </p>

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
            backgroundColor: featured
              ? color
              : `${color}14`,
            color: featured ? "#fff" : color,
          }}
        >
          <Icon size={19} strokeWidth={1.9} />
        </div>
      </div>
    </article>
  );
}

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
  className = "",
  action = null,
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-[22px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] ${className}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
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

        {action}
      </div>

      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({
  text = "Sin información para mostrar.",
}) {
  return (
    <div className="flex h-[250px] items-center justify-center rounded-[18px] bg-black/[0.025] text-[13px] font-normal text-black/40">
      {text}
    </div>
  );
}

function SummaryStrip({
  metrics,
  inventoryMetrics,
  monthLabel,
}) {
  return (
    <section className="rounded-[24px] bg-white p-4 shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <div className="grid gap-4 xl:grid-cols-[1fr_760px] xl:items-center">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-red-600">
            {monthLabel}
          </p>

          <h2 className="mt-1 text-[24px] font-medium tracking-[-0.04em] text-black">
            Estado general del negocio
          </h2>

          <p className="mt-1 max-w-2xl text-[13px] font-normal text-black/50">
            Ventas, utilidad, inventario y caja conectados con el modelo actual.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <SummaryChip
            label="Total vendido"
            value={formatCurrency(metrics.revenue)}
            tone="red"
          />
          <SummaryChip
            label="Utilidad"
            value={formatCurrency(metrics.profit)}
            tone="green"
          />
          <SummaryChip
            label="Unidades"
            value={metrics.units}
            tone="blue"
          />
          <SummaryChip
            label="Stock actual"
            value={inventoryMetrics.units}
            tone="violet"
          />
        </div>
      </div>
    </section>
  );
}

function SummaryChip({ label, value, tone }) {
  const tones = {
    red: "bg-red-50 text-red-600",
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <div className={`rounded-2xl p-3 ${tones[tone]}`}>
      <p className="text-[11px]">{label}</p>
      <p className="mt-1 truncate text-[13px] font-medium text-black">
        {value}
      </p>
    </div>
  );
}

function CashTodayPanel({
  summary,
  onOpenCash,
}) {
  return (
    <section className="mt-3 overflow-hidden rounded-[24px] bg-white shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
      <div className="flex flex-col gap-3 border-b border-black/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <WalletCards size={19} />
          </div>

          <div>
            <h2 className="text-[15px] font-medium text-black">
              Caja de hoy
            </h2>
            <p className="mt-0.5 text-[12px] text-black/45">
              Resumen consolidado de las cajas de {summary.businessDate}.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenCash}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] font-medium text-black/60 transition hover:bg-black/[0.025]"
        >
          Ver Caja
          <ArrowRight size={12} />
        </button>
      </div>

      <div className="grid gap-px bg-black/[0.06] sm:grid-cols-2 lg:grid-cols-6">
        <CashMetric
          label="Cajas abiertas"
          value={summary.openCount}
        />
        <CashMetric
          label="Cajas cerradas"
          value={summary.closedCount}
        />
        <CashMetric
          label="Base entregada"
          value={formatCurrency(summary.openingAmount)}
        />
        <CashMetric
          label="Ventas de cajas"
          value={formatCurrency(summary.totalSales)}
        />
        <CashMetric
          label="Efectivo esperado"
          value={formatCurrency(summary.expectedCash)}
        />
        <CashMetric
          label="Diferencia"
          value={formatCurrency(summary.difference)}
          alert={Math.abs(summary.difference) > 0.001}
        />
      </div>

      <div className="grid gap-3 p-4 xl:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="text-[11px] font-medium text-black/65">
            Saldos por modalidad
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CASH_METHODS.map((method) => (
              <div
                key={method}
                className="rounded-xl bg-[#f7f7f8] px-3 py-2.5"
              >
                <p className="truncate text-[10px] text-black/40">
                  {CASH_METHOD_LABELS[method]}
                </p>
                <p className="mt-1 truncate text-[12px] font-medium text-black">
                  {formatCurrency(summary.balances[method])}
                </p>
              </div>
            ))}
          </div>

          {summary.pendingAddi > 0 && (
            <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
              Addi pendiente por recibir: {formatCurrency(summary.pendingAddi)}
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-medium text-black/65">
            Operadores de hoy
          </p>

          <div className="mt-2 space-y-2">
            {summary.sessions.length === 0 ? (
              <div className="rounded-xl bg-[#f7f7f8] px-3 py-4 text-[11px] text-black/40">
                Todavía no hay cajas registradas hoy.
              </div>
            ) : (
              summary.sessions.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl border border-black/[0.06] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-black">
                      {item.operatorName || "Vendedor"}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-black/40">
                      {item.status === "open"
                        ? "Caja abierta"
                        : "Caja cerrada"}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-[10px] text-black/35">
                      Vendido
                    </p>
                    <p className="text-[11px] font-medium text-black">
                      {formatCurrency(item.totalSales)}
                    </p>
                  </div>

                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      item.status === "open"
                        ? "bg-emerald-500"
                        : "bg-black/20"
                    }`}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CashMetric({ label, value, alert = false }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] text-black/40">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-[15px] font-medium ${
          alert ? "text-red-600" : "text-black"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PaymentBreakdownCard({ breakdown }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {CASH_METHODS.map((method) => (
        <div
          key={method}
          className="flex items-center justify-between gap-3 rounded-xl bg-[#f7f7f8] px-3 py-2.5"
        >
          <span className="text-[11px] text-black/45">
            {CASH_METHOD_LABELS[method]}
          </span>
          <strong className="text-[11px] font-medium text-black">
            {formatCurrency(breakdown.totals[method])}
          </strong>
        </div>
      ))}
    </div>
  );
}

function InventoryAlerts({ alerts }) {
  return (
    <section className="min-w-0 rounded-[22px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
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
                    <p className="mt-0.5 truncate text-[12px] text-black/42">
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
    <section className="min-w-0 rounded-[22px] bg-white shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
      <div className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon size={18} strokeWidth={1.9} />
        </div>

        <div className="min-w-0">
          <h2 className="text-[15px] font-medium leading-5 text-black">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[12px] leading-5 text-black/45">
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
              const color =
                CHART_COLORS[
                  index % CHART_COLORS.length
                ];

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
                    <p className="mt-0.5 truncate text-[12px] text-black/42">
                      {item.units} unidad(es) · {item.salesCount} venta(s)
                    </p>
                  </div>

                  <p className="shrink-0 text-right text-[13px] font-medium text-black">
                    {valueKey === "units"
                      ? item.units
                      : formatCompactCurrency(
                          item[valueKey]
                        )}
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

function getSaleProductSummary(sale) {
  const items = getSaleItems(sale);

  if (!items.length) {
    return "Venta sin productos";
  }

  const first = items[0]?.productName || "Producto";

  if (items.length === 1) {
    return first;
  }

  return `${first} + ${items.length - 1} más`;
}

function getPaymentSummary(sale) {
  const payments = normalizeSalePayments(sale);

  if (payments.length === 1) {
    return CASH_METHOD_LABELS[payments[0].method] || payments[0].method;
  }

  return "Pago mixto";
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
          <table className="min-w-[700px] w-full text-left text-[12px]">
            <thead className="bg-black/[0.025] text-black/45">
              <tr>
                <th className="px-3 py-2 font-normal">
                  Venta
                </th>
                <th className="px-3 py-2 font-normal">
                  Productos
                </th>
                <th className="px-3 py-2 font-normal">
                  Unidades
                </th>
                <th className="px-3 py-2 font-normal">
                  Pago
                </th>
                <th className="px-3 py-2 text-right font-normal">
                  Total
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-black/[0.06]">
              {sales.slice(0, 8).map((sale) => (
                <tr key={sale.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-black">
                      {sale.saleNumber || "Venta"}
                    </p>
                    <p className="text-[11px] text-black/40">
                      {formatDateTime(sale.createdAt)}
                    </p>
                  </td>

                  <td className="px-3 py-2">
                    <p className="max-w-[260px] truncate font-medium text-black">
                      {getSaleProductSummary(sale)}
                    </p>
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {getSaleUnits(sale)}
                  </td>

                  <td className="px-3 py-2 text-black/55">
                    {getPaymentSummary(sale)}
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
      subtitle="Cada fila representa una venta completa; sus productos aparecen agrupados dentro de la operación."
      icon={ShoppingBag}
      className="xl:col-span-8"
    >
      {sales.length === 0 ? (
        <div className="rounded-[18px] bg-black/[0.025] p-6 text-center text-[13px] text-black/40">
          No hay ventas registradas para este día.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[18px] border border-black/[0.06]">
          <table className="min-w-[1180px] w-full text-left text-[12px]">
            <thead className="bg-black/[0.025] text-black/45">
              <tr>
                <th className="w-[130px] px-3 py-2 font-normal">
                  Venta
                </th>

                <th className="w-[190px] px-3 py-2 font-normal">
                  Cliente
                </th>

                <th className="min-w-[330px] px-3 py-2 font-normal">
                  Productos
                </th>

                <th className="w-[90px] px-3 py-2 text-center font-normal">
                  Unidades
                </th>

                <th className="w-[130px] px-3 py-2 text-right font-normal">
                  Total venta
                </th>

                <th className="w-[130px] px-3 py-2 text-right font-normal">
                  Utilidad
                </th>

                <th className="w-[130px] px-3 py-2 font-normal">
                  Pago
                </th>

                <th className="w-[180px] px-3 py-2 font-normal">
                  Vendedor
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-black/[0.06]">
              {sales.map((sale) => {
                const items = getAllocatedSaleLines(sale);
                const units = getSaleUnits(sale);
                const profit = getSaleProfit(sale);

                return (
                  <tr
                    key={sale.id}
                    className="align-top transition hover:bg-black/[0.012]"
                  >
                    <td className="px-3 py-3">
                      <p className="font-semibold text-black">
                        {sale.saleNumber || "Venta"}
                      </p>

                      <p className="mt-1 text-[10px] leading-4 text-black/38">
                        {formatDateTime(sale.createdAt)}
                      </p>
                    </td>

                    <td className="px-3 py-3">
                      <p className="max-w-[180px] truncate text-[11px] font-medium text-black/75">
                        {String(sale.customerName || "").trim() ||
                          "Venta sin cliente"}
                      </p>

                      {String(
                        sale.customerDocument || ""
                      ).trim() ? (
                        <p className="mt-0.5 max-w-[180px] truncate text-[9.5px] text-black/38">
                          C.C. {sale.customerDocument}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[9.5px] text-black/28">
                          Sin documento
                        </p>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="space-y-1.5">
                        {items.length === 0 ? (
                          <div className="rounded-[10px] bg-black/[0.025] px-3 py-2 text-[10px] text-black/38">
                            Sin productos registrados.
                          </div>
                        ) : (
                          items.map((item, index) => (
                            <div
                              key={`${sale.id}-${
                                item.analyticsKey || index
                              }`}
                              className="rounded-[10px] border border-black/[0.045] bg-[#fbfbfc] px-3 py-2"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[11px] font-medium text-black">
                                    {item.productName || "Producto"}
                                  </p>

                                  <p className="mt-0.5 truncate text-[9.5px] text-black/38">
                                    {item.productCode || "Sin código"}
                                    {" · "}
                                    {item.categoryName || "Sin categoría"}
                                    {" · Talla "}
                                    {item.size || "Talla única"}
                                  </p>
                                </div>

                                <div className="shrink-0 text-right">
                                  <p className="text-[10px] font-semibold text-black/70">
                                    × {item.quantity}
                                  </p>

                                  <p className="mt-0.5 text-[9px] text-black/35">
                                    {formatCurrency(item.revenue)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                        {units}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-right">
                      <p className="font-semibold text-black">
                        {formatCurrency(sale.total)}
                      </p>

                      {Number(sale.discount || 0) > 0 && (
                        <p className="mt-1 text-[9px] text-red-600">
                          - {formatCurrency(sale.discount)} desc.
                        </p>
                      )}
                    </td>

                    <td className="px-3 py-3 text-right font-semibold text-emerald-700">
                      {formatCurrency(profit)}
                    </td>

                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full bg-black/[0.035] px-2.5 py-1 text-[10px] font-medium text-black/55">
                        {getPaymentSummary(sale)}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <p className="max-w-[180px] truncate text-[11px] font-medium text-black/70">
                        {sale.sellerName ||
                          sale.sellerEmail ||
                          "Sin vendedor"}
                      </p>

                      {sale.sellerName &&
                        sale.sellerEmail &&
                        sale.sellerName !== sale.sellerEmail && (
                          <p className="mt-0.5 max-w-[180px] truncate text-[9px] text-black/35">
                            {sale.sellerEmail}
                          </p>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function ComparisonMetric({
  label,
  previous,
  current,
  currency = false,
}) {
  const change = getPercentChange(previous, current);
  const isPositive = change >= 0;

  return (
    <article className="rounded-[22px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
      <p className="text-[12px] font-normal text-black/45">
        {label}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl bg-blue-50 p-3">
          <p className="text-[11px] text-blue-700">
            Mes comparado
          </p>
          <p className="mt-1 text-[15px] font-medium text-black">
            {currency
              ? formatCurrency(previous)
              : previous}
          </p>
        </div>

        <div className="rounded-2xl bg-red-50 p-3">
          <p className="text-[11px] text-red-600">
            Mes principal
          </p>
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
        {isPositive ? (
          <TrendingUp size={13} />
        ) : (
          <TrendingDown size={13} />
        )}
        {Math.abs(change).toFixed(1)}%
      </div>
    </article>
  );
}

function getSessionAnalytics(
  session,
  sales,
  movements
) {
  const liveSummary = buildCashSessionSummary(
    session,
    sales,
    movements
  );

  if (
    session.status === "closed" &&
    session.closingBalances &&
    typeof session.closingBalances === "object"
  ) {
    const balances = CASH_METHODS.reduce(
      (result, method) => {
        result[method] = numberOrZero(
          session.closingBalances?.[method]
        );
        return result;
      },
      {}
    );

    return {
      balances,
      totalSales:
        session.closingTotalSales !== undefined
          ? numberOrZero(session.closingTotalSales)
          : liveSummary.totalSales,
      saleCount:
        session.closingSaleCount !== undefined
          ? numberOrZero(session.closingSaleCount)
          : liveSummary.saleCount,
      pendingAddi:
        session.closingPendingAddi !== undefined
          ? numberOrZero(session.closingPendingAddi)
          : liveSummary.pendingAddi,
      expectedCash:
        session.expectedCash !== undefined
          ? numberOrZero(session.expectedCash)
          : numberOrZero(balances.efectivo),
      totalAvailable: Object.values(balances).reduce(
        (sum, value) => sum + numberOrZero(value),
        0
      ),
    };
  }

  return liveSummary;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const defaults = useMemo(() => getDefaultMonthKeys(), []);

  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [cashSessions, setCashSessions] = useState([]);
  const [cashMovementsBySession, setCashMovementsBySession] =
    useState({});

  const [activeView, setActiveView] = useState("summary");
  const [monthA, setMonthA] = useState(
    defaults.previousMonth
  );
  const [monthB, setMonthB] = useState(
    defaults.currentMonth
  );

  const [dailyMonth, setDailyMonth] = useState(
    defaults.currentMonth
  );
  const [dailyDay, setDailyDay] = useState(
    defaults.currentDay
  );

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    const unsubscribeSales = subscribeSales(
      (salesData) => {
        setSales(
          Array.isArray(salesData) ? salesData : []
        );
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoading(false);
      },
      STORE_ID
    );

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(
          Array.isArray(productsData)
            ? productsData
            : []
        );
      },
      (error) => {
        console.error(error);
      },
      STORE_ID
    );

    const unsubscribeCashSessions =
      subscribeCashSessions(
        (values) => {
          setCashSessions(
            Array.isArray(values) ? values : []
          );
        },
        (error) => {
          console.error(error);
        },
        STORE_ID
      );

    return () => {
      unsubscribeSales();
      unsubscribeProducts();
      unsubscribeCashSessions();
    };
  }, []);

  const todayBusinessDate = getBogotaBusinessDate();

  const todayCashSessions = useMemo(
    () =>
      cashSessions.filter(
        (session) =>
          session.businessDate === todayBusinessDate
      ),
    [cashSessions, todayBusinessDate]
  );

  const todayCashSessionKey = useMemo(
    () =>
      todayCashSessions
        .map((session) => session.id)
        .sort()
        .join("|"),
    [todayCashSessions]
  );

  useEffect(() => {
    const unsubs = todayCashSessions.map((session) =>
      subscribeCashMovements(
        session.id,
        (values) => {
          setCashMovementsBySession((current) => ({
            ...current,
            [session.id]: Array.isArray(values)
              ? values
              : [],
          }));
        },
        (error) => {
          console.error(error);
        }
      )
    );

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [todayCashSessionKey]);

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

  const monthASales = useMemo(
    () => filterSalesByMonth(sales, monthA),
    [sales, monthA]
  );

  const monthBSales = useMemo(
    () => filterSalesByMonth(sales, monthB),
    [sales, monthB]
  );

  const selectedDaySales = useMemo(
    () => filterSalesByDay(sales, dailyMonth, dailyDay),
    [sales, dailyMonth, dailyDay]
  );

  const monthAMetrics = useMemo(
    () => finalizeMetrics(calculateMetrics(monthASales)),
    [monthASales]
  );

  const monthBMetrics = useMemo(
    () => finalizeMetrics(calculateMetrics(monthBSales)),
    [monthBSales]
  );

  const selectedDayMetrics = useMemo(
    () =>
      finalizeMetrics(
        calculateMetrics(selectedDaySales)
      ),
    [selectedDaySales]
  );

  const allTimeMetrics = useMemo(
    () => finalizeMetrics(calculateMetrics(sales)),
    [sales]
  );

  const productRanking = useMemo(
    () =>
      buildItemRanking(
        monthBSales,
        (line) =>
          line.productId ||
          line.productName ||
          "sin-producto",
        (line) =>
          line.productName || "Producto sin nombre"
      ),
    [monthBSales]
  );

  const categoryRanking = useMemo(
    () =>
      buildItemRanking(
        monthBSales,
        (line) =>
          line.categoryId ||
          line.categoryName ||
          "sin-categoria",
        (line) =>
          line.categoryName || "Sin categoría"
      ),
    [monthBSales]
  );

  const sizeRanking = useMemo(
    () =>
      buildItemRanking(
        monthBSales,
        (line) => line.size || "Talla única",
        (line) => line.size || "Talla única"
      ),
    [monthBSales]
  );

  const sellerRanking = useMemo(
    () => buildSellerRanking(monthBSales),
    [monthBSales]
  );

  const selectedDayProductRanking = useMemo(
    () =>
      buildItemRanking(
        selectedDaySales,
        (line) =>
          line.productId ||
          line.productName ||
          "sin-producto",
        (line) =>
          line.productName || "Producto sin nombre"
      ),
    [selectedDaySales]
  );

  const dailySales = useMemo(
    () => buildDailySales(monthBSales),
    [monthBSales]
  );

  const previousProductRanking = useMemo(
    () =>
      buildItemRanking(
        monthASales,
        (line) =>
          line.productId ||
          line.productName ||
          "sin-producto",
        (line) =>
          line.productName || "Producto sin nombre"
      ),
    [monthASales]
  );

  const comparisonDaily = useMemo(
    () => buildDayComparison(monthASales, monthBSales),
    [monthASales, monthBSales]
  );

  const monthPaymentBreakdown = useMemo(
    () => buildPaymentBreakdown(monthBSales),
    [monthBSales]
  );

  const inventoryMetrics = useMemo(() => {
    return products.reduce(
      (acc, product) => {
        const stock = numberOrZero(product.stock);
        const costPrice = numberOrZero(product.costPrice);
        const salePrice = numberOrZero(product.salePrice);

        acc.products += 1;
        acc.units += stock;
        acc.cost += costPrice * stock;
        acc.potentialRevenue += salePrice * stock;
        acc.potentialProfit +=
          (salePrice - costPrice) * stock;

        if (stock <= 0) acc.emptyProducts += 1;
        if (stock > 0 && stock <= 3) {
          acc.lowStockProducts += 1;
        }

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

  const inventoryAlerts = useMemo(
    () => buildInventoryAlerts(products, productRanking),
    [products, productRanking]
  );

  const todayCashSummary = useMemo(() => {
    const balances = CASH_METHODS.reduce(
      (result, method) => {
        result[method] = 0;
        return result;
      },
      {}
    );

    const sessionRows = todayCashSessions.map(
      (session) => {
        const summary = getSessionAnalytics(
          session,
          sales,
          cashMovementsBySession[session.id] || []
        );

        CASH_METHODS.forEach((method) => {
          balances[method] += numberOrZero(
            summary.balances?.[method]
          );
        });

        return {
          id: session.id,
          operatorName: session.operatorName,
          status: session.status,
          totalSales: summary.totalSales,
          saleCount: summary.saleCount,
          expectedCash: summary.expectedCash,
          pendingAddi: summary.pendingAddi,
          openingAmount: numberOrZero(
            session.openingAmount
          ),
          difference:
            session.status === "closed"
              ? Number(session.difference || 0)
              : 0,
        };
      }
    );

    return {
      businessDate: todayBusinessDate,
      sessions: sessionRows,
      openCount: sessionRows.filter(
        (item) => item.status === "open"
      ).length,
      closedCount: sessionRows.filter(
        (item) => item.status === "closed"
      ).length,
      openingAmount: sessionRows.reduce(
        (sum, item) => sum + item.openingAmount,
        0
      ),
      totalSales: sessionRows.reduce(
        (sum, item) => sum + item.totalSales,
        0
      ),
      saleCount: sessionRows.reduce(
        (sum, item) => sum + item.saleCount,
        0
      ),
      expectedCash: sessionRows.reduce(
        (sum, item) => sum + item.expectedCash,
        0
      ),
      pendingAddi: sessionRows.reduce(
        (sum, item) => sum + item.pendingAddi,
        0
      ),
      difference: sessionRows.reduce(
        (sum, item) => sum + item.difference,
        0
      ),
      balances,
    };
  }, [
    todayCashSessions,
    sales,
    cashMovementsBySession,
    todayBusinessDate,
  ]);

  const salesTrendOptions = useMemo(
    () =>
      getBaseChartOptions({
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
          categories: dailySales.map(
            (item) => item.label
          ),
          labels: {
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        yaxis: {
          labels: {
            formatter: (value) =>
              formatCompactCurrency(value),
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        tooltip: {
          y: {
            formatter: (value) =>
              formatCurrency(value),
          },
        },
      }),
    [dailySales]
  );

  const salesTrendSeries = useMemo(
    () => [
      {
        name: "Ventas",
        data: dailySales.map((item) =>
          numberOrZero(item.total)
        ),
      },
    ],
    [dailySales]
  );

  const categoryDonutOptions = useMemo(
    () =>
      getBaseChartOptions({
        labels: categoryRanking
          .slice(0, 8)
          .map((item) => item.label),
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
                        (sum, item) =>
                          sum +
                          numberOrZero(item.revenue),
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
            formatter: (value) =>
              formatCurrency(value),
          },
        },
      }),
    [categoryRanking]
  );

  const categoryDonutSeries = useMemo(
    () =>
      categoryRanking
        .slice(0, 8)
        .map((item) => numberOrZero(item.revenue)),
    [categoryRanking]
  );

  const paymentDonutOptions = useMemo(() => {
    const activeMethods = CASH_METHODS.filter(
      (method) =>
        numberOrZero(
          monthPaymentBreakdown.totals[method]
        ) > 0
    );

    return getBaseChartOptions({
      labels: activeMethods.map(
        (method) => CASH_METHOD_LABELS[method]
      ),
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
                label: "Cobrado",
                formatter: () =>
                  formatCompactCurrency(
                    monthPaymentBreakdown.total
                  ),
              },
            },
          },
        },
      },
      tooltip: {
        y: {
          formatter: (value) =>
            formatCurrency(value),
        },
      },
    });
  }, [monthPaymentBreakdown]);

  const paymentDonutSeries = useMemo(
    () =>
      CASH_METHODS.filter(
        (method) =>
          numberOrZero(
            monthPaymentBreakdown.totals[method]
          ) > 0
      ).map((method) =>
        numberOrZero(
          monthPaymentBreakdown.totals[method]
        )
      ),
    [monthPaymentBreakdown]
  );

  const productBarOptions = useMemo(
    () =>
      getBaseChartOptions({
        colors: CHART_COLORS,
        plotOptions: {
          bar: {
            borderRadius: 8,
            columnWidth: "45%",
            distributed: true,
          },
        },
        xaxis: {
          categories: productRanking
            .slice(0, 8)
            .map((item) => item.label),
          labels: {
            rotate: -20,
            trim: true,
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        yaxis: {
          labels: {
            formatter: (value) =>
              formatCompactCurrency(value),
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        legend: { show: false },
        tooltip: {
          y: {
            formatter: (value) =>
              formatCurrency(value),
          },
        },
      }),
    [productRanking]
  );

  const productBarSeries = useMemo(
    () => [
      {
        name: "Vendido",
        data: productRanking
          .slice(0, 8)
          .map((item) => numberOrZero(item.revenue)),
      },
    ],
    [productRanking]
  );

  const selectedDayProductOptions = useMemo(
    () =>
      getBaseChartOptions({
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
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        yaxis: {
          labels: {
            formatter: (value) =>
              formatCompactCurrency(value),
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        legend: { show: false },
        tooltip: {
          y: {
            formatter: (value) =>
              formatCurrency(value),
          },
        },
      }),
    [selectedDayProductRanking]
  );

  const selectedDayProductSeries = useMemo(
    () => [
      {
        name: "Vendido",
        data: selectedDayProductRanking
          .slice(0, 8)
          .map((item) => numberOrZero(item.revenue)),
      },
    ],
    [selectedDayProductRanking]
  );

  const sizesDonutOptions = useMemo(
    () =>
      getBaseChartOptions({
        labels: sizeRanking
          .slice(0, 8)
          .map((item) => item.label),
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
                      .reduce(
                        (sum, item) =>
                          sum +
                          numberOrZero(item.units),
                        0
                      )
                      .toLocaleString("es-CO"),
                },
              },
            },
          },
        },
        tooltip: {
          y: {
            formatter: (value) =>
              `${value} unidad(es)`,
          },
        },
      }),
    [sizeRanking]
  );

  const sizesDonutSeries = useMemo(
    () =>
      sizeRanking
        .slice(0, 8)
        .map((item) => numberOrZero(item.units)),
    [sizeRanking]
  );

  const sellersBarOptions = useMemo(
    () =>
      getBaseChartOptions({
        colors: ["#2563eb"],
        plotOptions: {
          bar: {
            horizontal: true,
            borderRadius: 8,
          },
        },
        xaxis: {
          categories: sellerRanking
            .slice(0, 7)
            .map((item) => item.label),
          labels: {
            formatter: (value) =>
              formatCompactCurrency(value),
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        yaxis: {
          labels: {
            style: {
              colors: "#374151",
              fontSize: "11px",
            },
          },
        },
        tooltip: {
          y: {
            formatter: (value) =>
              formatCurrency(value),
          },
        },
      }),
    [sellerRanking]
  );

  const sellersBarSeries = useMemo(
    () => [
      {
        name: "Vendido",
        data: sellerRanking
          .slice(0, 7)
          .map((item) => numberOrZero(item.revenue)),
      },
    ],
    [sellerRanking]
  );

  const comparisonLineOptions = useMemo(
    () =>
      getBaseChartOptions({
        colors: ["#2563eb", BRAND_RED],
        stroke: {
          curve: "smooth",
          width: 3,
        },
        xaxis: {
          categories: comparisonDaily.categories,
          title: { text: "Día del mes" },
          labels: {
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        yaxis: {
          labels: {
            formatter: (value) =>
              formatCompactCurrency(value),
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        tooltip: {
          y: {
            formatter: (value) =>
              formatCurrency(value),
          },
        },
      }),
    [comparisonDaily.categories]
  );

  const comparisonLineSeries = useMemo(
    () => [
      {
        name: formatMonthLabel(monthA),
        data: comparisonDaily.dataA,
      },
      {
        name: formatMonthLabel(monthB),
        data: comparisonDaily.dataB,
      },
    ],
    [comparisonDaily, monthA, monthB]
  );

  const previousProductOptions = useMemo(
    () =>
      getBaseChartOptions({
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
            style: {
              colors: "#6b7280",
              fontSize: "11px",
            },
          },
        },
        yaxis: {
          labels: {
            formatter: (value) =>
              formatCompactCurrency(value),
          },
        },
        legend: { show: false },
        tooltip: {
          y: {
            formatter: (value) =>
              formatCurrency(value),
          },
        },
      }),
    [previousProductRanking]
  );

  const previousProductSeries = useMemo(
    () => [
      {
        name: "Vendido",
        data: previousProductRanking
          .slice(0, 7)
          .map((item) => numberOrZero(item.revenue)),
      },
    ],
    [previousProductRanking]
  );

  const dailyDays = useMemo(
    () =>
      Array.from(
        { length: getDaysInMonth(dailyMonth) },
        (_, index) => index + 1
      ),
    [dailyMonth]
  );

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 font-sans sm:px-5 lg:px-6">
      <section className="w-full">
        <section className="flex flex-col gap-3 border-b border-black/[0.06] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mt-1 text-[28px] font-medium tracking-[-0.045em] text-black">
              Dashboard
            </h1>

            <p className="mt-1 max-w-2xl text-[13px] font-normal text-black/50">
              Ventas, caja, inventario y rendimiento comercial en una sola vista.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ViewTabs
              activeView={activeView}
              setActiveView={setActiveView}
            />

            {activeView !== "comparison" &&
              activeView !== "daily" && (
                <div className="rounded-2xl bg-white p-1 shadow-sm ring-1 ring-black/[0.08]">
                  <input
                    type="month"
                    value={monthB}
                    onChange={(event) =>
                      setMonthB(event.target.value)
                    }
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
                subtitle="Productos vendidos"
                icon={Boxes}
                color="#16a34a"
              />

              <MetricCard
                title="Utilidad"
                value={monthBMetrics.profit}
                subtitle={`Margen ${monthBMetrics.margin.toFixed(
                  1
                )}%`}
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

            <CashTodayPanel
              summary={todayCashSummary}
              onOpenCash={() => navigate("/admin/caja")}
            />

            <section className="mt-3 grid gap-3 xl:grid-cols-12">
              <SectionCard
                className="xl:col-span-7"
                title="Evolución de ventas"
                subtitle={`Ventas diarias de ${formatMonthLabel(
                  monthB
                )}`}
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
                subtitle="Participación real de ingresos por categoría"
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

            <section className="mt-3 grid gap-3 xl:grid-cols-12">
              <SectionCard
                className="xl:col-span-5"
                title="Formas de pago"
                subtitle={`Distribución real de ${formatMonthLabel(
                  monthB
                )}`}
                icon={CreditCard}
              >
                {paymentDonutSeries.length === 0 ? (
                  <EmptyState text="No hay pagos registrados." />
                ) : (
                  <div className="h-[320px]">
                    <Chart
                      type="donut"
                      height="100%"
                      options={paymentDonutOptions}
                      series={paymentDonutSeries}
                    />
                  </div>
                )}
              </SectionCard>

              <SectionCard
                className="xl:col-span-7"
                title="Detalle por medio de pago"
                subtitle="Las ventas mixtas se distribuyen entre sus medios reales"
                icon={Landmark}
              >
                <PaymentBreakdownCard
                  breakdown={monthPaymentBreakdown}
                />

                {monthPaymentBreakdown.pendingAddi > 0 && (
                  <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
                    Addi pendiente en el periodo: {formatCurrency(
                      monthPaymentBreakdown.pendingAddi
                    )}
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
                subtitle="Ranking visual por ingresos netos"
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

              <RecentSalesTable
                sales={sales}
                className="xl:col-span-5"
              />
            </section>
          </>
        ) : activeView === "daily" ? (
          <>
            <section className="mt-4 rounded-[22px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-red-600">
                    Historial diario
                  </p>
                  <h2 className="mt-1 text-[21px] font-medium tracking-[-0.04em] text-black">
                    Ventas por día
                  </h2>
                  <p className="mt-1 max-w-2xl text-[13px] text-black/50">
                    Revisa cada producto vendido, el total y la utilidad real del día.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="text-[12px] text-black/45">
                      Mes
                    </span>
                    <input
                      type="month"
                      value={dailyMonth}
                      onChange={(event) =>
                        setDailyMonth(event.target.value)
                      }
                      className="mt-1 h-9 w-full rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    />
                  </label>

                  <label>
                    <span className="text-[12px] text-black/45">
                      Día
                    </span>
                    <select
                      value={dailyDay}
                      onChange={(event) =>
                        setDailyDay(event.target.value)
                      }
                      className="mt-1 h-9 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    >
                      {dailyDays.map((day) => (
                        <option
                          key={day}
                          value={String(day)}
                        >
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
                subtitle={formatDayLabel(
                  dailyMonth,
                  dailyDay
                )}
                icon={BadgeDollarSign}
                currency
                featured
                color="#c1121f"
              />

              <MetricCard
                title="Ganancia del día"
                value={selectedDayMetrics.profit}
                subtitle={`Margen ${selectedDayMetrics.margin.toFixed(
                  1
                )}%`}
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
                subtitle="Productos vendidos"
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
            <section className="mt-4 rounded-[22px] bg-white p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-red-600">
                    Comparativa mensual
                  </p>
                  <h2 className="mt-1 text-[21px] font-medium tracking-[-0.04em] text-black">
                    Compara dos meses
                  </h2>
                  <p className="mt-1 max-w-2xl text-[13px] text-black/50">
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
                      onChange={(event) =>
                        setMonthA(event.target.value)
                      }
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
                      onChange={(event) =>
                        setMonthB(event.target.value)
                      }
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
                subtitle={`${formatMonthLabel(
                  monthA
                )} vs ${formatMonthLabel(monthB)}`}
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
                  value={
                    monthBMetrics.revenue -
                    monthAMetrics.revenue
                  }
                  subtitle="Mes principal - comparado"
                  icon={BadgeDollarSign}
                  currency
                  color={
                    monthBMetrics.revenue -
                      monthAMetrics.revenue >=
                    0
                      ? "#16a34a"
                      : "#c1121f"
                  }
                />
              </div>
            </section>

            <section className="mt-3 grid gap-3 xl:grid-cols-2">
              <SectionCard
                title={`Productos · ${formatMonthLabel(
                  monthA
                )}`}
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
                title={`Productos · ${formatMonthLabel(
                  monthB
                )}`}
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
