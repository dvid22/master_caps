import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { STORE_ID } from "./categories.service";

/* -------------------------------------------------------------------------- */
/*                                CONSTANTES                                   */
/* -------------------------------------------------------------------------- */

const CUSTOMERS_COLLECTION = "customers";

/* -------------------------------------------------------------------------- */
/*                                UTILIDADES                                   */
/* -------------------------------------------------------------------------- */

function cleanText(value) {
  return String(value || "").trim();
}

export function normalizeCustomerDocument(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeCustomerPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeCustomerSearch(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitizeStoreId(storeId) {
  return cleanText(storeId)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-");
}

export function getCustomerDocumentId(
  documentNumber,
  storeId = STORE_ID
) {
  const normalizedDocument =
    normalizeCustomerDocument(documentNumber);

  if (!normalizedDocument) {
    throw new Error(
      "La cédula del cliente es obligatoria."
    );
  }

  return `${sanitizeStoreId(
    storeId
  )}__${normalizedDocument}`;
}

function buildFullName({
  firstName = "",
  lastName = "",
  fullName = "",
}) {
  const cleanFullName = cleanText(fullName);

  if (cleanFullName) {
    return cleanFullName;
  }

  return [firstName, lastName]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function normalizeCustomerData(
  customer = {}
) {
  const documentNumber =
    normalizeCustomerDocument(
      customer.documentNumber ||
        customer.customerDocument
    );

  const phone =
    normalizeCustomerPhone(
      customer.phone ||
        customer.customerPhone
    );

  const firstName = cleanText(
    customer.firstName
  );

  const lastName = cleanText(
    customer.lastName
  );

  const fullName = buildFullName({
    firstName,
    lastName,
    fullName:
      customer.fullName ||
      customer.customerName,
  });

  return {
    ...customer,

    documentNumber,
    normalizedDocument:
      documentNumber,

    firstName,
    lastName,
    fullName,

    phone,
    email: cleanText(customer.email),
    address: cleanText(
      customer.address
    ),
    notes: cleanText(customer.notes),

    isActive:
      customer.isActive !== false,
  };
}

function mapCustomersSnapshot(
  snapshot
) {
  return snapshot.docs
    .map((docItem) =>
      normalizeCustomerData({
        id: docItem.id,
        ...docItem.data(),
      })
    )
    .sort((a, b) =>
      String(a.fullName).localeCompare(
        String(b.fullName),
        "es-CO"
      )
    );
}

/* -------------------------------------------------------------------------- */
/*                              SUSCRIPCIONES                                  */
/* -------------------------------------------------------------------------- */

export function subscribeCustomers(
  callback,
  onError,
  storeId = STORE_ID
) {
  const customersRef = collection(
    db,
    CUSTOMERS_COLLECTION
  );

  const customersQuery = query(
    customersRef,
    where("storeId", "==", storeId)
  );

  return onSnapshot(
    customersQuery,
    (snapshot) => {
      callback(
        mapCustomersSnapshot(snapshot)
      );
    },
    (error) => {
      console.error(
        "Error escuchando clientes:",
        error
      );

      if (onError) {
        onError(error);
      }
    }
  );
}

export async function getCustomers(
  storeId = STORE_ID
) {
  const customersRef = collection(
    db,
    CUSTOMERS_COLLECTION
  );

  const customersQuery = query(
    customersRef,
    where("storeId", "==", storeId)
  );

  const snapshot = await getDocs(
    customersQuery
  );

  return mapCustomersSnapshot(
    snapshot
  );
}

/* -------------------------------------------------------------------------- */
/*                              CONSULTAS                                      */
/* -------------------------------------------------------------------------- */

export async function getCustomerByDocument(
  documentNumber,
  storeId = STORE_ID
) {
  const customerId =
    getCustomerDocumentId(
      documentNumber,
      storeId
    );

  const customerRef = doc(
    db,
    CUSTOMERS_COLLECTION,
    customerId
  );

  const snapshot = await getDoc(
    customerRef
  );

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeCustomerData({
    id: snapshot.id,
    ...snapshot.data(),
  });
}

export async function getCustomerById(
  customerId
) {
  const cleanCustomerId =
    cleanText(customerId);

  if (!cleanCustomerId) {
    throw new Error(
      "No se encontró el cliente."
    );
  }

  const customerRef = doc(
    db,
    CUSTOMERS_COLLECTION,
    cleanCustomerId
  );

  const snapshot = await getDoc(
    customerRef
  );

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeCustomerData({
    id: snapshot.id,
    ...snapshot.data(),
  });
}

/* -------------------------------------------------------------------------- */
/*                              CREAR CLIENTE                                  */
/* -------------------------------------------------------------------------- */

export async function createCustomer({
  documentNumber,
  firstName = "",
  lastName = "",
  fullName = "",
  phone = "",
  email = "",
  address = "",
  notes = "",
  isActive = true,
  storeId = STORE_ID,
  actor = null,
}) {
  const normalizedDocument =
    normalizeCustomerDocument(
      documentNumber
    );

  const cleanFullName =
    buildFullName({
      firstName,
      lastName,
      fullName,
    });

  if (!normalizedDocument) {
    throw new Error(
      "La cédula del cliente es obligatoria."
    );
  }

  if (!cleanFullName) {
    throw new Error(
      "El nombre del cliente es obligatorio."
    );
  }

  const customerId =
    getCustomerDocumentId(
      normalizedDocument,
      storeId
    );

  const customerRef = doc(
    db,
    CUSTOMERS_COLLECTION,
    customerId
  );

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          customerRef
        );

      if (snapshot.exists()) {
        throw new Error(
          "Ya existe un cliente registrado con esta cédula."
        );
      }

      transaction.set(
        customerRef,
        {
          storeId,

          documentNumber:
            normalizedDocument,
          normalizedDocument,

          firstName:
            cleanText(firstName),
          lastName:
            cleanText(lastName),
          fullName: cleanFullName,

          phone:
            normalizeCustomerPhone(
              phone
            ),
          email: cleanText(email),
          address:
            cleanText(address),
          notes: cleanText(notes),

          isActive:
            isActive !== false,

          createdByUid:
            actor?.uid || "",
          createdByName:
            actor?.name || "",
          createdByEmail:
            actor?.email || "",

          updatedByUid:
            actor?.uid || "",
          updatedByName:
            actor?.name || "",
          updatedByEmail:
            actor?.email || "",

          createdAt:
            serverTimestamp(),
          updatedAt:
            serverTimestamp(),
        }
      );
    }
  );

  return {
    id: customerId,
    storeId,

    documentNumber:
      normalizedDocument,
    normalizedDocument,

    firstName:
      cleanText(firstName),
    lastName:
      cleanText(lastName),
    fullName: cleanFullName,

    phone:
      normalizeCustomerPhone(phone),
    email: cleanText(email),
    address: cleanText(address),
    notes: cleanText(notes),

    isActive:
      isActive !== false,
  };
}

/* -------------------------------------------------------------------------- */
/*                            ACTUALIZAR CLIENTE                               */
/* -------------------------------------------------------------------------- */

export async function updateCustomer(
  customerId,
  updates = {},
  actor = null
) {
  const cleanCustomerId =
    cleanText(customerId);

  if (!cleanCustomerId) {
    throw new Error(
      "No se encontró el cliente."
    );
  }

  const currentCustomer =
    await getCustomerById(
      cleanCustomerId
    );

  if (!currentCustomer) {
    throw new Error(
      "El cliente no existe."
    );
  }

  const nextFirstName =
    updates.firstName !== undefined
      ? cleanText(
          updates.firstName
        )
      : currentCustomer.firstName;

  const nextLastName =
    updates.lastName !== undefined
      ? cleanText(
          updates.lastName
        )
      : currentCustomer.lastName;

  const nextFullName =
    updates.fullName !== undefined
      ? buildFullName({
          firstName:
            nextFirstName,
          lastName:
            nextLastName,
          fullName:
            updates.fullName,
        })
      : buildFullName({
          firstName:
            nextFirstName,
          lastName:
            nextLastName,
          fullName:
            currentCustomer.fullName,
        });

  if (!nextFullName) {
    throw new Error(
      "El nombre del cliente es obligatorio."
    );
  }

  const customerRef = doc(
    db,
    CUSTOMERS_COLLECTION,
    cleanCustomerId
  );

  const payload = {
    firstName: nextFirstName,
    lastName: nextLastName,
    fullName: nextFullName,

    phone:
      updates.phone !== undefined
        ? normalizeCustomerPhone(
            updates.phone
          )
        : currentCustomer.phone,

    email:
      updates.email !== undefined
        ? cleanText(
            updates.email
          )
        : currentCustomer.email,

    address:
      updates.address !== undefined
        ? cleanText(
            updates.address
          )
        : currentCustomer.address,

    notes:
      updates.notes !== undefined
        ? cleanText(
            updates.notes
          )
        : currentCustomer.notes,

    isActive:
      updates.isActive !== undefined
        ? Boolean(
            updates.isActive
          )
        : currentCustomer.isActive,

    updatedByUid:
      actor?.uid || "",
    updatedByName:
      actor?.name || "",
    updatedByEmail:
      actor?.email || "",

    updatedAt:
      serverTimestamp(),
  };

  await updateDoc(
    customerRef,
    payload
  );

  return {
    ...currentCustomer,
    ...payload,
    id: cleanCustomerId,
  };
}

/* -------------------------------------------------------------------------- */
/*                        MÉTRICAS DESDE LAS VENTAS                            */
/* -------------------------------------------------------------------------- */

export function buildCustomerSalesMetrics(
  customers,
  sales
) {
  const safeCustomers =
    Array.isArray(customers)
      ? customers
      : [];

  const safeSales =
    Array.isArray(sales)
      ? sales
      : [];

  const metricsByCustomerId =
    new Map();

  safeCustomers.forEach(
    (customer) => {
      metricsByCustomerId.set(
        customer.id,
        {
          customerId:
            customer.id,
          purchases: 0,
          totalSpent: 0,
          lastPurchaseAt: null,
          productQuantities:
            new Map(),
        }
      );
    }
  );

  const customerByDocument =
    new Map(
      safeCustomers.map(
        (customer) => [
          normalizeCustomerDocument(
            customer.documentNumber
          ),
          customer,
        ]
      )
    );

  safeSales.forEach((sale) => {
    const saleCustomerId =
      cleanText(
        sale.customerId
      );

    const saleDocument =
      normalizeCustomerDocument(
        sale.customerDocument
      );

    const customer =
      safeCustomers.find(
        (item) =>
          item.id ===
          saleCustomerId
      ) ||
      customerByDocument.get(
        saleDocument
      );

    if (!customer) {
      return;
    }

    const metrics =
      metricsByCustomerId.get(
        customer.id
      );

    if (!metrics) {
      return;
    }

    metrics.purchases += 1;
    metrics.totalSpent += Number(
      sale.total || 0
    );

    const createdAt =
      sale.createdAt || null;

    const createdAtMillis =
      createdAt?.toMillis?.() ||
      Number(
        createdAt?.seconds || 0
      ) * 1000 ||
      0;

    const previousMillis =
      metrics.lastPurchaseAt
        ?.toMillis?.() ||
      Number(
        metrics.lastPurchaseAt
          ?.seconds || 0
      ) * 1000 ||
      0;

    if (
      createdAtMillis >
      previousMillis
    ) {
      metrics.lastPurchaseAt =
        createdAt;
    }

    const items =
      Array.isArray(sale.items)
        ? sale.items
        : [];

    items.forEach((item) => {
      const productId =
        cleanText(
          item.productId
        );

      if (!productId) {
        return;
      }

      const current =
        metrics.productQuantities.get(
          productId
        ) || {
          productId,
          productName:
            cleanText(
              item.productName
            ),
          quantity: 0,
        };

      current.quantity += Number(
        item.quantity || 0
      );

      if (
        !current.productName &&
        item.productName
      ) {
        current.productName =
          cleanText(
            item.productName
          );
      }

      metrics.productQuantities.set(
        productId,
        current
      );
    });
  });

  return safeCustomers.map(
    (customer) => {
      const metrics =
        metricsByCustomerId.get(
          customer.id
        ) || {
          purchases: 0,
          totalSpent: 0,
          lastPurchaseAt: null,
          productQuantities:
            new Map(),
        };

      const favoriteProducts =
        Array.from(
          metrics.productQuantities.values()
        )
          .sort(
            (a, b) =>
              b.quantity -
              a.quantity
          )
          .slice(0, 5);

      return {
        ...customer,
        purchases:
          metrics.purchases,
        totalSpent:
          metrics.totalSpent,
        averageTicket:
          metrics.purchases > 0
            ? metrics.totalSpent /
              metrics.purchases
            : 0,
        lastPurchaseAt:
          metrics.lastPurchaseAt,
        favoriteProducts,
      };
    }
  );
}