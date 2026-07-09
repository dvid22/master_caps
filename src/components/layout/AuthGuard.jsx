import { Navigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";
import { motion as Motion, AnimatePresence } from "framer-motion";
export default function AuthGuard({ children }) {
  const {
    loading,
    isAuthenticated,
    hasProfile,
    isActive,
    belongsToStore,
    canAccessPanel,
  } = useAuth();

if (loading) {
  return (
    <AnimatePresence>
      <Motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-black via-[#1a0507] to-[#c1121f] px-4"
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#c1121f]/35 blur-3xl" />
        <div className="absolute -right-24 bottom-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

        <Motion.div
          animate={{
            rotateY: [0, 360],
            rotateX: [0, 8, 0, -8, 0],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{ transformStyle: "preserve-3d" }}
          className="relative z-10 mb-10 h-40 w-40"
        >
          <div className="absolute inset-0 backface-hidden">
            <div className="flex h-full w-full items-center justify-center rounded-[30px] border border-white/10 bg-gradient-to-br from-[#c1121f] via-[#7f0b14] to-black shadow-[0_28px_90px_rgba(193,18,31,0.35)]">
              <div className="flex h-28 w-28 items-center justify-center rounded-[24px] bg-white shadow-2xl">
                <img
                  src="/logo.png"
                  alt="Master Caps"
                  className="h-24 w-24 object-contain"
                />
              </div>
            </div>
          </div>

          <div
            className="absolute inset-0 backface-hidden"
            style={{ transform: "rotateY(180deg)" }}
          >
            <div className="flex h-full w-full items-center justify-center rounded-[30px] border border-white/10 bg-gradient-to-br from-black via-[#7f0b14] to-[#c1121f] shadow-[0_28px_90px_rgba(193,18,31,0.35)]">
              <div className="flex h-28 w-28 items-center justify-center rounded-[24px] bg-white shadow-2xl">
                <img
                  src="/logo.png"
                  alt="Master Caps"
                  className="h-24 w-24 object-contain"
                />
              </div>
            </div>
          </div>
        </Motion.div>

        <Motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="relative z-10 text-center"
        >
          <h1 className="text-[28px] font-medium tracking-[-0.045em] text-white">
            Master Caps
          </h1>

          <p className="mt-2 flex items-center justify-center gap-2 text-[13px] font-normal text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-[#c1121f]" />
            Verificando acceso
            <span className="h-1.5 w-1.5 rounded-full bg-[#c1121f]" />
          </p>
        </Motion.section>

        <div className="relative z-10 mt-8 h-1 w-72 overflow-hidden rounded-full bg-white/12">
          <Motion.div
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{
              duration: 1.7,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="h-full rounded-full bg-gradient-to-r from-[#c1121f] via-white to-[#c1121f]"
          />

          {[...Array(4)].map((_, index) => (
            <Motion.span
              key={index}
              initial={{ left: "0%" }}
              animate={{ left: "100%" }}
              transition={{
                duration: 1.7,
                repeat: Infinity,
                delay: index * 0.35,
                ease: "easeInOut",
              }}
              className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.75)]"
            />
          ))}
        </div>

        <Motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="absolute bottom-8 z-10 text-[11px] font-normal tracking-[0.24em] text-white/30"
        >
          SISTEMA DE INVENTARIO
        </Motion.p>
      </Motion.main>
    </AnimatePresence>
  );
}
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasProfile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <h1 className="text-2xl font-semibold text-brand-black">
            Usuario sin perfil
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Tu cuenta existe en Firebase Auth, pero no tiene perfil creado en la
            colección users. Crea el documento del usuario en Firestore.
          </p>
        </section>
      </main>
    );
  }

  if (!isActive) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <h1 className="text-2xl font-semibold text-brand-black">
            Usuario inactivo
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Tu acceso fue desactivado. Contacta al administrador de Master Caps.
          </p>
        </section>
      </main>
    );
  }

  if (!belongsToStore) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <h1 className="text-2xl font-semibold text-brand-black">
            Tienda no autorizada
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Tu usuario no pertenece a esta tienda.
          </p>
        </section>
      </main>
    );
  }

  if (!canAccessPanel) {
    return <Navigate to="/login" replace />;
  }

  return children;
}