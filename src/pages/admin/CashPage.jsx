import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Clock3,
  History,
  Landmark,
  LockKeyhole,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  WalletCards,
  X,
} from "lucide-react";

import { STORE_ID } from "../../services/categories.service";
import { getCurrentUserActor } from "../../services/auth.service";
import { formatCurrency } from "../../utils/money";
import { subscribeSales } from "../../services/sales.service";
import {
  CASH_METHODS,
  CASH_METHOD_LABELS,
  buildCashSessionSummary,
  closeCashSession,
  createCashMovement,
  getBogotaBusinessDate,
  openCashSession,
  recoverExpiredCashSessions,
  subscribeCashMovements,
  subscribeCashSessions,
  subscribeTodayCashSession,
} from "../../services/cash.service";

function parseMoney(value) {
  return Number(String(value || "").replace(/[^\d]/g, "") || 0);
}

function formatMoneyInput(value) {
  const number = parseMoney(value);

  return number
    ? new Intl.NumberFormat("es-CO", {
        maximumFractionDigits: 0,
      }).format(number)
    : "";
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const date = toDate(value);

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function CashPage() {
  const actor = useMemo(() => getCurrentUserActor(), []);

  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sales, setSales] = useState([]);
  const [movements, setMovements] = useState([]);

  const [openingAmount, setOpeningAmount] = useState("");
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(true);

  const [movementType, setMovementType] = useState("transfer");
  const [movementForm, setMovementForm] = useState({
    fromMethod: "efectivo",
    toMethod: "transferencia",
    amount: "",
    note: "",
  });
  const [moving, setMoving] = useState(false);

  const [closeOpen, setCloseOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closing, setClosing] = useState(false);

  const [historyDetailSession, setHistoryDetailSession] = useState(null);

  const [message, setMessage] = useState(null);

  const [businessDateKey, setBusinessDateKey] = useState(() =>
    getBogotaBusinessDate()
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextDate = getBogotaBusinessDate();

      setBusinessDateKey((current) =>
        current === nextDate ? current : nextDate
      );
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!actor?.uid) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    recoverExpiredCashSessions({
      storeId: STORE_ID,
      actor,
    }).catch((error) => {
      console.error(error);
    });

    const unsubscribeCurrent = subscribeTodayCashSession({
      storeId: STORE_ID,
      actor,
      callback: (value) => {
        setSession(value);
        setLoading(false);
      },
      onError: (error) => {
        console.error(error);
        setLoading(false);
      },
    });

    const unsubscribeSales = subscribeSales(
      (values) => setSales(Array.isArray(values) ? values : []),
      (error) => console.error(error),
      STORE_ID
    );

    const unsubscribeSessions = subscribeCashSessions(
      (values) => setSessions(Array.isArray(values) ? values : []),
      (error) => console.error(error),
      STORE_ID
    );

    return () => {
      unsubscribeCurrent();
      unsubscribeSales();
      unsubscribeSessions();
    };
  }, [actor, businessDateKey]);

  useEffect(() => {
    if (!session?.id) {
      setMovements([]);
      return undefined;
    }

    return subscribeCashMovements(
      session.id,
      (values) => setMovements(Array.isArray(values) ? values : []),
      (error) => console.error(error)
    );
  }, [session?.id]);

  const summary = useMemo(
    () => buildCashSessionSummary(session, sales, movements),
    [session, sales, movements]
  );

  const ownSessions = useMemo(
    () =>
      sessions
        .filter((item) => item.operatorUid === actor?.uid)
        .slice(0, 12),
    [sessions, actor?.uid]
  );

  function notify(type, text) {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4500);
  }

  async function handleOpenCash(event) {
    event.preventDefault();

    try {
      setOpening(true);

      await openCashSession({
        openingAmount: parseMoney(openingAmount),
        storeId: STORE_ID,
        actor,
      });

      setOpeningAmount("");
      notify("success", "Caja abierta correctamente.");
    } catch (error) {
      console.error(error);
      notify("error", error.message || "No se pudo abrir la caja.");
    } finally {
      setOpening(false);
    }
  }

  async function handleMovement(event) {
    event.preventDefault();

    try {
      setMoving(true);

      await createCashMovement({
        sessionId: session?.id,
        type: movementType,
        fromMethod: movementForm.fromMethod,
        toMethod: movementForm.toMethod,
        amount: parseMoney(movementForm.amount),
        note: movementForm.note,
        actor,
      });

      setMovementForm((current) => ({
        ...current,
        amount: "",
        note: "",
      }));

      notify("success", "Movimiento registrado.");
    } catch (error) {
      console.error(error);
      notify(
        "error",
        error.message || "No se pudo registrar el movimiento."
      );
    } finally {
      setMoving(false);
    }
  }

  async function handleCloseCash(event) {
    event.preventDefault();

    try {
      setClosing(true);

      await closeCashSession({
        sessionId: session?.id,
        countedCash: parseMoney(countedCash),
        actor,
        closeType: "manual",
      });

      setCloseOpen(false);
      setCountedCash("");
      notify("success", "Caja cerrada correctamente.");
    } catch (error) {
      console.error(error);
      notify("error", error.message || "No se pudo cerrar la caja.");
    } finally {
      setClosing(false);
    }
  }

  if (!actor?.uid) {
    return (
      <main className="min-h-screen bg-[#f5f5f6] px-4 py-8 text-[#111]">
        <section className="mx-auto flex min-h-[420px] max-w-[720px] items-center justify-center rounded-[24px] border border-black/[0.06] bg-white p-8 text-center shadow-[0_16px_50px_rgba(0,0,0,0.04)]">
          <div>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-red-50 text-red-600">
              <LockKeyhole size={20} />
            </div>

            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.04em]">
              No pudimos identificar al operador
            </h1>

            <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5 text-black/45">
              Vuelve a iniciar sesión antes de abrir o administrar una caja.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-3 py-4 text-[#171717] sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <CashHeader
          session={session}
          actor={actor}
          summary={summary}
          onClose={() => {
            setCountedCash(formatMoneyInput(summary.expectedCash));
            setCloseOpen(true);
          }}
        />

        {message && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-[14px] border px-4 py-3 text-[12px] font-medium ${
              message.type === "success"
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-red-100 bg-red-50 text-red-700"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle2 size={14} />
            ) : (
              <X size={14} />
            )}
            {message.text}
          </div>
        )}

        {loading ? (
          <LoadingCash />
        ) : !session ? (
          <OpenCashPanel
            openingAmount={openingAmount}
            setOpeningAmount={setOpeningAmount}
            opening={opening}
            actor={actor}
            onSubmit={handleOpenCash}
          />
        ) : session.status === "closed" ? (
          <ClosedCashPanel session={session} />
        ) : (
          <OpenSessionDashboard
            session={session}
            summary={summary}
            movements={movements}
            actor={actor}
            movementType={movementType}
            setMovementType={setMovementType}
            movementForm={movementForm}
            setMovementForm={setMovementForm}
            moving={moving}
            onMovement={handleMovement}
          />
        )}

        <CashHistory
          sessions={ownSessions}
          onViewDetails={setHistoryDetailSession}
        />
      </section>

      {historyDetailSession && (
        <CashHistoryDetailModal
          session={historyDetailSession}
          sales={sales}
          onClose={() => setHistoryDetailSession(null)}
        />
      )}

      {closeOpen && (
        <CloseCashModal
          expectedCash={summary.expectedCash}
          countedCash={countedCash}
          setCountedCash={setCountedCash}
          closing={closing}
          onClose={() => setCloseOpen(false)}
          onSubmit={handleCloseCash}
        />
      )}
    </main>
  );
}

function CashHeader({
  session,
  actor,
  summary,
  onClose,
}) {
  const isOpen = session?.status === "open";

  return (
    <header className="rounded-[20px] border border-black/[0.055] bg-white/[0.95] px-5 py-4 shadow-[0_12px_34px_rgba(15,23,42,0.035)] backdrop-blur sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50/70 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-red-600">
              <WalletCards size={10} />
              Caja
            </span>

            {isOpen && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Abierta
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[28px] font-semibold tracking-[-0.045em] sm:text-[31px]">
              Control de caja
            </h1>

            <span className="rounded-full bg-[#f5f5f6] px-2.5 py-1 text-[11px] font-medium text-black/40">
              {getBogotaBusinessDate()}
            </span>
          </div>

          <p className="mt-1 text-[12px] text-black/43">
            Base, ventas, saldos y movimientos del día en un solo lugar.
          </p>
        </div>

        {isOpen && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 gap-2 sm:min-w-[330px]">
              <HeaderValue
                label="Efectivo esperado"
                value={formatCurrency(summary.expectedCash)}
              />

              <HeaderValue
                label="Operador"
                value={session.operatorName || actor.name || "Vendedor"}
                text
              />
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-black/[0.08] bg-[#222] px-4 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:bg-black"
            >
              <LockKeyhole size={13} />
              Cerrar caja
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function HeaderValue({ label, value, text = false }) {
  return (
    <div className="min-w-0 rounded-[13px] border border-black/[0.045] bg-[#fafafa] px-3.5 py-2.5">
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/28">
        {label}
      </p>

      <p
        className={`mt-1 truncate font-semibold tracking-[-0.025em] ${
          text ? "text-[11px]" : "text-[14px]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function LoadingCash() {
  return (
    <section className="mt-4 flex min-h-[360px] items-center justify-center rounded-[20px] border border-black/[0.055] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.025)]">
      <div className="text-center">
        <RefreshCw
          size={20}
          className="mx-auto animate-spin text-red-600"
        />
        <p className="mt-3 text-[11px] text-black/40">
          Cargando información de caja...
        </p>
      </div>
    </section>
  );
}

function OpenCashPanel({
  openingAmount,
  setOpeningAmount,
  opening,
  actor,
  onSubmit,
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-[20px] border border-black/[0.055] bg-white shadow-[0_16px_44px_rgba(15,23,42,0.035)]">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="relative overflow-hidden border-b border-black/[0.045] bg-[#fbfaf9] px-6 py-7 text-[#171717] sm:px-8 lg:min-h-[405px] lg:border-b-0 lg:border-r lg:px-9 lg:py-9">
          <div className="pointer-events-none absolute -right-20 -top-16 h-56 w-56 rounded-full bg-red-500/[0.06] blur-3xl" />
          <div className="pointer-events-none absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-black/[0.025] blur-3xl" />

          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-red-100 bg-white text-red-600 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <Banknote size={20} />
              </div>

              <p className="mt-6 text-[9px] font-semibold uppercase tracking-[0.12em] text-black/35">
                Inicio de jornada
              </p>

              <h2 className="mt-2 max-w-[620px] text-[28px] font-semibold leading-[1.08] tracking-[-0.045em] sm:text-[33px]">
                Registra la base inicial y empieza la jornada con claridad.
              </h2>

              <p className="mt-3 max-w-[620px] text-[12px] leading-5 text-black/48">
                La caja inicia con una base separada de las ventas. Más tarde podrás
                revisar movimientos, saldos por modalidad y el cierre final del día.
              </p>

              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-black/[0.05] bg-white px-3 py-1.5 text-[9px] font-medium text-black/48 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Apertura simple · luego el control completo queda en el panel
              </div>
            </div>

            <div className="mt-8 grid gap-2 sm:grid-cols-3">
              <SoftInfo
                label="Operador"
                value={actor?.name || actor?.email || "Vendedor"}
              />

              <SoftInfo
                label="Jornada"
                value="1 caja por día"
              />

              <SoftInfo
                label="Cierre"
                value="12:00 a. m."
              />
            </div>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col justify-center bg-[#fff] px-5 py-7 sm:px-7 lg:px-8"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-red-600">
            Apertura
          </p>

          <h3 className="mt-1 text-[21px] font-semibold tracking-[-0.04em]">
            ¿Con cuánto efectivo inicia?
          </h3>

          <p className="mt-1 text-[11px] leading-4 text-black/40">
            Registra solo el dinero físico que se entrega al vendedor.
          </p>

          <label className="mt-5 block">
            <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-black/30">
              Base inicial
            </span>

            <div className="relative mt-1.5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-black/25">
                $
              </span>

              <input
                value={openingAmount}
                onChange={(event) =>
                  setOpeningAmount(
                    formatMoneyInput(event.target.value)
                  )
                }
                inputMode="numeric"
                className="h-[52px] w-full rounded-[14px] border border-black/[0.08] bg-[#fafafa] pl-9 pr-4 text-[18px] font-semibold tracking-[-0.03em] outline-none transition placeholder:text-black/18 focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-600/10"
                placeholder="0"
                autoFocus
              />
            </div>
          </label>

          <div className="mt-3 rounded-[13px] border border-black/[0.045] bg-[#fafafa] px-3.5 py-3">
            <p className="text-[9.5px] leading-4 text-black/45">
              Ejemplo: base <strong>$10.000</strong> + ventas en efectivo{" "}
              <strong>$100.000</strong> = efectivo esperado{" "}
              <strong>$110.000</strong>.
            </p>
          </div>

          <div className="mt-4 grid gap-2 rounded-[13px] border border-black/[0.04] bg-[#fbfbfc] p-3">
            <div className="flex items-center justify-between gap-3 text-[9px] text-black/48">
              <span>Separa la base del día</span>
              <strong className="text-black/70">Sí</strong>
            </div>
            <div className="flex items-center justify-between gap-3 text-[9px] text-black/48">
              <span>Calcula el efectivo esperado</span>
              <strong className="text-black/70">Automático</strong>
            </div>
          </div>

          <button
            type="submit"
            disabled={opening}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-red-600 text-[11px] font-semibold text-white shadow-[0_10px_24px_rgba(220,38,38,0.16)] transition hover:-translate-y-0.5 hover:bg-red-700 disabled:translate-y-0 disabled:bg-black/15 disabled:shadow-none"
          >
            {opening ? (
              <RefreshCw
                size={13}
                className="animate-spin"
              />
            ) : (
              <CheckCircle2 size={13} />
            )}

            {opening ? "Abriendo caja..." : "Abrir caja"}
          </button>
        </form>
      </div>
    </section>
  );
}

function SoftInfo({ label, value }) {
  return (
    <div className="rounded-[12px] border border-black/[0.05] bg-white/[0.82] px-3.5 py-3 shadow-sm backdrop-blur-sm">
      <p className="text-[8px] uppercase tracking-[0.08em] text-black/35">
        {label}
      </p>
      <p className="mt-1 truncate text-[10px] font-medium text-black/72">
        {value}
      </p>
    </div>
  );
}

function OpenSessionDashboard({
  session,
  summary,
  movements,
  actor,
  movementType,
  setMovementType,
  movementForm,
  setMovementForm,
  moving,
  onMovement,
}) {
  return (
    <>
      <section className="mt-4 grid gap-3 lg:grid-cols-[1.18fr_.82fr]">
        <article className="rounded-[20px] border border-black/[0.055] bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.03)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-black/30">
                Dinero disponible
              </p>

              <p className="mt-1 text-[34px] font-semibold tracking-[-0.055em] sm:text-[40px]">
                {formatCurrency(summary.totalAvailable)}
              </p>

              <p className="mt-1 text-[10px] text-black/38">
                Total actual distribuido entre los distintos medios.
              </p>
            </div>

            <div className="rounded-[14px] border border-red-100 bg-red-50/65 px-4 py-3">
              <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-red-600">
                Efectivo esperado
              </p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.04em]">
                {formatCurrency(summary.expectedCash)}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SessionStat
              label="Base inicial"
              value={formatCurrency(session.openingAmount)}
            />
            <SessionStat
              label="Ventas"
              value={formatCurrency(summary.totalSales)}
            />
            <SessionStat
              label="Operaciones"
              value={`${summary.saleCount} ventas`}
            />
            <SessionStat
              label="Apertura"
              value={formatDateTime(session.openedAt)}
            />
          </div>
        </article>

        <article className="rounded-[20px] border border-red-100/70 bg-[#fffafa] p-5 text-[#171717] shadow-[0_12px_32px_rgba(15,23,42,0.028)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-red-500/80">
                Resumen del día
              </p>
              <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.03em]">
                Así va la jornada
              </h2>
            </div>

            <Landmark size={17} className="text-red-500" />
          </div>

          <div className="mt-5 space-y-3">
            <DarkSummaryLine
              label="Base inicial"
              value={formatCurrency(session.openingAmount)}
            />
            <DarkSummaryLine
              label="Ventas registradas"
              value={formatCurrency(summary.totalSales)}
            />
            <DarkSummaryLine
              label="Número de ventas"
              value={summary.saleCount}
            />
            <div className="border-t border-red-100/70 pt-3">
              <DarkSummaryLine
                label="Efectivo esperado"
                value={formatCurrency(summary.expectedCash)}
                strong
              />
            </div>
          </div>
        </article>
      </section>

      <section className="mt-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold tracking-[-0.02em]">
              Saldos actuales
            </h2>
            <p className="mt-0.5 text-[10px] text-black/36">
              Dónde está el dinero en este momento.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {CASH_METHODS.map((method) => (
            <BalanceCard
              key={method}
              method={method}
              balance={summary.balances[method]}
              sold={summary.salesByMethod[method]}
              pending={
                method === "addi"
                  ? summary.pendingAddi
                  : 0
              }
            />
          ))}
        </div>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <ActivityPanel movements={movements} />

        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <MovementForm
            type={movementType}
            setType={setMovementType}
            form={movementForm}
            setForm={setMovementForm}
            moving={moving}
            balances={summary.balances}
            onSubmit={onMovement}
          />

          <SessionInfo
            session={session}
            actor={actor}
          />
        </aside>
      </section>
    </>
  );
}

function SessionStat({ label, value }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-black/[0.045] bg-[#fafafa] px-3 py-3">
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/28">
        {label}
      </p>
      <p className="mt-1 truncate text-[10px] font-medium text-black/70">
        {value}
      </p>
    </div>
  );
}

function DarkSummaryLine({
  label,
  value,
  strong = false,
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[10px] text-black/42">
        {label}
      </span>

      <span
        className={
          strong
            ? "text-[12px] font-semibold text-[#171717]"
            : "text-[10px] font-medium text-black/72"
        }
      >
        {value}
      </span>
    </div>
  );
}

function BalanceCard({
  method,
  balance,
  sold,
  pending,
}) {
  const amount = Number(balance || 0);
  const hasBalance = amount !== 0;

  return (
    <article
      className={`min-w-0 rounded-[15px] border px-3.5 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.045)] ${
        hasBalance
          ? "border-black/[0.065] bg-white shadow-[0_6px_18px_rgba(15,23,42,0.025)]"
          : "border-black/[0.04] bg-white/[0.80]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[9px] font-medium text-black/45">
          {CASH_METHOD_LABELS[method]}
        </p>

        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            hasBalance ? "bg-red-500" : "bg-black/10"
          }`}
        />
      </div>

      <p className="mt-1.5 truncate text-[15px] font-semibold tracking-[-0.04em]">
        {formatCurrency(amount)}
      </p>

      <div className="mt-2 border-t border-black/[0.045] pt-2">
        <p className="truncate text-[8px] text-black/30">
          Vendido: {formatCurrency(sold)}
        </p>

        {pending > 0 && (
          <p className="mt-1 truncate text-[8px] font-medium text-amber-700">
            Pendiente: {formatCurrency(pending)}
          </p>
        )}
      </div>
    </article>
  );
}

function ActivityPanel({ movements }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[20px] border border-black/[0.055] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between border-b border-black/[0.05] bg-[#fcfcfd] px-4 py-3.5">
        <div>
          <h2 className="text-[12px] font-semibold">
            Actividad de caja
          </h2>
          <p className="mt-0.5 text-[9px] text-black/34">
            Traslados, entradas y salidas manuales.
          </p>
        </div>

        <span className="rounded-full bg-black/[0.035] px-2.5 py-1 text-[8px] font-medium text-black/45">
          {movements.length} movimiento(s)
        </span>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {movements.length === 0 ? (
          <div className="flex min-h-[280px] items-center justify-center p-8 text-center">
            <div>
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[13px] bg-[#f7f7f8] text-black/30">
                <History size={17} />
              </div>

              <p className="mt-3 text-[11px] font-medium">
                Sin movimientos manuales
              </p>

              <p className="mx-auto mt-1 max-w-[320px] text-[9px] leading-4 text-black/34">
                Las ventas se reflejan en los saldos automáticamente.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.045]">
            {movements.map((movement) => (
              <MovementRow
                key={movement.id}
                movement={movement}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MovementForm({
  type,
  setType,
  form,
  setForm,
  moving,
  balances,
  onSubmit,
}) {
  const types = [
    ["transfer", "Mover", ArrowRightLeft],
    ["entry", "Entrada", PlusCircle],
    ["exit", "Salida", MinusCircle],
  ];

  return (
    <form
      onSubmit={onSubmit}
      className="overflow-hidden rounded-[20px] border border-black/[0.055] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.03)]"
    >
      <div className="border-b border-black/[0.055] px-4 py-3.5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-red-600">
          Movimiento
        </p>

        <h2 className="mt-1 text-[14px] font-semibold tracking-[-0.02em]">
          Administrar dinero
        </h2>

        <p className="mt-0.5 text-[9px] leading-4 text-black/34">
          Mueve dinero sin alterar las ventas.
        </p>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-1 rounded-[11px] border border-black/[0.04] bg-[#f5f5f6] p-1">
          {types.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] text-[9px] font-medium transition ${
                type === value
                  ? "bg-white text-red-600 shadow-[0_4px_12px_rgba(15,23,42,0.05)] ring-1 ring-black/[0.035]"
                  : "text-black/40 hover:text-black/65"
              }`}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {type !== "entry" && (
            <CashSelect
              label="Origen"
              value={form.fromMethod}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  fromMethod: value,
                }))
              }
            >
              {CASH_METHODS.map((method) => (
                <option
                  key={method}
                  value={method}
                >
                  {CASH_METHOD_LABELS[method]} ·{" "}
                  {formatCurrency(balances[method])}
                </option>
              ))}
            </CashSelect>
          )}

          {type !== "exit" && (
            <CashSelect
              label="Destino"
              value={form.toMethod}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  toMethod: value,
                }))
              }
            >
              {CASH_METHODS.map((method) => (
                <option
                  key={method}
                  value={method}
                >
                  {CASH_METHOD_LABELS[method]}
                </option>
              ))}
            </CashSelect>
          )}

          <label className="block">
            <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/28">
              Valor
            </span>

            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-black/25">
                $
              </span>

              <input
                value={form.amount}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    amount: formatMoneyInput(event.target.value),
                  }))
                }
                inputMode="numeric"
                className="h-10 w-full rounded-[10px] border border-black/[0.07] bg-[#fafafa] pl-7 pr-3 text-[11px] font-medium outline-none transition focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-600/10"
                placeholder="0"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/28">
              Nota
            </span>

            <input
              value={form.note}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
              className="mt-1 h-10 w-full rounded-[10px] border border-black/[0.07] bg-[#fafafa] px-3 text-[10px] outline-none transition placeholder:text-black/25 focus:border-red-500 focus:bg-white"
              placeholder="Motivo opcional"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={
            moving ||
            parseMoney(form.amount) <= 0
          }
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-red-600 text-[10px] font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.14)] transition hover:-translate-y-0.5 hover:bg-red-700 disabled:translate-y-0 disabled:bg-black/15 disabled:shadow-none"
        >
          {moving ? (
            <RefreshCw
              size={12}
              className="animate-spin"
            />
          ) : (
            <ArrowRightLeft size={12} />
          )}

          {moving
            ? "Registrando..."
            : "Registrar movimiento"}
        </button>
      </div>
    </form>
  );
}

function CashSelect({
  label,
  value,
  onChange,
  children,
}) {
  return (
    <label className="block">
      <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/28">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-1 h-10 w-full rounded-[10px] border border-black/[0.07] bg-[#fafafa] px-3 text-[10px] outline-none transition focus:border-red-500 focus:bg-white"
      >
        {children}
      </select>
    </label>
  );
}

function SessionInfo({ session, actor }) {
  return (
    <section className="rounded-[20px] border border-black/[0.055] bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#f7f7f8] text-black/45">
          <Clock3 size={14} />
        </div>

        <div>
          <p className="text-[11px] font-semibold">
            Sesión actual
          </p>
          <p className="text-[8px] text-black/32">
            Información operativa
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        <InfoRow
          label="Operador"
          value={
            session.operatorName ||
            actor.name ||
            "Vendedor"
          }
        />

        <InfoRow
          label="Fecha"
          value={session.businessDate}
        />

        <InfoRow
          label="Apertura"
          value={formatDateTime(session.openedAt)}
        />

        <InfoRow
          label="Cierre límite"
          value="12:00 a. m."
        />
      </div>

      <div className="mt-4 rounded-[12px] border border-amber-100 bg-amber-50/70 px-3 py-2.5">
        <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-amber-700">
          Cierre automático
        </p>

        <p className="mt-1 text-[9px] leading-4 text-amber-900/65">
          Si la caja sigue abierta al cambiar el día, la sesión se considera vencida.
        </p>
      </div>
    </section>
  );
}

function MovementRow({ movement }) {
  const Icon =
    movement.type === "entry"
      ? ArrowDownLeft
      : movement.type === "exit"
        ? ArrowUpRight
        : ArrowRightLeft;

  const label =
    movement.type === "entry"
      ? `Entrada → ${
          CASH_METHOD_LABELS[movement.toMethod] ||
          movement.toMethod
        }`
      : movement.type === "exit"
        ? `${
            CASH_METHOD_LABELS[movement.fromMethod] ||
            movement.fromMethod
          } → Salida`
        : `${
            CASH_METHOD_LABELS[movement.fromMethod] ||
            movement.fromMethod
          } → ${
            CASH_METHOD_LABELS[movement.toMethod] ||
            movement.toMethod
          }`;

  const tone =
    movement.type === "entry"
      ? "bg-emerald-50 text-emerald-700"
      : movement.type === "exit"
        ? "bg-red-50 text-red-600"
        : "bg-black/[0.035] text-black/55";

  return (
    <article className="flex items-center gap-3 px-4 py-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] ${tone}`}
      >
        <Icon size={13} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-medium text-black/72">
          {label}
        </p>

        <p className="mt-0.5 truncate text-[8px] text-black/32">
          {movement.createdByName || "Usuario"} ·{" "}
          {formatDateTime(movement.createdAt)}
          {movement.note ? ` · ${movement.note}` : ""}
        </p>
      </div>

      <strong className="shrink-0 text-[11px] font-semibold">
        {formatCurrency(movement.amount)}
      </strong>
    </article>
  );
}

function ClosedCashPanel({ session }) {
  const automatic =
    session.closeType?.startsWith("automatic");

  return (
    <section className="mt-4 rounded-[20px] border border-black/[0.055] bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.03)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-black/[0.07] bg-[#f5f5f6] text-black/70">
            <LockKeyhole size={16} />
          </div>

          <div>
            <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-black/45">
              Caja cerrada
            </span>

            <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.035em]">
              Jornada finalizada
            </h2>

            <p className="mt-1 text-[10px] text-black/38">
              {automatic ? "Cierre automático" : "Cierre manual"} ·{" "}
              {formatDateTime(session.closedAt)}
            </p>
          </div>
        </div>

        <div className="rounded-[13px] bg-[#f7f7f8] px-4 py-2.5 text-right">
          <p className="text-[8px] uppercase tracking-[0.08em] text-black/28">
            Fecha
          </p>
          <p className="mt-1 text-[11px] font-medium">
            {session.businessDate}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <CloseMetric
          label="Esperado"
          value={formatCurrency(session.expectedCash)}
        />

        <CloseMetric
          label="Contado"
          value={
            session.countedCash === null
              ? "No contado"
              : formatCurrency(session.countedCash)
          }
        />

        <CloseMetric
          label="Diferencia"
          value={
            session.difference === null
              ? "—"
              : formatCurrency(session.difference)
          }
          accent={Number(session.difference || 0) !== 0}
        />
      </div>
    </section>
  );
}

function CloseMetric({
  label,
  value,
  accent = false,
}) {
  return (
    <article
      className={`rounded-[15px] border px-4 py-3 ${
        accent
          ? "border-red-100 bg-red-50/40"
          : "border-black/[0.055] bg-[#fafafa]"
      }`}
    >
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/28">
        {label}
      </p>

      <p className="mt-1 text-[17px] font-semibold tracking-[-0.04em]">
        {value}
      </p>
    </article>
  );
}


function saleBelongsToHistorySession(sale, session) {
  if (!sale || !session) return false;

  if (sale.cashSessionId) {
    return sale.cashSessionId === session.id;
  }

  const saleSellerUid = String(sale.sellerUid || "").trim();
  const operatorUid = String(session.operatorUid || "").trim();

  if (
    saleSellerUid &&
    operatorUid &&
    saleSellerUid !== operatorUid
  ) {
    return false;
  }

  const saleDate = toDate(sale.createdAt);
  const openedAt = toDate(session.openedAt);
  const closedAt = toDate(session.closedAt);

  if (!saleDate || !openedAt) {
    return false;
  }

  if (saleDate.getTime() < openedAt.getTime()) {
    return false;
  }

  if (
    closedAt &&
    saleDate.getTime() > closedAt.getTime()
  ) {
    return false;
  }

  return (
    getBogotaBusinessDate(saleDate) ===
    session.businessDate
  );
}

function getSalePaymentSummary(sale) {
  if (
    Array.isArray(sale?.payments) &&
    sale.payments.length > 0
  ) {
    return sale.payments
      .filter((payment) => Number(payment?.amount || 0) > 0)
      .map(
        (payment) =>
          `${CASH_METHOD_LABELS[payment.method] || payment.method || "Otro"} ${formatCurrency(
            payment.amount
          )}`
      )
      .join(" · ");
  }

  return (
    CASH_METHOD_LABELS[sale?.paymentMethod] ||
    sale?.paymentMethod ||
    "Otro"
  );
}

function numericOrFallback(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number(fallback || 0);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function CashHistory({
  sessions,
  onViewDetails,
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-[20px] border border-black/[0.055] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.025)]">
      <div className="flex items-center justify-between border-b border-black/[0.05] bg-[#fcfcfd] px-4 py-3.5">
        <div>
          <h2 className="text-[12px] font-semibold">
            Historial de cajas
          </h2>

          <p className="mt-0.5 text-[9px] text-black/34">
            Consulta aperturas, cierres, saldos, ventas y movimientos de cada jornada.
          </p>
        </div>

        <CalendarClock size={14} className="text-red-600" />
      </div>

      <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
        {sessions.length === 0 ? (
          <div className="rounded-[13px] bg-[#f7f7f8] px-4 py-5 text-[10px] text-black/40">
            Sin historial de cajas todavía.
          </div>
        ) : (
          sessions.map((item) => (
            <SessionHistoryCard
              key={item.id}
              session={item}
              onViewDetails={() =>
                onViewDetails?.(item)
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

function SessionHistoryCard({
  session,
  onViewDetails,
}) {
  const isOpen = session.status === "open";
  const automatic =
    session.closeType?.startsWith("automatic");

  const totalSales = numericOrFallback(
    session.closingTotalSales,
    0
  );

  const saleCount = numericOrFallback(
    session.closingSaleCount,
    0
  );

  return (
    <article className="rounded-[15px] border border-black/[0.055] bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-red-200/70 hover:shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold">
            {session.businessDate}
          </p>

          <p className="mt-1 text-[8px] text-black/34">
            {isOpen
              ? "Sesión activa"
              : automatic
                ? "Cierre automático"
                : "Cierre manual"}
          </p>
        </div>

        <span
          className={`rounded-full px-2 py-1 text-[7.5px] font-semibold ${
            isOpen
              ? "bg-emerald-50 text-emerald-700"
              : "bg-black/[0.035] text-black/45"
          }`}
        >
          {isOpen ? "ABIERTA" : "CERRADA"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-black/[0.05] pt-3">
        <HistoryMiniValue
          label="Base"
          value={formatCurrency(session.openingAmount)}
        />

        <HistoryMiniValue
          label="Esperado"
          value={
            isOpen
              ? "En curso"
              : formatCurrency(session.expectedCash)
          }
          alignRight
        />

        {!isOpen && (
          <>
            <HistoryMiniValue
              label="Ventas"
              value={formatCurrency(totalSales)}
            />

            <HistoryMiniValue
              label="Operaciones"
              value={`${saleCount} venta(s)`}
              alignRight
            />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onViewDetails}
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-black/[0.05] bg-[#f8f8f9] text-[9px] font-semibold text-black/60 transition hover:border-red-100 hover:bg-red-50 hover:text-red-600"
      >
        <History size={11} />
        Ver detalle completo
      </button>
    </article>
  );
}

function HistoryMiniValue({
  label,
  value,
  alignRight = false,
}) {
  return (
    <div className={alignRight ? "text-right" : ""}>
      <p className="text-[7px] font-semibold uppercase tracking-[0.08em] text-black/27">
        {label}
      </p>

      <p className="mt-1 truncate text-[10px] font-medium text-black/68">
        {value}
      </p>
    </div>
  );
}

function CashHistoryDetailModal({
  session,
  sales,
  onClose,
}) {
  const [detailMovements, setDetailMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(true);

  useEffect(() => {
    setMovementsLoading(true);

    const unsubscribe = subscribeCashMovements(
      session.id,
      (values) => {
        setDetailMovements(
          Array.isArray(values) ? values : []
        );
        setMovementsLoading(false);
      },
      (error) => {
        console.error(
          "No se pudieron cargar los movimientos de la caja:",
          error
        );
        setDetailMovements([]);
        setMovementsLoading(false);
      }
    );

    return () => unsubscribe?.();
  }, [session.id]);

  const sessionSales = useMemo(
    () =>
      (Array.isArray(sales) ? sales : [])
        .filter((sale) =>
          saleBelongsToHistorySession(sale, session)
        )
        .sort(
          (a, b) =>
            (toDate(b.createdAt)?.getTime() || 0) -
            (toDate(a.createdAt)?.getTime() || 0)
        ),
    [sales, session]
  );

  const calculatedSummary = useMemo(
    () =>
      buildCashSessionSummary(
        session,
        sales,
        detailMovements
      ),
    [session, sales, detailMovements]
  );

  const isClosed = session.status === "closed";

  const finalBalances = isClosed
    ? objectOrEmpty(session.closingBalances)
    : calculatedSummary.balances;

  const salesByMethod = isClosed
    ? objectOrEmpty(session.closingSalesByMethod)
    : calculatedSummary.salesByMethod;

  const totalSales = isClosed
    ? numericOrFallback(
        session.closingTotalSales,
        calculatedSummary.totalSales
      )
    : calculatedSummary.totalSales;

  const saleCount = isClosed
    ? numericOrFallback(
        session.closingSaleCount,
        calculatedSummary.saleCount
      )
    : calculatedSummary.saleCount;

  const pendingAddi = isClosed
    ? numericOrFallback(
        session.closingPendingAddi,
        calculatedSummary.pendingAddi
      )
    : calculatedSummary.pendingAddi;

  const expectedCash = isClosed
    ? numericOrFallback(
        session.expectedCash,
        finalBalances.efectivo
      )
    : calculatedSummary.expectedCash;

  const totalAvailable = CASH_METHODS.reduce(
    (total, method) =>
      total +
      numericOrFallback(finalBalances[method], 0),
    0
  );

  const movementTotals = detailMovements.reduce(
    (result, movement) => {
      const amount = numericOrFallback(
        movement.amount,
        0
      );

      if (movement.type === "entry") {
        result.entries += amount;
      } else if (movement.type === "exit") {
        result.exits += amount;
      } else if (movement.type === "transfer") {
        result.transfers += amount;
      }

      return result;
    },
    {
      entries: 0,
      exits: 0,
      transfers: 0,
    }
  );

  const automatic =
    session.closeType?.startsWith("automatic");

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/[0.025]5 p-2 backdrop-blur-sm sm:p-4">
      <section className="flex max-h-[94vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-[22px] border border-white/40 bg-[#f7f7f8] shadow-[0_32px_100px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between border-b border-black/[0.05] bg-white px-5 py-4 sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[8px] font-semibold ${
                  session.status === "open"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-black/[0.04] text-black/50"
                }`}
              >
                {session.status === "open"
                  ? "CAJA ABIERTA"
                  : "CAJA CERRADA"}
              </span>

              <span className="text-[9px] text-black/34">
                {automatic
                  ? "Cierre automático"
                  : session.status === "closed"
                    ? "Cierre manual"
                    : "Sesión en curso"}
              </span>
            </div>

            <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.04em]">
              Caja · {session.businessDate}
            </h2>

            <p className="mt-1 text-[10px] text-black/38">
              Auditoría completa de la jornada.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-black/[0.04] text-black/48 transition hover:bg-black/[0.08]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <HistoryMetric
              label="Base inicial"
              value={formatCurrency(session.openingAmount)}
            />

            <HistoryMetric
              label="Ventas"
              value={formatCurrency(totalSales)}
            />

            <HistoryMetric
              label="Operaciones"
              value={`${saleCount} venta(s)`}
            />

            <HistoryMetric
              label="Total disponible"
              value={formatCurrency(totalAvailable)}
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
            <HistorySection
              title="Información de la sesión"
              icon={Clock3}
            >
              <HistoryInfoGrid>
                <HistoryInfo
                  label="Operador"
                  value={
                    session.operatorName ||
                    "Sin nombre"
                  }
                />

                <HistoryInfo
                  label="Correo"
                  value={
                    session.operatorEmail ||
                    "Sin correo"
                  }
                />

                <HistoryInfo
                  label="Apertura"
                  value={formatDateTime(session.openedAt)}
                />

                <HistoryInfo
                  label="Cierre"
                  value={
                    session.closedAt
                      ? formatDateTime(session.closedAt)
                      : "Aún abierta"
                  }
                />

                <HistoryInfo
                  label="Cerrada por"
                  value={
                    session.closedByName ||
                    (session.status === "open"
                      ? "—"
                      : "Sistema")
                  }
                />

                <HistoryInfo
                  label="Tipo de cierre"
                  value={
                    session.status === "open"
                      ? "En curso"
                      : automatic
                        ? "Automático"
                        : "Manual"
                  }
                />
              </HistoryInfoGrid>
            </HistorySection>

            <HistorySection
              title="Arqueo de efectivo"
              icon={Banknote}
            >
              <div className="grid grid-cols-3 gap-2">
                <HistoryMoneyBox
                  label="Esperado"
                  value={formatCurrency(expectedCash)}
                />

                <HistoryMoneyBox
                  label="Contado"
                  value={
                    session.countedCash === null ||
                    session.countedCash === undefined
                      ? "No contado"
                      : formatCurrency(session.countedCash)
                  }
                />

                <HistoryMoneyBox
                  label="Diferencia"
                  value={
                    session.difference === null ||
                    session.difference === undefined
                      ? "—"
                      : formatCurrency(session.difference)
                  }
                  alert={
                    Number(session.difference || 0) !== 0
                  }
                />
              </div>

              {pendingAddi > 0 && (
                <div className="mt-3 rounded-[12px] bg-amber-50 px-3 py-2.5">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                    Addi pendiente por recibir
                  </p>

                  <p className="mt-1 text-[13px] font-semibold text-amber-900">
                    {formatCurrency(pendingAddi)}
                  </p>
                </div>
              )}
            </HistorySection>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <HistorySection
              title="Saldo final por modalidad"
              icon={WalletCards}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {CASH_METHODS.map((method) => (
                  <HistoryMethodBox
                    key={method}
                    label={CASH_METHOD_LABELS[method]}
                    value={numericOrFallback(
                      finalBalances[method],
                      0
                    )}
                  />
                ))}
              </div>
            </HistorySection>

            <HistorySection
              title="Ventas por modalidad"
              icon={Landmark}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {CASH_METHODS.map((method) => (
                  <HistoryMethodBox
                    key={method}
                    label={CASH_METHOD_LABELS[method]}
                    value={numericOrFallback(
                      salesByMethod[method],
                      0
                    )}
                  />
                ))}
              </div>
            </HistorySection>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)]">
            <HistorySection
              title={`Ventas de la caja (${sessionSales.length})`}
              icon={History}
            >
              {sessionSales.length === 0 ? (
                <EmptyHistoryText>
                  No se encontraron ventas asociadas a esta caja.
                </EmptyHistoryText>
              ) : (
                <div className="max-h-[360px] overflow-y-auto rounded-[12px] border border-black/[0.055]">
                  <div className="divide-y divide-black/[0.045]">
                    {sessionSales.map((sale) => (
                      <HistorySaleRow
                        key={sale.id}
                        sale={sale}
                      />
                    ))}
                  </div>
                </div>
              )}
            </HistorySection>

            <HistorySection
              title={`Movimientos (${detailMovements.length})`}
              icon={ArrowRightLeft}
            >
              <div className="grid grid-cols-3 gap-2">
                <MovementTotalBox
                  label="Entradas"
                  value={movementTotals.entries}
                  tone="entry"
                />

                <MovementTotalBox
                  label="Salidas"
                  value={movementTotals.exits}
                  tone="exit"
                />

                <MovementTotalBox
                  label="Traslados"
                  value={movementTotals.transfers}
                  tone="transfer"
                />
              </div>

              <div className="mt-3 max-h-[285px] overflow-y-auto rounded-[12px] border border-black/[0.055]">
                {movementsLoading ? (
                  <div className="flex min-h-[120px] items-center justify-center">
                    <RefreshCw
                      size={15}
                      className="animate-spin text-red-600"
                    />
                  </div>
                ) : detailMovements.length === 0 ? (
                  <EmptyHistoryText>
                    No hubo movimientos manuales.
                  </EmptyHistoryText>
                ) : (
                  <div className="divide-y divide-black/[0.045]">
                    {detailMovements.map((movement) => (
                      <MovementRow
                        key={movement.id}
                        movement={movement}
                      />
                    ))}
                  </div>
                )}
              </div>
            </HistorySection>
          </div>
        </div>

        <div className="flex justify-end border-t border-black/[0.055] bg-white px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-[10px] bg-black px-5 text-[10px] font-semibold text-white transition hover:bg-black/85"
          >
            Cerrar detalle
          </button>
        </div>
      </section>
    </div>
  );
}

function HistoryMetric({
  label,
  value,
}) {
  return (
    <article className="rounded-[14px] border border-black/[0.05] bg-white px-4 py-3 shadow-[0_6px_18px_rgba(15,23,42,0.025)]">
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/28">
        {label}
      </p>

      <p className="mt-1 text-[17px] font-semibold tracking-[-0.035em]">
        {value}
      </p>
    </article>
  );
}

function HistorySection({
  title,
  icon: Icon,
  children,
}) {
  return (
    <section className="rounded-[16px] border border-black/[0.05] bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.02)]">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-red-100 bg-red-50/70 text-red-600">
          <Icon size={13} />
        </div>

        <h3 className="text-[11px] font-semibold">
          {title}
        </h3>
      </div>

      <div className="mt-3">
        {children}
      </div>
    </section>
  );
}

function HistoryInfoGrid({ children }) {
  return (
    <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
      {children}
    </div>
  );
}

function HistoryInfo({
  label,
  value,
}) {
  return (
    <div className="min-w-0">
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-black/27">
        {label}
      </p>

      <p className="mt-1 break-words text-[10px] font-medium text-black/68">
        {value}
      </p>
    </div>
  );
}

function HistoryMoneyBox({
  label,
  value,
  alert = false,
}) {
  return (
    <div
      className={`min-w-0 rounded-[11px] border px-3 py-2.5 ${
        alert
          ? "border-red-100 bg-red-50/70"
          : "border-black/[0.04] bg-[#fafafa]"
      }`}
    >
      <p
        className={`text-[7px] font-semibold uppercase tracking-[0.08em] ${
          alert
            ? "text-red-600"
            : "text-black/30"
        }`}
      >
        {label}
      </p>

      <p
        className={`mt-1 truncate text-[12px] font-semibold ${
          alert
            ? "text-red-700"
            : "text-[#171717]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function HistoryMethodBox({
  label,
  value,
}) {
  return (
    <div className="min-w-0 rounded-[11px] border border-black/[0.04] bg-[#fafafa] px-3 py-2.5">
      <p className="truncate text-[8px] font-medium text-black/38">
        {label}
      </p>

      <p className="mt-1 truncate text-[11px] font-semibold">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function HistorySaleRow({ sale }) {
  return (
    <article className="flex items-center gap-3 bg-white px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-red-50 text-red-600">
        <Banknote size={12} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[9.5px] font-semibold">
            {sale.saleNumber || "Venta"}
          </p>

          <span className="text-[7.5px] text-black/28">
            {formatDateTime(sale.createdAt)}
          </span>
        </div>

        <p className="mt-0.5 truncate text-[8.5px] text-black/42">
          {sale.customerName ||
            sale.customerDocument ||
            "Venta sin cliente"}{" "}
          · {getSalePaymentSummary(sale)}
        </p>
      </div>

      <strong className="shrink-0 text-[10.5px] font-semibold">
        {formatCurrency(sale.total)}
      </strong>
    </article>
  );
}

function MovementTotalBox({
  label,
  value,
  tone,
}) {
  const classes =
    tone === "entry"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "exit"
        ? "bg-red-50 text-red-700"
        : "bg-[#f7f7f8] text-black/70";

  return (
    <div className={`rounded-[11px] px-3 py-2.5 ${classes}`}>
      <p className="text-[7px] font-semibold uppercase tracking-[0.08em] opacity-70">
        {label}
      </p>

      <p className="mt-1 truncate text-[11px] font-semibold">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function EmptyHistoryText({ children }) {
  return (
    <div className="flex min-h-[100px] items-center justify-center p-5 text-center text-[9px] text-black/36">
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[9px] text-black/35">
        {label}
      </span>

      <strong className="max-w-[64%] text-right text-[9px] font-medium text-black/65">
        {value}
      </strong>
    </div>
  );
}

function CloseCashModal({
  expectedCash,
  countedCash,
  setCountedCash,
  closing,
  onClose,
  onSubmit,
}) {
  const counted = parseMoney(countedCash);
  const difference =
    counted - Number(expectedCash || 0);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/[0.025]5 p-3 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-[500px] overflow-hidden rounded-[20px] border border-white/40 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]"
      >
        <div className="flex items-start justify-between border-b border-black/[0.055] px-5 py-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-red-600">
              Cierre del día
            </p>

            <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.04em]">
              Conteo final de efectivo
            </h2>

            <p className="mt-1 text-[9px] text-black/38">
              Compara el efectivo físico con lo esperado.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-black/[0.035] text-black/50 transition hover:bg-black/[0.07]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5">
          <div className="rounded-[14px] border border-red-100 bg-red-50/65 px-4 py-3.5 text-[#171717]">
            <p className="text-[8px] font-semibold uppercase tracking-[0.09em] text-red-600/75">
              Efectivo esperado
            </p>

            <p className="mt-1 text-[26px] font-semibold tracking-[-0.05em] text-[#171717]">
              {formatCurrency(expectedCash)}
            </p>
          </div>

          <label className="mt-4 block">
            <span className="text-[9px] font-medium text-black/45">
              Efectivo contado físicamente
            </span>

            <div className="relative mt-1.5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] text-black/25">
                $
              </span>

              <input
                value={countedCash}
                onChange={(event) =>
                  setCountedCash(
                    formatMoneyInput(event.target.value)
                  )
                }
                inputMode="numeric"
                className="h-[50px] w-full rounded-[13px] border border-black/[0.08] bg-[#fafafa] pl-9 pr-4 text-[16px] font-semibold outline-none transition focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-600/10"
                placeholder="0"
                autoFocus
              />
            </div>
          </label>

          <div
            className={`mt-3 rounded-[13px] px-4 py-3 ${
              difference === 0
                ? "bg-emerald-50"
                : "bg-amber-50"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p
                  className={`text-[8px] font-semibold uppercase tracking-[0.08em] ${
                    difference === 0
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}
                >
                  Diferencia
                </p>

                <p
                  className={`mt-1 text-[9px] ${
                    difference === 0
                      ? "text-emerald-700/70"
                      : "text-amber-800/70"
                  }`}
                >
                  {difference === 0
                    ? "El conteo coincide."
                    : "La diferencia quedará registrada."}
                </p>
              </div>

              <strong
                className={`text-[15px] ${
                  difference === 0
                    ? "text-emerald-700"
                    : "text-amber-800"
                }`}
              >
                {formatCurrency(difference)}
              </strong>
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-t border-black/[0.055] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-[10px] border border-black/[0.08] text-[10px] font-medium transition hover:bg-black/[0.025]"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={closing}
            className="h-10 flex-[1.4] rounded-[10px] bg-red-600 text-[10px] font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.14)] transition hover:bg-red-700 disabled:bg-black/15 disabled:shadow-none"
          >
            {closing
              ? "Cerrando..."
              : "Confirmar cierre"}
          </button>
        </div>
      </form>
    </div>
  );
}
