import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Printer,
  ReceiptText,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";

const DEFAULT_STORE = {
  name: "MASTER CAPS",
  logoUrl: "",
  nit: "",
  address: "",
  phone: "",
  city: "",
  footerMessage: "Gracias por tu compra",
  secondaryMessage: "Conserva este recibo para cambios o garantías",
};

function toSafeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toSafeNumber(value));
}

function formatDate(value) {
  if (!value) {
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date());
  }

  let date = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value?.toDate === "function") {
    date = value.toDate();
  } else if (typeof value?.seconds === "number") {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatPaymentMethod(value) {
  const methods = {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    nequi: "Nequi",
    daviplata: "Daviplata",
    tarjeta: "Tarjeta",
    otro: "Otro",
  };

  return methods[String(value || "").toLowerCase()] || String(value || "Efectivo");
}

function normalizeReceiptItems(sale) {
  if (Array.isArray(sale?.items) && sale.items.length > 0) {
    return sale.items.map((item, index) => {
      const quantity = Math.max(toSafeNumber(item.quantity), 0);
      const unitPrice = Math.max(toSafeNumber(item.unitPrice), 0);

      return {
        lineId: item.lineId || `line-${index + 1}`,
        productName: item.productName || "Producto",
        productCode: item.productCode || "",
        size: item.size || item.productSize || "Talla única",
        quantity,
        unitPrice,
        subtotal:
          item.subtotal !== undefined
            ? toSafeNumber(item.subtotal)
            : unitPrice * quantity,
      };
    });
  }

  if (sale?.productId || sale?.productName) {
    const quantity = Math.max(toSafeNumber(sale.quantity), 0);
    const unitPrice = Math.max(toSafeNumber(sale.unitPrice), 0);

    return [
      {
        lineId: "legacy-line-1",
        productName: sale.productName || "Producto",
        productCode: sale.productCode || "",
        size: sale.productSize || sale.size || "Talla única",
        quantity,
        unitPrice,
        subtotal:
          sale.total !== undefined
            ? toSafeNumber(sale.total)
            : unitPrice * quantity,
      },
    ];
  }

  return [];
}

function normalizeReceiptSale(sale = {}) {
  const items = normalizeReceiptItems(sale);

  const calculatedSubtotal = items.reduce(
    (total, item) => total + toSafeNumber(item.subtotal),
    0
  );

  const calculatedItems = items.reduce(
    (total, item) => total + toSafeNumber(item.quantity),
    0
  );

  const subtotal =
    sale.subtotal !== undefined
      ? toSafeNumber(sale.subtotal)
      : calculatedSubtotal;

  const discount = Math.max(toSafeNumber(sale.discount), 0);

  const total =
    sale.total !== undefined
      ? toSafeNumber(sale.total)
      : Math.max(subtotal - discount, 0);

  const amountReceived =
    sale.amountReceived !== undefined
      ? toSafeNumber(sale.amountReceived)
      : total;

  const change =
    sale.change !== undefined
      ? toSafeNumber(sale.change)
      : Math.max(amountReceived - total, 0);

  return {
    ...sale,
    items,
    saleNumber:
      sale.saleNumber || sale.receiptNumber || sale.id || "VENTA",
    subtotal,
    discount,
    total,
    amountReceived,
    change,
    totalItems:
      sale.totalItems !== undefined
        ? toSafeNumber(sale.totalItems)
        : calculatedItems,
    paymentMethod: formatPaymentMethod(sale.paymentMethod),
    customerName: String(sale.customerName || "").trim(),
    customerDocument: String(sale.customerDocument || "").trim(),
    customerPhone: String(sale.customerPhone || "").trim(),
    sellerName: String(sale.sellerName || "").trim(),
    notes: String(sale.notes || "").trim(),
    formattedDate: formatDate(sale.createdAt || sale.updatedAt),
  };
}

export default function ThermalReceipt({
  sale,
  open = true,
  onClose,
  store = DEFAULT_STORE,
  defaultPaperSize = "80mm",
  autoPrint = false,
  onPrinted,
}) {
  const [paperSize, setPaperSize] = useState(
    defaultPaperSize === "58mm" ? "58mm" : "80mm"
  );

  const [printing, setPrinting] = useState(false);

  const receipt = useMemo(() => normalizeReceiptSale(sale), [sale]);

  const storeData = useMemo(
    () => ({
      ...DEFAULT_STORE,
      ...(store || {}),
    }),
    [store]
  );

  useEffect(() => {
    if (!open || !autoPrint || !sale) return;

    const timer = window.setTimeout(() => {
      handlePrint();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [open, autoPrint, sale]);

  function handlePrint() {
    if (!sale || receipt.items.length === 0) {
      alert("No hay información suficiente para imprimir el recibo.");
      return;
    }

    try {
      setPrinting(true);

      document.documentElement.setAttribute(
        "data-thermal-paper-size",
        paperSize
      );

      window.setTimeout(() => {
        window.print();

        if (onPrinted) {
          onPrinted(receipt);
        }

        setPrinting(false);
      }, 120);
    } catch (error) {
      console.error("No se pudo abrir la impresión:", error);
      setPrinting(false);
      alert("No se pudo abrir el diálogo de impresión.");
    }
  }

  if (!open || !sale) {
    return null;
  }

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: var(--thermal-page-width, 80mm) auto;
            margin: 0;
          }

          html[data-thermal-paper-size="58mm"] {
            --thermal-page-width: 58mm;
          }

          html[data-thermal-paper-size="80mm"] {
            --thermal-page-width: 80mm;
          }

          html,
          body {
            width: var(--thermal-page-width, 80mm) !important;
            min-width: var(--thermal-page-width, 80mm) !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          body * {
            visibility: hidden !important;
          }

          #thermal-receipt-print-area,
          #thermal-receipt-print-area * {
            visibility: visible !important;
          }

          #thermal-receipt-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: var(--thermal-page-width, 80mm) !important;
            margin: 0 !important;
            padding: 3mm !important;
            box-sizing: border-box !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            border: none !important;
          }

          #thermal-receipt-print-area .thermal-no-print {
            display: none !important;
          }
        }

        #thermal-receipt-print-area {
          font-family:
            "Courier New",
            Courier,
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
        }

        #thermal-receipt-print-area.thermal-paper-58 {
          width: 58mm;
          font-size: 10px;
        }

        #thermal-receipt-print-area.thermal-paper-80 {
          width: 80mm;
          font-size: 11px;
        }
      `}</style>

      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-3 py-4 backdrop-blur-sm sm:px-5 sm:py-6">
        <section className="flex max-h-[94vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[30px] bg-[#f7f7f8] shadow-2xl">
          <header className="flex items-center justify-between border-b border-black/[0.06] bg-white px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <ReceiptText size={21} />
              </div>

              <div className="min-w-0">
                <p className="text-[12px] font-medium text-red-600">
                  Comprobante de venta
                </p>

                <h2 className="mt-0.5 truncate text-[20px] font-medium tracking-[-0.035em] text-black">
                  {receipt.saleNumber}
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600"
              aria-label="Cerrar recibo"
            >
              <X size={19} />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[320px_1fr]">
            <aside className="border-b border-black/[0.06] bg-white p-5 lg:border-b-0 lg:border-r">
              <div>
                <div className="flex items-center gap-2">
                  <Settings2 size={16} className="text-black/45" />

                  <p className="text-[13px] font-medium text-black">
                    Configuración de impresión
                  </p>
                </div>

                <p className="mt-1 text-[12px] leading-5 text-black/45">
                  Selecciona el ancho configurado en tu impresora térmica.
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaperSize("58mm")}
                  className={`rounded-2xl border px-3 py-3 text-left transition ${
                    paperSize === "58mm"
                      ? "border-red-600 bg-red-50 text-red-600"
                      : "border-black/[0.08] bg-white text-black hover:bg-black/[0.025]"
                  }`}
                >
                  <p className="text-[14px] font-medium">58 mm</p>
                  <p className="mt-1 text-[10px] opacity-65">
                    Compacto
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPaperSize("80mm")}
                  className={`rounded-2xl border px-3 py-3 text-left transition ${
                    paperSize === "80mm"
                      ? "border-red-600 bg-red-50 text-red-600"
                      : "border-black/[0.08] bg-white text-black hover:bg-black/[0.025]"
                  }`}
                >
                  <p className="text-[14px] font-medium">80 mm</p>
                  <p className="mt-1 text-[10px] opacity-65">
                    Recomendado
                  </p>
                </button>
              </div>

              <div className="mt-5 rounded-[22px] bg-black/[0.025] p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600" />

                  <p className="text-[12px] font-medium text-black">
                    Venta registrada
                  </p>
                </div>

                <div className="mt-3 space-y-2 text-[12px]">
                  <InfoRow
                    label="Productos"
                    value={`${receipt.totalItems} unidad(es)`}
                  />

                  <InfoRow
                    label="Método"
                    value={receipt.paymentMethod}
                  />

                  <InfoRow
                    label="Total"
                    value={formatCurrency(receipt.total)}
                    strong
                  />
                </div>
              </div>

              <div className="mt-5 rounded-[22px] border border-amber-200 bg-amber-50 p-4">
                <p className="text-[12px] font-medium text-amber-800">
                  Configuración recomendada
                </p>

                <p className="mt-2 text-[11px] leading-5 text-amber-700">
                  En el cuadro de impresión usa escala 100%, márgenes
                  predeterminados o ninguno y desactiva encabezados y pies de
                  página del navegador.
                </p>
              </div>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={printing}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Printer size={17} />
                  {printing ? "Preparando impresión..." : "Imprimir recibo"}
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={printing}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white text-[13px] font-medium text-black transition hover:bg-black/[0.025] disabled:opacity-50"
                >
                  <RotateCcw size={15} />
                  Reimprimir
                </button>
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-5 sm:p-6">
              <div className="mx-auto flex min-h-full items-start justify-center">
                <div className="rounded-[24px] bg-white p-4 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06] sm:p-6">
                  <div
                    id="thermal-receipt-print-area"
                    className={`bg-white text-black ${
                      paperSize === "58mm"
                        ? "thermal-paper-58"
                        : "thermal-paper-80"
                    }`}
                  >
                    <ReceiptContent
                      receipt={receipt}
                      store={storeData}
                      paperSize={paperSize}
                    />
                  </div>
                </div>
              </div>
            </main>
          </div>
        </section>
      </div>
    </>
  );
}

function ReceiptContent({ receipt, store, paperSize }) {
  const compact = paperSize === "58mm";

  return (
    <article
      style={{
        width: "100%",
        background: "#ffffff",
        color: "#000000",
        lineHeight: 1.35,
      }}
    >
      <header style={{ textAlign: "center" }}>
        {store.logoUrl ? (
          <img
            src={store.logoUrl}
            alt={store.name}
            style={{
              display: "block",
              width: compact ? "34mm" : "42mm",
              maxHeight: compact ? "18mm" : "22mm",
              objectFit: "contain",
              margin: "0 auto 6px",
              filter: "grayscale(1) contrast(1.2)",
            }}
          />
        ) : (
          <h1
            style={{
              margin: 0,
              fontSize: compact ? "15px" : "18px",
              fontWeight: 800,
              letterSpacing: "0.04em",
            }}
          >
            {store.name}
          </h1>
        )}

        {store.nit && (
          <p style={{ margin: "4px 0 0" }}>NIT: {store.nit}</p>
        )}

        {store.address && (
          <p style={{ margin: "2px 0 0" }}>{store.address}</p>
        )}

        {(store.city || store.phone) && (
          <p style={{ margin: "2px 0 0" }}>
            {[store.city, store.phone].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      <ReceiptSeparator />

      <section>
        <ReceiptTextRow label="Venta" value={receipt.saleNumber} />
        <ReceiptTextRow label="Fecha" value={receipt.formattedDate} />

        {receipt.sellerName && (
          <ReceiptTextRow label="Vendedor" value={receipt.sellerName} />
        )}

        <ReceiptTextRow label="Pago" value={receipt.paymentMethod} />
      </section>

      {(receipt.customerName ||
        receipt.customerDocument ||
        receipt.customerPhone) && (
        <>
          <ReceiptSeparator />

          <section>
            <p style={{ margin: 0, fontWeight: 700 }}>CLIENTE</p>

            {receipt.customerName && (
              <p style={{ margin: "3px 0 0" }}>
                {receipt.customerName}
              </p>
            )}

            {receipt.customerDocument && (
              <p style={{ margin: "2px 0 0" }}>
                Documento: {receipt.customerDocument}
              </p>
            )}

            {receipt.customerPhone && (
              <p style={{ margin: "2px 0 0" }}>
                Teléfono: {receipt.customerPhone}
              </p>
            )}
          </section>
        </>
      )}

      <ReceiptSeparator />

      <section>
        {receipt.items.map((item) => (
          <ReceiptProductLine key={item.lineId} item={item} />
        ))}
      </section>

      <ReceiptSeparator />

      <section>
        <ReceiptMoneyRow
          label="Subtotal"
          value={formatCurrency(receipt.subtotal)}
        />

        {receipt.discount > 0 && (
          <ReceiptMoneyRow
            label="Descuento"
            value={`- ${formatCurrency(receipt.discount)}`}
          />
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "8px",
            marginTop: "6px",
            paddingTop: "6px",
            borderTop: "1px solid #000",
            fontSize: compact ? "13px" : "15px",
            fontWeight: 800,
          }}
        >
          <span>TOTAL</span>
          <span>{formatCurrency(receipt.total)}</span>
        </div>

        {receipt.paymentMethod.toLowerCase() === "efectivo" && (
          <>
            <ReceiptMoneyRow
              label="Recibido"
              value={formatCurrency(receipt.amountReceived)}
            />

            <ReceiptMoneyRow
              label="Cambio"
              value={formatCurrency(receipt.change)}
              strong
            />
          </>
        )}
      </section>

      {receipt.notes && (
        <>
          <ReceiptSeparator />

          <section>
            <p style={{ margin: 0, fontWeight: 700 }}>NOTAS</p>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
              {receipt.notes}
            </p>
          </section>
        </>
      )}

      <ReceiptSeparator />

      <footer style={{ textAlign: "center" }}>
        <p
          style={{
            margin: 0,
            fontWeight: 800,
            fontSize: compact ? "11px" : "12px",
          }}
        >
          {store.footerMessage}
        </p>

        {store.secondaryMessage && (
          <p style={{ margin: "5px 0 0" }}>
            {store.secondaryMessage}
          </p>
        )}

        <p style={{ margin: "8px 0 0", fontSize: "9px" }}>
          Comprobante generado por el sistema de ventas
        </p>
      </footer>
    </article>
  );
}

function ReceiptProductLine({ item }) {
  return (
    <div style={{ marginBottom: "9px" }}>
      <p style={{ margin: 0, fontWeight: 700 }}>
        {item.productName}
      </p>

      <p style={{ margin: "2px 0 0" }}>
        {[item.productCode, `Talla ${item.size}`]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "8px",
          marginTop: "3px",
        }}
      >
        <span>
          {item.quantity} x {formatCurrency(item.unitPrice)}
        </span>

        <strong>{formatCurrency(item.subtotal)}</strong>
      </div>
    </div>
  );
}

function ReceiptTextRow({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "10px",
        marginTop: "2px",
      }}
    >
      <span>{label}:</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

function ReceiptMoneyRow({ label, value, strong = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "8px",
        marginTop: "4px",
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ReceiptSeparator() {
  return (
    <div
      style={{
        borderTop: "1px dashed #000",
        margin: "9px 0",
      }}
    />
  );
}

function InfoRow({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-black/45">{label}</span>

      <span
        className={
          strong
            ? "font-medium text-black"
            : "text-right text-black/75"
        }
      >
        {value}
      </span>
    </div>
  );
}