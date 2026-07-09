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
    admin: "bg-black text-white",
    seller: "bg-blue-100 text-blue-700",
  };

  return classes[role] || "bg-gray-100 text-gray-700";
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
    <main className="min-h-screen bg-brand-cream px-4 py-6 sm:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-black/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-gold">Master Caps</p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-brand-black">
              Usuarios
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Crea administradores y vendedores. Cada producto y venta quedará
              asociado al usuario que hizo la acción.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white hover:bg-black"
          >
            <Plus size={18} />
            Nuevo usuario
          </button>
        </div>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Usuarios activos</p>
            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {totals.active}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Vendedores</p>
            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {totals.sellers}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-sm text-gray-500">Administradores</p>
            <p className="mt-2 text-2xl font-semibold text-brand-black">
              {totals.admins}
            </p>
          </div>

          <div className="rounded-3xl bg-black p-5 text-white shadow-sm">
            <p className="text-sm text-white/60">Total registrados</p>
            <p className="mt-2 text-2xl font-semibold">
              {totals.total}
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:grid-cols-[1fr_180px_180px]">
          <label className="relative block">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-12 w-full rounded-2xl border border-black/10 bg-white pl-11 pr-4 text-sm outline-none focus:border-brand-black"
              placeholder="Buscar por nombre, correo o rol..."
            />
          </label>

          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
          >
            <option value="all">Todos los roles</option>
            <option value="admin">Administradores</option>
            <option value="seller">Vendedores</option>
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
          >
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </section>

        <section className="mt-6">
          {loading ? (
            <div className="rounded-3xl bg-white p-10 text-center text-sm text-gray-500">
              Cargando usuarios en tiempo real...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center">
              <UserCog size={38} className="mx-auto text-gray-400" />

              <h2 className="mt-4 text-xl font-semibold text-brand-black">
                No hay usuarios
              </h2>

              <p className="mt-2 text-sm text-gray-500">
                Crea el primer vendedor o administrador.
              </p>

              <button
                type="button"
                onClick={openCreateForm}
                className="mt-5 rounded-2xl bg-brand-black px-5 py-3 text-sm font-semibold text-white"
              >
                Crear usuario
              </button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredUsers.map((userItem) => (
                <article
                  key={userItem.id}
                  className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-cream text-brand-black">
                        <User size={24} />
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-brand-black">
                            {userItem.displayName}
                          </h3>

                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${getRoleClass(
                              userItem.role
                            )}`}
                          >
                            {getRoleLabel(userItem.role)}
                          </span>

                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              userItem.active
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {userItem.active ? "Activo" : "Inactivo"}
                          </span>
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                          <Mail size={15} />
                          {userItem.email}
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                          <Store size={14} />
                          Tienda: {userItem.storeId}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 sm:flex-col">
                      <button
                        type="button"
                        onClick={() => openEditForm(userItem)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black/10 px-4 py-3 text-sm font-semibold text-brand-black hover:border-brand-black"
                      >
                        <UserCog size={16} />
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleActive(userItem)}
                        className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
                          userItem.active
                            ? "border border-red-200 text-red-600 hover:bg-red-50"
                            : "border border-green-200 text-green-700 hover:bg-green-50"
                        }`}
                      >
                        {userItem.active ? (
                          <>
                            <UserX size={16} />
                            Desactivar
                          </>
                        ) : (
                          <>
                            <UserCheck size={16} />
                            Activar
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="w-full max-w-xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                  {editingUser ? "Editar usuario" : "Nuevo usuario"}
                </p>

                <h2 className="text-xl font-semibold text-brand-black">
                  {editingUser ? "Actualizar perfil" : "Crear acceso"}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="rounded-full p-2 hover:bg-gray-100"
              >
                <X size={22} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid gap-4">
                <label>
                  <span className="text-sm font-medium text-brand-black">
                    Nombre completo
                  </span>

                  <input
                    value={form.displayName}
                    onChange={(event) =>
                      updateForm("displayName", event.target.value)
                    }
                    className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                    placeholder="Ej: Juan Pérez"
                  />
                </label>

                <label>
                  <span className="text-sm font-medium text-brand-black">
                    Correo electrónico
                  </span>

                  <input
                    type="email"
                    value={form.email}
                    disabled={Boolean(editingUser)}
                    onChange={(event) =>
                      updateForm("email", event.target.value)
                    }
                    className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black disabled:bg-gray-100 disabled:text-gray-500"
                    placeholder="usuario@mastercaps.com"
                  />

                  {editingUser && (
                    <p className="mt-1 text-xs text-gray-500">
                      El correo no se edita desde este panel.
                    </p>
                  )}
                </label>

                {!editingUser && (
                  <label>
                    <span className="text-sm font-medium text-brand-black">
                      Contraseña temporal
                    </span>

                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) =>
                        updateForm("password", event.target.value)
                      }
                      className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm outline-none focus:border-brand-black"
                      placeholder="Mínimo 6 caracteres"
                    />
                  </label>
                )}

                <label>
                  <span className="text-sm font-medium text-brand-black">
                    Rol
                  </span>

                  <select
                    value={form.role}
                    onChange={(event) =>
                      updateForm("role", event.target.value)
                    }
                    className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm outline-none focus:border-brand-black"
                  >
                    <option value="seller">Vendedor</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>

                <div className="rounded-3xl bg-brand-cream p-4">
                  <div className="flex items-start gap-3">
                    {form.role === "admin" ? (
                      <Shield
                        size={22}
                        className="mt-0.5 text-brand-black"
                      />
                    ) : (
                      <CheckCircle2
                        size={22}
                        className="mt-0.5 text-brand-black"
                      />
                    )}

                    <div>
                      <p className="text-sm font-semibold text-brand-black">
                        {form.role === "admin"
                          ? "Administrador"
                          : "Vendedor"}
                      </p>

                      <p className="mt-1 text-sm leading-6 text-gray-600">
                        {form.role === "admin"
                          ? "Podrá entrar al panel y gestionar la operación completa."
                          : "Podrá registrar ventas y quedará asociado a las acciones que realice."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-2xl border border-black/10 px-5 py-3 text-sm font-semibold text-brand-black hover:border-brand-black"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-2xl bg-brand-black px-6 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Guardando..."
                    : editingUser
                      ? "Actualizar usuario"
                      : "Crear usuario"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}