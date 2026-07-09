export default function LoginPage() {
  return (
    <main className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
        <p className="text-sm font-medium text-brand-gold">Master Caps</p>
        <h1 className="mt-2 text-3xl font-semibold text-brand-black">
          Iniciar sesión
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Acceso administrativo al inventario.
        </p>

        <div className="mt-8 space-y-4">
          <input
            className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-brand-black"
            placeholder="Correo electrónico"
          />
          <input
            type="password"
            className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-brand-black"
            placeholder="Contraseña"
          />

          <button className="w-full rounded-2xl bg-brand-black px-4 py-3 text-sm font-semibold text-white hover:bg-black">
            Entrar
          </button>
        </div>
      </section>
    </main>
  );
}