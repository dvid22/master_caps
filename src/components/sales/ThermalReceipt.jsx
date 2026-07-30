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


function printReceiptInIsolatedFrame(paperSize) {
  return new Promise((resolve, reject) => {
    const receiptElement = document.getElementById(
      "thermal-receipt-print-area"
    );

    if (!receiptElement) {
      reject(
        new Error(
          "No se encontró el contenido del recibo para imprimir."
        )
      );
      return;
    }

    const width = paperSize === "58mm" ? "58mm" : "80mm";
    const printableWidth =
      paperSize === "58mm" ? "52mm" : "72mm";
    const iframe = document.createElement("iframe");

    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (!frameWindow || !frameDocument) {
      iframe.remove();
      reject(
        new Error(
          "El navegador no permitió preparar la impresión."
        )
      );
      return;
    }

    const receiptMarkup = receiptElement.outerHTML;

    frameDocument.open();
    frameDocument.write(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <title>Recibo térmico</title>

          <style>
            @page {
              size: ${width} auto;
              margin: 0;
            }

            * {
              box-sizing: border-box;
            }

            html,
            body {
              width: ${width};
              min-width: ${width};
              max-width: ${width};
              height: auto;
              min-height: 0;
              margin: 0;
              padding: 0;
              overflow: visible;
              background: #ffffff;
              color: #000000;
            }

            body {
              display: flex;
              justify-content: center;
              align-items: flex-start;
            }

            #thermal-receipt-print-area {
              position: static;
              display: block;
              width: ${printableWidth};
              min-width: ${printableWidth};
              max-width: ${printableWidth};
              height: auto;
              min-height: 0;
              margin: 0 auto;
              padding: 2mm 1.5mm 3mm;
              overflow: visible;
              border: 0;
              border-radius: 0;
              box-shadow: none;
              transform: none;
              background: #ffffff;
              color: #000000;
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

            #thermal-receipt-print-area,
            #thermal-receipt-print-area * {
              visibility: visible;
            }

            #thermal-receipt-print-area article,
            #thermal-receipt-print-area section,
            #thermal-receipt-print-area header,
            #thermal-receipt-print-area footer,
            #thermal-receipt-print-area div,
            #thermal-receipt-print-area img {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            #thermal-receipt-print-area img {
              max-width: 100%;
            }

            #thermal-receipt-print-area .thermal-receipt-logo {
              display: block;
              width: 42mm;
              max-width: 92%;
              height: auto;
              max-height: 23mm;
              margin: 0 auto 7px;
              object-fit: contain;
              filter:
                grayscale(1)
                brightness(0)
                contrast(3.2)
                drop-shadow(0.18px 0 0 #000)
                drop-shadow(-0.18px 0 0 #000)
                drop-shadow(0 0.18px 0 #000)
                drop-shadow(0 -0.18px 0 #000);
              image-rendering: auto;
            }

            #thermal-receipt-print-area,
            #thermal-receipt-print-area * {
              min-width: 0;
            }

            #thermal-receipt-print-area p,
            #thermal-receipt-print-area span,
            #thermal-receipt-print-area strong {
              overflow-wrap: anywhere;
              word-break: break-word;
            }

            .thermal-no-print {
              display: none !important;
            }

            @media print {
              html,
              body {
                width: ${width} !important;
                min-width: ${width} !important;
                max-width: ${width} !important;
                height: auto !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
              }

              #thermal-receipt-print-area {
                width: ${printableWidth} !important;
                min-width: ${printableWidth} !important;
                max-width: ${printableWidth} !important;
                height: auto !important;
                min-height: 0 !important;
                margin: 0 auto !important;
                padding: 2mm 1.5mm 3mm !important;
                overflow: visible !important;
              }
            }
          </style>
        </head>

        <body>
          ${receiptMarkup}
        </body>
      </html>
    `);
    frameDocument.close();

    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;

      window.setTimeout(() => {
        iframe.remove();
        resolve();
      }, 250);
    };

    const startPrint = async () => {
      try {
        const images = Array.from(
          frameDocument.images || []
        );

        await Promise.all(
          images.map(
            (image) =>
              new Promise((imageResolve) => {
                if (image.complete) {
                  imageResolve();
                  return;
                }

                image.addEventListener(
                  "load",
                  imageResolve,
                  { once: true }
                );
                image.addEventListener(
                  "error",
                  imageResolve,
                  { once: true }
                );
              })
          )
        );

        frameWindow.addEventListener(
          "afterprint",
          cleanup,
          { once: true }
        );

        frameWindow.focus();
        frameWindow.print();

        window.setTimeout(cleanup, 5000);
      } catch (error) {
        iframe.remove();
        reject(error);
      }
    };

    if (frameDocument.readyState === "complete") {
      window.setTimeout(startPrint, 80);
    } else {
      iframe.addEventListener(
        "load",
        () => window.setTimeout(startPrint, 80),
        { once: true }
      );
    }
  });
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

  async function handlePrint() {
    if (!sale || receipt.items.length === 0) {
      alert("No hay información suficiente para imprimir el recibo.");
      return;
    }

    if (printing) return;

    try {
      setPrinting(true);

      await printReceiptInIsolatedFrame(paperSize);

      if (onPrinted) {
        onPrinted(receipt);
      }
    } catch (error) {
      console.error("No se pudo abrir la impresión:", error);
      alert(
        error?.message ||
          "No se pudo abrir el diálogo de impresión."
      );
    } finally {
      setPrinting(false);
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
            min-width: 0 !important;
            max-width: var(--thermal-page-width, 80mm) !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
          }

          #root {
            position: static !important;
            width: var(--thermal-page-width, 80mm) !important;
            min-width: 0 !important;
            max-width: var(--thermal-page-width, 80mm) !important;
            height: 0 !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
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
            inset: auto !important;
            left: 0 !important;
            top: 0 !important;
            display: block !important;
            width: var(--thermal-page-width, 80mm) !important;
            min-width: var(--thermal-page-width, 80mm) !important;
            max-width: var(--thermal-page-width, 80mm) !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 3mm !important;
            overflow: visible !important;
            box-sizing: border-box !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            transform: none !important;
          }

          #thermal-receipt-print-area article,
          #thermal-receipt-print-area section,
          #thermal-receipt-print-area header,
          #thermal-receipt-print-area footer,
          #thermal-receipt-print-area div,
          #thermal-receipt-print-area img {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
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
          width: 52mm;
          font-size: 9.5px;
        }

        #thermal-receipt-print-area.thermal-paper-80 {
          width: 72mm;
          font-size: 10.5px;
        }

        #thermal-receipt-print-area .thermal-receipt-logo {
          display: block;
          height: auto;
          filter:
            grayscale(1)
            brightness(0)
            contrast(3.2)
            drop-shadow(0.18px 0 0 #000)
            drop-shadow(-0.18px 0 0 #000)
            drop-shadow(0 0.18px 0 #000)
            drop-shadow(0 -0.18px 0 #000);
          image-rendering: auto;
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
            className="thermal-receipt-logo"
            style={{
              display: "block",
              width: compact ? "34mm" : "42mm",
              maxWidth: "92%",
              maxHeight: compact ? "19mm" : "23mm",
              objectFit: "contain",
              margin: "0 auto 7px",
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
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: "8px",
            marginTop: "6px",
            paddingTop: "6px",
            borderTop: "1px solid #000",
            fontSize: compact ? "12px" : "14px",
            fontWeight: 800,
            alignItems: "baseline",
          }}
        >
          <span style={{ minWidth: 0 }}>TOTAL</span>
          <span style={{ whiteSpace: "nowrap", textAlign: "right" }}>
            {formatCurrency(receipt.total)}
          </span>
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
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "7px",
          marginTop: "3px",
          alignItems: "baseline",
        }}
      >
        <span style={{ minWidth: 0 }}>
          {item.quantity} x {formatCurrency(item.unitPrice)}
        </span>

        <strong
          style={{
            whiteSpace: "nowrap",
            textAlign: "right",
          }}
        >
          {formatCurrency(item.subtotal)}
        </strong>
      </div>
    </div>
  );
}

function ReceiptTextRow({ label, value }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 0.82fr) minmax(0, 1.18fr)",
        gap: "6px",
        marginTop: "2px",
        alignItems: "start",
      }}
    >
      <span style={{ minWidth: 0 }}>{label}:</span>
      <span
        style={{
          minWidth: 0,
          textAlign: "right",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ReceiptMoneyRow({ label, value, strong = false }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: "8px",
        marginTop: "4px",
        fontWeight: strong ? 700 : 400,
        alignItems: "baseline",
      }}
    >
      <span style={{ minWidth: 0 }}>{label}</span>
      <span
        style={{
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}
      </span>
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