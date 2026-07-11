import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "master-caps-reservation-cart-v1";
const CART_EVENT = "master-caps-reservation-cart-change";

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeItem(item) {
  const stock = Math.max(Math.trunc(safeNumber(item?.stock)), 0);
  const quantity = Math.min(
    Math.max(Math.trunc(safeNumber(item?.quantity, 1)), 1),
    stock || 1
  );

  return {
    cartKey:
      item?.cartKey ||
      `${String(item?.storeId || "master-caps")}__${String(
        item?.productId || ""
      )}__${String(item?.variantId || "legacy")}`,
    storeId: String(item?.storeId || "master-caps"),
    productId: String(item?.productId || ""),
    productName: String(item?.productName || "Producto"),
    productCode: String(item?.productCode || ""),
    categoryName: String(item?.categoryName || ""),
    variantId: String(item?.variantId || "legacy"),
    size: String(item?.size || "Talla única"),
    quantity,
    stock,
    unitPrice: Math.max(safeNumber(item?.unitPrice), 0),
    coverUrl: String(item?.coverUrl || ""),
  };
}

function readCart() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.map(normalizeItem).filter((item) => item.productId)
      : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  if (typeof window === "undefined") return;

  const normalized = items.map(normalizeItem);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: normalized }));
}

export function getReservationCart() {
  return readCart();
}

export function clearReservationCart() {
  writeCart([]);
}

export function useReservationCart(storeId = "master-caps") {
  const [items, setItems] = useState(() =>
    readCart().filter((item) => item.storeId === storeId)
  );

  useEffect(() => {
    const sync = () => {
      setItems(readCart().filter((item) => item.storeId === storeId));
    };

    window.addEventListener(CART_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [storeId]);

  const commit = useCallback(
    (updater) => {
      const allItems = readCart();
      const storeItems = allItems.filter((item) => item.storeId === storeId);
      const otherStoreItems = allItems.filter((item) => item.storeId !== storeId);
      const nextStoreItems =
        typeof updater === "function" ? updater(storeItems) : updater;

      writeCart([...otherStoreItems, ...nextStoreItems]);
    },
    [storeId]
  );

  const addItem = useCallback(
    (rawItem) => {
      const incoming = normalizeItem({ ...rawItem, storeId });

      if (!incoming.productId || !incoming.variantId) {
        throw new Error("El producto o la variante no son válidos.");
      }

      if (incoming.stock <= 0) {
        throw new Error("La talla seleccionada no tiene stock.");
      }

      commit((current) => {
        const existing = current.find(
          (item) => item.cartKey === incoming.cartKey
        );

        if (!existing) {
          return [...current, incoming];
        }

        const nextQuantity = Math.min(
          existing.quantity + incoming.quantity,
          incoming.stock
        );

        return current.map((item) =>
          item.cartKey === incoming.cartKey
            ? {
                ...item,
                ...incoming,
                quantity: nextQuantity,
              }
            : item
        );
      });

      return incoming;
    },
    [commit, storeId]
  );

  const updateQuantity = useCallback(
    (cartKey, nextQuantity) => {
      commit((current) =>
        current.map((item) => {
          if (item.cartKey !== cartKey) return item;

          const quantity = Math.min(
            Math.max(Math.trunc(safeNumber(nextQuantity, 1)), 1),
            Math.max(item.stock, 1)
          );

          return { ...item, quantity };
        })
      );
    },
    [commit]
  );

  const removeItem = useCallback(
    (cartKey) => {
      commit((current) => current.filter((item) => item.cartKey !== cartKey));
    },
    [commit]
  );

  const clear = useCallback(() => commit([]), [commit]);

  const summary = useMemo(() => {
    const totalItems = items.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    );

    const total = items.reduce(
      (sum, item) =>
        sum + Number(item.unitPrice || 0) * Number(item.quantity || 0),
      0
    );

    return {
      totalItems,
      uniqueItems: items.length,
      total,
    };
  }, [items]);

  return {
    items,
    summary,
    addItem,
    updateQuantity,
    removeItem,
    clear,
  };
}