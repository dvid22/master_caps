import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { STORE_ID } from "../../services/categories.service";
import { subscribeSales } from "../../services/sales.service";
import {
  buildCustomerSalesMetrics,
  createCustomer,
  subscribeCustomers,
  updateCustomer,
} from "../../services/customers.service";
import { getCurrentUserActor } from "../../services/auth.service";
import { formatCurrency } from "../../utils/money";

const PAGE_SIZE = 8;

const emptyCustomerForm = {
  documentNumber: "",
  fullName: "",
  phone: "",
  notes: "",
  isActive: true,
};

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "CL";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function getDateValue(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function formatDate(value) {
  const date = getDateValue(value);

  if (!date) {
    return "Sin compras";
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDocument(value) {
  const clean = String(value || "").replace(/\D/g, "");

  if (!clean) {
    return "Sin cédula";
  }

  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function getCustomerLevel(customer) {
  const purchases = Number(customer.purchases || 0);
  const totalSpent = Number(customer.totalSpent || 0);

  if (
    totalSpent >= 2_000_000 ||
    purchases >= 10
  ) {
    return {
      id: "vip",
      label: "VIP",
      className:
        "border-red-200 bg-red-50 text-red-600",
    };
  }

  if (
    totalSpent >= 800_000 ||
    purchases >= 4
  ) {
    return {
      id: "frequent",
      label: "Frecuente",
      className:
        "border-orange-200 bg-orange-50 text-orange-600",
    };
  }

  return {
    id: "new",
    label: "Nuevo",
    className:
      "border-black/[0.08] bg-black/[0.035] text-black/55",
  };
}

function getRelativeCustomerFilter(customer, filter) {
  if (filter === "all") {
    return true;
  }

  return getCustomerLevel(customer).id === filter;
}

function compareCustomersByRanking(a, b) {
  const productsDiff =
    Number(b.totalProducts || 0) -
    Number(a.totalProducts || 0);

  if (productsDiff !== 0) {
    return productsDiff;
  }

  const purchasesDiff =
    Number(b.purchases || 0) -
    Number(a.purchases || 0);

  if (purchasesDiff !== 0) {
    return purchasesDiff;
  }

  const spentDiff =
    Number(b.totalSpent || 0) -
    Number(a.totalSpent || 0);

  if (spentDiff !== 0) {
    return spentDiff;
  }

  return String(a.fullName || "").localeCompare(
    String(b.fullName || ""),
    "es-CO"
  );
}

export default function ClientsPage() {
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);

  useEffect(() => {
    let loadedCustomers = false;
    let loadedSales = false;

    function updateLoading() {
      if (loadedCustomers && loadedSales) {
        setLoading(false);
      }
    }

    const unsubscribeCustomers = subscribeCustomers(
      (customersData) => {
        loadedCustomers = true;
        setCustomers(customersData);
        updateLoading();
      },
      (error) => {
        console.error(error);
        loadedCustomers = true;
        updateLoading();
        alert("No se pudieron cargar los clientes.");
      },
      STORE_ID
    );

    const unsubscribeSales = subscribeSales(
      (salesData) => {
        loadedSales = true;
        setSales(salesData);
        updateLoading();
      },
      (error) => {
        console.error(error);
        loadedSales = true;
        updateLoading();
        alert("No se pudieron cargar las ventas.");
      },
      STORE_ID
    );

    return () => {
      unsubscribeCustomers();
      unsubscribeSales();
    };
  }, []);

  const customerMetrics = useMemo(
    () =>
      buildCustomerSalesMetrics(
        customers,
        sales
      ),
    [customers, sales]
  );

  const rankedCustomers = useMemo(
    () =>
      [...customerMetrics].sort(
        compareCustomersByRanking
      ),
    [customerMetrics]
  );

  const rankingByCustomerId = useMemo(
    () =>
      new Map(
        rankedCustomers.map((customer, index) => [
          customer.id,
          index + 1,
        ])
      ),
    [rankedCustomers]
  );

  const stats = useMemo(() => {
    const totalCustomers = customerMetrics.length;

    const frequentCustomers = customerMetrics.filter(
      (customer) => {
        const level = getCustomerLevel(customer).id;

        return (
          level === "vip" ||
          level === "frequent"
        );
      }
    ).length;

    const bestCustomer = rankedCustomers[0] || null;

    const accumulatedSales = customerMetrics.reduce(
      (total, customer) =>
        total + Number(customer.totalSpent || 0),
      0
    );

    const accumulatedProducts = customerMetrics.reduce(
      (total, customer) =>
        total + Number(customer.totalProducts || 0),
      0
    );

    return {
      totalCustomers,
      frequentCustomers,
      bestCustomer,
      accumulatedSales,
      accumulatedProducts,
    };
  }, [customerMetrics, rankedCustomers]);

  const filteredCustomers = useMemo(() => {
    const cleanSearch = normalizeText(search);

    return customerMetrics
      .filter((customer) => {
        const haystack = normalizeText(
          [
            customer.fullName,
            customer.documentNumber,
            customer.phone,
          ].join(" ")
        );

        const matchesSearch =
          !cleanSearch ||
          haystack.includes(cleanSearch);

        const matchesLevel =
          getRelativeCustomerFilter(
            customer,
            levelFilter
          );

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" &&
            customer.isActive !== false) ||
          (statusFilter === "inactive" &&
            customer.isActive === false);

        return (
          matchesSearch &&
          matchesLevel &&
          matchesStatus
        );
      })
      .sort(compareCustomersByRanking);
  }, [
    customerMetrics,
    search,
    levelFilter,
    statusFilter,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    levelFilter,
    statusFilter,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredCustomers.length /
        PAGE_SIZE
    )
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedCustomers = useMemo(() => {
    const start =
      (page - 1) *
      PAGE_SIZE;

    return filteredCustomers.slice(
      start,
      start + PAGE_SIZE
    );
  }, [
    filteredCustomers,
    page,
  ]);

  function openNewCustomer() {
    setEditingCustomer(null);
    setCustomerForm(emptyCustomerForm);
    setFormOpen(true);
  }

  function openEditCustomer(customer) {
    setEditingCustomer(customer);

    setCustomerForm({
      documentNumber:
        customer.documentNumber || "",
      fullName:
        customer.fullName || "",
      phone:
        customer.phone || "",
      notes:
        customer.notes || "",
      isActive:
        customer.isActive !== false,
    });

    setFormOpen(true);
  }

  function updateCustomerForm(field, value) {
    setCustomerForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSaveCustomer(event) {
    event.preventDefault();

    if (
      !String(
        customerForm.documentNumber || ""
      ).trim()
    ) {
      alert("La cédula es obligatoria.");
      return;
    }

    if (
      !String(
        customerForm.fullName || ""
      ).trim()
    ) {
      alert(
        "El nombre del cliente es obligatorio."
      );
      return;
    }

    try {
      setSaving(true);

      const actor = getCurrentUserActor();

      if (editingCustomer) {
        await updateCustomer(
          editingCustomer.id,
          {
            fullName:
              customerForm.fullName,
            phone:
              customerForm.phone,
            notes:
              customerForm.notes,
            isActive:
              customerForm.isActive,
          },
          actor
        );
      } else {
        await createCustomer({
          documentNumber:
            customerForm.documentNumber,
          fullName:
            customerForm.fullName,
          phone:
            customerForm.phone,
          notes:
            customerForm.notes,
          isActive:
            customerForm.isActive,
          storeId: STORE_ID,
          actor,
        });
      }

      setFormOpen(false);
      setEditingCustomer(null);
      setCustomerForm(emptyCustomerForm);
    } catch (error) {
      console.error(error);

      alert(
        error?.message ||
          "No se pudo guardar el cliente."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 text-black sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1680px]">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-red-600">
              Gestión comercial
            </p>

            <h1 className="mt-1 text-[30px] font-medium tracking-[-0.045em] sm:text-[34px]">
              Clientes
            </h1>

            <p className="mt-1 text-[13px] text-black/48">
              Fidelización, historial y volumen real de compra de tus clientes
            </p>
          </div>

          <button
            type="button"
            onClick={openNewCustomer}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
          >
            <Plus size={17} />
            Nuevo cliente
          </button>
        </header>

        <section className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Users}
            label="Clientes registrados"
            value={stats.totalCustomers}
            helper="Base total de clientes"
          />

          <StatCard
            icon={Star}
            label="Clientes frecuentes"
            value={stats.frequentCustomers}
            helper="Frecuentes y VIP"
          />

          <StatCard
            icon={Sparkles}
            label="Mayor comprador"
            value={
              stats.bestCustomer?.fullName ||
              "Sin datos"
            }
            helper={
              stats.bestCustomer
                ? `${Number(
                    stats.bestCustomer.totalProducts || 0
                  ).toLocaleString(
                    "es-CO"
                  )} producto(s) · ${formatCurrency(
                    stats.bestCustomer.totalSpent || 0
                  )}`
                : "Sin compras"
            }
            compactValue
          />

          <StatCard
            icon={ShieldCheck}
            label="Ventas acumuladas"
            value={formatCurrency(
              stats.accumulatedSales
            )}
            helper={`${Number(
              stats.accumulatedProducts || 0
            ).toLocaleString(
              "es-CO"
            )} producto(s) comprados`}
            compactValue
          />
        </section>

        <section className="mt-4">
          <div className="min-w-0 overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-[0_18px_55px_rgba(0,0,0,0.045)]">
            <div className="border-b border-black/[0.06] p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-medium text-black/70">
                    Ranking de clientes
                  </p>
                  <p className="mt-0.5 text-[10px] text-black/38">
                    Prioridad: productos comprados → compras realizadas → dinero gastado.
                  </p>
                </div>

                <span className="rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-[9px] font-medium text-red-600">
                  Más productos = mejor posición
                </span>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
                <label className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
                  />

                  <input
                    value={search}
                    onChange={(event) =>
                      setSearch(
                        event.target.value
                      )
                    }
                    placeholder="Buscar por nombre, cédula o teléfono..."
                    className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[12px] outline-none transition placeholder:text-black/32 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  />
                </label>

                <label className="relative">
                  <Filter
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35"
                  />

                  <select
                    value={levelFilter}
                    onChange={(event) =>
                      setLevelFilter(
                        event.target.value
                      )
                    }
                    className="h-11 w-full appearance-none rounded-2xl border border-black/[0.08] bg-white pl-9 pr-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  >
                    <option value="all">
                      Todos los niveles
                    </option>
                    <option value="vip">
                      VIP
                    </option>
                    <option value="frequent">
                      Frecuentes
                    </option>
                    <option value="new">
                      Nuevos
                    </option>
                  </select>
                </label>

                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value
                    )
                  }
                  className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                >
                  <option value="all">
                    Todos los estados
                  </option>
                  <option value="active">
                    Activos
                  </option>
                  <option value="inactive">
                    Inactivos
                  </option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06] bg-black/[0.015] text-left">
                    <TableHead>
                      Rank
                    </TableHead>
                    <TableHead>
                      Cliente
                    </TableHead>
                    <TableHead>
                      Cédula
                    </TableHead>
                    <TableHead>
                      Teléfono
                    </TableHead>
                    <TableHead>
                      Última compra
                    </TableHead>
                    <TableHead>
                      Productos
                    </TableHead>
                    <TableHead>
                      Compras
                    </TableHead>
                    <TableHead>
                      Total gastado
                    </TableHead>
                    <TableHead>
                      Nivel
                    </TableHead>
                    <TableHead align="right">
                      Acciones
                    </TableHead>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-5 py-12 text-center text-[12px] text-black/40"
                      >
                        Cargando clientes y ventas...
                      </td>
                    </tr>
                  ) : paginatedCustomers.length ===
                    0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-5 py-12 text-center"
                      >
                        <UserRound
                          size={32}
                          className="mx-auto text-black/20"
                        />

                        <p className="mt-3 text-[14px] font-medium">
                          No encontramos clientes
                        </p>

                        <p className="mt-1 text-[11px] text-black/40">
                          Ajusta los filtros o crea el primer cliente.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    paginatedCustomers.map(
                      (customer) => (
                        <CustomerRow
                          key={customer.id}
                          customer={customer}
                          rankingPosition={
                            rankingByCustomerId.get(
                              customer.id
                            ) || 0
                          }
                          onEdit={() =>
                            openEditCustomer(
                              customer
                            )
                          }
                        />
                      )
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-black/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-[11px] text-black/42">
                Mostrando{" "}
                {filteredCustomers.length === 0
                  ? 0
                  : (page - 1) *
                      PAGE_SIZE +
                    1}
                -
                {Math.min(
                  page *
                    PAGE_SIZE,
                  filteredCustomers.length
                )}{" "}
                de{" "}
                {filteredCustomers.length}{" "}
                cliente(s)
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() =>
                    setPage(
                      (current) =>
                        Math.max(
                          current - 1,
                          1
                        )
                    )
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] disabled:opacity-30"
                >
                  <ChevronLeft
                    size={15}
                  />
                </button>

                <span className="min-w-[76px] text-center text-[11px] text-black/55">
                  {page} / {totalPages}
                </span>

                <button
                  type="button"
                  disabled={
                    page >= totalPages
                  }
                  onClick={() =>
                    setPage(
                      (current) =>
                        Math.min(
                          current + 1,
                          totalPages
                        )
                    )
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] disabled:opacity-30"
                >
                  <ChevronRight
                    size={15}
                  />
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>

      {formOpen && (
        <CustomerFormModal
          editingCustomer={
            editingCustomer
          }
          form={customerForm}
          saving={saving}
          onChange={updateCustomerForm}
          onClose={() => {
            if (saving) {
              return;
            }

            setFormOpen(false);
            setEditingCustomer(null);
          }}
          onSubmit={
            handleSaveCustomer
          }
        />
      )}
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  compactValue = false,
}) {
  return (
    <article className="rounded-[19px] border border-black/[0.055] bg-white px-3.5 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.028)]">
      <div className="flex min-h-[78px] items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[8px] font-medium uppercase tracking-[0.11em] text-black/38">
            {label}
          </p>

          <p
            className={`mt-1.5 truncate font-medium leading-none tracking-[-0.04em] ${
              compactValue
                ? "text-[16px]"
                : "text-[22px]"
            }`}
          >
            {value}
          </p>

          <p className="mt-1.5 truncate text-[8.5px] leading-none text-black/38">
            {helper}
          </p>
        </div>

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon
            size={15}
            strokeWidth={1.8}
          />
        </div>
      </div>
    </article>
  );
}

function TableHead({
  children,
  align = "left",
}) {
  return (
    <th
      className={`px-4 py-3 text-[9px] font-medium uppercase tracking-[0.12em] text-black/38 ${
        align === "right"
          ? "text-right"
          : ""
      }`}
    >
      {children}
    </th>
  );
}

function CustomerRow({
  customer,
  rankingPosition,
  onEdit,
}) {
  const level =
    getCustomerLevel(customer);

  return (
    <tr className="border-b border-black/[0.055] transition last:border-0 hover:bg-black/[0.012]">
      <td className="px-4 py-3">
        <span
          className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[10px] font-semibold ${
            rankingPosition > 0 &&
            rankingPosition <= 3
              ? "bg-red-50 text-red-600 ring-1 ring-red-100"
              : "bg-black/[0.035] text-black/45"
          }`}
        >
          #{rankingPosition || "-"}
        </span>
      </td>

      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 text-left">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-[10px] font-medium text-white">
            {getInitials(
              customer.fullName
            )}
          </div>

          <div className="min-w-0">
            <p className="max-w-[180px] truncate text-[11px] font-medium">
              {customer.fullName}
            </p>

            <p className="mt-0.5 max-w-[180px] truncate text-[9px] text-black/38">
              {customer.isActive === false
                ? "Cliente inactivo"
                : "Cliente activo"}
            </p>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 text-[10px] text-black/62">
        {formatDocument(
          customer.documentNumber
        )}
      </td>

      <td className="px-4 py-3 text-[10px] text-black/62">
        {customer.phone ||
          "Sin teléfono"}
      </td>

      <td className="px-4 py-3 text-[10px] text-black/55">
        {formatDate(
          customer.lastPurchaseAt
        )}
      </td>

      <td className="px-4 py-3">
        <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">
          {Number(
            customer.totalProducts || 0
          ).toLocaleString(
            "es-CO"
          )}
        </span>
      </td>

      <td className="px-4 py-3 text-[10px] font-medium">
        {customer.purchases || 0}
      </td>

      <td className="px-4 py-3 text-[11px] font-medium">
        {formatCurrency(
          customer.totalSpent || 0
        )}
      </td>

      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-medium ${level.className}`}
        >
          {level.label}
        </span>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50"
            aria-label="Editar cliente"
          >
            <Pencil size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function CustomerFormModal({
  editingCustomer,
  form,
  saving,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-3.5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-red-600">
              Clientes
            </p>

            <h2 className="mt-1 text-[21px] font-medium tracking-[-0.035em]">
              {editingCustomer
                ? "Editar cliente"
                : "Nuevo cliente"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035] disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <form
          onSubmit={onSubmit}
          className="p-5"
        >
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-[0.9fr_1.1fr]">
              <Field
                label="Cédula *"
                value={
                  form.documentNumber
                }
                onChange={(value) =>
                  onChange(
                    "documentNumber",
                    value
                  )
                }
                placeholder="Ej: 1070000000"
                inputMode="numeric"
                disabled={
                  Boolean(
                    editingCustomer
                  )
                }
              />

              <Field
                label="Teléfono"
                value={form.phone}
                onChange={(value) =>
                  onChange(
                    "phone",
                    value
                  )
                }
                placeholder="3000000000"
                inputMode="tel"
              />
            </div>

            <Field
              label="Nombre completo *"
              value={form.fullName}
              onChange={(value) =>
                onChange(
                  "fullName",
                  value
                )
              }
              placeholder="Ej: María Alejandra Ruiz"
            />

            <label>
              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-black/55">
                Notas
              </span>

              <textarea
                value={form.notes}
                onChange={(event) =>
                  onChange(
                    "notes",
                    event.target.value
                  )
                }
                rows={3}
                className="mt-2 w-full resize-none rounded-2xl border border-black/[0.08] px-4 py-3 text-[12px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Preferencias, observaciones o información útil..."
              />
            </label>

            <label className="flex items-center justify-between gap-4 rounded-2xl border border-black/[0.07] px-4 py-3">
              <div>
                <p className="text-[11px] font-medium">
                  Cliente activo
                </p>

                <p className="mt-0.5 text-[9px] text-black/40">
                  Los clientes inactivos se conservan en el historial.
                </p>
              </div>

              <input
                type="checkbox"
                checked={
                  form.isActive
                }
                onChange={(event) =>
                  onChange(
                    "isActive",
                    event.target.checked
                  )
                }
                className="h-4 w-4 accent-red-600"
              />
            </label>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-11 rounded-2xl border border-black/[0.08] text-[11px] font-medium transition hover:bg-black/[0.025] disabled:opacity-40"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="h-11 rounded-2xl bg-red-600 text-[11px] font-medium text-white shadow-lg shadow-red-600/15 transition hover:bg-red-700 disabled:bg-black/20 disabled:shadow-none"
            >
              {saving
                ? "Guardando..."
                : editingCustomer
                  ? "Guardar cambios"
                  : "Crear cliente"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  disabled = false,
}) {
  return (
    <label>
      <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-black/55">
        {label}
      </span>

      <input
        type={type}
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={disabled}
        className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] px-4 text-[12px] outline-none transition placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45"
      />
    </label>
  );
}
