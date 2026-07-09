import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Shirt,
  Tag,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { loginAdmin } from "../../services/auth.service";

export default function LoginPage() {
  const navigate = useNavigate();

  const { loading, isAuthenticated, canAccessPanel } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [logging, setLogging] = useState(false);

  const [slideIndex, setSlideIndex] = useState(0);

  const slides = [
    {
      badge: "Tienda de ropa",
      title: "Tu estilo,\nnuestra pasión",
      description:
        "Descubre prendas y accesorios para cada ocasión. Calidad, diseño y confort en un solo lugar.",
    },
    {
      badge: "Moda exclusiva",
      title: "Viste diferente,\ncompra mejor",
      description:
        "Colecciones modernas, productos seleccionados y una experiencia premium para tus clientes.",
    },
    {
      badge: "Master Caps",
      title: "Calidad,\nestilo y confianza",
      description:
        "Administra productos, ventas e inventario desde un panel rápido, seguro y profesional.",
    },
  ];

  const currentSlide = slides[slideIndex];

  useEffect(() => {
    const interval = setInterval(() => {
      setSlideIndex((current) =>
        current === slides.length - 1 ? 0 : current + 1
      );
    }, 4500);

    return () => clearInterval(interval);
  }, [slides.length]);

  function previousSlide() {
    setSlideIndex((current) =>
      current === 0 ? slides.length - 1 : current - 1
    );
  }

  function nextSlide() {
    setSlideIndex((current) =>
      current === slides.length - 1 ? 0 : current + 1
    );
  }

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
      <main className="flex h-screen items-center justify-center bg-white px-4">
        <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-sm font-normal text-black">Verificando sesión...</p>
        </section>
      </main>
    );
  }

  if (isAuthenticated && canAccessPanel) {
    return <Navigate to="/admin/inventario" replace />;
  }

  return (
    <main className="h-screen overflow-hidden bg-white font-sans">
      <section className="grid h-screen grid-cols-1 overflow-hidden lg:grid-cols-[1.68fr_0.72fr] xl:grid-cols-[1.72fr_0.68fr]">
        <aside className="relative hidden h-screen overflow-hidden bg-white lg:block">
          <img
            src="/fondo.png"
            alt="Master Caps tienda de ropa"
            className="absolute inset-0 h-full w-full object-contain object-center"
          />

          <div className="absolute inset-0 bg-gradient-to-r from-white/98 via-white/72 to-white/0" />
          <div className="absolute inset-0 bg-gradient-to-t from-white/84 via-transparent to-white/30" />

          <div className="relative z-10 flex h-full flex-col justify-between px-8 py-6 xl:px-10 xl:py-7 2xl:px-12">
            <img
              src="/logo.png"
              alt="Master Caps"
              className="h-14 w-auto object-contain xl:h-16"
            />

            <div className="max-w-[490px] transition-all duration-500">
              <span className="inline-flex rounded-full border border-red-500/30 bg-white/75 px-5 py-1.5 text-[12px] font-medium text-red-600 shadow-sm backdrop-blur">
                {currentSlide.badge}
              </span>

              <h1 className="mt-5 whitespace-pre-line text-[38px] font-medium leading-[1.04] tracking-[-0.045em] text-black xl:text-[44px] 2xl:text-[50px]">
                {currentSlide.title}
              </h1>

              <p className="mt-4 max-w-[470px] text-[14px] font-normal leading-6 text-black/72 xl:text-[15px]">
                {currentSlide.description}
              </p>

              <div className="mt-6 space-y-3.5 xl:mt-7 xl:space-y-4">
                <Feature
                  icon={<Shirt size={17} />}
                  title="Moda exclusiva"
                  text="Colecciones únicas y modernas"
                />
                <Feature
                  icon={<Tag size={17} />}
                  title="Mejores precios"
                  text="Calidad premium al mejor precio"
                />
                <Feature
                  icon={<ShieldCheck size={17} />}
                  title="Compra segura"
                  text="Tus datos y compras siempre protegidos"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={previousSlide}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-red-500/35 bg-white/80 text-black shadow-sm transition hover:bg-red-600 hover:text-white"
              >
                <ChevronLeft size={21} />
              </button>

              <div className="flex items-center gap-2">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSlideIndex(index)}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      slideIndex === index
                        ? "w-9 bg-red-600"
                        : "w-2 bg-black/20"
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={nextSlide}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-red-500/35 bg-white/80 text-black shadow-sm transition hover:bg-red-600 hover:text-white"
              >
                <ChevronRight size={21} />
              </button>
            </div>
          </div>
        </aside>

        <section className="relative flex h-screen items-center justify-center overflow-hidden bg-white px-4 py-4">
          <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-red-100/35 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-black/[0.03] blur-3xl" />

          <div className="relative w-full max-w-[345px] xl:max-w-[365px]">
            <form
              onSubmit={handleSubmit}
              className="rounded-[26px] bg-white px-6 py-6 shadow-[0_24px_70px_rgba(0,0,0,0.09)] ring-1 ring-black/5 xl:px-7"
            >
              <div className="flex justify-center">
                <img
                  src="/logo.png"
                  alt="Master Caps"
                  className="h-12 w-auto object-contain xl:h-14"
                />
              </div>

              <div className="mt-4 text-center">
                <h1 className="text-[25px] font-medium tracking-[-0.04em] text-black xl:text-[28px]">
                  <span className="text-red-600">Bienvenido</span> de nuevo
                </h1>

                <p className="mt-1 text-[12px] font-normal text-black/55 xl:text-[13px]">
                  Inicia sesión para continuar comprando
                </p>
              </div>

              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-[12px] font-medium text-black/65">
                    Correo electrónico
                  </span>

                  <div className="relative mt-2">
                    <Mail
                      size={16}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
                    />

                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-11 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-4 text-[13px] font-normal text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                      placeholder="Ingresa tu correo"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="text-[12px] font-medium text-black/65">
                    Contraseña
                  </span>

                  <div className="relative mt-2">
                    <Lock
                      size={16}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
                    />

                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-11 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-12 text-[13px] font-normal text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                      placeholder="Ingresa tu contraseña"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2 text-black/40 transition hover:bg-black/5 hover:text-black"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              </div>

              <div className="mt-4 flex items-center text-[13px]">
                <label className="flex cursor-pointer items-center gap-2 font-normal text-black/65">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-black/20 text-red-600 focus:ring-red-600"
                  />
                  Recordarme
                </label>
              </div>

              <button
                type="submit"
                disabled={logging}
                className="mt-5 flex h-11 w-full items-center justify-center gap-3 rounded-2xl bg-red-600 px-5 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {logging ? "Entrando..." : "Iniciar sesión"}
                {!logging && <ArrowRight size={17} />}
              </button>
            </form>

            <p className="mt-4 text-center text-[11px] font-normal text-black/35">
              © 2024 Master Caps. Todos los derechos reservados.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}

function Feature({ icon, title, text }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-white/80 text-red-600 shadow-sm">
        {icon}
      </div>

      <div>
        <h3 className="text-[13px] font-medium text-black">{title}</h3>
        <p className="text-[13px] font-normal text-black/62">{text}</p>
      </div>
    </div>
  );
}