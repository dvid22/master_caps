import { Navigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";

export default function RoleGuard({ allowedRoles = [], children }) {
  const { loading, role } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-sm font-medium text-brand-black">
            Verificando permisos...
          </p>
        </section>
      </main>
    );
  }

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/admin/inventario" replace />;
  }

  return children;
}