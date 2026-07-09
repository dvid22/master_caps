import { Navigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";

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
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-sm font-medium text-brand-black">
            Verificando acceso...
          </p>
          <p className="mt-1 text-xs text-gray-500">Master Caps</p>
        </section>
      </main>
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