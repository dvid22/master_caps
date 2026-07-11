import { Link } from "react-router-dom";
import {
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";

import { formatCurrency } from "../../utils/money";

export default function ReservationCartDrawer({
  open,
  onClose,
  storeId,
  cart,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-sm">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Cerrar carrito"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[430px] flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <ShoppingBag size={20} />

              {cart.summary.totalItems > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-medium text-white">
                  {cart.summary.totalItems}
                </span>
              )}
            </div>

            <div>
              <p className="text-[11px] font-medium text-red-600">
                Tu selección
              </p>
              <h2 className="text-[20px] font-medium tracking-[-0.04em]">
                Carrito de apartados
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.18)_transparent]">
          {cart.items.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[26px] bg-black/[0.025] px-6 text-center">
              <ShoppingBag size={38} className="text-black/20" />
              <p className="mt-4 text-[16px] font-medium">
                Tu carrito está vacío
              </p>
              <p className="mt-2 text-[12px] leading-5 text-black/45">
                Selecciona una talla y agrega productos para apartarlos juntos.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.items.map((item) => (
                <article
                  key={item.cartKey}
                  className="rounded-[22px] border border-black/[0.06] bg-white p-3"
                >
                  <div className="flex gap-3">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-black/[0.025]">
                      {item.coverUrl ? (
                        <img
                          src={item.coverUrl}
                          alt={item.productName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ShoppingBag size={22} className="text-black/20" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="line-clamp-2 text-[13px] font-medium">
                            {item.productName}
                          </h3>
                          <p className="mt-1 text-[10px] text-black/45">
                            {item.productCode || "Sin código"} · Talla {item.size}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => cart.removeItem(item.cartKey)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={item.quantity <= 1}
                            onClick={() =>
                              cart.updateQuantity(
                                item.cartKey,
                                item.quantity - 1
                              )
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.08] disabled:opacity-30"
                          >
                            <Minus size={13} />
                          </button>

                          <span className="flex h-8 min-w-9 items-center justify-center rounded-xl bg-black/[0.025] px-2 text-[12px] font-medium">
                            {item.quantity}
                          </span>

                          <button
                            type="button"
                            disabled={item.quantity >= item.stock}
                            onClick={() =>
                              cart.updateQuantity(
                                item.cartKey,
                                item.quantity + 1
                              )
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.08] disabled:opacity-30"
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        <p className="text-[14px] font-medium">
                          {formatCurrency(item.unitPrice * item.quantity)}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-black/[0.06] bg-white px-5 py-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] text-black/40">
                {cart.summary.totalItems} unidad(es)
              </p>
              <p className="mt-1 text-[26px] font-medium tracking-[-0.05em]">
                {formatCurrency(cart.summary.total)}
              </p>
            </div>

            {cart.items.length > 0 && (
              <button
                type="button"
                onClick={cart.clear}
                className="rounded-xl px-3 py-2 text-[11px] text-red-600 hover:bg-red-50"
              >
                Vaciar
              </button>
            )}
          </div>

          {cart.items.length > 0 ? (
            <Link
              to={`/catalogo/${storeId}/checkout`}
              onClick={onClose}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[14px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
            >
              Continuar con el apartado
            </Link>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-12 w-full rounded-2xl border border-black/[0.08] text-[13px] font-medium"
            >
              Seguir explorando
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}