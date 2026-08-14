import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Edit3,
  Eye,
  HandCoins,
  ImagePlus,
  PackageCheck,
  PackageSearch,
  Plus,
  RefreshCcw,
  Search,
  ShoppingBag,
  Trash2,
  User,
  X,
} from "lucide-react";

import {
  SPECIAL_ORDER_STATUS,
  SPECIAL_ORDER_STATUS_LABELS,
  buildSpecialOrdersPurchaseSummary,
  createSpecialOrder,
  removeSpecialOrderImage,
  replaceSpecialOrderImage,
  subscribeSpecialOrders,
  updateSpecialOrder,
  updateSpecialOrderStatus,
} from "../../services/specialOrders.service";

import {
  getCustomerByDocument,
  normalizeCustomerDocument,
} from "../../services/customers.service";

import {
  getProductCoverImage,
  subscribeProducts,
} from "../../services/products.service";

import {
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";

import { getCurrentUserActor } from "../../services/auth.service";
import { formatCurrency } from "../../utils/money";

const PAGE_SIZE = 10;

const emptyForm = {
  customerId: "",
  customerDocument: "",
  customerName: "",
  customerPhone: "",

  productId: "",
  productName: "",
  productCode: "",

  size: "",
  color: "",
  quantity: "1",
  notes: "",
  agreedPrice: "",
  hasDeposit: false,
  depositAmount: "",
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toLocaleUpperCase("es-CO");
}

function parseMoneyInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return 0;

  const amount = Number(digits);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoneyInput(value) {
  const amount = parseMoneyInput(value);
  if (!amount) return "";

  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
  }).format(amount);
}

function getOrderBalance(order) {
  const agreedPrice = Number(order?.agreedPrice || 0);
  const depositAmount = Number(order?.depositAmount || 0);

  return agreedPrice > 0
    ? Math.max(agreedPrice - depositAmount, 0)
    : Number(order?.balanceDue || 0);
}

function getDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = getDate(value);

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getStatusStyles(status) {
  return (
    {
      pending: "border-amber-200 bg-amber-50 text-amber-700",
      ordered: "border-blue-200 bg-blue-50 text-blue-700",
      received: "border-emerald-200 bg-emerald-50 text-emerald-700",
      delivered: "border-black/[0.08] bg-black/[0.035] text-black/60",
      cancelled: "border-red-200 bg-red-50 text-red-600",
    }[status] || "border-black/[0.08] bg-black/[0.035] text-black/60"
  );
}

function getNextStatusOptions(status) {
  const map = {
    [SPECIAL_ORDER_STATUS.PENDING]: [
      SPECIAL_ORDER_STATUS.ORDERED,
      SPECIAL_ORDER_STATUS.RECEIVED,
      SPECIAL_ORDER_STATUS.CANCELLED,
    ],
    [SPECIAL_ORDER_STATUS.ORDERED]: [
      SPECIAL_ORDER_STATUS.PENDING,
      SPECIAL_ORDER_STATUS.RECEIVED,
      SPECIAL_ORDER_STATUS.CANCELLED,
    ],
    [SPECIAL_ORDER_STATUS.RECEIVED]: [
      SPECIAL_ORDER_STATUS.ORDERED,
      SPECIAL_ORDER_STATUS.DELIVERED,
      SPECIAL_ORDER_STATUS.CANCELLED,
    ],
    [SPECIAL_ORDER_STATUS.DELIVERED]: [],
    [SPECIAL_ORDER_STATUS.CANCELLED]: [
      SPECIAL_ORDER_STATUS.PENDING,
    ],
  };

  return map[status] || [];
}

export default function SpecialOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [viewMode, setViewMode] = useState("orders");

  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    setLoading(true);

    const unsubscribeOrders = subscribeSpecialOrders(
      (data) => {
        setOrders(data);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoading(false);
        pushNotification("error", "No se pudieron cargar los encargos.");
      },
      STORE_ID
    );

    const unsubscribeProducts = subscribeProducts(
      setProducts,
      (error) => {
        console.error(error);
        pushNotification("error", "No se pudieron cargar los productos.");
      },
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      setCategories,
      (error) => {
        console.error(error);
      },
      STORE_ID
    );

    return () => {
      unsubscribeOrders();
      unsubscribeProducts();
      unsubscribeCategories();
    };
  }, []);

  function pushNotification(type, message) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setNotifications((current) => [
      ...current,
      { id, type, message },
    ]);

    window.setTimeout(() => {
      setNotifications((current) =>
        current.filter((item) => item.id !== id)
      );
    }, 4200);
  }

  function closeNotification(id) {
    setNotifications((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  const stats = useMemo(() => {
    const pending = orders.filter(
      (order) => order.status === SPECIAL_ORDER_STATUS.PENDING
    ).length;

    const ordered = orders.filter(
      (order) => order.status === SPECIAL_ORDER_STATUS.ORDERED
    ).length;

    const received = orders.filter(
      (order) => order.status === SPECIAL_ORDER_STATUS.RECEIVED
    ).length;

    const active = orders.filter((order) =>
      [
        SPECIAL_ORDER_STATUS.PENDING,
        SPECIAL_ORDER_STATUS.ORDERED,
        SPECIAL_ORDER_STATUS.RECEIVED,
      ].includes(order.status)
    ).length;

    return {
      pending,
      ordered,
      received,
      active,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const cleanSearch = normalizeUpper(search);

    return orders.filter((order) => {
      const haystack = normalizeUpper(
        [
          order.orderNumber,
          order.customerName,
          order.customerDocument,
          order.customerPhone,
          order.productName,
          order.productCode,
          order.size,
          order.color,
        ].join(" ")
      );

      const matchesSearch =
        !cleanSearch || haystack.includes(cleanSearch);

      const matchesStatus =
        statusFilter === "all" || order.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [orders, search, statusFilter]);

  const purchaseSummary = useMemo(
    () => buildSpecialOrdersPurchaseSummary(orders),
    [orders]
  );

  const totalPages = Math.max(
    Math.ceil(filteredOrders.length / PAGE_SIZE),
    1
  );

  const paginatedOrders = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;

    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  async function handleStatusChange(order, status) {
    try {
      setSaving(true);

      await updateSpecialOrderStatus({
        specialOrderId: order.id,
        status,
        actor: getCurrentUserActor(),
      });

      pushNotification(
        "success",
        `${order.orderNumber} actualizado a ${SPECIAL_ORDER_STATUS_LABELS[status]}.`
      );
    } catch (error) {
      console.error(error);
      pushNotification(
        "error",
        error?.message || "No se pudo actualizar el estado."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 text-black sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1680px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-red-600">
              Solicitudes de clientes
            </p>

            <h1 className="mt-1 text-[28px] font-medium tracking-[-0.045em] sm:text-[32px]">
              Encargos
            </h1>

            <p className="mt-1 text-[12px] text-black/46">
              Organiza lo que debes traer, para quién, en qué talla y color.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingOrder(null);
              setShowCreate(true);
            }}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-red-600 px-4 text-[11px] font-medium text-white shadow-lg shadow-red-600/15 transition hover:bg-red-700 lg:self-auto"
          >
            <Plus size={15} />
            Nuevo encargo
          </button>
        </header>

        <section className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Clock3}
            label="Pendientes"
            value={stats.pending}
            helper="Falta comprarlos"
          />

          <StatCard
            icon={ShoppingBag}
            label="Ya pedidos"
            value={stats.ordered}
            helper="Solicitados al proveedor"
          />

          <StatCard
            icon={PackageCheck}
            label="Recibidos"
            value={stats.received}
            helper="Listos para entregar"
          />

          <StatCard
            icon={RefreshCcw}
            label="Encargos activos"
            value={stats.active}
            helper="Pendientes de cierre"
          />
        </section>

        <section className="mt-4 overflow-hidden rounded-[24px] border border-black/[0.06] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col gap-3 border-b border-black/[0.06] p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex w-full rounded-xl bg-black/[0.035] p-1 sm:w-auto">
              <ViewButton
                active={viewMode === "orders"}
                onClick={() => setViewMode("orders")}
              >
                Encargos
              </ViewButton>

              <ViewButton
                active={viewMode === "purchase"}
                onClick={() => setViewMode("purchase")}
              >
                Lista para comprar
              </ViewButton>
            </div>

            {viewMode === "orders" && (
              <div className="grid w-full gap-2.5 md:grid-cols-[minmax(0,1fr)_180px] lg:max-w-[680px]">
                <label className="relative block">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35"
                  />

                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-10 w-full rounded-xl border border-black/[0.08] pl-10 pr-3 text-[11px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    placeholder="Buscar cliente, producto, talla o color..."
                  />
                </label>

                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-10 rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                >
                  <option value="all">Todos los estados</option>
                  <option value="pending">Pendientes</option>
                  <option value="ordered">Pedidos</option>
                  <option value="received">Recibidos</option>
                  <option value="delivered">Entregados</option>
                  <option value="cancelled">Cancelados</option>
                </select>
              </div>
            )}
          </div>

          {viewMode === "orders" ? (
            <>
              <div className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] border-collapse">
                    <thead>
                      <tr className="border-b border-black/[0.06] bg-black/[0.015]">
                        <TableHead>Encargo</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead>Talla / color</TableHead>
                        <TableHead>Abono</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead align="right">Acciones</TableHead>
                      </tr>
                    </thead>

                    <tbody>
                      {loading ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-12 text-center text-[11px] text-black/40"
                          >
                            Cargando encargos...
                          </td>
                        </tr>
                      ) : paginatedOrders.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-12 text-center text-[11px] text-black/40"
                          >
                            No hay encargos para mostrar.
                          </td>
                        </tr>
                      ) : (
                        paginatedOrders.map((order) => (
                          <OrderRow
                            key={order.id}
                            order={order}
                            saving={saving}
                            onOpen={() => setSelectedOrder(order)}
                            onEdit={() => {
                              setEditingOrder(order);
                              setShowCreate(true);
                            }}
                            onStatusChange={(status) =>
                              handleStatusChange(order, status)
                            }
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-2.5 p-3 md:hidden">
                {loading ? (
                  <EmptyState text="Cargando encargos..." />
                ) : paginatedOrders.length === 0 ? (
                  <EmptyState text="No hay encargos para mostrar." />
                ) : (
                  paginatedOrders.map((order) => (
                    <OrderMobileCard
                      key={order.id}
                      order={order}
                      saving={saving}
                      onOpen={() => setSelectedOrder(order)}
                      onEdit={() => {
                        setEditingOrder(order);
                        setShowCreate(true);
                      }}
                      onStatusChange={(status) =>
                        handleStatusChange(order, status)
                      }
                    />
                  ))
                )}
              </div>

              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={filteredOrders.length}
                onPageChange={setPage}
              />
            </>
          ) : (
            <PurchaseSummaryView summary={purchaseSummary} />
          )}
        </section>
      </section>

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onEdit={() => {
            setEditingOrder(selectedOrder);
            setSelectedOrder(null);
            setShowCreate(true);
          }}
        />
      )}

      {showCreate && (
        <SpecialOrderModal
          order={editingOrder}
          products={products}
          categories={categories}
          saving={saving}
          onClose={() => {
            if (saving) return;
            setShowCreate(false);
            setEditingOrder(null);
          }}
          onSuccess={(message) => {
            setShowCreate(false);
            setEditingOrder(null);
            pushNotification("success", message);
          }}
          onError={(message) =>
            pushNotification("error", message)
          }
          setSaving={setSaving}
        />
      )}

      <NotificationStack
        notifications={notifications}
        onClose={closeNotification}
      />
    </main>
  );
}

function StatCard({ icon: Icon, label, value, helper }) {
  return (
    <article className="rounded-[18px] border border-black/[0.055] bg-white px-3.5 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.028)]">
      <div className="flex min-h-[76px] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[8px] font-medium uppercase tracking-[0.11em] text-black/38">
            {label}
          </p>

          <p className="mt-1.5 text-[22px] font-medium leading-none tracking-[-0.04em]">
            {value}
          </p>

          <p className="mt-1.5 truncate text-[8.5px] text-black/38">
            {helper}
          </p>
        </div>

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <Icon size={15} />
        </div>
      </div>
    </article>
  );
}

function ViewButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 flex-1 rounded-lg px-3 text-[10px] font-medium transition sm:flex-none ${
        active
          ? "bg-white text-black shadow-sm"
          : "text-black/45 hover:text-black"
      }`}
    >
      {children}
    </button>
  );
}

function TableHead({ children, align = "left" }) {
  return (
    <th
      className={`px-4 py-3 text-left text-[8px] font-medium uppercase tracking-[0.11em] text-black/38 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function OrderRow({
  order,
  saving,
  onOpen,
  onEdit,
  onStatusChange,
}) {
  const nextStatuses = getNextStatusOptions(order.status);

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-black/[0.055] last:border-0 transition hover:bg-red-50/35"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <OrderImage order={order} size="h-10 w-10" />
          <div>
            <p className="text-[10.5px] font-medium">{order.orderNumber}</p>
            <p className="mt-0.5 text-[8px] text-black/38">
              Toca para ver detalles
            </p>
          </div>
        </div>
      </td>

      <td className="px-4 py-3">
        <p className="max-w-[170px] truncate text-[10px] font-medium">
          {order.customerName}
        </p>
        <p className="mt-0.5 text-[8px] text-black/38">
          {order.customerDocument}
        </p>
      </td>

      <td className="px-4 py-3">
        <p className="max-w-[190px] truncate text-[10px] font-medium">
          {order.productName}
        </p>
        <p className="mt-0.5 text-[8px] text-black/38">
          {order.productCode || "Sin código"}
        </p>
      </td>

      <td className="px-4 py-3 text-[9.5px] text-black/58">
        <span>{order.size || "Sin talla"}</span>
        <span className="mx-1 text-black/20">·</span>
        <span>{order.color || "Sin color"}</span>
      </td>

      <td className="px-4 py-3">
        <p className="text-[9px] font-medium">
          {Number(order.depositAmount || 0) > 0
            ? formatCurrency(order.depositAmount)
            : "Sin abono"}
        </p>
        {Number(order.agreedPrice || 0) > 0 && (
          <p className="mt-0.5 text-[8px] text-black/36">
            de {formatCurrency(order.agreedPrice)}
          </p>
        )}
      </td>

      <td className="px-4 py-3 text-[9px] text-black/50">
        {formatDate(order.requestedAt)}
      </td>

      <td className="px-4 py-3">
        <StatusBadge status={order.status} />
      </td>

      <td
        className="px-4 py-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.07] text-black/45 transition hover:bg-black/[0.03] hover:text-black"
            title="Ver detalles"
          >
            <Eye size={12} />
          </button>

          <button
            type="button"
            onClick={onEdit}
            disabled={[
              SPECIAL_ORDER_STATUS.DELIVERED,
              SPECIAL_ORDER_STATUS.CANCELLED,
            ].includes(order.status)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.07] text-black/45 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
            title="Editar encargo"
          >
            <Edit3 size={12} />
          </button>

          {nextStatuses.length > 0 && (
            <StatusMenu
              statuses={nextStatuses}
              disabled={saving}
              onSelect={onStatusChange}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

function OrderMobileCard({
  order,
  saving,
  onOpen,
  onEdit,
  onStatusChange,
}) {
  const nextStatuses = getNextStatusOptions(order.status);
  const balance = getOrderBalance(order);

  return (
    <article className="overflow-hidden rounded-[22px] border border-black/[0.055] bg-white shadow-[0_12px_34px_rgba(0,0,0,0.04)]">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full p-3.5 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[8px] font-medium uppercase tracking-[0.12em] text-red-600">
              {order.orderNumber}
            </p>
            <p className="mt-0.5 text-[8px] text-black/35">
              {formatDate(order.requestedAt)}
            </p>
          </div>

          <StatusBadge status={order.status} />
        </div>

        <div className="mt-3 flex gap-3">
          <OrderImage order={order} size="h-[86px] w-[86px]" />

          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] font-medium leading-[1.25] tracking-[-0.015em]">
              {order.productName}
            </p>

            <div className="mt-2 flex flex-wrap gap-1">
              <Chip>{order.size || "Sin talla"}</Chip>
              <Chip>{order.color || "Sin color"}</Chip>
              <Chip>{order.quantity} u.</Chip>
            </div>

            <div className="mt-2.5">
              <p className="truncate text-[10px] font-medium text-black/75">
                {order.customerName}
              </p>
              <p className="mt-0.5 truncate text-[8.5px] text-black/38">
                CC {order.customerDocument}
                {order.customerPhone ? ` · ${order.customerPhone}` : ""}
              </p>
            </div>
          </div>
        </div>

        <div
          className={`mt-3 flex items-center justify-between rounded-[14px] px-3 py-2.5 ${
            Number(order.depositAmount || 0) > 0
              ? "bg-emerald-50"
              : "bg-black/[0.025]"
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                Number(order.depositAmount || 0) > 0
                  ? "bg-white text-emerald-600"
                  : "bg-white text-black/35"
              }`}
            >
              <HandCoins size={13} />
            </div>

            <div>
              <p className="text-[7.5px] uppercase tracking-[0.08em] text-black/35">
                Abono
              </p>
              <p className="mt-0.5 text-[10px] font-medium">
                {Number(order.depositAmount || 0) > 0
                  ? formatCurrency(order.depositAmount)
                  : "Sin abono"}
              </p>
            </div>
          </div>

          {Number(order.agreedPrice || 0) > 0 && (
            <div className="text-right">
              <p className="text-[7.5px] text-black/35">Saldo</p>
              <p className="mt-0.5 text-[10px] font-medium">
                {formatCurrency(balance)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[8.5px] text-black/35">
            Ver detalles completos
          </span>
          <Eye size={13} className="text-black/35" />
        </div>
      </button>

      <div className="grid grid-cols-2 gap-2 border-t border-black/[0.055] bg-black/[0.012] p-2.5">
        <button
          type="button"
          onClick={onEdit}
          disabled={[
            SPECIAL_ORDER_STATUS.DELIVERED,
            SPECIAL_ORDER_STATUS.CANCELLED,
          ].includes(order.status)}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.07] bg-white text-[9px] font-medium text-black/65 disabled:opacity-30"
        >
          <Edit3 size={12} />
          Editar
        </button>

        {nextStatuses.length > 0 ? (
          <StatusMenu
            statuses={nextStatuses}
            disabled={saving}
            onSelect={onStatusChange}
            full
          />
        ) : (
          <div className="flex h-9 items-center justify-center rounded-xl bg-black/[0.03] text-[9px] text-black/40">
            Encargo cerrado
          </div>
        )}
      </div>
    </article>
  );
}

function OrderImage({ order, size }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/[0.025] ring-1 ring-black/[0.05] ${size}`}
    >
      {order.imageUrl ? (
        <img
          src={order.imageUrl}
          alt={order.productName}
          className="h-full w-full bg-white object-contain p-1"
        />
      ) : (
        <Camera size={17} className="text-black/22" />
      )}
    </div>
  );
}

function Chip({ children }) {
  return (
    <span className="rounded-full bg-black/[0.035] px-2 py-1 text-[8px] text-black/55">
      {children}
    </span>
  );
}

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2 py-1 text-[8px] font-medium ${getStatusStyles(
        status
      )}`}
    >
      {SPECIAL_ORDER_STATUS_LABELS[status] || status}
    </span>
  );
}

function StatusMenu({
  statuses,
  disabled,
  onSelect,
  full = false,
}) {
  return (
    <div className={`relative ${full ? "w-full" : ""}`}>
      <select
        value=""
        disabled={disabled}
        onChange={(event) => {
          if (!event.target.value) return;
          onSelect(event.target.value);
          event.target.value = "";
        }}
        className={`h-8 appearance-none rounded-lg border border-black/[0.07] bg-white pl-3 pr-7 text-[8.5px] outline-none transition hover:border-red-200 focus:border-red-600 ${
          full ? "h-9 w-full rounded-xl text-[9px]" : ""
        }`}
      >
        <option value="">Cambiar estado</option>

        {statuses.map((status) => (
          <option key={status} value={status}>
            {SPECIAL_ORDER_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <ChevronDown
        size={11}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-black/35"
      />
    </div>
  );
}

function PurchaseSummaryView({ summary }) {
  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3">
        <p className="text-[13px] font-medium">
          Lista consolidada para comprar
        </p>

        <p className="mt-0.5 text-[10px] text-black/42">
          Agrupa automáticamente producto, talla, color y cantidad de los encargos pendientes o pedidos.
        </p>
      </div>

      {summary.length === 0 ? (
        <EmptyState text="No hay mercancía pendiente por comprar." />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {summary.map((item) => (
            <article
              key={item.key}
              className="rounded-[18px] border border-black/[0.06] bg-white p-3 shadow-[0_10px_28px_rgba(0,0,0,0.025)]"
            >
              <p className="truncate text-[11px] font-medium">
                {item.productName}
              </p>

              <div className="mt-2 flex flex-wrap gap-1">
                <Chip>{item.size || "Sin talla"}</Chip>
                <Chip>{item.color || "Sin color"}</Chip>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniMetric
                  label="Traer"
                  value={`${item.totalQuantity} u.`}
                />
                <MiniMetric
                  label="Clientes"
                  value={item.customerCount}
                />
              </div>

              {item.customers.length > 0 && (
                <div className="mt-3 border-t border-black/[0.06] pt-2.5">
                  <p className="text-[7.5px] uppercase tracking-[0.08em] text-black/35">
                    Para
                  </p>

                  <div className="mt-1.5 space-y-1">
                    {item.customers.slice(0, 3).map((customer) => (
                      <p
                        key={customer.customerId}
                        className="truncate text-[8.5px] text-black/55"
                      >
                        {customer.customerName || customer.customerDocument}
                      </p>
                    ))}

                    {item.customers.length > 3 && (
                      <p className="text-[8px] text-red-600">
                        +{item.customers.length - 3} cliente(s)
                      </p>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-xl bg-black/[0.025] px-2.5 py-2">
      <p className="text-[7.5px] text-black/35">{label}</p>
      <p className="mt-0.5 text-[12px] font-medium">{value}</p>
    </div>
  );
}

function SpecialOrderModal({
  order,
  products,
  categories,
  saving,
  onClose,
  onSuccess,
  onError,
  setSaving,
}) {
  const editing = Boolean(order);

  const [form, setForm] = useState(() =>
    editing
      ? {
          customerId: order.customerId || "",
          customerDocument: order.customerDocument || "",
          customerName: order.customerName || "",
          customerPhone: order.customerPhone || "",

          productId: order.productId || "",
          productName: order.productName || "",
          productCode: order.productCode || "",

          size: order.size || "",
          color: order.color || "",
          quantity: String(order.quantity || 1),
          notes: order.notes || "",
          agreedPrice:
            Number(order.agreedPrice || 0) > 0
              ? formatMoneyInput(order.agreedPrice)
              : "",
          hasDeposit: Number(order.depositAmount || 0) > 0,
          depositAmount:
            Number(order.depositAmount || 0) > 0
              ? formatMoneyInput(order.depositAmount)
              : "",
        }
      : emptyForm
  );

  const [customerLookup, setCustomerLookup] = useState({
    status: editing ? "found" : "idle",
    customer: editing
      ? {
          id: order.customerId,
          fullName: order.customerName,
          phone: order.customerPhone,
        }
      : null,
  });

  const [productSearch, setProductSearch] = useState("");
  const [productMode, setProductMode] = useState(
    editing && order.productId ? "linked" : "linked"
  );

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(
    order?.imageUrl || ""
  );
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => {
    if (editing) return undefined;

    const documentNumber = normalizeCustomerDocument(
      form.customerDocument
    );

    if (!documentNumber) {
      setCustomerLookup({
        status: "idle",
        customer: null,
      });
      return undefined;
    }

    let cancelled = false;

    setCustomerLookup({
      status: "searching",
      customer: null,
    });

    const timeoutId = window.setTimeout(async () => {
      try {
        const customer = await getCustomerByDocument(
          documentNumber,
          STORE_ID
        );

        if (cancelled) return;

        if (customer) {
          setForm((current) => ({
            ...current,
            customerId: customer.id,
            customerName: customer.fullName || "",
            customerPhone: customer.phone || "",
          }));

          setCustomerLookup({
            status: "found",
            customer,
          });
        } else {
          setForm((current) => ({
            ...current,
            customerId: "",
            customerName: "",
            customerPhone: "",
          }));

          setCustomerLookup({
            status: "not-found",
            customer: null,
          });
        }
      } catch (error) {
        if (cancelled) return;

        console.error(error);

        setCustomerLookup({
          status: "error",
          customer: null,
        });
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [form.customerDocument, editing]);

  useEffect(() => {
    return () => {
      if (imagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const filteredProducts = useMemo(() => {
    const clean = normalizeUpper(productSearch);

    return products
      .filter((product) => {
        if (!clean) return true;

        return normalizeUpper(
          [
            product.name,
            product.code,
            product.categoryName,
          ].join(" ")
        ).includes(clean);
      })
      .slice(0, 8);
  }, [products, productSearch]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]:
        ["productName", "size", "color"].includes(field)
          ? normalizeUpper(value)
          : ["agreedPrice", "depositAmount"].includes(field)
            ? formatMoneyInput(value)
            : value,
    }));
  }

  function handleDocumentChange(value) {
    const documentNumber = normalizeCustomerDocument(value).slice(0, 15);

    setForm((current) => ({
      ...current,
      customerId: "",
      customerDocument: documentNumber,
      customerName: "",
      customerPhone: "",
    }));
  }

  function selectProduct(product) {
    setForm((current) => ({
      ...current,
      productId: product.id,
      productName: normalizeUpper(product.name),
      productCode: product.code || "",
    }));

    setProductSearch("");
  }

  function clearProduct() {
    setForm((current) => ({
      ...current,
      productId: "",
      productName: "",
      productCode: "",
    }));
  }

  function handleImageChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (imagePreview?.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setRemoveImage(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.customerDocument) {
      onError("Escribe la cédula del cliente.");
      return;
    }

    if (customerLookup.status === "searching") {
      onError("Espera mientras validamos el cliente.");
      return;
    }

    if (
      !editing &&
      customerLookup.status !== "found" &&
      !normalizeText(form.customerName)
    ) {
      onError("Completa el nombre del cliente nuevo.");
      return;
    }

    if (!normalizeText(form.productName)) {
      onError("Selecciona o escribe el producto del encargo.");
      return;
    }

    if (Number(form.quantity || 0) <= 0) {
      onError("La cantidad debe ser mayor a cero.");
      return;
    }

    const agreedPrice = parseMoneyInput(form.agreedPrice);
    const depositAmount = form.hasDeposit
      ? parseMoneyInput(form.depositAmount)
      : 0;

    if (form.hasDeposit && depositAmount <= 0) {
      onError("Escribe el valor del abono del cliente.");
      return;
    }

    if (agreedPrice > 0 && depositAmount > agreedPrice) {
      onError("El abono no puede ser mayor al valor del encargo.");
      return;
    }

    try {
      setSaving(true);
      const actor = getCurrentUserActor();

      if (editing) {
        await updateSpecialOrder(
          order.id,
          {
            productId: form.productId,
            productName: form.productName,
            productCode: form.productCode,
            size: form.size,
            color: form.color,
            quantity: form.quantity,
            notes: form.notes,
            agreedPrice,
            hasDeposit: Boolean(form.hasDeposit),
            depositAmount,
          },
          actor
        );

        if (removeImage && order.imagePath) {
          await removeSpecialOrderImage({
            specialOrderId: order.id,
            actor,
          });
        }

        if (imageFile) {
          await replaceSpecialOrderImage({
            specialOrderId: order.id,
            imageFile,
            actor,
          });
        }

        onSuccess(`${order.orderNumber} actualizado correctamente.`);
      } else {
        const created = await createSpecialOrder({
          ...form,
          agreedPrice,
          hasDeposit: Boolean(form.hasDeposit),
          depositAmount,
          imageFile,
          storeId: STORE_ID,
          actor,
        });

        onSuccess(
          `${created.orderNumber} creado correctamente.`
        );
      }
    } catch (error) {
      console.error(error);
      onError(
        error?.message || "No se pudo guardar el encargo."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-3 py-4 backdrop-blur-sm">
      <section className="flex max-h-[94vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-red-600">
              {editing ? "Editar encargo" : "Nuevo encargo"}
            </p>

            <h2 className="mt-1 text-[20px] font-medium tracking-[-0.035em]">
              {editing
                ? order.orderNumber
                : "Registrar solicitud del cliente"}
            </h2>

            <p className="mt-1 text-[10px] text-black/42">
              Cliente, producto, talla, color y foto de referencia.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035] text-black/55 disabled:opacity-40"
          >
            <X size={17} />
          </button>
        </header>

        <form
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px]">
            <div className="min-w-0">
              <SectionTitle
                title="Cliente"
                description="Busca por cédula para evitar duplicados."
              />

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <Field
                  label="Cédula"
                  value={form.customerDocument}
                  onChange={handleDocumentChange}
                  disabled={editing}
                  inputMode="numeric"
                />

                {editing || customerLookup.status === "found" ? (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5">
                    <p className="text-[8px] font-medium text-emerald-700">
                      Cliente vinculado
                    </p>
                    <p className="mt-1 truncate text-[11px] font-medium">
                      {form.customerName}
                    </p>
                    <p className="mt-0.5 truncate text-[8.5px] text-black/42">
                      {form.customerPhone || "Sin teléfono"}
                    </p>
                  </div>
                ) : customerLookup.status === "searching" ? (
                  <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 text-[9px] text-red-600">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-200 border-t-red-600" />
                    Buscando cliente...
                  </div>
                ) : customerLookup.status === "not-found" ? (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-[9px] text-amber-700">
                    Cliente nuevo. Completa sus datos.
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl bg-black/[0.025] px-3 text-[9px] text-black/40">
                    <User size={13} />
                    Ingresa una cédula
                  </div>
                )}
              </div>

              {!editing &&
                customerLookup.status === "not-found" && (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <Field
                      label="Nombre completo"
                      value={form.customerName}
                      onChange={(value) =>
                        updateForm("customerName", value)
                      }
                    />

                    <Field
                      label="Teléfono"
                      value={form.customerPhone}
                      onChange={(value) =>
                        updateForm("customerPhone", value)
                      }
                      inputMode="tel"
                    />
                  </div>
                )}

              <div className="mt-5">
                <SectionTitle
                  title="Producto solicitado"
                  description="Puedes vincular uno existente o escribir uno nuevo."
                />
              </div>

              <div className="mt-3 inline-flex rounded-xl bg-black/[0.035] p-1">
                <ViewButton
                  active={productMode === "linked"}
                  onClick={() => {
                    setProductMode("linked");
                    clearProduct();
                  }}
                >
                  Producto existente
                </ViewButton>

                <ViewButton
                  active={productMode === "free"}
                  onClick={() => {
                    setProductMode("free");
                    clearProduct();
                  }}
                >
                  Producto libre
                </ViewButton>
              </div>

              {productMode === "linked" ? (
                <div className="mt-3">
                  {form.productId ? (
                    <SelectedProduct
                      product={products.find(
                        (item) => item.id === form.productId
                      )}
                      name={form.productName}
                      code={form.productCode}
                      onClear={clearProduct}
                    />
                  ) : (
                    <>
                      <label className="relative block">
                        <Search
                          size={14}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35"
                        />

                        <input
                          value={productSearch}
                          onChange={(event) =>
                            setProductSearch(event.target.value)
                          }
                          className="h-10 w-full rounded-xl border border-black/[0.08] pl-9 pr-3 text-[11px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                          placeholder="Buscar producto existente..."
                        />
                      </label>

                      <div className="mt-2 grid max-h-[220px] gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                        {filteredProducts.map((product) => (
                          <ProductOption
                            key={product.id}
                            product={product}
                            onSelect={() =>
                              selectProduct(product)
                            }
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <Field
                    label="Nombre del producto"
                    value={form.productName}
                    onChange={(value) =>
                      updateForm("productName", value)
                    }
                    placeholder="Ej: CHAQUETA IMPERMEABLE"
                  />

                  <Field
                    label="Referencia / código"
                    value={form.productCode}
                    onChange={(value) =>
                      updateForm("productCode", value)
                    }
                    placeholder="Opcional"
                  />
                </div>
              )}

              <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                <Field
                  label="Talla"
                  value={form.size}
                  onChange={(value) =>
                    updateForm("size", value)
                  }
                  placeholder="Ej: XL"
                />

                <Field
                  label="Color"
                  value={form.color}
                  onChange={(value) =>
                    updateForm("color", value)
                  }
                  placeholder="Ej: NEGRO"
                />

                <Field
                  label="Cantidad"
                  value={form.quantity}
                  onChange={(value) =>
                    updateForm(
                      "quantity",
                      value.replace(/\D/g, "")
                    )
                  }
                  inputMode="numeric"
                />
              </div>

              <div className="mt-5">
                <SectionTitle
                  title="Valor y abono"
                  description="Define si el cliente deja dinero al momento de hacer el encargo."
                />
              </div>

              <div className="mt-3 rounded-[18px] border border-black/[0.06] bg-black/[0.018] p-3">
                <div className="grid gap-2.5 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Field
                    label="Valor acordado del encargo"
                    value={form.agreedPrice}
                    onChange={(value) =>
                      updateForm("agreedPrice", value)
                    }
                    placeholder="Ej: 180.000"
                    inputMode="numeric"
                  />

                  <div>
                    <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-black/48">
                      ¿Deja abono?
                    </span>

                    <div className="mt-1.5 grid grid-cols-2 rounded-xl bg-white p-1 ring-1 ring-black/[0.07]">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            hasDeposit: false,
                            depositAmount: "",
                          }))
                        }
                        className={`h-8 rounded-lg px-3 text-[9px] font-medium transition ${
                          !form.hasDeposit
                            ? "bg-black text-white"
                            : "text-black/45"
                        }`}
                      >
                        Sin abono
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            hasDeposit: true,
                          }))
                        }
                        className={`h-8 rounded-lg px-3 text-[9px] font-medium transition ${
                          form.hasDeposit
                            ? "bg-red-600 text-white"
                            : "text-black/45"
                        }`}
                      >
                        Con abono
                      </button>
                    </div>
                  </div>
                </div>

                {form.hasDeposit && (
                  <div className="mt-3">
                    <Field
                      label="Valor del abono"
                      value={form.depositAmount}
                      onChange={(value) =>
                        updateForm("depositAmount", value)
                      }
                      placeholder="Ej: 10.000"
                      inputMode="numeric"
                    />

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[10000, 20000, 50000].map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() =>
                            updateForm("depositAmount", String(amount))
                          }
                          className="h-7 rounded-lg border border-black/[0.07] bg-white px-2.5 text-[8px] text-black/55 transition hover:border-red-200 hover:text-red-600"
                        >
                          {formatCurrency(amount)}
                        </button>
                      ))}

                      {parseMoneyInput(form.agreedPrice) > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            updateForm(
                              "depositAmount",
                              String(
                                Math.round(
                                  parseMoneyInput(form.agreedPrice) / 2
                                )
                              )
                            )
                          }
                          className="h-7 rounded-lg border border-red-100 bg-red-50 px-2.5 text-[8px] text-red-600"
                        >
                          50% del valor
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniMetric
                    label="Abono"
                    value={
                      form.hasDeposit &&
                      parseMoneyInput(form.depositAmount) > 0
                        ? formatCurrency(
                            parseMoneyInput(form.depositAmount)
                          )
                        : "Sin abono"
                    }
                  />

                  <MiniMetric
                    label="Saldo"
                    value={
                      parseMoneyInput(form.agreedPrice) > 0
                        ? formatCurrency(
                            Math.max(
                              parseMoneyInput(form.agreedPrice) -
                                (form.hasDeposit
                                  ? parseMoneyInput(form.depositAmount)
                                  : 0),
                              0
                            )
                          )
                        : "Sin definir"
                    }
                  />
                </div>
              </div>

              <label className="mt-3 block">
                <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-black/48">
                  Notas
                </span>

                <textarea
                  value={form.notes}
                  onChange={(event) =>
                    updateForm("notes", event.target.value)
                  }
                  rows={3}
                  className="mt-1.5 w-full resize-none rounded-xl border border-black/[0.08] px-3 py-2.5 text-[11px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  placeholder="Detalles especiales del encargo..."
                />
              </label>
            </div>

            <aside>
              <SectionTitle
                title="Foto de referencia"
                description="Opcional · sirve para recordar exactamente qué pidió."
              />

              <label className="mt-3 block cursor-pointer">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={handleImageChange}
                  className="hidden"
                />

                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[20px] border border-dashed border-black/15 bg-black/[0.025] transition hover:border-red-300 hover:bg-red-50/30">
                  {imagePreview && !removeImage ? (
                    <img
                      src={imagePreview}
                      alt="Referencia del encargo"
                      className="h-full w-full bg-white object-contain p-2"
                    />
                  ) : (
                    <div className="text-center">
                      <ImagePlus
                        size={26}
                        className="mx-auto text-black/28"
                      />

                      <p className="mt-2 text-[10px] font-medium">
                        Cargar fotografía
                      </p>

                      <p className="mt-1 text-[8px] text-black/35">
                        JPG, PNG, WEBP o AVIF
                      </p>
                    </div>
                  )}
                </div>
              </label>

              {imagePreview && !removeImage && (
                <button
                  type="button"
                  onClick={() => {
                    if (imagePreview?.startsWith("blob:")) {
                      URL.revokeObjectURL(imagePreview);
                    }

                    setImageFile(null);
                    setImagePreview("");
                    setRemoveImage(Boolean(order?.imagePath));
                  }}
                  className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-red-100 text-[9px] text-red-600 transition hover:bg-red-50"
                >
                  <Trash2 size={12} />
                  Quitar foto
                </button>
              )}

              <div className="mt-3 rounded-[16px] bg-black/[0.025] p-3">
                <p className="text-[8px] font-medium uppercase tracking-[0.08em] text-black/40">
                  Resumen
                </p>

                <div className="mt-2 space-y-2">
                  <InfoLine
                    label="Cliente"
                    value={form.customerName || "Pendiente"}
                  />

                  <InfoLine
                    label="Producto"
                    value={form.productName || "Pendiente"}
                  />

                  <InfoLine
                    label="Talla"
                    value={form.size || "Sin talla"}
                  />

                  <InfoLine
                    label="Color"
                    value={form.color || "Sin color"}
                  />

                  <InfoLine
                    label="Cantidad"
                    value={`${form.quantity || 0} unidad(es)`}
                  />
                  <InfoLine
                    label="Abono"
                    value={
                      form.hasDeposit &&
                      parseMoneyInput(form.depositAmount) > 0
                        ? formatCurrency(
                            parseMoneyInput(form.depositAmount)
                          )
                        : "Sin abono"
                    }
                  />
                </div>
              </div>
            </aside>
          </div>

          <footer className="sticky bottom-0 mt-5 flex items-center justify-end gap-2 border-t border-black/[0.06] bg-white pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-10 rounded-xl border border-black/[0.08] px-4 text-[10px] font-medium disabled:opacity-40"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-[10px] font-medium text-white shadow-sm shadow-red-600/15 disabled:bg-black/20"
            >
              <CheckCircle2 size={13} />
              {saving
                ? "Guardando..."
                : editing
                  ? "Actualizar encargo"
                  : "Crear encargo"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}


function OrderDetailModal({ order, onClose, onEdit }) {
  const balance = getOrderBalance(order);
  const canEdit = ![
    SPECIAL_ORDER_STATUS.DELIVERED,
    SPECIAL_ORDER_STATUS.CANCELLED,
  ].includes(order.status);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
      <section className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-w-[760px] sm:rounded-[28px]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/[0.06] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-medium uppercase tracking-[0.13em] text-red-600">
                {order.orderNumber}
              </p>
              <StatusBadge status={order.status} />
            </div>

            <h2 className="mt-1.5 truncate text-[19px] font-medium tracking-[-0.03em]">
              Detalle del encargo
            </h2>

            <p className="mt-0.5 text-[9px] text-black/38">
              Registrado {formatDate(order.requestedAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-[210px_minmax(0,1fr)]">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[20px] bg-black/[0.025] ring-1 ring-black/[0.055]">
              {order.imageUrl ? (
                <img
                  src={order.imageUrl}
                  alt={order.productName}
                  className="h-full w-full bg-white object-contain p-2"
                />
              ) : (
                <Camera size={30} className="text-black/22" />
              )}
            </div>

            <div className="min-w-0">
              <p className="text-[8px] font-medium uppercase tracking-[0.1em] text-black/35">
                Producto solicitado
              </p>
              <h3 className="mt-1 text-[17px] font-medium leading-tight">
                {order.productName}
              </h3>
              <p className="mt-1 text-[9px] text-black/38">
                {order.productCode || "Sin código"}
                {order.productId
                  ? " · Vinculado al inventario"
                  : " · Producto libre"}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <DetailMini label="Talla" value={order.size || "—"} />
                <DetailMini label="Color" value={order.color || "—"} />
                <DetailMini label="Cantidad" value={`${order.quantity} u.`} />
              </div>

              <div className="mt-4 rounded-[16px] bg-black/[0.025] p-3">
                <p className="text-[8px] font-medium uppercase tracking-[0.1em] text-black/35">
                  Cliente
                </p>
                <p className="mt-1 text-[12px] font-medium">
                  {order.customerName}
                </p>
                <p className="mt-0.5 text-[9px] text-black/42">
                  CC {order.customerDocument}
                  {order.customerPhone ? ` · ${order.customerPhone}` : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-medium">Valor y abono</p>

            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <DetailMoney
                label="Valor acordado"
                value={
                  Number(order.agreedPrice || 0) > 0
                    ? formatCurrency(order.agreedPrice)
                    : "Sin definir"
                }
              />
              <DetailMoney
                label="Abono recibido"
                value={
                  Number(order.depositAmount || 0) > 0
                    ? formatCurrency(order.depositAmount)
                    : "Sin abono"
                }
                accent={Number(order.depositAmount || 0) > 0}
              />
              <DetailMoney
                label="Saldo pendiente"
                value={
                  Number(order.agreedPrice || 0) > 0
                    ? formatCurrency(balance)
                    : "Sin definir"
                }
              />
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-medium">Seguimiento</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <TimelineItem label="Solicitado" value={order.requestedAt} active />
              <TimelineItem label="Pedido" value={order.orderedAt} />
              <TimelineItem label="Recibido" value={order.receivedAt} />
              <TimelineItem label="Entregado" value={order.deliveredAt} />
              <TimelineItem label="Cancelado" value={order.cancelledAt} />
            </div>
          </div>

          {order.notes && (
            <div className="mt-4 rounded-[16px] border border-black/[0.055] p-3">
              <p className="text-[8px] font-medium uppercase tracking-[0.1em] text-black/35">
                Notas
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-[10px] leading-5 text-black/65">
                {order.notes}
              </p>
            </div>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-black/[0.06] bg-white p-3 sm:flex sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-black/[0.08] px-4 text-[10px] font-medium"
          >
            Cerrar
          </button>

          <button
            type="button"
            onClick={onEdit}
            disabled={!canEdit}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-[10px] font-medium text-white disabled:bg-black/15"
          >
            <Edit3 size={13} />
            Editar encargo
          </button>
        </footer>
      </section>
    </div>
  );
}

function DetailMini({ label, value }) {
  return (
    <div className="rounded-xl bg-black/[0.025] px-2.5 py-2">
      <p className="text-[7.5px] text-black/35">{label}</p>
      <p className="mt-0.5 truncate text-[9.5px] font-medium">{value}</p>
    </div>
  );
}

function DetailMoney({ label, value, accent = false }) {
  return (
    <div
      className={`rounded-[14px] px-3 py-3 ${
        accent ? "bg-emerald-50" : "bg-black/[0.025]"
      }`}
    >
      <p className={`text-[8px] ${accent ? "text-emerald-700/65" : "text-black/35"}`}>
        {label}
      </p>
      <p className={`mt-1 text-[12px] font-medium ${accent ? "text-emerald-700" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function TimelineItem({ label, value, active = false }) {
  const hasValue = Boolean(value);

  return (
    <div className={`rounded-xl px-2.5 py-2 ${
      hasValue || active ? "bg-black/[0.035]" : "bg-black/[0.018]"
    }`}>
      <p className="text-[7.5px] text-black/35">{label}</p>
      <p className="mt-0.5 text-[8.5px] font-medium text-black/60">
        {hasValue ? formatDate(value) : active ? "Registrado" : "Pendiente"}
      </p>
    </div>
  );
}

function SectionTitle({ title, description }) {
  return (
    <div>
      <p className="text-[12px] font-medium">{title}</p>
      <p className="mt-0.5 text-[9px] text-black/38">
        {description}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder = "",
  disabled = false,
  inputMode,
}) {
  return (
    <label className="block">
      <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-black/48">
        {label}
      </span>

      <input
        value={value}
        disabled={disabled}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45"
      />
    </label>
  );
}

function ProductOption({ product, onSelect }) {
  const cover = getProductCoverImage(product);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-2 rounded-xl border border-black/[0.06] p-2 text-left transition hover:border-red-200 hover:bg-red-50/40"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/[0.025]">
        {cover.url ? (
          <img
            src={cover.url}
            alt={product.name}
            className="h-full w-full bg-white object-contain p-1"
          />
        ) : (
          <Camera size={14} className="text-black/25" />
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-[9.5px] font-medium">
          {product.name}
        </p>

        <p className="mt-0.5 truncate text-[8px] text-black/38">
          {product.code || "Sin código"} ·{" "}
          {product.categoryName || "Sin categoría"}
        </p>
      </div>
    </button>
  );
}

function SelectedProduct({
  product,
  name,
  code,
  onClear,
}) {
  const cover = product
    ? getProductCoverImage(product)
    : { url: "" };

  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-emerald-100 bg-emerald-50/60 p-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
        {cover.url ? (
          <img
            src={cover.url}
            alt={name}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <PackageSearch size={17} className="text-black/25" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-medium">
          {name}
        </p>

        <p className="mt-0.5 text-[8px] text-black/40">
          {code || "Sin código"}
        </p>
      </div>

      <button
        type="button"
        onClick={onClear}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-red-600 ring-1 ring-red-100"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function InfoLine({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[8.5px]">
      <span className="text-black/38">{label}</span>
      <span className="max-w-[140px] truncate text-right font-medium">
        {value}
      </span>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="rounded-[18px] bg-black/[0.025] p-8 text-center">
      <PackageSearch
        size={24}
        className="mx-auto text-black/25"
      />
      <p className="mt-2 text-[10px] text-black/42">
        {text}
      </p>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}) {
  const start =
    totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;

  const end = Math.min(page * PAGE_SIZE, totalItems);

  return (
    <footer className="flex flex-col gap-2.5 border-t border-black/[0.06] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <p className="text-[9px] text-black/40">
        Mostrando {start}-{end} de {totalItems} encargo(s)
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() =>
            onPageChange((current) => Math.max(current - 1, 1))
          }
          className="h-8 min-w-8 rounded-lg border border-black/[0.08] text-[10px] disabled:opacity-30"
        >
          ‹
        </button>

        <span className="min-w-[58px] text-center text-[9px] text-black/48">
          {page} / {totalPages}
        </span>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() =>
            onPageChange((current) =>
              Math.min(current + 1, totalPages)
            )
          }
          className="h-8 min-w-8 rounded-lg border border-black/[0.08] text-[10px] disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </footer>
  );
}

function NotificationStack({
  notifications,
  onClose,
}) {
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[150] flex w-[min(350px,calc(100vw-24px))] flex-col gap-2 sm:right-5 sm:top-5">
      {notifications.map((notification) => {
        const style =
          notification.type === "success"
            ? "border-emerald-200 text-emerald-700"
            : notification.type === "error"
              ? "border-red-200 text-red-700"
              : "border-black/[0.08] text-black/65";

        const Icon =
          notification.type === "success"
            ? CheckCircle2
            : notification.type === "error"
              ? X
              : Clock3;

        return (
          <div
            key={notification.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-[16px] border bg-white px-3.5 py-3 shadow-[0_14px_38px_rgba(0,0,0,0.10)] ${style}`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.025]">
              <Icon size={14} />
            </div>

            <p className="min-w-0 flex-1 pt-0.5 text-[10px] leading-4 text-black/68">
              {notification.message}
            </p>

            <button
              type="button"
              onClick={() => onClose(notification.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-black/35 hover:bg-black/[0.04] hover:text-black"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}