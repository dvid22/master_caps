import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { subscribeAuth } from "../../services/auth.service";

export default function AuthGuard({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeAuth((currentUser) => {
      setUser(currentUser);
      setChecking(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-sm font-medium text-brand-black">
            Verificando acceso...
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Master Caps
          </p>
        </section>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}