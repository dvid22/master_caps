import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

import { db, storage } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

import {
  getCustomerDocumentId,
  normalizeCustomerDocument,
  normalizeCustomerPhone,
} from "./customers.service";

export const SPECIAL_ORDER_COLLECTION = "specialOrders";

export const SPECIAL_ORDER_STATUS = Object.freeze({
  PENDING: "pending",
  ORDERED: "ordered",
  RECEIVED: "received",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
});

export const SPECIAL_ORDER_STATUS_VALUES = Object.values(
  SPECIAL_ORDER_STATUS
);

export const SPECIAL_ORDER_STATUS_LABELS = Object.freeze({
  pending: "Pendiente",
  ordered: "Pedido",
  received: "Recibido",
  delivered: "Entregado",
  cancelled: "Cancelado",
});

export const SPECIAL_ORDER_MAX_IMAGE_SIZE = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

function safeString(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return safeString(value)
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("es-CO");
}

function normalizeOptionalText(value) {
  return safeString(value).replace(/\s+/g, " ");
}

function normalizeQuantity(value) {
  const quantity = Math.trunc(Number(value || 0));
  return Number.isFinite(quantity) ? Math.max(quantity, 0) : 0;
}

function normalizeStatus(value) {
  const cleanStatus = safeString(value).toLowerCase();

  return SPECIAL_ORDER_STATUS_VALUES.includes(cleanStatus)
    ? cleanStatus
    : SPECIAL_ORDER_STATUS.PENDING;
}

function sanitizeStoreId(value) {
  return (
    safeString(value)
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "store"
  );
}

function sanitizeFileName(value) {
  const cleanName = safeString(value || "encargo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleanName || "encargo";
}

function getFileExtension(file) {
  const name = safeString(file?.name);
  const parts = name.split(".");

  if (parts.length > 1) {
    const ext = parts.pop().toLowerCase();
    return ext === "jpeg" ? "jpg" : ext;
  }

  const byType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  };

  return byType[file?.type] || "webp";
}

function validateImageFile(file) {
  if (!file) return null;

  if (!(file instanceof File) && !(file instanceof Blob)) {
    throw new Error("La imagen del encargo no es válida.");
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(
      "La foto del encargo debe ser JPG, PNG, WEBP o AVIF."
    );
  }

  if (Number(file.size || 0) > SPECIAL_ORDER_MAX_IMAGE_SIZE) {
    throw new Error("La foto del encargo no puede superar 8 MB.");
  }

  return file;
}

function getSpecialOrderCounterRef(storeId) {
  return doc(db, "counters", `special_orders_${storeId}`);
}

function formatSpecialOrderNumber(number) {
  return `ENC-${String(number).padStart(6, "0")}`;
}

async function getNextSpecialOrderNumber(transaction, storeId) {
  const counterRef = getSpecialOrderCounterRef(storeId);
  const counterSnapshot = await transaction.get(counterRef);
  const lastNumber = Number(counterSnapshot.data()?.lastNumber || 0);
  const nextNumber = lastNumber + 1;

  return {
    counterRef,
    number: nextNumber,
    orderNumber: formatSpecialOrderNumber(nextNumber),
  };
}

function getSpecialOrderImagePath({ storeId, orderId, file }) {
  const safeStoreId = sanitizeStoreId(storeId);
  const extension = getFileExtension(file);
  const baseName = sanitizeFileName(file?.name || `encargo-${orderId}`);

  return [
    "businesses",
    safeStoreId,
    "special-orders",
    orderId,
    `${Date.now()}-${baseName}.${extension}`,
  ].join("/");
}

function isOwnedSpecialOrderImagePath(path, storeId, orderId) {
  return safeString(path).startsWith(
    `businesses/${sanitizeStoreId(storeId)}/special-orders/${orderId}/`
  );
}

async function uploadSpecialOrderImage({ file, storeId, orderId }) {
  const validFile = validateImageFile(file);

  if (!validFile) {
    return {
      imageUrl: "",
      imagePath: "",
      imageName: "",
      imageType: "",
      imageSize: 0,
    };
  }

  const imagePath = getSpecialOrderImagePath({
    storeId,
    orderId,
    file: validFile,
  });

  const imageRef = storageRef(storage, imagePath);

  await uploadBytes(imageRef, validFile, {
    contentType: validFile.type,
    customMetadata: {
      storeId: safeString(storeId),
      specialOrderId: safeString(orderId),
      purpose: "special-order-reference",
    },
  });

  const imageUrl = await getDownloadURL(imageRef);

  return {
    imageUrl,
    imagePath,
    imageName: safeString(validFile.name),
    imageType: safeString(validFile.type),
    imageSize: Number(validFile.size || 0),
  };
}

async function safelyDeleteSpecialOrderImage({ path, storeId, orderId }) {
  if (!path || !isOwnedSpecialOrderImagePath(path, storeId, orderId)) {
    return false;
  }

  try {
    await deleteObject(storageRef(storage, path));
    return true;
  } catch (error) {
    if (error?.code === "storage/object-not-found") return true;

    console.error("No se pudo eliminar la imagen del encargo:", error);
    return false;
  }
}

function getTimestampMilliseconds(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const date = value?.toDate?.() || new Date(value);
  return Number.isNaN(date?.getTime?.()) ? 0 : date.getTime();
}

function mapSpecialOrderDocument(id, data = {}) {
  return {
    id,
    storeId: safeString(data.storeId),
    orderNumber: safeString(data.orderNumber),

    customerId: safeString(data.customerId),
    customerDocument: normalizeCustomerDocument(data.customerDocument),
    customerName: normalizeOptionalText(data.customerName),
    customerPhone: normalizeCustomerPhone(data.customerPhone),

    productId: safeString(data.productId),
    productName: normalizeOptionalText(data.productName),
    productCode: safeString(data.productCode),

    size: normalizeOptionalText(data.size),
    color: normalizeOptionalText(data.color),
    quantity: Math.max(normalizeQuantity(data.quantity), 1),
    notes: normalizeOptionalText(data.notes),

    imageUrl: safeString(data.imageUrl),
    imagePath: safeString(data.imagePath),
    imageName: safeString(data.imageName),
    imageType: safeString(data.imageType),
    imageSize: Number(data.imageSize || 0),

    status: normalizeStatus(data.status),

    requestedAt: data.requestedAt || data.createdAt || null,
    orderedAt: data.orderedAt || null,
    receivedAt: data.receivedAt || null,
    deliveredAt: data.deliveredAt || null,
    cancelledAt: data.cancelledAt || null,

    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,

    createdByUid: safeString(data.createdByUid),
    createdByName: safeString(data.createdByName),
    createdByEmail: safeString(data.createdByEmail),
    updatedByUid: safeString(data.updatedByUid),
    updatedByName: safeString(data.updatedByName),
    updatedByEmail: safeString(data.updatedByEmail),
  };
}

function mapSnapshot(snapshot) {
  return snapshot.docs
    .map((item) => mapSpecialOrderDocument(item.id, item.data()))
    .sort(
      (a, b) =>
        getTimestampMilliseconds(b.requestedAt || b.createdAt) -
        getTimestampMilliseconds(a.requestedAt || a.createdAt)
    );
}

function normalizeCustomerPayload({
  customerId = "",
  customerDocument = "",
  customerName = "",
  customerPhone = "",
  storeId,
}) {
  const cleanDocument = normalizeCustomerDocument(customerDocument);
  const cleanName = normalizeOptionalText(customerName);
  const cleanPhone = normalizeCustomerPhone(customerPhone);

  if (!cleanDocument) {
    throw new Error(
      "La cédula del cliente es obligatoria para crear un encargo."
    );
  }

  const expectedCustomerId = getCustomerDocumentId(cleanDocument, storeId);
  const cleanCustomerId = safeString(customerId);

  if (cleanCustomerId && cleanCustomerId !== expectedCustomerId) {
    throw new Error(
      "La cédula seleccionada no coincide con el cliente del encargo."
    );
  }

  return {
    customerId: expectedCustomerId,
    customerDocument: cleanDocument,
    customerName: cleanName,
    customerPhone: cleanPhone,
  };
}

function normalizeOrderPayload({
  productId = "",
  productName = "",
  productCode = "",
  size = "",
  color = "",
  quantity = 1,
  notes = "",
}) {
  const cleanProductName = normalizeName(productName);
  const cleanQuantity = normalizeQuantity(quantity);

  if (!cleanProductName) {
    throw new Error(
      "Escribe o selecciona el producto que desea el cliente."
    );
  }

  if (cleanQuantity <= 0) {
    throw new Error("La cantidad del encargo debe ser mayor a cero.");
  }

  return {
    productId: safeString(productId),
    productName: cleanProductName,
    productCode: safeString(productCode),
    size: normalizeName(size),
    color: normalizeName(color),
    quantity: cleanQuantity,
    notes: normalizeOptionalText(notes),
  };
}

export function subscribeSpecialOrders(callback, onError, storeId = STORE_ID) {
  const q = query(
    collection(db, SPECIAL_ORDER_COLLECTION),
    where("storeId", "==", storeId)
  );

  return onSnapshot(
    q,
    (snapshot) => callback(mapSnapshot(snapshot)),
    (error) => {
      console.error("Error escuchando encargos:", error);
      if (onError) onError(error);
    }
  );
}

export async function getSpecialOrders(storeId = STORE_ID) {
  const q = query(
    collection(db, SPECIAL_ORDER_COLLECTION),
    where("storeId", "==", storeId)
  );

  return mapSnapshot(await getDocs(q));
}

export async function getSpecialOrderById(specialOrderId) {
  const cleanId = safeString(specialOrderId);
  if (!cleanId) throw new Error("No se encontró el encargo.");

  const snapshot = await getDoc(
    doc(db, SPECIAL_ORDER_COLLECTION, cleanId)
  );

  if (!snapshot.exists()) return null;

  return mapSpecialOrderDocument(snapshot.id, snapshot.data());
}

export async function createSpecialOrder({
  customerId = "",
  customerDocument = "",
  customerName = "",
  customerPhone = "",
  productId = "",
  productName = "",
  productCode = "",
  size = "",
  color = "",
  quantity = 1,
  notes = "",
  imageFile = null,
  storeId = STORE_ID,
  actor = null,
}) {
  const cleanStoreId = safeString(storeId) || STORE_ID;

  const customer = normalizeCustomerPayload({
    customerId,
    customerDocument,
    customerName,
    customerPhone,
    storeId: cleanStoreId,
  });

  const order = normalizeOrderPayload({
    productId,
    productName,
    productCode,
    size,
    color,
    quantity,
    notes,
  });

  const specialOrderRef = doc(collection(db, SPECIAL_ORDER_COLLECTION));

  let uploadedImage = {
    imageUrl: "",
    imagePath: "",
    imageName: "",
    imageType: "",
    imageSize: 0,
  };

  if (imageFile) {
    uploadedImage = await uploadSpecialOrderImage({
      file: imageFile,
      storeId: cleanStoreId,
      orderId: specialOrderRef.id,
    });
  }

  try {
    return await runTransaction(db, async (transaction) => {
      const counter = await getNextSpecialOrderNumber(
        transaction,
        cleanStoreId
      );

      const customerRef = doc(db, "customers", customer.customerId);
      const customerSnapshot = await transaction.get(customerRef);

      let finalCustomerName = customer.customerName;
      let finalCustomerPhone = customer.customerPhone;
      let shouldCreateCustomer = false;

      if (customerSnapshot.exists()) {
        const existingCustomer = customerSnapshot.data();

        if (safeString(existingCustomer.storeId) !== cleanStoreId) {
          throw new Error(
            "El cliente encontrado no pertenece a esta tienda."
          );
        }

        finalCustomerName =
          normalizeOptionalText(existingCustomer.fullName) || finalCustomerName;
        finalCustomerPhone =
          normalizeCustomerPhone(existingCustomer.phone) || finalCustomerPhone;
      } else {
        if (!finalCustomerName) {
          throw new Error(
            "Este cliente no está registrado. Completa su nombre para crearlo con el encargo."
          );
        }

        shouldCreateCustomer = true;
      }

      if (shouldCreateCustomer) {
        transaction.set(customerRef, {
          storeId: cleanStoreId,
          documentNumber: customer.customerDocument,
          normalizedDocument: customer.customerDocument,
          firstName: "",
          lastName: "",
          fullName: finalCustomerName,
          phone: finalCustomerPhone,
          email: "",
          address: "",
          notes: "",
          isActive: true,
          createdByUid: actor?.uid || "",
          createdByName: actor?.name || "",
          createdByEmail: actor?.email || "",
          updatedByUid: actor?.uid || "",
          updatedByName: actor?.name || "",
          updatedByEmail: actor?.email || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(
        counter.counterRef,
        {
          storeId: cleanStoreId,
          lastNumber: counter.number,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      transaction.set(specialOrderRef, {
        storeId: cleanStoreId,
        orderNumber: counter.orderNumber,
        customerId: customer.customerId,
        customerDocument: customer.customerDocument,
        customerName: finalCustomerName,
        customerPhone: finalCustomerPhone,
        productId: order.productId,
        productName: order.productName,
        productCode: order.productCode,
        size: order.size,
        color: order.color,
        quantity: order.quantity,
        notes: order.notes,
        ...uploadedImage,
        status: SPECIAL_ORDER_STATUS.PENDING,
        requestedAt: serverTimestamp(),
        orderedAt: null,
        receivedAt: null,
        deliveredAt: null,
        cancelledAt: null,
        createdByUid: actor?.uid || "",
        createdByName: actor?.name || "",
        createdByEmail: actor?.email || "",
        updatedByUid: actor?.uid || "",
        updatedByName: actor?.name || "",
        updatedByEmail: actor?.email || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        id: specialOrderRef.id,
        orderNumber: counter.orderNumber,
        storeId: cleanStoreId,
        customerId: customer.customerId,
        customerDocument: customer.customerDocument,
        customerName: finalCustomerName,
        customerPhone: finalCustomerPhone,
        ...order,
        ...uploadedImage,
        status: SPECIAL_ORDER_STATUS.PENDING,
      };
    });
  } catch (error) {
    if (uploadedImage.imagePath) {
      await safelyDeleteSpecialOrderImage({
        path: uploadedImage.imagePath,
        storeId: cleanStoreId,
        orderId: specialOrderRef.id,
      });
    }

    throw error;
  }
}

export async function updateSpecialOrder(
  specialOrderId,
  updates = {},
  actor = null
) {
  const cleanId = safeString(specialOrderId);
  if (!cleanId) throw new Error("No se encontró el encargo.");

  const specialOrderRef = doc(db, SPECIAL_ORDER_COLLECTION, cleanId);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(specialOrderRef);
    if (!snapshot.exists()) throw new Error("El encargo no existe.");

    const current = snapshot.data();
    const currentStatus = normalizeStatus(current.status);

    if (currentStatus === SPECIAL_ORDER_STATUS.DELIVERED) {
      throw new Error("Un encargo entregado ya no puede editarse.");
    }

    if (currentStatus === SPECIAL_ORDER_STATUS.CANCELLED) {
      throw new Error("Un encargo cancelado ya no puede editarse.");
    }

    const payload = normalizeOrderPayload({
      productId:
        updates.productId !== undefined ? updates.productId : current.productId,
      productName:
        updates.productName !== undefined
          ? updates.productName
          : current.productName,
      productCode:
        updates.productCode !== undefined
          ? updates.productCode
          : current.productCode,
      size: updates.size !== undefined ? updates.size : current.size,
      color: updates.color !== undefined ? updates.color : current.color,
      quantity:
        updates.quantity !== undefined ? updates.quantity : current.quantity,
      notes: updates.notes !== undefined ? updates.notes : current.notes,
    });

    transaction.update(specialOrderRef, {
      ...payload,
      updatedByUid: actor?.uid || "",
      updatedByName: actor?.name || "",
      updatedByEmail: actor?.email || "",
      updatedAt: serverTimestamp(),
    });

    return { id: cleanId, ...payload };
  });
}

function getStatusTimestampField(status) {
  return {
    [SPECIAL_ORDER_STATUS.ORDERED]: "orderedAt",
    [SPECIAL_ORDER_STATUS.RECEIVED]: "receivedAt",
    [SPECIAL_ORDER_STATUS.DELIVERED]: "deliveredAt",
    [SPECIAL_ORDER_STATUS.CANCELLED]: "cancelledAt",
  }[status] || null;
}

function validateStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;

  const allowed = {
    pending: ["ordered", "received", "cancelled"],
    ordered: ["pending", "received", "cancelled"],
    received: ["ordered", "delivered", "cancelled"],
    delivered: [],
    cancelled: ["pending"],
  };

  if (!allowed[currentStatus]?.includes(nextStatus)) {
    throw new Error(
      `No puedes cambiar un encargo de ${
        SPECIAL_ORDER_STATUS_LABELS[currentStatus]
      } a ${SPECIAL_ORDER_STATUS_LABELS[nextStatus]}.`
    );
  }
}

export async function updateSpecialOrderStatus({
  specialOrderId,
  status,
  actor = null,
}) {
  const cleanId = safeString(specialOrderId);
  const nextStatus = normalizeStatus(status);

  if (!cleanId) throw new Error("No se encontró el encargo.");

  const specialOrderRef = doc(db, SPECIAL_ORDER_COLLECTION, cleanId);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(specialOrderRef);
    if (!snapshot.exists()) throw new Error("El encargo no existe.");

    const current = snapshot.data();
    const currentStatus = normalizeStatus(current.status);

    validateStatusTransition(currentStatus, nextStatus);

    const payload = {
      status: nextStatus,
      updatedByUid: actor?.uid || "",
      updatedByName: actor?.name || "",
      updatedByEmail: actor?.email || "",
      updatedAt: serverTimestamp(),
    };

    const timestampField = getStatusTimestampField(nextStatus);
    if (timestampField) payload[timestampField] = serverTimestamp();

    if (currentStatus === "cancelled" && nextStatus === "pending") {
      payload.cancelledAt = null;
    }

    if (currentStatus === "ordered" && nextStatus === "pending") {
      payload.orderedAt = null;
    }

    transaction.update(specialOrderRef, payload);

    return {
      id: cleanId,
      previousStatus: currentStatus,
      status: nextStatus,
    };
  });
}

export async function replaceSpecialOrderImage({
  specialOrderId,
  imageFile,
  actor = null,
}) {
  const cleanId = safeString(specialOrderId);
  if (!cleanId) throw new Error("No se encontró el encargo.");

  validateImageFile(imageFile);

  const specialOrderRef = doc(db, SPECIAL_ORDER_COLLECTION, cleanId);
  const snapshot = await getDoc(specialOrderRef);

  if (!snapshot.exists()) throw new Error("El encargo no existe.");

  const current = snapshot.data();
  const storeId = safeString(current.storeId) || STORE_ID;
  const previousPath = safeString(current.imagePath);

  const uploadedImage = await uploadSpecialOrderImage({
    file: imageFile,
    storeId,
    orderId: cleanId,
  });

  try {
    await runTransaction(db, async (transaction) => {
      const fresh = await transaction.get(specialOrderRef);
      if (!fresh.exists()) throw new Error("El encargo ya no existe.");

      transaction.update(specialOrderRef, {
        ...uploadedImage,
        updatedByUid: actor?.uid || "",
        updatedByName: actor?.name || "",
        updatedByEmail: actor?.email || "",
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    await safelyDeleteSpecialOrderImage({
      path: uploadedImage.imagePath,
      storeId,
      orderId: cleanId,
    });
    throw error;
  }

  if (previousPath) {
    await safelyDeleteSpecialOrderImage({
      path: previousPath,
      storeId,
      orderId: cleanId,
    });
  }

  return { id: cleanId, ...uploadedImage };
}

export async function removeSpecialOrderImage({
  specialOrderId,
  actor = null,
}) {
  const cleanId = safeString(specialOrderId);
  if (!cleanId) throw new Error("No se encontró el encargo.");

  const specialOrderRef = doc(db, SPECIAL_ORDER_COLLECTION, cleanId);
  const snapshot = await getDoc(specialOrderRef);

  if (!snapshot.exists()) throw new Error("El encargo no existe.");

  const current = snapshot.data();
  const storeId = safeString(current.storeId) || STORE_ID;
  const previousPath = safeString(current.imagePath);

  await runTransaction(db, async (transaction) => {
    const fresh = await transaction.get(specialOrderRef);
    if (!fresh.exists()) throw new Error("El encargo ya no existe.");

    transaction.update(specialOrderRef, {
      imageUrl: "",
      imagePath: "",
      imageName: "",
      imageType: "",
      imageSize: 0,
      updatedByUid: actor?.uid || "",
      updatedByName: actor?.name || "",
      updatedByEmail: actor?.email || "",
      updatedAt: serverTimestamp(),
    });
  });

  if (previousPath) {
    await safelyDeleteSpecialOrderImage({
      path: previousPath,
      storeId,
      orderId: cleanId,
    });
  }

  return true;
}

export function buildSpecialOrdersPurchaseSummary(specialOrders = []) {
  const activeOrders = specialOrders.filter((order) =>
    [SPECIAL_ORDER_STATUS.PENDING, SPECIAL_ORDER_STATUS.ORDERED].includes(
      normalizeStatus(order.status)
    )
  );

  const grouped = new Map();

  activeOrders.forEach((order) => {
    const productId = safeString(order.productId);
    const productName = normalizeName(order.productName);
    const size = normalizeName(order.size);
    const color = normalizeName(order.color);

    const key = [
      productId || productName,
      size || "SIN-TALLA",
      color || "SIN-COLOR",
    ].join("__");

    const existing = grouped.get(key) || {
      key,
      productId,
      productName,
      size,
      color,
      totalQuantity: 0,
      customerCount: 0,
      customers: [],
      orderIds: [],
      orderNumbers: [],
    };

    existing.totalQuantity += Math.max(normalizeQuantity(order.quantity), 1);
    existing.orderIds.push(order.id);

    if (order.orderNumber) existing.orderNumbers.push(order.orderNumber);

    if (
      order.customerId &&
      !existing.customers.some(
        (customer) => customer.customerId === order.customerId
      )
    ) {
      existing.customers.push({
        customerId: order.customerId,
        customerName: order.customerName,
        customerDocument: order.customerDocument,
        customerPhone: order.customerPhone,
      });
    }

    existing.customerCount = existing.customers.length;
    grouped.set(key, existing);
  });

  return Array.from(grouped.values()).sort((a, b) => {
    if (b.totalQuantity !== a.totalQuantity) {
      return b.totalQuantity - a.totalQuantity;
    }

    return a.productName.localeCompare(b.productName, "es");
  });
}