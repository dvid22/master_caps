import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ImageDown,
  Loader2,
  Search,
  Square,
  X,
} from "lucide-react";

import {
  analyzeProductImages,
  IMAGE_DOWNLOAD_ALLOWED_ORIGINS,
  isProductImagesOptimized,
  optimizeAllProductImages,
} from "../../services/productImageOptimizer.service";
import { getProductImages } from "../../services/products.service";

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("es-CO");
}

function Stat({ label, value, tone = "default" }) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-red-600"
          : "text-black";

  return (
    <div className="rounded-2xl bg-black/[0.03] px-4 py-3">
      <p className="text-[11px] text-black/45">{label}</p>
      <p className={`mt-0.5 text-[16px] font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function ProgressBar({ done, total }) {
  const percent = total > 0 ? Math.min(Math.round((done / total) * 100), 100) : 0;

  return (
    <div>
      <div className="flex justify-between text-[12px] text-black/55">
        <span>
          {formatNumber(done)} de {formatNumber(total)}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full bg-red-600 transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Panel de administración para optimizar en bloque las imágenes existentes.
 * - "Analizar" solo lee metadatos: no cambia nada.
 * - "Probar con 1 producto" y "Optimizar todo" sí escriben (con confirmación).
 */
export default function ImageOptimizationPanel({ open, onClose, products, storeId }) {
  const [phase, setPhase] = useState("idle"); // idle | analyzing | analyzed | running | done
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState(null);
  const [runProgress, setRunProgress] = useState(null);
  const [lastRunWasTest, setLastRunWasTest] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const wakeLockRef = useRef(null);

  const busy = phase === "analyzing" || phase === "running";

  const counts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];
    const withImages = list.filter((product) => getProductImages(product).length > 0);
    const optimized = withImages.filter(isProductImagesOptimized);

    return {
      total: list.length,
      withImages: withImages.length,
      optimized: optimized.length,
      pending: withImages.length - optimized.length,
    };
  }, [products]);

  /* Avisar antes de cerrar la pestaña durante el proceso. */
  useEffect(() => {
    if (!busy) return undefined;

    const handler = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  async function acquireWakeLock() {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      wakeLockRef.current = null;
    }
  }

  function releaseWakeLock() {
    try {
      wakeLockRef.current?.release();
    } catch {
      // sin acción
    }
    wakeLockRef.current = null;
  }

  async function handleAnalyze() {
    stopRef.current = false;
    setStopping(false);
    setFatalError("");
    setPhase("analyzing");
    setAnalysisProgress({ done: 0, total: products.length });

    try {
      const result = await analyzeProductImages(products, {
        shouldStop: () => stopRef.current,
        onProgress: ({ done, total, summary: partial }) => {
          setAnalysisProgress({ done, total });
          setSummary(partial);
        },
      });

      setSummary(result);
      setPhase("analyzed");
    } catch (error) {
      console.error(error);
      setFatalError(error?.message || "No se pudo analizar.");
      setPhase("idle");
    }
  }

  async function handleRun({ test }) {
    const message = test
      ? "Se optimizará 1 producto real. Las imágenes viejas NO se borran. ¿Continuar?"
      : `Se optimizarán ${formatNumber(counts.pending)} productos en producción.\n\n` +
        "• Hazlo desde Chrome en PC, idealmente con la tienda cerrada.\n" +
        "• No cierres esta pestaña mientras corre (puedes detenerlo y retomarlo luego).\n" +
        "• Las imágenes viejas NO se borran.\n\n¿Continuar?";

    if (!window.confirm(message)) return;

    stopRef.current = false;
    setStopping(false);
    setFatalError("");
    setLastRunWasTest(test);
    setPhase("running");
    setRunProgress({ done: 0, total: test ? 1 : counts.pending, errors: [] });
    await acquireWakeLock();

    try {
      const result = await optimizeAllProductImages(products, {
        storeId,
        limit: test ? 1 : undefined,
        shouldStop: () => stopRef.current,
        onProgress: (progress) => setRunProgress(progress),
      });

      setRunProgress(result);
      setPhase("done");
    } catch (error) {
      console.error(error);
      setFatalError(error?.message || "El proceso se detuvo por un error.");
      setPhase("done");
    } finally {
      releaseWakeLock();
    }
  }

  function handleStop() {
    stopRef.current = true;
    setStopping(true);
  }

  function handleClose() {
    if (busy) return;
    onClose?.();
  }

  if (!open) return null;

  const saved = runProgress
    ? Math.max(Number(runProgress.bytesBefore || 0) - Number(runProgress.bytesAfter || 0), 0)
    : 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-[18px] font-semibold text-black">
              <ImageDown size={20} className="text-red-600" />
              Optimizar imágenes
            </h2>
            <p className="mt-1 text-[12px] text-black/50">
              Recomprime las fotos pesadas, crea las miniaturas que faltan y corrige la caché.
              Las imágenes viejas no se borran.
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.04] text-black/60 transition hover:bg-black/[0.08] disabled:opacity-30"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Productos" value={formatNumber(counts.total)} />
          <Stat label="Con imágenes" value={formatNumber(counts.withImages)} />
          <Stat label="Ya optimizados" value={formatNumber(counts.optimized)} tone="good" />
          <Stat
            label="Pendientes"
            value={formatNumber(counts.pending)}
            tone={counts.pending > 0 ? "warn" : "good"}
          />
        </div>

        {!IMAGE_DOWNLOAD_ALLOWED_ORIGINS.includes(window.location.origin) && (
          <div className="mt-4 flex gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Desde esta dirección ({window.location.origin}) Storage bloquea la descarga de imágenes y la
              optimización fallará. Abre la app desde <b>http://localhost:5173</b> o desde el dominio oficial.
            </span>
          </div>
        )}

        {fatalError && (
          <div className="mt-4 flex gap-2 rounded-2xl bg-red-50 px-4 py-3 text-[12px] text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {fatalError}
          </div>
        )}

        {/* ANÁLISIS */}
        {phase === "analyzing" && (
          <div className="mt-5 space-y-3">
            <p className="flex items-center gap-2 text-[13px] text-black/70">
              <Loader2 size={15} className="animate-spin" />
              Analizando (solo lectura, no cambia nada)...
            </p>
            <ProgressBar done={analysisProgress.done} total={analysisProgress.total} />
          </div>
        )}

        {summary && phase !== "running" && phase !== "done" && (
          <div className="mt-5">
            <p className="text-[12px] font-medium text-black/60">
              Resultado del análisis {phase === "analyzing" ? "(parcial)" : ""}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Productos por optimizar" value={formatNumber(summary.productsNeedingWork)} tone="warn" />
              <Stat label="Fotos a recomprimir" value={formatNumber(summary.imagesToRecompress)} tone="warn" />
              <Stat label="Miniaturas a crear" value={formatNumber(summary.thumbnailsToCreate)} tone="warn" />
              <Stat label="Vistas previas a crear" value={formatNumber(summary.placeholdersToCreate)} />
              <Stat label="Arreglos de caché" value={formatNumber(summary.cacheFixes)} />
              <Stat label="Peso de fotos pesadas" value={formatBytes(summary.heavyMainBytes)} />
              {summary.missingImages > 0 && (
                <Stat label="Archivos no encontrados" value={formatNumber(summary.missingImages)} tone="bad" />
              )}
              {summary.errors > 0 && (
                <Stat label="Errores al analizar" value={formatNumber(summary.errors)} tone="bad" />
              )}
            </div>
          </div>
        )}

        {/* EJECUCIÓN */}
        {(phase === "running" || phase === "done") && runProgress && (
          <div className="mt-5 space-y-3">
            {phase === "running" ? (
              <p className="flex items-center gap-2 text-[13px] text-black/70">
                <Loader2 size={15} className="animate-spin" />
                {stopping
                  ? "Deteniendo cuando terminen los productos en curso..."
                  : "Optimizando... no cierres esta pestaña."}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-700">
                <CheckCircle2 size={16} />
                {lastRunWasTest ? "Prueba terminada" : "Proceso terminado"}
                {runProgress.done < runProgress.total ? " (detenido, puedes retomarlo)" : ""}
              </p>
            )}

            <ProgressBar done={runProgress.done || 0} total={runProgress.total || 0} />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Optimizados" value={formatNumber(runProgress.optimized)} tone="good" />
              <Stat label="Sin cambios" value={formatNumber(runProgress.unchanged)} />
              <Stat
                label="Con error"
                value={formatNumber(runProgress.failed)}
                tone={runProgress.failed > 0 ? "bad" : "default"}
              />
              <Stat label="Fotos recomprimidas" value={formatNumber(runProgress.recompressed)} />
              <Stat label="Miniaturas creadas" value={formatNumber(runProgress.thumbnails)} />
              <Stat label="Ahorro en fotos" value={formatBytes(saved)} tone="good" />
            </div>

            {runProgress.errors?.length > 0 && (
              <details className="rounded-2xl bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
                <summary className="cursor-pointer font-medium">
                  Avisos y errores ({runProgress.errors.length})
                </summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {runProgress.errors.map((item, index) => (
                    <li key={`${item.productId}-${index}`}>
                      <span className="font-medium">{item.name}:</span> {item.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* ACCIONES */}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {busy ? (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.1] bg-white px-4 text-[12px] font-medium text-black transition hover:bg-black/[0.03]"
            >
              <Square size={14} />
              Detener
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleAnalyze}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.1] bg-white px-4 text-[12px] font-medium text-black transition hover:bg-black/[0.03]"
              >
                <Search size={15} />
                {summary ? "Analizar de nuevo" : "Analizar (no cambia nada)"}
              </button>

              <button
                type="button"
                onClick={() => handleRun({ test: true })}
                disabled={counts.pending === 0}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-red-200 bg-white px-4 text-[12px] font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Probar con 1 producto
              </button>

              <button
                type="button"
                onClick={() => handleRun({ test: false })}
                disabled={counts.pending === 0}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-red-600 px-5 text-[12px] font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/[0.08] disabled:text-black/30 disabled:shadow-none"
              >
                <ImageDown size={15} />
                Optimizar {counts.pending > 0 ? formatNumber(counts.pending) : ""} productos
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
