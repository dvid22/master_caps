import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { BadgeCheck, ShoppingBag } from "lucide-react";

import { useAuth } from "../../context/AuthContext";

const MIN_SPLASH_TIME = 3900;

export default function AuthGuard({ children }) {
  const {
    loading,
    isAuthenticated,
    hasProfile,
    isActive,
    belongsToStore,
    canAccessPanel,
  } = useAuth();

  const [splashFinished, setSplashFinished] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSplashFinished(true);
    }, MIN_SPLASH_TIME);

    return () => window.clearTimeout(timer);
  }, []);

  if (loading || !splashFinished) {
    return <StoreSplashLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasProfile) {
    return (
      <GuardMessage
        title="Usuario sin perfil"
        description="Tu cuenta existe en Firebase Auth, pero no tiene perfil creado en la colección users. Crea el documento del usuario en Firestore."
      />
    );
  }

  if (!isActive) {
    return (
      <GuardMessage
        title="Usuario inactivo"
        description="Tu acceso fue desactivado. Contacta al administrador de Master Caps."
      />
    );
  }

  if (!belongsToStore) {
    return (
      <GuardMessage
        title="Tienda no autorizada"
        description="Tu usuario no pertenece a esta tienda."
      />
    );
  }

  if (!canAccessPanel) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function StoreSplashLoader() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-5">
      <style>
        {`
          @keyframes mcFadeIn {
            0% { opacity: 0; transform: translateY(12px) scale(.97); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
          }

          @keyframes mcRackLine {
            0% { transform: scaleX(0); opacity: 0; }
            18% { opacity: 1; }
            100% { transform: scaleX(1); opacity: 1; }
          }

          @keyframes mcGarmentIn {
            0% { opacity: 0; transform: translateY(-34px) scale(.82) rotate(-6deg); }
            38% { opacity: 1; transform: translateY(0) scale(1) rotate(0deg); }
            72% { transform: translateY(0) scale(1) rotate(0deg); }
            100% { transform: translateY(-4px) scale(1) rotate(0deg); }
          }

          @keyframes mcGarmentFloat {
            0%, 100% { transform: translateY(0) rotate(-1deg); }
            50% { transform: translateY(-5px) rotate(1deg); }
          }

          @keyframes mcShine {
            0% { transform: translateX(-140%) skewX(-18deg); opacity: 0; }
            25% { opacity: .9; }
            100% { transform: translateX(180%) skewX(-18deg); opacity: 0; }
          }

          @keyframes mcProgress {
            0% { width: 0%; }
            25% { width: 35%; }
            58% { width: 72%; }
            100% { width: 100%; }
          }

          @keyframes mcDot {
            0%, 100% { opacity: .35; transform: translateY(0) scale(.9); }
            50% { opacity: 1; transform: translateY(-3px) scale(1.08); }
          }
        `}
      </style>

      <div className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-50/80 blur-3xl" />
      <div className="absolute -right-32 top-10 h-80 w-80 rounded-full bg-black/[0.025] blur-3xl" />
      <div className="absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-red-100/60 blur-3xl" />

      <section className="relative w-full max-w-[500px] overflow-hidden rounded-[36px] bg-white px-7 py-9 text-center shadow-[0_28px_90px_rgba(0,0,0,0.09)] ring-1 ring-black/[0.06]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[36px]">
          <div
            className="absolute left-0 top-0 h-full w-24 bg-gradient-to-r from-transparent via-white/80 to-transparent"
            style={{ animation: "mcShine 3.2s ease-in-out 1.1s infinite" }}
          />
        </div>

        <img
          src="/logo.png"
          alt="Master Caps"
          className="mx-auto h-24 w-auto object-contain"
          style={{ animation: "mcFadeIn .65s ease-out both" }}
        />

        <div
          className="relative mx-auto mt-7 h-[190px] w-full max-w-[390px]"
          style={{ animation: "mcFadeIn .7s ease-out .08s both" }}
        >
          <div className="absolute left-[9%] right-[9%] top-8 h-[5px] origin-left rounded-full bg-black shadow-[0_10px_25px_rgba(0,0,0,0.18)]">
            <div
              className="h-full origin-left rounded-full bg-black"
              style={{ animation: "mcRackLine .9s ease-out both" }}
            />
          </div>

          <div className="absolute left-[13%] top-8 h-[122px] w-[4px] rounded-full bg-black/80" />
          <div className="absolute right-[13%] top-8 h-[122px] w-[4px] rounded-full bg-black/80" />

          <div className="absolute bottom-8 left-[10%] right-[10%] h-[10px] rounded-full bg-black/[0.08] blur-sm" />

          <RackGarment delay=".25s" left="18%" type="shirt" color="black" />
          <RackGarment delay=".55s" left="36%" type="hoodie" color="beige" />
          <RackGarment delay=".85s" left="54%" type="pants" color="dark" />
          <RackGarment delay="1.15s" left="72%" type="cap" color="red" />
        </div>

        <div
          className="mx-auto mt-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-4 py-2 text-red-600"
          style={{ animation: "mcFadeIn .7s ease-out .18s both" }}
        >
          <BadgeCheck size={17} />
          <span className="text-[12px] font-medium">Acceso verificado</span>
        </div>

        <h1
          className="mt-4 text-[26px] font-medium tracking-[-0.05em] text-black"
          style={{ animation: "mcFadeIn .7s ease-out .24s both" }}
        >
          Preparando tu tienda
        </h1>

        <p
          className="mt-2 text-[13px] leading-6 text-black/50"
          style={{ animation: "mcFadeIn .7s ease-out .3s both" }}
        >
          Organizando inventario, ventas y apartados en tiempo real.
        </p>

        <div className="mx-auto mt-7 h-2 w-full overflow-hidden rounded-full bg-black/[0.045]">
          <div
            className="h-full rounded-full bg-red-600 shadow-[0_8px_20px_rgba(220,38,38,0.28)]"
            style={{ animation: "mcProgress 3.2s ease-in-out infinite" }}
          />
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <span
            className="h-2 w-2 rounded-full bg-red-600"
            style={{ animation: "mcDot 1s ease-in-out infinite" }}
          />
          <span
            className="h-2 w-2 rounded-full bg-red-600"
            style={{ animation: "mcDot 1s ease-in-out .18s infinite" }}
          />
          <span
            className="h-2 w-2 rounded-full bg-red-600"
            style={{ animation: "mcDot 1s ease-in-out .36s infinite" }}
          />
        </div>
      </section>
    </main>
  );
}

function RackGarment({ delay, left, type, color }) {
  return (
    <div
      className="absolute top-8"
      style={{
        left,
        animation: `mcGarmentIn .9s ease-out ${delay} both, mcGarmentFloat 2.4s ease-in-out calc(${delay} + .9s) infinite`,
      }}
    >
      <div className="mx-auto h-7 w-px bg-black/35" />
      <div className="mx-auto h-3 w-6 rounded-t-full border-l border-r border-t border-black/30" />

      {type === "shirt" && <ShirtShape color={color} />}
      {type === "hoodie" && <HoodieShape color={color} />}
      {type === "pants" && <PantsShape color={color} />}
      {type === "cap" && <CapShape />}
    </div>
  );
}

function ShirtShape({ color }) {
  return (
    <div
      className={`relative h-20 w-16 rounded-b-[16px] ${
        color === "black" ? "bg-black" : "bg-red-600"
      } shadow-[0_16px_35px_rgba(0,0,0,0.16)]`}
    >
      <div className="absolute -left-5 top-3 h-8 w-7 rotate-[22deg] rounded-xl bg-inherit" />
      <div className="absolute -right-5 top-3 h-8 w-7 -rotate-[22deg] rounded-xl bg-inherit" />
      <div className="absolute left-1/2 top-0 h-5 w-7 -translate-x-1/2 rounded-b-full bg-white" />
      <div className="absolute inset-x-4 top-8 h-px bg-white/15" />
    </div>
  );
}

function HoodieShape({ color }) {
  return (
    <div
      className={`relative h-[86px] w-[70px] rounded-b-[18px] rounded-t-[22px] ${
        color === "beige" ? "bg-[#d8c8b5]" : "bg-black"
      } shadow-[0_16px_35px_rgba(0,0,0,0.14)]`}
    >
      <div className="absolute left-1/2 top-[-8px] h-8 w-11 -translate-x-1/2 rounded-t-full bg-inherit" />
      <div className="absolute -left-4 top-8 h-9 w-6 rounded-xl bg-inherit" />
      <div className="absolute -right-4 top-8 h-9 w-6 rounded-xl bg-inherit" />
      <div className="absolute left-1/2 top-34 h-7 w-9 -translate-x-1/2 rounded-xl border border-black/10 bg-white/10" />
    </div>
  );
}

function PantsShape({ color }) {
  return (
    <div
      className={`relative h-[88px] w-[62px] ${
        color === "dark" ? "bg-[#1f2937]" : "bg-black"
      } shadow-[0_16px_35px_rgba(0,0,0,0.15)]`}
    >
      <div className="absolute left-0 top-0 h-5 w-full rounded-t-xl bg-black/20" />
      <div className="absolute bottom-0 left-0 h-[74px] w-[29px] rounded-b-xl bg-inherit" />
      <div className="absolute bottom-0 right-0 h-[74px] w-[29px] rounded-b-xl bg-inherit" />
      <div className="absolute bottom-0 left-1/2 h-[72px] w-[4px] -translate-x-1/2 bg-white" />
    </div>
  );
}

function CapShape() {
  return (
    <div className="relative mt-8 h-12 w-20">
      <div className="absolute left-3 top-0 h-10 w-12 rounded-t-full rounded-bl-2xl bg-red-600 shadow-[0_16px_35px_rgba(220,38,38,0.18)]" />
      <div className="absolute bottom-1 right-0 h-4 w-12 rounded-full bg-black" />
      <div className="absolute left-7 top-3 h-3 w-3 rounded-full border border-white/50" />
    </div>
  );
}

function GuardMessage({ title, description }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <section className="w-full max-w-md rounded-[30px] bg-white p-8 text-center shadow-[0_18px_55px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06]">
        <img
          src="/logo.png"
          alt="Master Caps"
          className="mx-auto h-20 w-auto object-contain"
        />

        <h1 className="mt-5 text-[24px] font-medium tracking-[-0.04em] text-black">
          {title}
        </h1>

        <p className="mt-2 text-[14px] leading-6 text-black/50">
          {description}
        </p>
      </section>
    </main>
  );
}