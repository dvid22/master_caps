import { useCallback, useEffect, useMemo, useState } from "react";

const LEGACY_STORAGE_KEY = "master-caps-reservation-cart-v1";
const VISITOR_STORAGE_KEY = "master-caps-public-visitor-id-v1";
const SESSION_KEY_PREFIX = "master-caps-reservation-session-v2";
const CART_KEY_PREFIX = "master-caps-reservation-cart-v2";
const CART_EVENT = "master-caps-reservation-cart-change-v2";

function createId(prefix) {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${randomId}`;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeStoreId(value) {
  return String(value || "master-caps").trim() || "master-caps";
}

function getVisitorId() {
  if (typeof window === "undefined") return "server-visitor";

  let visitorId = window.localStorage.getItem(VISITOR_STORAGE_KEY);

  if (!visitorId) {
    visitorId = createId("visitor");
    window.localStorage.setItem(VISITOR_STORAGE_KEY, visitorId);
  }

  return visitorId;
}

function getSessionStorageKey(storeId) {
  return `${SESSION_KEY_PREFIX}:${safeStoreId(storeId)}`;
}

function getOrCreateSessionId(storeId) {
  if (typeof window === "undefined") return "server-session";

  const key = getSessionStorageKey(storeId);
  let sessionId = window.sessionStorage.getItem(key);

  if (!sessionId) {
    sessionId = createId("cart");
    window.sessionStorage.setItem(key, sessionId);
  }

  return sessionId;
}

function rotateSessionId(storeId) {
  if (typeof window === "undefined") return "server-session";

  const sessionId = createId("cart");
  window.sessionStorage.setItem(getSessionStorageKey(storeId), sessionId);

  return sessionId;
}

function getCartStorageKey(storeId, sessionId) {
  return `${CART_KEY_PREFIX}:${safeStoreId(storeId)}:${sessionId}`;
}

function normalizeItem(item, storeId) {
  const stock = Math.max(Math.trunc(safeNumber(item?.stock)), 0);
  const quantity = Math.min(
    Math.max(Math.trunc(safeNumber(item?.quantity, 1)), 1),
    stock || 1
  );

  const cleanStoreId = safeStoreId(storeId || item?.storeId);

  return {
    cartKey:
      item?.cartKey ||
      `${cleanStoreId}__${String(item?.productId || "")}__${String(
        item?.variantId || "legacy"
      )}`,
    storeId: cleanStoreId,
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

function removeLegacyCartOnce() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // No interrumpe el catálogo si el navegador bloquea almacenamiento.
  }
}

function readCart(storeId, sessionId) {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(
      getCartStorageKey(storeId, sessionId)
    );
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed
          .map((item) => normalizeItem(item, storeId))
          .filter((item) => item.productId)
      : [];
  } catch {
    return [];
  }
}

function writeCart(storeId, sessionId, items) {
  if (typeof window === "undefined") return;

  const normalized = items.map((item) => normalizeItem(item, storeId));
  const key = getCartStorageKey(storeId, sessionId);

  window.sessionStorage.setItem(key, JSON.stringify(normalized));

  window.dispatchEvent(
    new CustomEvent(CART_EVENT, {
      detail: {
        storeId: safeStoreId(storeId),
        sessionId,
        items: normalized,
      },
    })
  );
}

export function getReservationVisitorId() {
  return getVisitorId();
}

export function getReservationSessionId(storeId = "master-caps") {
  return getOrCreateSessionId(storeId);
}

export function getReservationCart(storeId = "master-caps") {
  const sessionId = getOrCreateSessionId(storeId);
  return readCart(storeId, sessionId);
}

export function clearReservationCart(storeId = "master-caps") {
  const sessionId = getOrCreateSessionId(storeId);
  writeCart(storeId, sessionId, []);
}

export function useReservationCart(storeId = "master-caps") {
  const cleanStoreId = safeStoreId(storeId);

  const [sessionId, setSessionId] = useState(() => {
    removeLegacyCartOnce();
    return getOrCreateSessionId(cleanStoreId);
  });

  const [visitorId] = useState(() => getVisitorId());

  const [items, setItems] = useState(() =>
    readCart(cleanStoreId, sessionId)
  );

  useEffect(() => {
    const sync = (event) => {
      const detail = event?.detail;

      if (
        detail &&
        (detail.storeId !== cleanStoreId ||
          detail.sessionId !== sessionId)
      ) {
        return;
      }

      setItems(readCart(cleanStoreId, sessionId));
    };

    window.addEventListener(CART_EVENT, sync);

    return () => {
      window.removeEventListener(CART_EVENT, sync);
    };
  }, [cleanStoreId, sessionId]);

  const commit = useCallback(
    (updater) => {
      const current = readCart(cleanStoreId, sessionId);
      const next =
        typeof updater === "function" ? updater(current) : updater;

      writeCart(cleanStoreId, sessionId, next);
    },
    [cleanStoreId, sessionId]
  );

  const addItem = useCallback(
    (rawItem) => {
      const incoming = normalizeItem(
        { ...rawItem, storeId: cleanStoreId },
        cleanStoreId
      );

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
    [cleanStoreId, commit]
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
      commit((current) =>
        current.filter((item) => item.cartKey !== cartKey)
      );
    },
    [commit]
  );

  const clear = useCallback(() => {
    writeCart(cleanStoreId, sessionId, []);
  }, [cleanStoreId, sessionId]);

  const finishSession = useCallback(() => {
    writeCart(cleanStoreId, sessionId, []);

    const nextSessionId = rotateSessionId(cleanStoreId);
    setSessionId(nextSessionId);
    setItems([]);
  }, [cleanStoreId, sessionId]);

  const startNewSession = useCallback(() => {
    const currentItems = readCart(cleanStoreId, sessionId);

    if (
      currentItems.length > 0 &&
      !window.confirm(
        "¿Deseas iniciar un carrito nuevo? Se eliminarán los productos actuales."
      )
    ) {
      return false;
    }

    writeCart(cleanStoreId, sessionId, []);

    const nextSessionId = rotateSessionId(cleanStoreId);
    setSessionId(nextSessionId);
    setItems([]);

    return true;
  }, [cleanStoreId, sessionId]);

  const summary = useMemo(() => {
    const totalItems = items.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    );

    const total = items.reduce(
      (sum, item) =>
        sum +
        Number(item.unitPrice || 0) * Number(item.quantity || 0),
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
    visitorId,
    sessionId,
    addItem,
    updateQuantity,
    removeItem,
    clear,
    finishSession,
    startNewSession,
  };
}