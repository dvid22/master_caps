function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
}

function quantity(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(Math.trunc(number), 0) : 0;
}

function getSaleItems(sale = {}) {
  if (Array.isArray(sale?.items) && sale.items.length > 0) {
    return sale.items;
  }

  return [
    {
      quantity: sale?.quantity,
      unitPrice: sale?.unitPrice,
      regularUnitPrice:
        sale?.regularUnitPrice !== undefined
          ? sale.regularUnitPrice
          : sale?.unitPrice,
      isPromotion: sale?.isPromotion,
      promotionDiscount: sale?.promotionDiscount,
    },
  ];
}

/**
 * Fuente única para trazabilidad comercial.
 *
 * Conceptos:
 * - regularSubtotal: valor que habría tenido la venta a precio normal.
 * - promotionDiscount: ahorro generado únicamente por promociones de producto.
 * - manualDiscount: descuento adicional aplicado en el POS.
 * - totalDiscount: promoción + descuento manual.
 * - total: dinero realmente cobrado al cliente.
 *
 * Nunca consulta el producto actual. Trabaja exclusivamente con el snapshot
 * guardado dentro de la venta para que el historial no cambie al modificar
 * o retirar una promoción posteriormente.
 */
export function getSaleCommercialTrace(sale = {}) {
  const items = getSaleItems(sale);

  const subtotal =
    sale?.subtotal !== undefined
      ? money(sale.subtotal)
      : items.reduce(
          (sum, item) =>
            sum + money(item?.unitPrice) * quantity(item?.quantity),
          0
        );

  const regularSubtotalFromItems = items.reduce((sum, item) => {
    const regularUnitPrice =
      item?.regularUnitPrice !== undefined
        ? money(item.regularUnitPrice)
        : money(item?.unitPrice);

    const explicitRegularSubtotal =
      item?.regularSubtotal !== undefined
        ? money(item.regularSubtotal)
        : regularUnitPrice * quantity(item?.quantity);

    return sum + explicitRegularSubtotal;
  }, 0);

  const promotionDiscountFromItems = items.reduce((sum, item) => {
    if (item?.promotionDiscount !== undefined) {
      return sum + money(item.promotionDiscount);
    }

    const unitPrice = money(item?.unitPrice);
    const regularUnitPrice =
      item?.regularUnitPrice !== undefined
        ? money(item.regularUnitPrice)
        : unitPrice;

    return (
      sum +
      Math.max(
        (regularUnitPrice - unitPrice) * quantity(item?.quantity),
        0
      )
    );
  }, 0);

  const promotionUnitsFromItems = items.reduce(
    (sum, item) =>
      sum +
      (Boolean(item?.isPromotion)
        ? quantity(item?.quantity)
        : 0),
    0
  );

  const promotionLineCountFromItems = items.filter((item) =>
    Boolean(item?.isPromotion)
  ).length;

  const regularSubtotal =
    sale?.regularSubtotal !== undefined
      ? money(sale.regularSubtotal)
      : Math.max(
          regularSubtotalFromItems,
          subtotal,
          money(sale?.total)
        );

  const hasPromotionSnapshot =
    sale?.hasPromotion !== undefined
      ? Boolean(sale.hasPromotion)
      : promotionUnitsFromItems > 0 ||
        promotionLineCountFromItems > 0;

  const promotionDiscount =
    sale?.promotionDiscount !== undefined
      ? money(sale.promotionDiscount)
      : hasPromotionSnapshot
        ? Math.max(
            promotionDiscountFromItems,
            regularSubtotal - subtotal,
            0
          )
        : promotionDiscountFromItems;

  const manualDiscount = money(
    sale?.manualDiscount !== undefined
      ? sale.manualDiscount
      : sale?.discount
  );

  const totalDiscount =
    sale?.totalDiscount !== undefined
      ? money(sale.totalDiscount)
      : promotionDiscount + manualDiscount;

  const promotionUnits =
    sale?.promotionUnits !== undefined
      ? quantity(sale.promotionUnits)
      : promotionUnitsFromItems;

  const promotionLineCount =
    sale?.promotionLineCount !== undefined
      ? quantity(sale.promotionLineCount)
      : promotionLineCountFromItems;

  const total =
    sale?.total !== undefined
      ? money(sale.total)
      : Math.max(subtotal - manualDiscount, 0);

  return {
    regularSubtotal,
    promotionDiscount,
    promotionSubtotal: subtotal,
    manualDiscount,
    totalDiscount,
    total,
    promotionUnits,
    promotionLineCount,
    hasPromotion:
      hasPromotionSnapshot ||
      promotionDiscount > 0 ||
      promotionUnits > 0,
  };
}

export function getPromotionSavingsForItem(item = {}) {
  if (item?.promotionDiscount !== undefined) {
    return money(item.promotionDiscount);
  }

  const unitPrice = money(item?.unitPrice);
  const regularUnitPrice =
    item?.regularUnitPrice !== undefined
      ? money(item.regularUnitPrice)
      : unitPrice;

  return Math.max(
    (regularUnitPrice - unitPrice) * quantity(item?.quantity),
    0
  );
}
