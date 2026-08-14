import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ExternalLink,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PackagePlus,
  TimerReset,
  PanelLeftClose,
  PanelLeftOpen,
  ShoppingBag,
  ReceiptText,
  Users,
  WalletCards,
  X,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { STORE_ID } from "../../services/categories.service";
import { logoutAdmin } from "../../services/auth.service";
import { subscribeReservations } from "../../services/reservations.service";

const navItems = [
  {
    label: "Dashboard",
    path: "/admin/dashboard",
    icon: LayoutDashboard,
    roles: ["admin"],
  },
  {
    label: "Inventario",
    path: "/admin/inventario",
    icon: Package,
    roles: ["admin", "seller"],
  },
  {
    label: "Ventas",
    path: "/admin/ventas",
    icon: ShoppingBag,
    roles: ["admin", "seller"],
  },
  {
    label: "Apartados",
    path: "/admin/apartados",
    icon: FileClock,
    roles: ["admin", "seller"],
  },
  {
    label: "Clientes",
    path: "/admin/clientes",
    icon: Users,
    roles: ["admin"],
  },
  {
    label: "Encargos",
    path: "/admin/encargos",
    icon: PackagePlus,
    roles: ["admin"],
  },
  {
    label: "Pagos Addi",
    path: "/admin/addi",
    icon: WalletCards,
    roles: ["admin"],
  },
  {
    label: "Usuarios y nómina",
    sellerLabel: "Mi jornada",
    path: "/admin/usuarios",
    icon: TimerReset,
    roles: ["admin", "seller"],
  },
  {
    label: "Gastos",
    path: "/admin/gastos",
    icon: ReceiptText,
    roles: ["admin"],
  },
];

function getNavigationLabel(item, role) {
  if (role === "seller" && item.sellerLabel) {
    return item.sellerLabel;
  }

  return item.label;
}

function getRoleLabel(role) {
  const labels = {
    admin: "Administrador",
    seller: "Vendedor",
  };

  return labels[role] || "Usuario";
}

function formatBadgeCount(count) {
  if (count > 99) return "99+";
  return String(count);
}

function ReservationsBadge({ count, isActive = false, compact = false }) {
  if (!count || count <= 0) return null;

  if (compact) {
    return (
      <span
        className={`absolute -right-1 -top-1 flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none shadow-sm ring-2 ${
          isActive
            ? "bg-white text-red-600 ring-red-600"
            : "bg-red-600 text-white ring-white"
        }`}
      >
        {formatBadgeCount(count)}
      </span>
    );
  }

  return (
    <span
      className={`ml-auto inline-flex h-6 min-w-6 animate-pulse items-center justify-center rounded-full px-2 text-[11px] font-semibold leading-none shadow-sm ${
        isActive ? "bg-white text-red-600" : "bg-red-600 text-white"
      }`}
    >
      {formatBadgeCount(count)}
    </span>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { profile, role } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [reservations, setReservations] = useState([]);

  const visibleNavItems = navItems.filter((item) => item.roles.includes(role));

  const unreadReservationsCount = reservations.filter((reservation) => {
    return (
      reservation.status === "active" && reservation.notificationRead !== true
    );
  }).length;

  useEffect(() => {
    const unsubscribeReservations = subscribeReservations(
      (reservationsData) => {
        setReservations(reservationsData);
      },
      (error) => {
        console.error("No se pudieron escuchar los apartados:", error);
      },
      STORE_ID
    );

    return () => {
      unsubscribeReservations();
    };
  }, []);

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

    setMobileOpen(false);
  }

  async function handleLogout() {
    const confirmLogout = window.confirm("¿Seguro que deseas cerrar sesión?");

    if (!confirmLogout) return;

    await logoutAdmin();

    setMobileOpen(false);
    navigate("/login", { replace: true });
  }

  return (
    <main
      className={`min-h-screen bg-[#f7f7f8] text-black transition-all duration-300 lg:grid ${
        sidebarCollapsed
          ? "lg:grid-cols-[74px_1fr]"
          : "lg:grid-cols-[218px_1fr]"
      }`}
    >
      <aside className="hidden border-r border-black/[0.06] bg-white/95 lg:block">
        <div className="sticky top-0 flex h-screen min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 px-3 pb-2.5 pt-3">
            <div
              className={`relative rounded-[20px] border border-black/[0.06] bg-white shadow-[0_12px_34px_rgba(0,0,0,0.035)] transition-all ${
                sidebarCollapsed ? "px-2.5 py-2.5" : "px-3 py-3"
              }`}
            >
              <button
                type="button"
                onClick={() => setSidebarCollapsed((current) => !current)}
                className="absolute -right-2.5 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-black/[0.08] bg-white text-black/55 shadow-sm transition hover:bg-red-50 hover:text-red-600"
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={15} />
                ) : (
                  <PanelLeftClose size={15} />
                )}
              </button>

              <div className="flex flex-col items-center">
                <img
                  src="/logo.png"
                  alt="Master Caps"
                  className={`object-contain transition-all ${
                    sidebarCollapsed ? "h-9 w-9" : "h-[58px] w-auto"
                  }`}
                />

                {!sidebarCollapsed && (
                  <div className="mt-2 inline-flex rounded-full border border-red-500/25 bg-red-50 px-3 py-1 text-[11px] font-normal text-red-600">
                    {getRoleLabel(role)}
                  </div>
                )}
              </div>
            </div>
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const navLabel = getNavigationLabel(item, role);
              const isReservationsItem = item.label === "Apartados";

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={sidebarCollapsed ? navLabel : undefined}
                  className={({ isActive }) =>
                    `group relative flex items-center rounded-xl text-[12.5px] font-normal transition-all ${
                      sidebarCollapsed
                        ? "h-9 justify-center px-0"
                        : "h-9 gap-2.5 px-2.5"
                    } ${
                      isActive
                        ? "bg-red-600 text-white shadow-lg shadow-red-600/15"
                        : "text-black/68 hover:bg-black/[0.035] hover:text-black"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition ${
                          isActive
                            ? "bg-white/15 text-white"
                            : "bg-white text-black/55 ring-1 ring-black/[0.06] group-hover:text-red-600"
                        }`}
                      >
                        <Icon size={15} strokeWidth={1.9} />
                      </span>

                      {sidebarCollapsed && isReservationsItem && (
                        <ReservationsBadge
                          count={unreadReservationsCount}
                          isActive={isActive}
                          compact
                        />
                      )}

                      {!sidebarCollapsed && (
                        <>
                          <span className="min-w-0 flex-1 truncate">
                            {navLabel}
                          </span>

                          {isReservationsItem && (
                            <ReservationsBadge
                              count={unreadReservationsCount}
                              isActive={isActive}
                            />
                          )}
                        </>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="shrink-0 space-y-1.5 border-t border-black/[0.06] bg-white px-3 py-3">
            <button
              type="button"
              onClick={openCatalog}
              title={sidebarCollapsed ? "Ver catálogo" : undefined}
              className={`flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] font-normal text-black/76 transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600 ${
                sidebarCollapsed ? "px-0" : ""
              }`}
            >
              <ExternalLink size={16} strokeWidth={1.9} />
              {!sidebarCollapsed && "Ver catálogo"}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              title={sidebarCollapsed ? "Cerrar sesión" : undefined}
              className={`flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-black/[0.035] px-3 text-[11px] font-normal text-black/66 transition hover:bg-red-50 hover:text-red-600 ${
                sidebarCollapsed ? "px-0" : ""
              }`}
            >
              <LogOut size={16} strokeWidth={1.9} />
              {!sidebarCollapsed && "Cerrar sesión"}
            </button>
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src="/logo.png"
                alt="Master Caps"
                className="h-10 w-10 rounded-xl object-contain"
              />

              <div className="min-w-0">
                <p className="truncate text-[14px] font-normal text-black">
                  Master Caps
                </p>

                <p className="truncate text-[12px] text-black/48">
                  {profile?.displayName || "Panel administrador"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-black/[0.08] bg-white text-black transition hover:bg-black/[0.035]"
            >
              <Menu size={19} />

              <ReservationsBadge
                count={unreadReservationsCount}
                compact
              />
            </button>
          </div>
        </header>

        <div className="min-h-screen">
          <Outlet />
        </div>
      </section>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm lg:hidden">
          <aside className="flex h-full min-h-0 w-[82%] max-w-[300px] flex-col overflow-hidden bg-white shadow-2xl">
            <div className="shrink-0 border-b border-black/[0.06] px-4 py-3.5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 flex-col items-center">
                  <img
                    src="/logo.png"
                    alt="Master Caps"
                    className="h-14 w-auto object-contain"
                  />

                  <div className="mt-2 inline-flex rounded-full border border-red-500/25 bg-red-50 px-3 py-1 text-[11px] font-normal text-red-600">
                    {getRoleLabel(role)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035] text-black transition hover:bg-red-50 hover:text-red-600"
                >
                  <X size={19} />
                </button>
              </div>
            </div>

            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const navLabel = getNavigationLabel(item, role);
                const isReservationsItem = item.label === "Apartados";

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `group flex h-10 items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-normal transition-all ${
                        isActive
                          ? "bg-red-600 text-white shadow-lg shadow-red-600/15"
                          : "text-black/68 hover:bg-black/[0.035] hover:text-black"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition ${
                            isActive
                              ? "bg-white/15 text-white"
                              : "bg-white text-black/55 ring-1 ring-black/[0.06] group-hover:text-red-600"
                          }`}
                        >
                          <Icon size={15} strokeWidth={1.9} />
                        </span>

                        <span className="min-w-0 flex-1 truncate">
                          {navLabel}
                        </span>

                        {isReservationsItem && (
                          <ReservationsBadge
                            count={unreadReservationsCount}
                            isActive={isActive}
                          />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </nav>

            <div className="shrink-0 space-y-1.5 border-t border-black/[0.06] bg-white px-3 py-3">
              <button
                type="button"
                onClick={openCatalog}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] font-normal text-black/76 transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
              >
                <ExternalLink size={16} />
                Ver catálogo
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-black/[0.035] px-3 text-[11px] font-normal text-black/66 transition hover:bg-red-50 hover:text-red-600"
              >
                <LogOut size={16} />
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}