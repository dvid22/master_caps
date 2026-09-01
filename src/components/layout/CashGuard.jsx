import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

import { STORE_ID } from "../../services/categories.service";
import { getCurrentUserActor } from "../../services/auth.service";
import {
  getBogotaBusinessDate,
  recoverExpiredCashSessions,
  subscribeTodayCashSession,
} from "../../services/cash.service";

export default function CashGuard({ children }) {
  const actor = useMemo(() => getCurrentUserActor(), []);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
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

    let active = true;

    recoverExpiredCashSessions({
      storeId: STORE_ID,
      actor,
    }).catch((error) => {
      console.error("No se pudieron cerrar cajas vencidas:", error);
    });

    const unsubscribe = subscribeTodayCashSession({
      storeId: STORE_ID,
      actor,
      callback: (value) => {
        if (!active) return;
        setSession(value);
        setLoading(false);
      },
      onError: (error) => {
        console.error("No se pudo validar la caja actual:", error);
        if (!active) return;
        setLoading(false);
      },
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [actor, businessDateKey]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f8] px-4 text-black">
        <div className="rounded-[24px] bg-white px-7 py-6 text-center shadow-[0_18px_55px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.06]">
          <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-red-100 border-t-red-600" />
          <p className="mt-3 text-[12px] text-black/50">
            Validando la caja de hoy...
          </p>
        </div>
      </main>
    );
  }

  const hasOpenCash =
    Boolean(session) &&
    session.status === "open" &&
    session.businessDate === businessDateKey;

  if (!hasOpenCash) {
    return <Navigate to="/admin/caja" replace />;
  }

  return children;
}
