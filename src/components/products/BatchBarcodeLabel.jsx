import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import {
  AlertTriangle,
  Barcode,
  Check,
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  X,
} from "lucide-react";

import {
  getVariantLabelPrintState,
  normalizeProductVariants,
  registerLabelPrintBatch,
} from "../../services/products.service";
import {
  resolveVariantBarcode,
  validateVariantBarcode,
} from "../../services/barcode.service";
import { getCurrentUserActor } from "../../services/auth.service";
import { formatCurrency } from "../../utils/money";

const DEFAULT_STORE = {
  name: "MASTER CAPS",
  logoUrl: "/logo.png",
};

const PRESET = {
  id: "dual30x20",
  label: "Doble 30 × 20 mm",
  pageWidth: "64mm",
  width: "30mm",
  height: "20mm",
  columns: 2,
  columnGap: "2mm",
  rowGap: "0mm",
  barcodeHeight: 22,
  fontSize: "6.2px",
};

function safeText(value) {
  return String(value || "").trim();
}

function normalizeSize(value) {
  const cleanValue = safeText(value);

  if (!cleanValue) return "Talla única";

  const normalized = cleanValue.toUpperCase();

  if (
    normalized === "TALLA UNICA" ||
    normalized === "TALLA ÚNICA" ||
    normalized === "UNICA" ||
    normalized === "ÚNICA"
  ) {
    return "Talla única";
  }

  return normalized;
}

function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock,
    {
      productId: product?.id,
      productCode: product?.code,
      storeId: product?.storeId,
    }
  ).map((variant, index) => ({
    ...variant,
    id: safeText(variant.id) || `variant-${index + 1}`,
    size: normalizeSize(variant.size),
    stock: Math.max(Number(variant.stock || 0), 0),
    barcode: safeText(variant.barcode),
  }));
}

function createBatchLines(products) {
  return (Array.isArray(products) ? products : []).flatMap(
    (product) =>
      getProductVariants(product)
        .map((variant, variantIndex) => {
          const state = getVariantLabelPrintState(variant);

          return {
            key: `${product.id}:${variant.id}`,
            product,
            variant,
            variantIndex,
            stock: state.stock,
            printed: state.printed,
            pending: state.pending,
            selected: state.stock > 0,
            quantity:
              state.stock <= 0
                ? 0
                : state.pending > 0
                  ? state.pending
                  : state.stock,
          };
        })
        .filter((line) => line.stock > 0)
  );
}

function clampQuantity(value, stock) {
  const quantity = Math.trunc(Number(value || 0));

  if (!Number.isFinite(quantity)) return 0;

  return Math.min(Math.max(quantity, 0), Math.max(Number(stock || 0), 0));
}

function buildLabelsFromLines(lines) {
  const labels = [];

  lines.forEach((line) => {
    if (!line.selected) return;

    const quantity = clampQuantity(line.quantity, line.stock);
    const barcode = resolveVariantBarcode(
      line.product,
      line.variant,
      line.variantIndex
    );

    for (let index = 0; index < quantity; index += 1) {
      labels.push({
        key: `${line.key}:${index + 1}`,
        lineKey: line.key,
        product: line.product,
        variant: line.variant,
        barcode,
      });
    }
  });

  return labels;
}

function appendEmptyPhysicalPosition(labels) {
  if (labels.length === 0 || labels.length % 2 === 0) {
    return labels;
  }

  return [
    ...labels,
    {
      key: "empty-physical-position",
      empty: true,
      product: {},
      variant: {},
      barcode: "",
    },
  ];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createBarcodeSvgMarkup(barcode) {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );

  JsBarcode(svg, barcode, {
    format: "CODE128",
    lineColor: "#000000",
    background: "#ffffff",
    width: 2,
    height: PRESET.barcodeHeight,
    displayValue: false,
    margin: 0,
    flat: true,
  });

  return svg.outerHTML;
}

function createPrintableMarkup({
  labels,
  showName,
  showPrice,
  showHumanCode,
}) {
  const printableLabels = appendEmptyPhysicalPosition(labels);

  const articles = printableLabels
    .map((label) => {
      if (label.empty) {
        return `
          <article
            class="barcode-print-label"
            style="visibility:hidden"
            aria-hidden="true"
          ></article>
        `;
      }

      const productName = escapeHtml(label.product?.name || "");
      const productCode = escapeHtml(
        label.product?.code || label.barcode
      );
      const size = escapeHtml(
        normalizeSize(label.variant?.size)
      );
      const price = escapeHtml(
        formatCurrency(label.product?.salePrice)
      );
      const barcodeMarkup = createBarcodeSvgMarkup(
        label.barcode
      );

      return `
        <article class="barcode-print-label">
          ${
            showName
              ? `<p class="barcode-label-name">${productName}</p>`
              : ""
          }

          <div class="barcode-label-meta">
            <span>Talla ${size}</span>
            ${showPrice ? `<strong>${price}</strong>` : ""}
          </div>

          <div class="barcode-svg-wrap">
            ${barcodeMarkup}
          </div>

          ${
            showHumanCode
              ? `<p class="barcode-label-code">${productCode}</p>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  return `
    <div id="barcode-label-print-area">
      ${articles}
    </div>
  `;
}

function printLabelsInIsolatedFrame(labelsMarkup) {
  return new Promise((resolve, reject) => {
    let iframe = null;
    let cleanupTimer = null;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;

      if (cleanupTimer) {
        window.clearTimeout(cleanupTimer);
      }

      window.setTimeout(() => {
        iframe?.remove();
        resolve();
      }, 250);
    };

    try {
      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("title", "Impresión por lote");
      iframe.style.position = "fixed";
      iframe.style.left = "0";
      iframe.style.top = "0";
      iframe.style.width = PRESET.pageWidth;
      iframe.style.height = "1px";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      iframe.style.zIndex = "-1";

      document.body.appendChild(iframe);

      const frameWindow = iframe.contentWindow;
      const frameDocument = iframe.contentDocument;

      if (!frameWindow || !frameDocument) {
        throw new Error(
          "El navegador no permitió preparar las etiquetas."
        );
      }

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
            <title>Etiquetas por lote</title>

            <style>
              @page {
                size: ${PRESET.pageWidth} auto;
                margin: 0;
              }

              * {
                box-sizing: border-box;
              }

              html,
              body {
                width: ${PRESET.pageWidth};
                min-width: ${PRESET.pageWidth};
                max-width: ${PRESET.pageWidth};
                height: auto;
                min-height: 0;
                margin: 0;
                padding: 0;
                overflow: visible;
                background: #ffffff;
                color: #000000;
              }

              body {
                display: block;
                font-family:
                  Arial,
                  Helvetica,
                  system-ui,
                  sans-serif;
              }

              #barcode-label-print-area {
                display: grid;
                grid-template-columns: repeat(
                  ${PRESET.columns},
                  ${PRESET.width}
                );
                column-gap: ${PRESET.columnGap};
                row-gap: ${PRESET.rowGap};
                width: ${PRESET.pageWidth};
                min-width: ${PRESET.pageWidth};
                max-width: ${PRESET.pageWidth};
                margin: 0;
                padding: 0;
                align-items: start;
                justify-content: center;
                transform: translateX(-0.5mm);
                transform-origin: top left;
                background: #ffffff;
              }

              .barcode-print-label {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: stretch;
                justify-content: center;
                width: ${PRESET.width};
                min-width: ${PRESET.width};
                max-width: ${PRESET.width};
                height: ${PRESET.height};
                min-height: ${PRESET.height};
                max-height: ${PRESET.height};
                margin: 0;
                padding: 1.65mm 0.9mm 0.65mm;
                overflow: hidden;
                break-inside: avoid;
                page-break-inside: avoid;
                background: #ffffff;
                color: #000000;
                border: 0;
                border-radius: 0;
                box-shadow: none;
                text-align: center;
                font-size: ${PRESET.fontSize};
                line-height: 1.05;
              }

              .barcode-label-name {
                display: block;
                max-width: 100%;
                margin: 0 0 0.35mm;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 5.8px;
                font-weight: 800;
                line-height: 1;
              }

              .barcode-label-meta {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                align-items: baseline;
                gap: 1mm;
                width: 100%;
                margin: 0 0 0.35mm;
                font-size: 6.5px;
                font-weight: 700;
                line-height: 1;
              }

              .barcode-label-meta > span:first-child {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                text-align: left;
              }

              .barcode-label-meta > strong {
                white-space: nowrap;
                text-align: right;
              }

              .barcode-svg-wrap {
                display: flex;
                flex: 1 1 auto;
                align-items: center;
                justify-content: center;
                width: 100%;
                min-height: 0;
                overflow: hidden;
              }

              .barcode-print-label svg {
                display: block;
                width: 26mm;
                max-width: 26mm;
                height: auto;
                margin: 0 auto;
                overflow: visible;
              }

              .barcode-label-code {
                max-width: 100%;
                margin: 0.15mm 0 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-family:
                  "Courier New",
                  Courier,
                  monospace;
                font-size: 5.2px;
                font-weight: 700;
                letter-spacing: 0;
                line-height: 1;
              }

              @media print {
                html,
                body,
                #barcode-label-print-area {
                  width: ${PRESET.pageWidth} !important;
                  min-width: ${PRESET.pageWidth} !important;
                  max-width: ${PRESET.pageWidth} !important;
                  height: auto !important;
                  min-height: 0 !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: visible !important;
                }

                .barcode-print-label {
                  width: ${PRESET.width} !important;
                  min-width: ${PRESET.width} !important;
                  max-width: ${PRESET.width} !important;
                  height: ${PRESET.height} !important;
                  min-height: ${PRESET.height} !important;
                  max-height: ${PRESET.height} !important;
                }
              }
            </style>
          </head>

          <body>
            ${labelsMarkup}
          </body>
        </html>
      `);
      frameDocument.close();

      const printNow = () => {
        try {
          frameWindow.addEventListener(
            "afterprint",
            cleanup,
            { once: true }
          );

          frameWindow.focus();
          frameWindow.print();

          cleanupTimer = window.setTimeout(
            cleanup,
            5000
          );
        } catch (error) {
          iframe?.remove();
          reject(error);
        }
      };

      frameWindow.requestAnimationFrame(() => {
        frameWindow.requestAnimationFrame(printNow);
      });
    } catch (error) {
      iframe?.remove();
      reject(error);
    }
  });
}

export default function BatchBarcodeLabel({
  products,
  open = true,
  onClose,
  onPrinted,
  store = DEFAULT_STORE,
}) {
  const [lines, setLines] = useState(() =>
    createBatchLines(products)
  );
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showHumanCode, setShowHumanCode] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [reprintDialogOpen, setReprintDialogOpen] =
    useState(false);
  const [
    printedLinesAwaitingConfirmation,
    setPrintedLinesAwaitingConfirmation,
  ] = useState(null);

  useEffect(() => {
    if (!open) return;

    setLines(createBatchLines(products));
    setShowName(true);
    setShowPrice(true);
    setShowHumanCode(true);
    setReprintDialogOpen(false);
    setPrintedLinesAwaitingConfirmation(null);
  }, [open, products]);

  const selectedLines = useMemo(
    () =>
      lines
        .map((line) => ({
          ...line,
          quantity: clampQuantity(
            line.quantity,
            line.stock
          ),
        }))
        .filter(
          (line) =>
            line.selected &&
            line.quantity > 0 &&
            line.stock > 0
        ),
    [lines]
  );

  const labels = useMemo(
    () => buildLabelsFromLines(selectedLines),
    [selectedLines]
  );

  const previewLabels = useMemo(
    () => appendEmptyPhysicalPosition(labels.slice(0, 20)),
    [labels]
  );

  const reprintLines = useMemo(
    () =>
      selectedLines.filter(
        (line) => line.quantity > line.pending
      ),
    [selectedLines]
  );

  const totalPending = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + line.pending,
        0
      ),
    [lines]
  );

  const totalPrinted = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + line.printed,
        0
      ),
    [lines]
  );

  function updateLine(lineKey, changes) {
    setLines((current) =>
      current.map((line) =>
        line.key === lineKey
          ? {
              ...line,
              ...changes,
            }
          : line
      )
    );
  }

  function updateQuantity(line, nextQuantity) {
    const quantity = clampQuantity(
      nextQuantity,
      line.stock
    );

    updateLine(line.key, {
      selected: quantity > 0,
      quantity,
    });
  }

  function toggleLine(line) {
    const nextSelected = !line.selected;

    updateLine(line.key, {
      selected: nextSelected,
      quantity: nextSelected
        ? Math.max(
            Number(line.quantity || 0),
            line.pending > 0
              ? line.pending
              : line.stock > 0
                ? line.stock
                : 0
          )
        : 0,
    });
  }

  function selectAllPending() {
    setLines((current) =>
      current.map((line) => ({
        ...line,
        selected: line.pending > 0,
        quantity: line.pending,
      }))
    );
  }

  function resetBatch() {
    setLines(createBatchLines(products));
    setShowName(true);
    setShowPrice(true);
    setShowHumanCode(true);
  }

  async function performPrint(linesToPrint) {
    const printableLines = linesToPrint.filter(
      (line) =>
        line.selected &&
        clampQuantity(line.quantity, line.stock) > 0
    );

    const labelsToPrint =
      buildLabelsFromLines(printableLines);

    if (labelsToPrint.length === 0) {
      alert(
        "No hay etiquetas pendientes para imprimir."
      );
      return;
    }

    const invalidLabel = labelsToPrint.find(
      (label) =>
        !validateVariantBarcode(label.barcode).valid
    );

    if (invalidLabel) {
      alert(
        `No se pudo preparar el código ${
          invalidLabel.barcode || "sin valor"
        }.`
      );
      return;
    }

    if (printing) return;

    try {
      setPrinting(true);
      setReprintDialogOpen(false);

      const labelsMarkup = createPrintableMarkup({
        labels: labelsToPrint,
        showName,
        showPrice,
        showHumanCode,
      });

      await printLabelsInIsolatedFrame(labelsMarkup);

      setPrintedLinesAwaitingConfirmation(
        printableLines.map((line) => ({
          ...line,
          quantity: clampQuantity(
            line.quantity,
            line.stock
          ),
        }))
      );
    } catch (error) {
      console.error(error);
      alert(
        error?.message ||
          "No se pudo abrir el diálogo de impresión."
      );
    } finally {
      setPrinting(false);
    }
  }

  function requestPrint() {
    if (selectedLines.length === 0) {
      alert(
        "Selecciona al menos una variante para imprimir."
      );
      return;
    }

    if (reprintLines.length > 0) {
      setReprintDialogOpen(true);
      return;
    }

    performPrint(selectedLines);
  }

  function printOnlyPending() {
    const pendingOnlyLines = selectedLines
      .map((line) => ({
        ...line,
        selected: line.pending > 0,
        quantity: Math.min(
          line.quantity,
          line.pending
        ),
      }))
      .filter(
        (line) =>
          line.selected && line.quantity > 0
      );

    if (pendingOnlyLines.length === 0) {
      alert(
        "Todos los productos seleccionados ya tienen sus etiquetas impresas."
      );
      setReprintDialogOpen(false);
      return;
    }

    performPrint(pendingOnlyLines);
  }

  async function confirmPrintedRegistration() {
    if (
      !Array.isArray(
        printedLinesAwaitingConfirmation
      ) ||
      printedLinesAwaitingConfirmation.length === 0
    ) {
      return;
    }

    try {
      setRegistering(true);

      const entries =
        printedLinesAwaitingConfirmation.map((line) => ({
          productId: line.product.id,
          variantId: line.variant.id,
          quantity: line.quantity,
        }));

      const actor = getCurrentUserActor();

      await registerLabelPrintBatch(entries, actor);

      setPrintedLinesAwaitingConfirmation(null);

      if (onPrinted) {
        onPrinted(entries);
      }

      onClose();
    } catch (error) {
      console.error(error);
      alert(
        error?.message ||
          "Las etiquetas se imprimieron, pero no se pudo guardar el estado."
      );
    } finally {
      setRegistering(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[115] overflow-y-auto bg-black/60 px-3 py-3 backdrop-blur-sm sm:px-5 sm:py-5">
        <section className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-col overflow-hidden rounded-[24px] bg-[#f7f7f8] shadow-2xl lg:max-h-[calc(100vh-40px)] lg:rounded-[30px]">
          <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <Barcode size={22} />
              </div>

              <div className="min-w-0">
                <p className="text-[12px] font-medium text-red-600">
                  Impresión por lotes
                </p>
                <h2 className="mt-0.5 truncate text-[20px] font-medium tracking-[-0.035em] text-black">
                  {products.length} producto(s) seleccionados
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={printing || registering}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            >
              <X size={19} />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[530px_minmax(0,1fr)] lg:overflow-hidden">
            <aside className="min-h-0 border-b border-black/[0.06] bg-white p-4 sm:p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
              <div className="grid grid-cols-3 gap-2">
                <SummaryCard
                  label="Ya impresas"
                  value={totalPrinted}
                  tone="success"
                />
                <SummaryCard
                  label="Pendientes"
                  value={totalPending}
                  tone="warning"
                />
                <SummaryCard
                  label="En este lote"
                  value={labels.length}
                  tone="accent"
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-black">
                    Productos y cantidades
                  </p>
                  <p className="mt-1 text-[11px] text-black/45">
                    Por defecto se cargan solo las etiquetas pendientes.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={selectAllPending}
                  className="rounded-xl bg-red-50 px-3 py-2 text-[10px] font-medium text-red-600 transition hover:bg-red-100"
                >
                  Solo pendientes
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {lines.map((line) => {
                  const reprinting =
                    line.quantity > line.pending;

                  return (
                    <article
                      key={line.key}
                      className={`rounded-[18px] border p-3 transition ${
                        line.selected
                          ? reprinting
                            ? "border-amber-200 bg-amber-50/70"
                            : "border-red-200 bg-red-50/50"
                          : "border-black/[0.07] bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => toggleLine(line)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                              line.selected
                                ? "border-red-600 bg-red-600 text-white"
                                : "border-black/15 bg-white text-transparent"
                            }`}
                          >
                            <Check size={13} />
                          </span>

                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-medium text-black">
                              {line.product.name}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-black/45">
                              {line.product.code || "SIN CÓDIGO"} · Talla{" "}
                              {line.variant.size}
                            </span>
                          </span>
                        </button>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={
                              !line.selected ||
                              line.quantity <= 0
                            }
                            onClick={() =>
                              updateQuantity(
                                line,
                                line.quantity - 1
                              )
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.08] bg-white disabled:opacity-35"
                          >
                            <Minus size={13} />
                          </button>

                          <input
                            type="number"
                            min="0"
                            max={line.stock}
                            value={line.quantity}
                            onChange={(event) =>
                              updateQuantity(
                                line,
                                event.target.value
                              )
                            }
                            className="h-8 w-12 rounded-lg border border-black/[0.08] bg-white text-center text-[11px] outline-none focus:border-red-600"
                          />

                          <button
                            type="button"
                            disabled={
                              line.quantity >= line.stock
                            }
                            onClick={() =>
                              updateQuantity(
                                line,
                                line.quantity + 1
                              )
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.08] bg-white disabled:opacity-35"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-1.5 text-[9px]">
                        <MiniState
                          label="Stock"
                          value={line.stock}
                        />
                        <MiniState
                          label="Impresas"
                          value={line.printed}
                        />
                        <MiniState
                          label="Pendientes"
                          value={line.pending}
                        />
                      </div>

                      {reprinting && line.selected && (
                        <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-[9px] text-amber-800">
                          <AlertTriangle size={13} />
                          Incluye{" "}
                          {line.quantity - line.pending} reimpresión(es).
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <section className="mt-5 border-t border-black/[0.06] pt-4">
                <p className="text-[13px] font-medium text-black">
                  Contenido visible
                </p>

                <div className="mt-3 grid gap-2">
                  <ToggleOption
                    label="Nombre del producto"
                    checked={showName}
                    onChange={setShowName}
                  />
                  <ToggleOption
                    label="Precio de venta"
                    checked={showPrice}
                    onChange={setShowPrice}
                  />
                  <ToggleOption
                    label="Código legible"
                    checked={showHumanCode}
                    onChange={setShowHumanCode}
                  />
                </div>
              </section>

              <div className="sticky bottom-0 z-10 mt-4 grid grid-cols-[1fr_auto] gap-2 border-t border-black/[0.05] bg-white/95 pt-3 backdrop-blur">
                <button
                  type="button"
                  onClick={requestPrint}
                  disabled={
                    printing ||
                    registering ||
                    labels.length === 0
                  }
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/15 disabled:shadow-none"
                >
                  <Printer size={16} />
                  {printing
                    ? "Abriendo impresión..."
                    : `Imprimir ${labels.length} etiqueta(s)`}
                </button>

                <button
                  type="button"
                  onClick={resetBatch}
                  disabled={printing || registering}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.08] bg-white text-black/60 transition hover:bg-black/[0.025] disabled:opacity-40"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </aside>

            <main className="min-h-0 overflow-auto p-3 sm:p-5 lg:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[14px] font-medium text-black">
                    Vista previa
                  </p>
                  <p className="mt-1 text-[11px] text-black/45">
                    Se muestran máximo 20 etiquetas en pantalla. La impresión incluye el lote completo.
                  </p>
                </div>

                <span className="rounded-full bg-white px-3 py-1.5 text-[10px] text-black/55 ring-1 ring-black/[0.06]">
                  {PRESET.label}
                </span>
              </div>

              <div className="mx-auto flex min-h-[330px] min-w-0 justify-center overflow-x-auto rounded-[24px] bg-white p-4 shadow-[0_18px_55px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.06]">
                {labels.length === 0 ? (
                  <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
                    <Barcode
                      size={34}
                      className="text-black/20"
                    />
                    <p className="mt-4 text-[15px] font-medium text-black">
                      No hay etiquetas seleccionadas
                    </p>
                    <p className="mt-2 max-w-[360px] text-[12px] leading-5 text-black/45">
                      Selecciona productos y define las cantidades del lote.
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${PRESET.columns}, ${PRESET.width})`,
                      columnGap: PRESET.columnGap,
                      rowGap: PRESET.rowGap,
                      width: PRESET.pageWidth,
                      minWidth: PRESET.pageWidth,
                      transform: "translateX(-0.5mm)",
                      transformOrigin: "top left",
                      background: "#ffffff",
                    }}
                  >
                    {previewLabels.map((label) => (
                      <PreviewLabel
                        key={label.key}
                        label={label}
                        showName={showName}
                        showPrice={showPrice}
                        showHumanCode={showHumanCode}
                      />
                    ))}
                  </div>
                )}
              </div>
            </main>
          </div>
        </section>
      </div>

      {reprintDialogOpen && (
        <DecisionModal
          title="Hay etiquetas ya impresas"
          description={`${reprintLines.length} variante(s) incluyen unidades que ya estaban marcadas como impresas.`}
          icon={AlertTriangle}
          tone="warning"
          onClose={() => setReprintDialogOpen(false)}
          actions={
            <>
              <button
                type="button"
                onClick={() =>
                  setReprintDialogOpen(false)
                }
                className="h-11 rounded-2xl border border-black/[0.08] px-5 text-[12px] font-medium text-black/65 transition hover:bg-black/[0.03]"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={printOnlyPending}
                className="h-11 rounded-2xl border border-amber-200 bg-amber-50 px-5 text-[12px] font-medium text-amber-800 transition hover:bg-amber-100"
              >
                Descartar ya impresas
              </button>

              <button
                type="button"
                onClick={() =>
                  performPrint(selectedLines)
                }
                className="h-11 rounded-2xl bg-red-600 px-5 text-[12px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
              >
                Reimprimir
              </button>
            </>
          }
        >
          <div className="mt-4 max-h-[220px] space-y-2 overflow-y-auto">
            {reprintLines.map((line) => (
              <div
                key={line.key}
                className="rounded-2xl bg-black/[0.025] px-4 py-3"
              >
                <p className="truncate text-[12px] font-medium text-black">
                  {line.product.name} · Talla{" "}
                  {line.variant.size}
                </p>
                <p className="mt-1 text-[10px] text-black/45">
                  Pendientes: {line.pending} · Solicitadas:{" "}
                  {line.quantity} · Reimpresiones:{" "}
                  {line.quantity - line.pending}
                </p>
              </div>
            ))}
          </div>
        </DecisionModal>
      )}

      {printedLinesAwaitingConfirmation && (
        <DecisionModal
          title="¿La impresión salió correctamente?"
          description="Confirma para guardar en Firebase cuáles etiquetas ya fueron impresas."
          icon={CheckCircle2}
          tone="success"
          onClose={() =>
            setPrintedLinesAwaitingConfirmation(null)
          }
          actions={
            <>
              <button
                type="button"
                onClick={() =>
                  setPrintedLinesAwaitingConfirmation(
                    null
                  )
                }
                disabled={registering}
                className="h-11 rounded-2xl border border-black/[0.08] px-5 text-[12px] font-medium text-black/65 transition hover:bg-black/[0.03] disabled:opacity-40"
              >
                No registrar
              </button>

              <button
                type="button"
                onClick={confirmPrintedRegistration}
                disabled={registering}
                className="h-11 rounded-2xl bg-emerald-600 px-5 text-[12px] font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {registering
                  ? "Guardando..."
                  : "Sí, registrar impresas"}
              </button>
            </>
          }
        >
          <div className="mt-4 rounded-[20px] bg-emerald-50 p-4">
            <p className="text-[11px] text-emerald-700">
              Se registrarán{" "}
              {printedLinesAwaitingConfirmation.reduce(
                (total, line) =>
                  total + Number(line.quantity || 0),
                0
              )}{" "}
              etiqueta(s).
            </p>
          </div>
        </DecisionModal>
      )}
    </>
  );
}

function PreviewLabel({
  label,
  showName,
  showPrice,
  showHumanCode,
}) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (
      label.empty ||
      !svgRef.current ||
      !label.barcode
    ) {
      return;
    }

    try {
      JsBarcode(svgRef.current, label.barcode, {
        format: "CODE128",
        lineColor: "#000000",
        background: "#ffffff",
        width: 2,
        height: PRESET.barcodeHeight,
        displayValue: false,
        margin: 0,
        flat: true,
      });
    } catch (error) {
      console.error(
        "No se pudo generar el código de barras:",
        error
      );
    }
  }, [label]);

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        width: PRESET.width,
        minWidth: PRESET.width,
        maxWidth: PRESET.width,
        height: PRESET.height,
        minHeight: PRESET.height,
        maxHeight: PRESET.height,
        padding: "1.65mm 0.9mm 0.65mm",
        overflow: "hidden",
        background: "#ffffff",
        color: "#000000",
        fontFamily:
          "Arial, Helvetica, system-ui, sans-serif",
        fontSize: PRESET.fontSize,
        lineHeight: 1.05,
        textAlign: "center",
        visibility: label.empty
          ? "hidden"
          : "visible",
      }}
    >
      {showName && (
        <p
          style={{
            maxWidth: "100%",
            margin: "0 0 0.35mm",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "5.8px",
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          {label.product?.name}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1fr) auto",
          alignItems: "baseline",
          gap: "1mm",
          width: "100%",
          marginBottom: "0.35mm",
          fontSize: "6.5px",
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          Talla {normalizeSize(label.variant?.size)}
        </span>

        {showPrice && (
          <strong
            style={{
              whiteSpace: "nowrap",
              textAlign: "right",
            }}
          >
            {formatCurrency(
              label.product?.salePrice
            )}
          </strong>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flex: "1 1 auto",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <svg
          ref={svgRef}
          style={{
            display: "block",
            width: "26mm",
            maxWidth: "26mm",
            height: "auto",
            overflow: "visible",
          }}
        />
      </div>

      {showHumanCode && (
        <p
          style={{
            maxWidth: "100%",
            margin: "0.15mm 0 0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily:
              '"Courier New", Courier, monospace',
            fontSize: "5.2px",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {label.product?.code ||
            label.barcode}
        </p>
      )}
    </article>
  );
}

function ToggleOption({
  label,
  checked,
  onChange,
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-black/[0.07] bg-white px-4 py-3 transition hover:bg-black/[0.02]">
      <span className="text-[12px] text-black/70">
        {label}
      </span>

      <input
        type="checkbox"
        checked={checked}
        onChange={(event) =>
          onChange(event.target.checked)
        }
        className="sr-only"
      />

      <span
        className={`relative h-6 w-11 rounded-full transition ${
          checked
            ? "bg-red-600"
            : "bg-black/10"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
    </label>
  );
}

function SummaryCard({ label, value, tone }) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-600";

  return (
    <div className={`rounded-[18px] p-3 ${toneClass}`}>
      <p className="text-[9px] opacity-70">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-medium">
        {value}
      </p>
    </div>
  );
}

function MiniState({ label, value }) {
  return (
    <div className="rounded-xl bg-white px-2.5 py-2 text-center ring-1 ring-black/[0.05]">
      <p className="text-black/40">{label}</p>
      <p className="mt-0.5 font-medium text-black">
        {value}
      </p>
    </div>
  );
}

function DecisionModal({
  title,
  description,
  icon: Icon,
  tone = "warning",
  onClose,
  actions,
  children,
}) {
  const iconClass =
    tone === "success"
      ? "bg-emerald-50 text-emerald-600"
      : "bg-amber-50 text-amber-700";

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm">
      <section className="w-full max-w-[560px] overflow-hidden rounded-[26px] bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${iconClass}`}
            >
              <Icon size={20} />
            </div>

            <div className="min-w-0">
              <h3 className="text-[18px] font-medium tracking-[-0.03em] text-black">
                {title}
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-black/45">
                {description}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.035] text-black/55 transition hover:bg-black/[0.06]"
          >
            <X size={17} />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {children}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-black/[0.06] px-5 py-4 sm:flex-row sm:justify-end">
          {actions}
        </footer>
      </section>
    </div>
  );
}