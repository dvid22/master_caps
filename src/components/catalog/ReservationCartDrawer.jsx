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
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Cerrar carrito"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col bg-white shadow-[0_0_80px_rgba(0,0,0,0.2)]">
        <header className="flex min-h-[106px] items-center justify-between border-b border-black/[0.08] px-5 sm:px-6">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-red-600">
              Tu selección
            </p>

            <div className="mt-1 flex items-center gap-3">
              <h2 className="text-[23px] font-medium uppercase tracking-[-0.045em]">
                Carrito de apartados
              </h2>

              {cart.summary.totalItems > 0 && (
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-black px-2 text-[9px] font-medium text-white">
                  {cart.summary.totalItems}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center border border-black/[0.1] transition hover:bg-black hover:text-white"
            aria-label="Cerrar carrito"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.18)_transparent]">
          {cart.items.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center border border-black/[0.08] bg-white px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/[0.035]">
                <ShoppingBag size={29} className="text-black/25" />
              </div>

              <p className="mt-5 text-[18px] font-medium uppercase tracking-[-0.03em]">
                Tu carrito está vacío
              </p>

              <p className="mt-3 max-w-[280px] text-[11px] leading-5 text-black/45">
                Selecciona una talla y agrega productos para apartarlos juntos.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-black/[0.08]">
              {cart.items.map((item) => (
                <article
                  key={item.cartKey}
                  className="py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex gap-4">
                    <div className="flex h-[116px] w-[92px] shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-black/[0.08]">
                      {item.coverUrl ? (
                        <img
                          src={item.coverUrl}
                          alt={item.productName}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain p-1.5"
                        />
                      ) : (
                        <ShoppingBag size={22} className="text-black/20" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="line-clamp-2 text-[11px] font-medium uppercase leading-5">
                            {item.productName}
                          </h3>

                          <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-black/42">
                            {item.productCode || "Sin código"} · Talla {item.size}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => cart.removeItem(item.cartKey)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center text-red-600 transition hover:bg-red-50"
                          aria-label={`Eliminar ${item.productName}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="mt-4 flex items-end justify-between gap-3">
                        <div className="grid grid-cols-[34px_42px_34px] border border-black/[0.12]">
                          <button
                            type="button"
                            disabled={item.quantity <= 1}
                            onClick={() =>
                              cart.updateQuantity(
                                item.cartKey,
                                item.quantity - 1
                              )
                            }
                            className="flex h-9 items-center justify-center border-r border-black/[0.12] transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Disminuir cantidad"
                          >
                            <Minus size={12} />
                          </button>

                          <span className="flex h-9 items-center justify-center text-[11px] font-medium">
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
                            className="flex h-9 items-center justify-center border-l border-black/[0.12] transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Aumentar cantidad"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <div className="text-right">
                          <p className="text-[9px] uppercase tracking-[0.08em] text-black/38">
                            Subtotal
                          </p>

                          <p className="mt-1 text-[14px] font-medium">
                            {formatCurrency(item.unitPrice * item.quantity)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-black/[0.08] bg-white px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-5 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[9px] uppercase tracking-[0.14em] text-black/40">
                Total · {cart.summary.totalItems} unidad(es)
              </p>

              <p className="mt-2 text-[30px] font-medium tracking-[-0.055em]">
                {formatCurrency(cart.summary.total)}
              </p>
            </div>

            {cart.items.length > 0 && (
              <button
                type="button"
                onClick={cart.clear}
                className="border-b border-red-600 pb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-red-600 transition hover:text-red-700"
              >
                Vaciar carrito
              </button>
            )}
          </div>

          {cart.items.length > 0 ? (
            <Link
              to={`/catalogo/${storeId}/checkout`}
              onClick={onClose}
              className="mt-5 inline-flex min-h-[58px] w-full items-center justify-center gap-3 bg-black px-5 py-4 text-center text-[10px] font-medium uppercase tracking-[0.17em] text-white transition hover:bg-red-600"
            >
              <ShoppingBag size={16} />
              Continuar con el apartado
            </Link>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="mt-5 min-h-[56px] w-full border border-black bg-white px-5 text-[10px] font-medium uppercase tracking-[0.16em] transition hover:bg-black hover:text-white"
            >
              Seguir explorando
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}