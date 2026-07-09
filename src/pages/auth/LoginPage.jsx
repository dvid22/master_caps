import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail, Store } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { loginAdmin } from "../../services/auth.service";

export default function LoginPage() {
  const navigate = useNavigate();

  const { loading, isAuthenticated, canAccessPanel } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [logging, setLogging] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setLogging(true);

      await loginAdmin(email, password);

      navigate("/admin/inventario", { replace: true });
    } catch (error) {
      console.error(error);

      if (error.code === "auth/invalid-credential") {
        alert("Correo o contraseña incorrectos.");
      } else if (error.code === "auth/user-not-found") {
        alert("No existe un usuario con ese correo.");
      } else if (error.code === "auth/wrong-password") {
        alert("La contraseña es incorrecta.");
      } else {
        alert(error.message || "No se pudo iniciar sesión.");
      }
    } finally {
      setLogging(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-cream px-4">
        <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-sm font-medium text-brand-black">
            Verificando sesión...
          </p>
        </section>
      </main>
    );
  }

  if (isAuthenticated && canAccessPanel) {
    return <Navigate to="/admin/inventario" replace />;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-cream px-4 py-8">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-gold/20 blur-3xl" />
      <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-black/10 blur-3xl" />

      <section className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl ring-1 ring-black/5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-black text-white">
          <Store size={30} />
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm font-medium text-brand-gold">Master Caps</p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-black">
            Iniciar sesión
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            Accede al panel administrativo para gestionar inventario, ventas y
            apartados.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-brand-black">
              Correo electrónico
            </span>

            <div className="relative mt-2">
              <Mail
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              />

              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 w-full rounded-2xl border border-black/10 pl-11 pr-4 text-sm outline-none focus:border-brand-black"
                placeholder="admin@mastercaps.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-brand-black">
              Contraseña
            </span>

            <div className="relative mt-2">
              <Lock
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              />

              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 w-full rounded-2xl border border-black/10 pl-11 pr-12 text-sm outline-none focus:border-brand-black"
                placeholder="Tu contraseña"
              />

              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-brand-black"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={logging}
            className="w-full rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logging ? "Entrando..." : "Entrar al panel"}
          </button>
        </form>
      </section>
    </main>
  );
}