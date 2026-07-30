import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import {
  Barcode,
  Check,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Settings2,
  Tag,
  X,
} from "lucide-react";
import {
  resolveVariantBarcode,
  validateVariantBarcode,
} from "../../services/barcode.service";

const DEFAULT_STORE = {
  name: "MASTER CAPS",
  logoUrl: "/logo.png",
};

const PRESETS = {
  dual30x20: {
    id: "dual30x20",
    label: "Doble 30 × 20 mm",
    description: "Dos etiquetas por fila · rollo Jaltech",
    pageWidth: "64mm",
    width: "30mm",
    height: "20mm",
    columns: 2,
    columnGap: "2mm",
    rowGap: "0mm",
    barcodeHeight: 22,
    barcodeWidth: 0.68,
    fontSize: "6.2px",
  },
  single30x20: {
    id: "single30x20",
    label: "Individual 30 × 20 mm",
    description: "Una etiqueta usando el rollo doble Jaltech",
    pageWidth: "64mm",
    width: "30mm",
    height: "20mm",
    columns: 2,
    columnGap: "2mm",
    rowGap: "0mm",
    barcodeHeight: 22,
    barcodeWidth: 0.68,
    fontSize: "6.2px",
  },
  thermal58: {
    id: "thermal58",
    label: "Térmica 58 mm",
    description: "Una etiqueta grande por fila",
    pageWidth: "58mm",
    width: "58mm",
    height: "38mm",
    columns: 1,
    columnGap: "0mm",
    rowGap: "0mm",
    barcodeHeight: 52,
    barcodeWidth: 1.65,
    fontSize: "10px",
  },
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
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return product.variants.map((variant, index) => ({
      id: safeText(variant.id) || `variant-${index + 1}`,
      size: normalizeSize(variant.size),
      stock: Math.max(Number(variant.stock || 0), 0),
      barcode: safeText(variant.barcode),
    }));
  }

  return [
    {
      id: "legacy-variant",
      size: normalizeSize(product?.size),
      stock: Math.max(Number(product?.stock || 0), 0),
      barcode: safeText(product?.barcode),
    },
  ];
}

function buildVariantBarcode(product, variant, variantIndex = 0) {
  return resolveVariantBarcode(product, variant, variantIndex);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function createInitialSelections(product) {
  return getProductVariants(product).reduce((accumulator, variant) => {
    const available = Number(variant.stock || 0) > 0;

    accumulator[variant.id] = {
      selected: available,
      quantity: available ? 1 : 0,
    };

    return accumulator;
  }, {});
}


function printLabelsInIsolatedFrame({
  labelsMarkup,
  preset,
}) {
  return new Promise((resolve, reject) => {
    let iframe = null;
    let cleanupTimer = null;
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;

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
      iframe.setAttribute("title", "Impresión de etiquetas");
      iframe.style.position = "fixed";
      iframe.style.left = "0";
      iframe.style.top = "0";
      iframe.style.width = preset.pageWidth;
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
            <title>Etiquetas de producto</title>

            <style>
              @page {
                size: ${preset.pageWidth} auto;
                margin: 0;
              }

              * {
                box-sizing: border-box;
              }

              html,
              body {
                width: ${preset.pageWidth};
                min-width: ${preset.pageWidth};
                max-width: ${preset.pageWidth};
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
                  ${preset.columns},
                  ${preset.width}
                );
                column-gap: ${preset.columnGap};
                row-gap: ${preset.rowGap};
                width: ${preset.pageWidth};
                min-width: ${preset.pageWidth};
                max-width: ${preset.pageWidth};
                margin: 0;
                padding: 0;
                background: #ffffff;
                align-items: start;
                justify-content: center;
                transform: translateX(-0.5mm);
                transform-origin: top left;
              }

              .barcode-print-label {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: stretch;
                justify-content: center;
                width: ${preset.width};
                min-width: ${preset.width};
                max-width: ${preset.width};
                height: ${preset.height};
                min-height: ${preset.height};
                max-height: ${preset.height};
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
                transform: none;
                text-align: center;
                font-size: ${preset.fontSize};
                line-height: 1.05;
              }

              .barcode-print-label svg {
                display: block;
                width: ${preset.id.includes("30x20") ? "26mm" : "48mm"};
                max-width: ${preset.id.includes("30x20") ? "26mm" : "48mm"};
                height: auto;
                margin: 0 auto;
                overflow: visible;
              }

              .barcode-print-label img {
                display: block;
                max-width: 100%;
                object-fit: contain;
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

              .barcode-label-code {
                max-width: 100%;
                margin: 0.25mm 0 0;
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

              .barcode-label-store {
                height: 2.5mm;
                margin: 0 0 0.3mm;
              }

              .barcode-label-store img {
                width: auto;
                height: 2.5mm;
                max-width: 16mm;
                margin: 0 auto;
                filter:
                  grayscale(1)
                  brightness(0)
                  contrast(2.3);
              }

              @media print {
                html,
                body,
                #barcode-label-print-area {
                  width: ${preset.pageWidth} !important;
                  min-width: ${preset.pageWidth} !important;
                  max-width: ${preset.pageWidth} !important;
                  height: auto !important;
                  min-height: 0 !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: visible !important;
                }

                .barcode-print-label {
                  width: ${preset.width} !important;
                  min-width: ${preset.width} !important;
                  max-width: ${preset.width} !important;
                  height: ${preset.height} !important;
                  min-height: ${preset.height} !important;
                  max-height: ${preset.height} !important;
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

      /*
       * No esperamos eventos de carga remotos: las etiquetas contienen
       * SVG ya generado. Esto conserva el gesto del clic y evita que
       * Edge bloquee silenciosamente window.print().
       */
      frameWindow.requestAnimationFrame(() => {
        frameWindow.requestAnimationFrame(printNow);
      });
    } catch (error) {
      iframe?.remove();
      reject(error);
    }
  });
}


export default function BarcodeLabel({
  product,
  open = true,
  onClose,
  store = DEFAULT_STORE,
  defaultPreset = "dual30x20",
}) {
  const [presetId, setPresetId] = useState(() => {
    if (defaultPreset === "single30x20") {
      return "single30x20";
    }

    return "dual30x20";
  });
  const [showStore, setShowStore] = useState(false);
  const [showName, setShowName] = useState(false);
  const [showPrice, setShowPrice] = useState(true);
  const [showHumanCode, setShowHumanCode] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [selections, setSelections] = useState(() =>
    createInitialSelections(product)
  );

  const variants = useMemo(() => getProductVariants(product), [product]);
  const preset = PRESETS[presetId];
  const storeData = useMemo(
    () => ({ ...DEFAULT_STORE, ...(store || {}) }),
    [store]
  );

  useEffect(() => {
    setSelections(createInitialSelections(product));
  }, [product]);

  const labels = useMemo(() => {
    const result = [];

    variants.forEach((variant, variantIndex) => {
      const selection = selections[variant.id];
      if (!selection?.selected) return;

      const stock = Math.max(Number(variant.stock || 0), 0);
      const quantity = Math.min(
        Math.max(Math.trunc(Number(selection.quantity || 0)), 0),
        stock
      );
      const barcode = buildVariantBarcode(
        product,
        variant,
        variantIndex
      );

      for (let index = 0; index < quantity; index += 1) {
        result.push({
          key: `${variant.id}-${index + 1}`,
          variant,
          barcode,
        });
      }
    });

    return result;
  }, [variants, selections, product]);

  const printableLabels = useMemo(() => {
    const isThirtyByTwenty =
      preset.id === "dual30x20" ||
      preset.id === "single30x20";

    if (
      !isThirtyByTwenty ||
      labels.length === 0 ||
      labels.length % 2 === 0
    ) {
      return labels;
    }

    return [
      ...labels,
      {
        key: "empty-physical-position",
        empty: true,
        variant: {
          id: "empty",
          size: "",
          stock: 0,
          barcode: "",
        },
        barcode: "",
      },
    ];
  }, [labels, preset.id]);

  function updateQuantity(variant, nextQuantity) {
    const stock = Math.max(Number(variant.stock || 0), 0);
    const safeQuantity = Math.min(
      Math.max(Math.trunc(Number(nextQuantity || 0)), 0),
      stock
    );

    setSelections((current) => ({
      ...current,
      [variant.id]: {
        selected: safeQuantity > 0,
        quantity: safeQuantity,
      },
    }));
  }

  function toggleVariant(variant) {
    setSelections((current) => {
      const currentSelection = current[variant.id] || {
        selected: false,
        quantity: 0,
      };
      const nextSelected = !currentSelection.selected;

      return {
        ...current,
        [variant.id]: {
          selected: nextSelected,
          quantity: nextSelected
            ? Math.max(Number(currentSelection.quantity || 1), 1)
            : 0,
        },
      };
    });
  }

  function selectAll() {
    setSelections(
      variants.reduce((accumulator, variant) => {
        const available = Number(variant.stock || 0) > 0;
        accumulator[variant.id] = {
          selected: available,
          quantity: available ? 1 : 0,
        };
        return accumulator;
      }, {})
    );
  }

  function resetConfiguration() {
    setSelections(createInitialSelections(product));
    setPresetId(
      defaultPreset === "single30x20"
        ? "single30x20"
        : "dual30x20"
    );
    setShowStore(false);
    setShowName(false);
    setShowPrice(true);
    setShowHumanCode(true);
  }

  async function handlePrint() {
    if (labels.length === 0) {
      alert("Selecciona al menos una etiqueta para imprimir.");
      return;
    }

    const invalidLabel = labels.find(
      (label) => !validateVariantBarcode(label.barcode).valid
    );

    if (invalidLabel) {
      alert(
        `No se pudo preparar el código de barras ${
          invalidLabel.barcode || "sin valor"
        }.`
      );
      return;
    }

    if (printing) return;

    const printArea = document.getElementById(
      "barcode-label-print-area"
    );

    if (!printArea) {
      alert("No se encontró la vista previa de las etiquetas.");
      return;
    }

    try {
      setPrinting(true);

      await printLabelsInIsolatedFrame({
        labelsMarkup: printArea.outerHTML,
        preset,
      });
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

  if (!open || !product) return null;

  return (
    <>
      <style>{`
        #barcode-label-print-area {
          display: grid;
          align-items: start;
          justify-content: start;
        }

        .barcode-print-label {
          overflow: hidden;
          box-sizing: border-box;
          background: #ffffff;
          color: #000000;
        }

        .barcode-print-label svg {
          display: block;
          max-width: 100%;
          height: auto;
        }
      `}</style>

      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 px-3 py-4 backdrop-blur-sm sm:px-5 sm:py-6">
        <section className="flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[30px] bg-[#f7f7f8] shadow-2xl">
          <header className="flex items-center justify-between border-b border-black/[0.06] bg-white px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <Barcode size={22} />
              </div>

              <div className="min-w-0">
                <p className="text-[12px] font-medium text-red-600">
                  Etiquetas de producto
                </p>
                <h2 className="mt-0.5 truncate text-[20px] font-medium tracking-[-0.035em] text-black">
                  {product.name}
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600"
            >
              <X size={19} />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[390px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-black/[0.06] bg-white p-5 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-black/45" />
                <p className="text-[13px] font-medium text-black">
                  Configuración de impresión
                </p>
              </div>

              <section className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-black/35">
                  Formato
                </p>

                <div className="mt-2 grid gap-2">
                  {Object.values(PRESETS).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setPresetId(option.id)}
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                        presetId === option.id
                          ? "border-red-500 bg-red-50 text-red-600"
                          : "border-black/[0.08] bg-white text-black hover:bg-black/[0.025]"
                      }`}
                    >
                      <div>
                        <p className="text-[13px] font-medium">
                          {option.label}
                        </p>
                        <p className="mt-0.5 text-[10px] opacity-60">
                          {option.description}
                        </p>
                      </div>

                      {presetId === option.id && <Check size={17} />}
                    </button>
                  ))}
                </div>
              </section>

            

              <section className="mt-5 border-t border-black/[0.06] pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-black">
                      Tallas y cantidades
                    </p>
                    <p className="mt-1 text-[11px] text-black/45">
                      Define cuántas etiquetas imprimir por talla.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded-xl bg-red-50 px-3 py-2 text-[10px] font-medium text-red-600 transition hover:bg-red-100"
                  >
                    Seleccionar
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {variants.map((variant, variantIndex) => {
                    const selection = selections[variant.id] || {
                      selected: false,
                      quantity: 0,
                    };
                    const stock = Number(variant.stock || 0);
                    const disabled = stock <= 0;

                    return (
                      <article
                        key={variant.id}
                        className={`rounded-[18px] border p-3 transition ${
                          selection.selected
                            ? "border-red-200 bg-red-50/60"
                            : "border-black/[0.07] bg-white"
                        } ${disabled ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => toggleVariant(variant)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
                          >
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                                selection.selected
                                  ? "border-red-600 bg-red-600 text-white"
                                  : "border-black/15 bg-white text-transparent"
                              }`}
                            >
                              <Check size={13} />
                            </span>

                            <span className="min-w-0">
                              <span className="block truncate text-[12px] font-medium text-black">
                                {variant.size}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-black/45">
                                Stock: {stock} unidad(es)
                              </span>
                            </span>
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              disabled={disabled || !selection.selected}
                              onClick={() =>
                                updateQuantity(
                                  variant,
                                  Number(selection.quantity || 0) - 1
                                )
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.08] bg-white disabled:opacity-35"
                            >
                              <Minus size={13} />
                            </button>

                            <input
                              type="number"
                              min="0"
                              max={stock}
                              disabled={disabled}
                              value={selection.quantity}
                              onChange={(event) =>
                                updateQuantity(variant, event.target.value)
                              }
                              className="h-8 w-12 rounded-lg border border-black/[0.08] bg-white text-center text-[11px] outline-none focus:border-red-600"
                            />

                            <button
                              type="button"
                              disabled={
                                disabled ||
                                Number(selection.quantity || 0) >= stock
                              }
                              onClick={() =>
                                updateQuantity(
                                  variant,
                                  Number(selection.quantity || 0) + 1
                                )
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.08] bg-white disabled:opacity-35"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        </div>

                        {selection.selected && (
                          <p className="mt-2 truncate rounded-xl bg-white px-3 py-2 font-mono text-[9px] text-black/55 ring-1 ring-black/[0.05]">
                            {buildVariantBarcode(
                              product,
                              variant,
                              variantIndex
                            ) || "Producto sin código"}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="mt-5 border-t border-black/[0.06] pt-5">
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

              <div className="mt-5 rounded-[20px] bg-black/[0.025] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-black/45">
                    Etiquetas totales
                  </span>
                  <strong className="text-[18px] font-medium text-red-600">
                    {labels.length}
                  </strong>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={printing || labels.length === 0}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/15 disabled:shadow-none"
                >
                  <Printer size={16} />
                  {printing ? "Abriendo impresión..." : "Imprimir etiquetas"}
                </button>

                <button
                  type="button"
                  onClick={resetConfiguration}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.08] bg-white text-black/60 transition hover:bg-black/[0.025]"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[14px] font-medium text-black">
                    Vista previa
                  </p>
                  <p className="mt-1 text-[11px] text-black/45">
                    Formato físico real: dos etiquetas de 30 × 20 mm por fila.
                  </p>
                </div>

                <span className="rounded-full bg-white px-3 py-1.5 text-[10px] text-black/55 ring-1 ring-black/[0.06]">
                  {preset.label}
                </span>
              </div>

              <div className="mx-auto flex min-h-[320px] max-w-[760px] justify-center rounded-[26px] bg-white p-5 shadow-[0_18px_55px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.06]">
                {labels.length === 0 ? (
                  <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
                    <Tag size={34} className="text-black/20" />
                    <p className="mt-4 text-[15px] font-medium text-black">
                      No hay etiquetas seleccionadas
                    </p>
                    <p className="mt-2 max-w-[360px] text-[12px] leading-5 text-black/45">
                      Selecciona una talla y define la cantidad para generar la
                      vista previa.
                    </p>
                  </div>
                ) : (
                  <div
                    id="barcode-label-print-area"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${preset.columns}, ${preset.width})`,
                      columnGap: preset.columnGap,
                      rowGap: preset.rowGap,
                      width: preset.pageWidth,
                      maxWidth: "100%",
                      background: "#ffffff",
                      transform: "translateX(-0.5mm)",
                      transformOrigin: "top left",
                    }}
                  >
                    {printableLabels.map((label) => (
                      <PrintableLabel
                        key={label.key}
                        product={product}
                        label={label}
                        preset={preset}
                        store={storeData}
                        showStore={showStore}
                        showName={showName}
                        showPrice={showPrice}
                        showHumanCode={showHumanCode}
                        empty={Boolean(label.empty)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </main>
          </div>
        </section>
      </div>
    </>
  );
}

function PrintableLabel({
  product,
  label,
  preset,
  store,
  showStore,
  showName,
  showPrice,
  showHumanCode,
  empty = false,
}) {
  const svgRef = useRef(null);
  const compact30 = preset.id.includes("30x20");

  useEffect(() => {
    if (empty || !svgRef.current || !label.barcode) return;

    try {
      JsBarcode(svgRef.current, label.barcode, {
        format: "CODE128",
        lineColor: "#000000",
        background: "#ffffff",
        width: 2,
        height: preset.barcodeHeight,
        displayValue: false,
        margin: 0,
        flat: true,
      });
    } catch (error) {
      console.error("No se pudo generar el código de barras:", error);
    }
  }, [empty, label.barcode, preset]);

  return (
    <article
      className="barcode-print-label"
      style={{
        width: preset.width,
        minWidth: preset.width,
        maxWidth: preset.width,
        height: preset.height,
        minHeight: preset.height,
        maxHeight: preset.height,
        boxSizing: "border-box",
        breakInside: "avoid",
        padding: compact30
          ? "1.65mm 0.9mm 0.65mm"
          : "3mm",
        overflow: "hidden",
        background: "#ffffff",
        color: "#000000",
        border: 0,
        fontFamily:
          'Arial, Helvetica, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: preset.fontSize,
        lineHeight: 1.05,
        textAlign: "center",
        visibility: empty ? "hidden" : "visible",
      }}
    >
      {showStore && (
        <header
          className="barcode-label-store"
          style={{
            height: compact30 ? "2.5mm" : "8mm",
            marginBottom: compact30 ? "0.3mm" : "1mm",
          }}
        >
          {store.logoUrl ? (
            <img
              src={store.logoUrl}
              alt={store.name}
              style={{
                display: "block",
                width: "auto",
                height: compact30 ? "2.5mm" : "7mm",
                maxWidth: compact30 ? "16mm" : "24mm",
                objectFit: "contain",
                margin: "0 auto",
                filter:
                  "grayscale(1) brightness(0) contrast(2.3)",
              }}
            />
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: compact30 ? "5.2px" : "10px",
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              {store.name}
            </p>
          )}
        </header>
      )}

      {showName && (
        <p
          className="barcode-label-name"
          style={{
            display: "block",
            maxWidth: "100%",
            margin: compact30
              ? "0 0 0.35mm"
              : "0 0 1mm",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: compact30 ? "5.8px" : "11px",
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          {product.name}
        </p>
      )}

      <div
        className="barcode-label-meta"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "baseline",
          gap: compact30 ? "1mm" : "3mm",
          width: "100%",
          marginBottom: compact30 ? "0.35mm" : "1.5mm",
          fontSize: compact30 ? "6.5px" : "10px",
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
          Talla {label.variant.size}
        </span>

        {showPrice && (
          <strong
            style={{
              whiteSpace: "nowrap",
              textAlign: "right",
            }}
          >
            {formatCurrency(product.salePrice)}
          </strong>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flex: compact30 ? "1 1 auto" : "0 0 auto",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <svg
          ref={svgRef}
          aria-label={`Código de barras ${product.code || label.barcode}`}
          style={{
            display: "block",
            width: compact30 ? "26mm" : "48mm",
            maxWidth: compact30 ? "26mm" : "48mm",
            height: "auto",
            overflow: "visible",
          }}
        />
      </div>

      {showHumanCode && (
        <p
          className="barcode-label-code"
          style={{
            maxWidth: "100%",
            margin: compact30 ? "0.15mm 0 0" : "1mm 0 0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily:
              '"Courier New", Courier, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: compact30 ? "5.2px" : "9px",
            fontWeight: 700,
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          {product.code || label.barcode}
        </p>
      )}
    </article>
  );
}

function ToggleOption({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-black/[0.07] bg-white px-4 py-3 transition hover:bg-black/[0.02]">
      <span className="text-[12px] text-black/70">{label}</span>

      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />

      <span
        className={`relative h-6 w-11 rounded-full transition ${
          checked ? "bg-red-600" : "bg-black/10"
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