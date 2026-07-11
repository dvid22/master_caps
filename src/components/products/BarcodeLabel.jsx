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

const DEFAULT_STORE = {
  name: "MASTER CAPS",
  logoUrl: "/logo.png",
};

const PRESETS = {
  compact: {
    id: "compact",
    label: "Compacta",
    description: "Ideal para etiquetas pequeñas",
    width: "50mm",
    minHeight: "30mm",
    barcodeHeight: 42,
    barcodeWidth: 1.45,
  },
  thermal58: {
    id: "thermal58",
    label: "Térmica 58 mm",
    description: "Una etiqueta por línea",
    width: "58mm",
    minHeight: "38mm",
    barcodeHeight: 52,
    barcodeWidth: 1.65,
  },
  thermal80: {
    id: "thermal80",
    label: "Térmica 80 mm",
    description: "Mayor legibilidad",
    width: "80mm",
    minHeight: "46mm",
    barcodeHeight: 64,
    barcodeWidth: 1.9,
  },
};

function safeText(value) {
  return String(value || "").trim();
}

function normalizeCodePart(value) {
  return safeText(value)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-_]/g, "");
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

function buildVariantBarcode(product, variant) {
  if (variant?.barcode) {
    return normalizeCodePart(variant.barcode);
  }

  const productCode = normalizeCodePart(product?.code);
  const sizeCode = normalizeCodePart(variant?.size);

  if (!productCode) return "";

  if (!sizeCode || sizeCode === "TALLA-UNICA") {
    return `MC-${productCode}-UNICA`;
  }

  return `MC-${productCode}-${sizeCode}`;
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

export default function BarcodeLabel({
  product,
  open = true,
  onClose,
  store = DEFAULT_STORE,
  defaultPreset = "thermal58",
}) {
  const [presetId, setPresetId] = useState(
    PRESETS[defaultPreset] ? defaultPreset : "thermal58"
  );
  const [showStore, setShowStore] = useState(true);
  const [showName, setShowName] = useState(true);
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

    variants.forEach((variant) => {
      const selection = selections[variant.id];
      if (!selection?.selected) return;

      const stock = Math.max(Number(variant.stock || 0), 0);
      const quantity = Math.min(
        Math.max(Math.trunc(Number(selection.quantity || 0)), 0),
        stock
      );
      const barcode = buildVariantBarcode(product, variant);

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
    setPresetId(PRESETS[defaultPreset] ? defaultPreset : "thermal58");
    setShowStore(true);
    setShowName(true);
    setShowPrice(true);
    setShowHumanCode(true);
  }

  function handlePrint() {
    if (labels.length === 0) {
      alert("Selecciona al menos una etiqueta para imprimir.");
      return;
    }

    if (labels.some((label) => !label.barcode)) {
      alert("El producto debe tener un código para generar sus etiquetas.");
      return;
    }

    try {
      setPrinting(true);
      document.documentElement.style.setProperty(
        "--barcode-label-width",
        preset.width
      );

      window.setTimeout(() => {
        window.print();
        setPrinting(false);
      }, 180);
    } catch (error) {
      console.error(error);
      setPrinting(false);
      alert("No se pudo abrir el diálogo de impresión.");
    }
  }

  if (!open || !product) return null;

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: var(--barcode-label-width, 58mm) auto;
            margin: 0;
          }

          html,
          body {
            width: var(--barcode-label-width, 58mm) !important;
            min-width: var(--barcode-label-width, 58mm) !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          body * {
            visibility: hidden !important;
          }

          #barcode-label-print-area,
          #barcode-label-print-area * {
            visibility: visible !important;
          }

          #barcode-label-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: var(--barcode-label-width, 58mm) !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          .barcode-print-label {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
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
                  {variants.map((variant) => {
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
                            {buildVariantBarcode(product, variant) ||
                              "Producto sin código"}
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
                    label="Identidad de la tienda"
                    checked={showStore}
                    onChange={setShowStore}
                  />
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
                  {printing ? "Preparando..." : "Imprimir etiquetas"}
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
                    Cada bloque corresponde a una etiqueta.
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
                      width: preset.width,
                      maxWidth: "100%",
                      background: "#ffffff",
                    }}
                  >
                    {labels.map((label) => (
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
}) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !label.barcode) return;

    try {
      JsBarcode(svgRef.current, label.barcode, {
        format: "CODE128",
        lineColor: "#000000",
        background: "#ffffff",
        width: preset.barcodeWidth,
        height: preset.barcodeHeight,
        displayValue: false,
        margin: 0,
        flat: true,
      });
    } catch (error) {
      console.error("No se pudo generar el código de barras:", error);
    }
  }, [label.barcode, preset]);

  return (
    <article
      className="barcode-print-label"
      style={{
        width: "100%",
        minHeight: preset.minHeight,
        boxSizing: "border-box",
        breakInside: "avoid",
        padding: "3mm",
        background: "#ffffff",
        color: "#000000",
        borderBottom: "1px dashed #000000",
        fontFamily:
          'Arial, Helvetica, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: "center",
      }}
    >
      {showStore && (
        <header style={{ marginBottom: "2mm" }}>
          {store.logoUrl ? (
            <img
              src={store.logoUrl}
              alt={store.name}
              style={{
                display: "block",
                width: preset.id === "compact" ? "19mm" : "24mm",
                maxHeight: preset.id === "compact" ? "8mm" : "10mm",
                objectFit: "contain",
                margin: "0 auto",
                filter: "grayscale(1) contrast(1.35)",
              }}
            />
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: "0.08em",
              }}
            >
              {store.name}
            </p>
          )}
        </header>
      )}

      {showName && (
        <p
          style={{
            margin: "0 0 1mm",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: preset.id === "compact" ? "10px" : "11px",
            fontWeight: 700,
          }}
        >
          {product.name}
        </p>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "3mm",
          marginBottom: "1.5mm",
          fontSize: preset.id === "compact" ? "9px" : "10px",
        }}
      >
        <span>
          Talla: <strong>{label.variant.size}</strong>
        </span>

        {showPrice && <strong>{formatCurrency(product.salePrice)}</strong>}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <svg
          ref={svgRef}
          aria-label={`Código de barras ${label.barcode}`}
          style={{ display: "block", maxWidth: "100%", height: "auto" }}
        />
      </div>

      {showHumanCode && (
        <p
          style={{
            margin: "1mm 0 0",
            fontFamily:
              '"Courier New", Courier, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: preset.id === "compact" ? "8px" : "9px",
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
        >
          {label.barcode}
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