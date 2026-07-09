import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ExternalLink,
  FileClock,
  LogOut,
  Menu,
  Package,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";

import { STORE_ID } from "../../services/categories.service";
import { logoutAdmin } from "../../services/auth.service";

const navItems = [
  {
    label: "Inventario",
    path: "/admin/inventario",
    icon: Package,
  },
  {
    label: "Ventas",
    path: "/admin/ventas",
    icon: ShoppingBag,
  },
  {
    label: "Apartados",
    path: "/admin/apartados",
    icon: FileClock,
  },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  function openCatalog() {
    const catalogUrl = `${window.location.origin}/catalogo/${STORE_ID}`;
    window.open(catalogUrl, "_blank", "noopener,noreferrer");

    navigator.clipboard
      ?.writeText(catalogUrl)
      .then(() => {
        console.log("Link del catálogo copiado:", catalogUrl);
      })
      .catch(() => {
        console.log("No se pudo copiar automáticamente:", catalogUrl);
      });
  }

  async function handleLogout() {
    const confirmLogout = window.confirm("¿Seguro que deseas cerrar sesión?");

    if (!confirmLogout) return;

    await logoutAdmin();
    navigate("/login", { replace: true });
  }

  return (
    <main className="min-h-screen bg-brand-cream lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="hidden border-r border-black/10 bg-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="border-b border-black/10 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-black text-white">
                <Store size={24} />
              </div>

              <div>
                <p className="text-lg font-semibold text-brand-black">
                  Master Caps
                </p>
                <p className="text-xs text-gray-500">
                  Panel administrador
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-2 p-4">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                      isActive
                        ? "bg-brand-black text-white"
                        : "text-brand-black hover:bg-brand-cream"
                    }`
                  }
                >
                  <Icon size={18} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="space-y-3 border-t border-black/10 p-4">
            <button
              type="button"
              onClick={openCatalog}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-brand-black hover:border-brand-black"
            >
              <ExternalLink size={17} />
              Ver catálogo
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-100"
            >
              <LogOut size={17} />
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-black/10 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-brand-black">
                Master Caps
              </p>
              <p className="text-xs text-gray-500">
                Panel administrador
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-2xl border border-black/10 p-3"
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        <Outlet />
      </section>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 lg:hidden">
          <aside className="h-full w-[86%] max-w-sm bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/10 p-5">
              <div>
                <p className="text-lg font-semibold text-brand-black">
                  Master Caps
                </p>
                <p className="text-xs text-gray-500">
                  Menú principal
                </p>
              </div>

              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-full p-2 hover:bg-gray-100"
              >
                <X size={22} />
              </button>
            </div>

            <nav className="space-y-2 p-4">
              {navItems.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                        isActive
                          ? "bg-brand-black text-white"
                          : "text-brand-black hover:bg-brand-cream"
                      }`
                    }
                  >
                    <Icon size={18} />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>

            <div className="space-y-3 border-t border-black/10 p-4">
              <button
                type="button"
                onClick={openCatalog}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-brand-black hover:border-brand-black"
              >
                <ExternalLink size={17} />
                Ver catálogo
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-100"
              >
                <LogOut size={17} />
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}