import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Mail,
  Plus,
  Search,
  Shield,
  Store,
  User,
  UserCheck,
  UserCog,
  UserX,
  X,
} from "lucide-react";

import {
  createStoreUser,
  setUserActiveStatus,
  subscribeUsers,
  updateStoreUser,
} from "../../services/users.service";

import { STORE_ID } from "../../services/categories.service";
import { getCurrentUserActor } from "../../services/auth.service";

const emptyForm = {
  displayName: "",
  email: "",
  password: "",
  role: "seller",
};

function getRoleLabel(role) {
  const labels = {
    admin: "Administrador",
    seller: "Vendedor",
  };

  return labels[role] || "Usuario";
}

function getRoleClass(role) {
  const classes = {
    admin: "bg-red-600 text-white",
    seller: "bg-red-50 text-red-600",
  };

  return classes[role] || "bg-black/[0.04] text-black/55";
}

function getStatusClass(active) {
  return active
    ? "bg-emerald-50 text-emerald-600"
    : "bg-red-50 text-red-600";
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingUser, setEditingUser] = useState(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);

    const unsubscribeUsers = subscribeUsers(
      (usersData) => {
        setUsers(usersData);
        setLoading(false);
      },
      () => {
        setLoading(false);
        alert("No se pudieron escuchar los usuarios en tiempo real.");
      },
      STORE_ID
    );

    return () => {
      unsubscribeUsers();
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return users.filter((userItem) => {
      const matchesSearch =
        !cleanSearch ||
        String(userItem.displayName || "").toLowerCase().includes(cleanSearch) ||
        String(userItem.email || "").toLowerCase().includes(cleanSearch) ||
        String(userItem.role || "").toLowerCase().includes(cleanSearch);

      const matchesRole =
        roleFilter === "all" || userItem.role === roleFilter;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && userItem.active) ||
        (statusFilter === "inactive" && !userItem.active);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  const totals = useMemo(() => {
    return users.reduce(
      (acc, userItem) => {
        acc.total += 1;

        if (userItem.active) acc.active += 1;
        if (!userItem.active) acc.inactive += 1;
        if (userItem.role === "admin") acc.admins += 1;
        if (userItem.role === "seller") acc.sellers += 1;

        return acc;
      },
      {
        total: 0,
        active: 0,
        inactive: 0,
        admins: 0,
        sellers: 0,
      }
    );
  }, [users]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingUser(null);
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(userItem) {
    setEditingUser(userItem);

    setForm({
      displayName: userItem.displayName || "",
      email: userItem.email || "",
      password: "",
      role: userItem.role || "seller",
    });

    setShowForm(true);
  }

  function closeForm() {
    resetForm();
    setShowForm(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const displayName = form.displayName.trim();
    const email = form.email.trim().toLowerCase();
    const password = form.password.trim();

    if (!displayName) {
      alert("Escribe el nombre del usuario.");
      return;
    }

    if (!email) {
      alert("Escribe el correo.");
      return;
    }

    try {
      setSaving(true);

      const actor = getCurrentUserActor();

      if (editingUser) {
        await updateStoreUser(editingUser.id, {
          displayName,
          role: form.role,
          updatedByUid: actor.uid,
          updatedByName: actor.name,
          updatedByEmail: actor.email,
        });
      } else {
        if (!password || password.length < 6) {
          alert("La contraseña debe tener mínimo 6 caracteres.");
          return;
        }

        await createStoreUser({
          displayName,
          email,
          password,
          role: form.role,
          storeId: STORE_ID,
          creator: actor,
        });
      }

      closeForm();
    } catch (error) {
      console.error(error);

      if (error.code === "auth/email-already-in-use") {
        alert("Ya existe un usuario con ese correo.");
      } else if (error.code === "auth/invalid-email") {
        alert("El correo no es válido.");
      } else {
        alert(error.message || "No se pudo guardar el usuario.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(userItem) {
    const nextStatus = !userItem.active;

    const confirmMessage = nextStatus
      ? `¿Deseas activar a ${userItem.displayName}?`
      : `¿Deseas desactivar a ${userItem.displayName}?`;

    const confirmed = window.confirm(confirmMessage);

    if (!confirmed) return;

    try {
      await setUserActiveStatus(userItem.id, nextStatus);
    } catch (error) {
      console.error(error);
      alert("No se pudo cambiar el estado del usuario.");
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-3 py-4 sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-medium tracking-[-0.045em] text-black">
              Usuarios
            </h1>

            <p className="mt-1 text-[13px] font-normal text-black/50">
              Administra vendedores y accesos del panel
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
          >
            <Plus size={17} strokeWidth={1.9} />
            Nuevo usuario
          </button>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Usuarios activos" value={totals.active} />
          <MetricCard title="Vendedores" value={totals.sellers} />
          <MetricCard title="Administradores" value={totals.admins} />
          <MetricCard title="Total registrados" value={totals.total} featured />
        </section>

        <section className="mt-5 rounded-[26px] bg-white p-3 shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
          <div className="grid gap-3 lg:grid-cols-[1.45fr_0.82fr_0.82fr]">
            <label className="relative block">
              <Search
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] font-normal text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Buscar por nombre, correo o rol..."
              />
            </label>

            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="all">Todos los roles</option>
              <option value="admin">Administradores</option>
              <option value="seller">Vendedores</option>
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </select>
          </div>

          <section className="mt-4">
            {loading ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center text-[13px] text-black/45">
                Cargando usuarios en tiempo real...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black/50 ring-1 ring-black/[0.06]">
                  <UserCog size={24} />
                </div>

                <h2 className="mt-4 text-[17px] font-medium text-black">
                  No hay usuarios
                </h2>

                <p className="mt-2 text-[13px] text-black/45">
                  Crea el primer vendedor o administrador.
                </p>

                <button
                  type="button"
                  onClick={openCreateForm}
                  className="mt-5 rounded-2xl bg-red-600 px-5 py-3 text-[13px] font-medium text-white hover:bg-red-700"
                >
                  Crear usuario
                </button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredUsers.map((userItem) => (
                  <UserCard
                    key={userItem.id}
                    userItem={userItem}
                    onEdit={() => openEditForm(userItem)}
                    onToggle={() => handleToggleActive(userItem)}
                  />
                ))}
              </div>
            )}
          </section>
        </section>
      </section>

      {showForm && (
        <UserFormModal
          editingUser={editingUser}
          form={form}
          saving={saving}
          closeForm={closeForm}
          handleSubmit={handleSubmit}
          updateForm={updateForm}
        />
      )}
    </main>
  );
}

function MetricCard({ title, value, featured = false }) {
  return (
    <article
      className={`rounded-[24px] p-4 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ${
        featured
          ? "bg-red-600 text-white ring-red-600"
          : "bg-white text-black ring-black/[0.06]"
      }`}
    >
      <p
        className={`text-[12px] font-normal ${
          featured ? "text-white/70" : "text-black/45"
        }`}
      >
        {title}
      </p>

      <p className="mt-1 text-[24px] font-medium tracking-[-0.04em]">
        {value}
      </p>
    </article>
  );
}

function UserCard({ userItem, onEdit, onToggle }) {
  return (
    <article className="rounded-[24px] bg-white p-3 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(0,0,0,0.07)]">
      <div className="flex items-start gap-3">
        <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[20px] bg-black/[0.025] text-black/55">
          <User size={25} strokeWidth={1.8} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium text-black">
            {userItem.displayName}
          </h3>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-black/45">
            <Mail size={13} className="shrink-0" />
            <span className="truncate">{userItem.email}</span>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-black/45">
            <Store size={13} className="shrink-0" />
            <span className="truncate">Tienda: {userItem.storeId}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-black/[0.06] pt-3">
        <span
          className={`rounded-full px-3 py-1.5 text-[11px] font-normal ${getRoleClass(
            userItem.role
          )}`}
        >
          {getRoleLabel(userItem.role)}
        </span>

        <span
          className={`rounded-full px-3 py-1.5 text-[11px] font-normal ${getStatusClass(
            userItem.active
          )}`}
        >
          {userItem.active ? "Activo" : "Inactivo"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_1.05fr] gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white text-[13px] font-medium text-black transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
        >
          <UserCog size={15} />
          Editar
        </button>

        <button
          type="button"
          onClick={onToggle}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border text-[13px] font-medium transition ${
            userItem.active
              ? "border-red-100 bg-white text-red-600 hover:bg-red-50"
              : "border-emerald-100 bg-white text-emerald-600 hover:bg-emerald-50"
          }`}
        >
          {userItem.active ? (
            <>
              <UserX size={15} />
              Desactivar
            </>
          ) : (
            <>
              <UserCheck size={15} />
              Activar
            </>
          )}
        </button>
      </div>
    </article>
  );
}

function UserFormModal({
  editingUser,
  form,
  saving,
  closeForm,
  handleSubmit,
  updateForm,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-medium tracking-[-0.025em] text-red-600">
              {editingUser ? "Editar usuario" : "Nuevo usuario"}
            </h2>

            <p className="mt-1 text-[12px] text-black/45">
              {editingUser ? "Actualiza los datos del perfil" : "Crea un nuevo acceso al panel"}
            </p>
          </div>

          <button
            type="button"
            onClick={closeForm}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
          <div className="grid gap-3">
            <InputField
              label="Nombre completo"
              value={form.displayName}
              onChange={(value) => updateForm("displayName", value)}
              placeholder="Ej: Juan Pérez"
            />

            <InputField
              label="Correo electrónico"
              type="email"
              value={form.email}
              disabled={Boolean(editingUser)}
              onChange={(value) => updateForm("email", value)}
              placeholder="usuario@mastercaps.com"
              helper={
                editingUser ? "El correo no se edita desde este panel." : ""
              }
            />

            {!editingUser && (
              <InputField
                label="Contraseña temporal"
                type="password"
                value={form.password}
                onChange={(value) => updateForm("password", value)}
                placeholder="Mínimo 6 caracteres"
              />
            )}

            <label>
              <span className="text-[12px] font-normal text-black/55">
                Rol
              </span>

              <select
                value={form.role}
                onChange={(event) => updateForm("role", event.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="seller">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </label>

            <div className="rounded-2xl bg-black/[0.025] p-4">
              <div className="flex items-start gap-3">
                {form.role === "admin" ? (
                  <Shield size={20} className="mt-0.5 text-red-600" />
                ) : (
                  <CheckCircle2 size={20} className="mt-0.5 text-emerald-600" />
                )}

                <div>
                  <p className="text-[14px] font-medium text-black">
                    {form.role === "admin" ? "Administrador" : "Vendedor"}
                  </p>

                  <p className="mt-1 text-[13px] leading-5 text-black/50">
                    {form.role === "admin"
                      ? "Podrá entrar al panel y gestionar la operación completa."
                      : "Podrá registrar ventas y quedará asociado a las acciones que realice."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={closeForm}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-black/[0.08] text-[14px] font-medium text-black/70 transition hover:bg-black/[0.035]"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-red-600 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? "Guardando..."
                : editingUser
                  ? "Actualizar"
                  : "Crear usuario"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  helper = "",
}) {
  return (
    <label>
      <span className="text-[12px] font-normal text-black/55">{label}</span>

      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-10 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[13px] text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45"
        placeholder={placeholder}
      />

      {helper && <p className="mt-1 text-[11px] text-black/40">{helper}</p>}
    </label>
  );
}