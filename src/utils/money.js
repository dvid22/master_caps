export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const cleaned = String(value)
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.]/g, "");

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

export function formatCurrency(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(number);
}

export function calculateProfit(costPrice, salePrice) {
  const cost = toNumber(costPrice);
  const sale = toNumber(salePrice);

  const profitMargin = sale - cost;
  const profitPercent = cost > 0 ? (profitMargin / cost) * 100 : 0;

  return {
    profitMargin,
    profitPercent,
  };
}