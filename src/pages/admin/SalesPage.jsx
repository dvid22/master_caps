import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgePercent,
  Barcode,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Minus,
  PackagePlus,
  PackageSearch,
  Plus,
  Printer,
  ReceiptText,
  ScanLine,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  User,
  X,
} from "lucide-react";

import {
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";

import {
  getProductCoverImage,
  getProductPromotionStock,
  getPromotionStockForVariant,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";

import {
  createMultiItemSale,
  subscribeSales,
} from "../../services/sales.service";

import {
  normalizeCustomerDocument,
  normalizeCustomerPhone,
  subscribeCustomers,
} from "../../services/customers.service";

import { formatCurrency, toNumber } from "../../utils/money";
import { getCurrentUserActor } from "../../services/auth.service";
import ThermalReceipt from "../../components/sales/ThermalReceipt";
import {
  getVariantBarcodeAliases,
  normalizeScannerBarcode,
} from "../../services/barcode.service";

const emptyCheckout = {
  customerId: "",
  customerName: "",
  customerDocument: "",
  customerPhone: "",
  paymentMethod: "efectivo",
  mixedPayments: [
    { method: "efectivo", amount: "" },
    { method: "nequi", amount: "" },
  ],
  discount: "",
  amountReceived: "",
  notes: "",
};

const emptyQuickProduct = {
  productName: "",
  productCode: "",
  size: "",
  quantity: "1",
  unitPrice: "",
  costPrice: "",
  note: "",
};

const MIXED_PAYMENT_OPTIONS = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "nequi", label: "Nequi" },
  { value: "daviplata", label: "Daviplata" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
];

function parseMoneyInput(value) {
  return Math.max(
    Number(
      String(value || "")
        .replace(/[^0-9]/g, "")
    ) || 0,
    0
  );
}

function formatMoneyInput(value) {
  const number = parseMoneyInput(value);

  if (!number) {
    return "";
  }

  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
  }).format(number);
}

function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

function getTotalStock(product) {
  return getProductVariants(product).reduce(
    (total, variant) => total + Number(variant.stock || 0),
    0
  );
}

function isPromotionProduct(product) {
  return (
    Boolean(product?.isPromotion) &&
    Number(product?.promotionPrice || 0) > 0 &&
    getProductPromotionStock(product) > 0
  );
}

function getNormalStockForVariant(
  product,
  variant
) {
  return Math.max(
    Number(variant?.stock || 0) -
      getPromotionStockForVariant(
        product,
        variant
      ),
    0
  );
}

function getSaleModeStock(
  product,
  variant,
  isPromotion = false
) {
  return isPromotion
    ? getPromotionStockForVariant(
        product,
        variant
      )
    : getNormalStockForVariant(
        product,
        variant
      );
}

function getLineUnitPrice(
  product,
  isPromotion = false
) {
  return isPromotion
    ? Number(
        product?.promotionPrice || 0
      )
    : Number(
        product?.salePrice || 0
      );
}

function getAvailableVariants(product) {
  return getProductVariants(product).filter(
    (variant) => Number(variant.stock || 0) > 0
  );
}

function getStockStatus(stock) {
  const value = Number(stock || 0);

  if (value <= 0) {
    return {
      label: "Agotado",
      filter: "empty",
      badgeClass: "bg-red-50 text-red-600",
      stockClass: "text-red-600",
    };
  }

  if (value <= 3) {
    return {
      label: "Stock bajo",
      filter: "low",
      badgeClass: "bg-orange-50 text-orange-600",
      stockClass: "text-orange-600",
    };
  }

  return {
    label: "Disponible",
    filter: "available",
    badgeClass: "bg-emerald-50 text-emerald-600",
    stockClass: "text-emerald-600",
  };
}

function normalizeScannerValue(value) {
  return normalizeScannerBarcode(value);
}

function makeCartKey(
  productId,
  variantId,
  isPromotion = false
) {
  return `${productId}__${variantId}__${
    isPromotion ? "promo" : "normal"
  }`;
}

export default function SalesPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customersReady, setCustomersReady] = useState(false);

  const [cart, setCart] = useState([]);
  const [checkout, setCheckout] = useState(emptyCheckout);
  const [customerLookup, setCustomerLookup] = useState({
    status: "idle",
    mode: "",
    value: "",
    customer: null,
  });

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("available");

  const [scannerValue, setScannerValue] = useState("");
  const [scannerStatus, setScannerStatus] = useState(null);

  const [variantProduct, setVariantProduct] = useState(null);
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [completedSale, setCompletedSale] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);

  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState(false);

  const scannerInputRef = useRef(null);
  const scannerLockRef = useRef({ code: "", timestamp: 0 });

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
        setLoading(false);

        setCart((currentCart) =>
          currentCart
            .map((item) => {
              if (item.isManual) {
                return item;
              }

              const product = productsData.find(
                (candidate) => candidate.id === item.productId
              );

              if (!product) return null;

              const variant = getProductVariants(product).find(
                (candidate) => candidate.id === item.variantId
              );

              if (!variant) return null;

              const availableStock =
                getSaleModeStock(
                  product,
                  variant,
                  item.isPromotion
                );

              if (availableStock <= 0) {
                return null;
              }

              return {
                ...item,
                product,
                variant,
                unitPrice:
                  getLineUnitPrice(
                    product,
                    item.isPromotion
                  ),
                regularUnitPrice:
                  Number(
                    product.salePrice || 0
                  ),
                promotionPrice:
                  item.isPromotion
                    ? Number(
                        product.promotionPrice ||
                          0
                      )
                    : 0,
                promotionNote:
                  item.isPromotion
                    ? String(
                        product.promotionNote ||
                          ""
                      ).trim()
                    : "",
                quantity: Math.min(
                  Number(
                    item.quantity || 1
                  ),
                  availableStock
                ),
              };
            })
            .filter(Boolean)
        );
      },
      () => {
        setLoading(false);
        alert("No se pudieron escuchar los productos en tiempo real.");
      },
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      (categoriesData) => setCategories(categoriesData),
      () => alert("No se pudieron escuchar las categorías en tiempo real."),
      STORE_ID
    );

    const unsubscribeSales = subscribeSales(
      (salesData) => setSales(salesData),
      () => alert("No se pudieron escuchar las ventas en tiempo real."),
      STORE_ID
    );

    const unsubscribeCustomers = subscribeCustomers(
      (customersData) => {
        setCustomers(
          Array.isArray(customersData)
            ? customersData
            : []
        );
        setCustomersReady(true);
      },
      () => {
        setCustomersReady(true);
        console.error(
          "No se pudieron escuchar los clientes en tiempo real."
        );
      },
      STORE_ID
    );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeSales();
      unsubscribeCustomers();
    };
  }, []);

  useEffect(() => {
    const documentNumber =
      normalizeCustomerDocument(
        checkout.customerDocument
      );

    const phoneNumber =
      normalizeCustomerPhone(
        checkout.customerPhone
      );

    const hasDocument =
      documentNumber.length > 0;

    const hasSearchablePhone =
      !hasDocument &&
      phoneNumber.length >= 7;

    if (!hasDocument && !hasSearchablePhone) {
      setCustomerLookup({
        status: "idle",
        mode: "",
        value: "",
        customer: null,
      });
      return;
    }

    if (!customersReady) {
      setCustomerLookup({
        status: "searching",
        mode: hasDocument
          ? "document"
          : "phone",
        value: hasDocument
          ? documentNumber
          : phoneNumber,
        customer: null,
      });
      return;
    }

    const mode = hasDocument
      ? "document"
      : "phone";

    const value = hasDocument
      ? documentNumber
      : phoneNumber;

    setCustomerLookup({
      status: "searching",
      mode,
      value,
      customer: null,
    });

    const timeoutId = window.setTimeout(() => {
      const customer =
        mode === "document"
          ? customers.find(
              (item) =>
                normalizeCustomerDocument(
                  item?.documentNumber ||
                    item?.normalizedDocument ||
                    item?.customerDocument
                ) === documentNumber
            ) || null
          : customers.find(
              (item) =>
                normalizeCustomerPhone(
                  item?.phone ||
                    item?.customerPhone
                ) === phoneNumber
            ) || null;

      if (customer) {
        setCheckout((current) => {
          const currentDocument =
            normalizeCustomerDocument(
              current.customerDocument
            );

          const currentPhone =
            normalizeCustomerPhone(
              current.customerPhone
            );

          const stillMatches =
            mode === "document"
              ? currentDocument ===
                documentNumber
              : !currentDocument &&
                currentPhone ===
                  phoneNumber;

          if (!stillMatches) {
            return current;
          }

          return {
            ...current,
            customerId:
              customer.id || "",
            customerName:
              customer.fullName || "",
            customerDocument:
              normalizeCustomerDocument(
                customer.documentNumber ||
                  customer.normalizedDocument ||
                  current.customerDocument
              ),
            customerPhone:
              normalizeCustomerPhone(
                customer.phone ||
                  current.customerPhone
              ),
          };
        });

        setCustomerLookup({
          status: "found",
          mode,
          value,
          customer,
        });

        return;
      }

      setCheckout((current) => {
        const currentDocument =
          normalizeCustomerDocument(
            current.customerDocument
          );

        const currentPhone =
          normalizeCustomerPhone(
            current.customerPhone
          );

        const stillMatches =
          mode === "document"
            ? currentDocument ===
              documentNumber
            : !currentDocument &&
              currentPhone ===
                phoneNumber;

        if (!stillMatches) {
          return current;
        }

        return {
          ...current,
          customerId: "",
        };
      });

      setCustomerLookup({
        status: "not-found",
        mode,
        value,
        customer: null,
      });
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    checkout.customerDocument,
    checkout.customerPhone,
    customers,
    customersReady,
  ]);

  useEffect(() => {
    const focusScanner = (event) => {
      const target = event.target;
      const isTypingField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (!isTypingField && !variantProduct && !mobileCartOpen) {
        scannerInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", focusScanner);

    return () => window.removeEventListener("keydown", focusScanner);
  }, [variantProduct, mobileCartOpen]);

  const availableSizes = useMemo(() => {
    const sizes = products.flatMap((product) =>
      getProductVariants(product).map((variant) => variant.size)
    );

    return [...new Set(sizes)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const variants = getProductVariants(product);
      const stock = getTotalStock(product);
      const stockStatus = getStockStatus(stock);

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "")
          .toLowerCase()
          .includes(cleanSearch) ||
        variants.some((variant) =>
          String(variant.size || "").toLowerCase().includes(cleanSearch)
        );

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize =
        sizeFilter === "all" ||
        variants.some((variant) => variant.size === sizeFilter);

      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "available" && stock > 0) ||
        (stockFilter === "low" && stock > 0 && stock <= 3) ||
        (stockFilter === "empty" && stock <= 0);

      return matchesSearch && matchesCategory && matchesSize && matchesStock;
    });
  }, [products, search, categoryFilter, sizeFilter, stockFilter]);

  const cartSummary = useMemo(() => {
    const regularSubtotal = cart.reduce(
      (total, item) =>
        total +
        Number(
          item.regularUnitPrice ??
            item.product?.salePrice ??
            item.unitPrice ??
            0
        ) *
          Number(item.quantity || 0),
      0
    );

    const subtotal = cart.reduce(
      (total, item) =>
        total +
        Number(item.unitPrice || 0) *
          Number(item.quantity || 0),
      0
    );

    const promotionSavings = Math.max(
      regularSubtotal - subtotal,
      0
    );

    const totalCost = cart.reduce(
      (total, item) =>
        total +
        Number(
          item.costPrice ??
            item.product?.costPrice ??
            0
        ) * Number(item.quantity || 0),
      0
    );

    const totalItems = cart.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    );

    const discount = Math.min(Math.max(toNumber(checkout.discount), 0), subtotal);
    const total = Math.max(subtotal - discount, 0);
    const mixedPayments =
      checkout.paymentMethod === "mixto"
        ? checkout.mixedPayments
            .map((payment) => ({
              method: payment.method,
              amount: parseMoneyInput(
                payment.amount
              ),
            }))
            .filter(
              (payment) =>
                payment.method &&
                payment.amount > 0
            )
        : [];

    const mixedPaid = mixedPayments.reduce(
      (sum, payment) =>
        sum + payment.amount,
      0
    );

    const mixedPending = Math.max(
      total - mixedPaid,
      0
    );

    const mixedExcess = Math.max(
      mixedPaid - total,
      0
    );

    const amountReceived =
      checkout.paymentMethod === "efectivo"
        ? Math.max(toNumber(checkout.amountReceived), 0)
        : total;
    const change =
      checkout.paymentMethod === "efectivo"
        ? Math.max(amountReceived - total, 0)
        : 0;

    return {
      regularSubtotal,
      subtotal,
      promotionSavings,
      totalCost,
      profit: total - totalCost,
      totalItems,
      uniqueItems: cart.length,
      discount,
      total,
      amountReceived,
      change,
      mixedPayments,
      mixedPaid,
      mixedPending,
      mixedExcess,
    };
  }, [cart, checkout]);

  function updateCheckout(field, value) {
    setCheckout((current) => ({ ...current, [field]: value }));
  }

  function handleCustomerDocumentChange(value) {
    const documentNumber =
      normalizeCustomerDocument(value).slice(0, 15);

    setCheckout((current) => ({
      ...current,
      customerId: "",
      customerDocument: documentNumber,
    }));
  }

  function handleCustomerPhoneChange(value) {
    const phoneNumber =
      normalizeCustomerPhone(value).slice(0, 15);

    setCheckout((current) => ({
      ...current,
      customerId: "",
      customerPhone: phoneNumber,
    }));
  }

  function clearCustomerSelection() {
    setCheckout((current) => ({
      ...current,
      customerId: "",
      customerName: "",
      customerDocument: "",
      customerPhone: "",
    }));

    setCustomerLookup({
      status: "idle",
      mode: "",
      value: "",
      customer: null,
    });
  }

  function updateMixedPayment(index, field, value) {
    setCheckout((current) => ({
      ...current,
      mixedPayments: current.mixedPayments.map(
        (payment, paymentIndex) =>
          paymentIndex === index
            ? {
                ...payment,
                [field]:
                  field === "amount"
                    ? formatMoneyInput(value)
                    : value,
              }
            : payment
      ),
    }));
  }

  function addMixedPaymentRow() {
    setCheckout((current) => {
      const used = new Set(
        current.mixedPayments.map(
          (payment) => payment.method
        )
      );

      const nextMethod =
        MIXED_PAYMENT_OPTIONS.find(
          (option) =>
            !used.has(option.value)
        )?.value || "otro";

      return {
        ...current,
        mixedPayments: [
          ...current.mixedPayments,
          {
            method: nextMethod,
            amount: "",
          },
        ],
      };
    });
  }

  function removeMixedPaymentRow(index) {
    setCheckout((current) => ({
      ...current,
      mixedPayments:
        current.mixedPayments.length <= 2
          ? current.mixedPayments
          : current.mixedPayments.filter(
              (_, paymentIndex) =>
                paymentIndex !== index
            ),
    }));
  }

  function addQuickProduct(form) {
    const productName = String(
      form.productName || ""
    ).trim();
    const quantity = Math.max(
      Number(form.quantity || 0),
      0
    );
    const unitPrice = parseMoneyInput(
      form.unitPrice
    );
    const costPrice = parseMoneyInput(
      form.costPrice
    );
    const size =
      String(form.size || "").trim() ||
      "Talla única";

    if (!productName) {
      alert(
        "Escribe el nombre del producto."
      );
      return false;
    }

    if (quantity <= 0) {
      alert(
        "La cantidad debe ser mayor a cero."
      );
      return false;
    }

    if (unitPrice <= 0) {
      alert(
        "El precio de venta debe ser mayor a cero."
      );
      return false;
    }

    const manualLineId = `manual-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const cartKey = `manual__${manualLineId}`;

    setCart((current) => [
      ...current,
      {
        cartKey,
        isManual: true,
        manualLineId,
        productId: "",
        variantId: "",
        product: {
          id: "",
          name: productName,
          code:
            String(
              form.productCode || ""
            ).trim() || "VENTA RÁPIDA",
          costPrice,
          salePrice: unitPrice,
          categoryName: "Venta rápida",
        },
        variant: {
          id: "",
          size,
          stock: 999999,
        },
        productName,
        productCode:
          String(
            form.productCode || ""
          ).trim(),
        size,
        quantity,
        unitPrice,
        regularUnitPrice: unitPrice,
        costPrice,
        isPromotion: false,
        promotionPrice: 0,
        promotionNote: "",
        manualNote:
          String(form.note || "").trim(),
      },
    ]);

    setScannerStatus({
      type: "success",
      message: `${productName} agregado como venta rápida`,
    });

    setQuickProductOpen(false);
    return true;
  }

  function openProduct(product) {
    const variants = getAvailableVariants(product);

    if (variants.length === 0) {
      alert("Este producto no tiene stock disponible.");
      return;
    }

    if (
      variants.length === 1 &&
      !isPromotionProduct(product)
    ) {
      addToCart(
        product,
        variants[0],
        false
      );
      return;
    }

    setVariantProduct(product);
  }

  function addToCart(
    product,
    variant,
    isPromotion = false
  ) {
    const stock = getSaleModeStock(
      product,
      variant,
      isPromotion
    );

    if (stock <= 0) {
      alert(
        isPromotion
          ? `La talla ${variant.size} no tiene unidades en promoción.`
          : `La talla ${variant.size} no tiene unidades normales disponibles.`
      );
      return;
    }

    const cartKey = makeCartKey(
      product.id,
      variant.id,
      isPromotion
    );

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.cartKey === cartKey);

      if (existing) {
        if (existing.quantity >= stock) {
          alert(
            `Solo hay ${stock} unidad(es) disponibles de ${product.name} talla ${variant.size}.`
          );
          return currentCart;
        }

        return currentCart.map((item) =>
          item.cartKey === cartKey
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [
        ...currentCart,
        {
          cartKey,
          productId: product.id,
          variantId: variant.id,
          product,
          variant,
          isPromotion,
          unitPrice:
            getLineUnitPrice(
              product,
              isPromotion
            ),
          regularUnitPrice: Number(
            product.salePrice || 0
          ),
          promotionPrice:
            isPromotion
              ? Number(
                  product.promotionPrice ||
                    0
                )
              : 0,
          promotionNote:
            isPromotion
              ? String(
                  product.promotionNote ||
                    ""
                ).trim()
              : "",
          quantity: 1,
        },
      ];
    });

    setVariantProduct(null);
    setScannerStatus({
      type: "success",
      message: `${product.name} · ${variant.size} agregado`,
    });
  }

  function updateCartQuantity(cartKey, nextQuantity) {
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (item.cartKey !== cartKey) return item;

        if (item.isManual) {
          return {
            ...item,
            quantity: Math.max(
              Number(nextQuantity || 1),
              1
            ),
          };
        }

        const stock =
          getSaleModeStock(
            item.product,
            item.variant,
            item.isPromotion
          );

        const safeQuantity = Math.min(
          Math.max(
            Number(nextQuantity || 1),
            1
          ),
          stock
        );

        return { ...item, quantity: safeQuantity };
      })
    );
  }

  function removeCartItem(cartKey) {
    setCart((currentCart) =>
      currentCart.filter((item) => item.cartKey !== cartKey)
    );
  }

  function clearCart() {
    if (cart.length === 0) return;

    if (!window.confirm("¿Seguro que deseas vaciar la venta actual?")) return;

    setCart([]);
    setCheckout(emptyCheckout);
  }

  function findProductFromScanner(rawValue) {
    const scannedCode = normalizeScannerValue(rawValue);

    if (!scannedCode) return null;

    const variantMatches = [];

    for (const product of products) {
      const variants = getProductVariants(product);

      for (let index = 0; index < variants.length; index += 1) {
        const variant = variants[index];

        const aliases = getVariantBarcodeAliases(
          product,
          variant,
          index
        ).map(normalizeScannerValue);

        if (aliases.includes(scannedCode)) {
          variantMatches.push({ product, variant });
        }
      }
    }

    if (variantMatches.length === 1) {
      return variantMatches[0];
    }

    if (variantMatches.length > 1) {
      return {
        ambiguous: true,
        scannedCode,
        matches: variantMatches,
      };
    }

    const productMatches = products.filter(
      (product) =>
        normalizeScannerValue(product.code) === scannedCode ||
        normalizeScannerValue(product.barcode) === scannedCode
    );

    if (productMatches.length === 1) {
      return {
        product: productMatches[0],
        variant: null,
      };
    }

    if (productMatches.length > 1) {
      return {
        ambiguous: true,
        scannedCode,
        matches: productMatches.map((product) => ({
          product,
          variant: null,
        })),
      };
    }

    return null;
  }

  function processScannedCode(rawValue) {
    const scannedCode = normalizeScannerValue(rawValue);
    if (!scannedCode) return;

    const now = Date.now();

    if (
      scannerLockRef.current.code === scannedCode &&
      now - scannerLockRef.current.timestamp < 650
    ) {
      return;
    }

    scannerLockRef.current = { code: scannedCode, timestamp: now };

    const match = findProductFromScanner(scannedCode);

    if (!match) {
      setScannerStatus({
        type: "error",
        message: `No se encontró el código ${scannedCode}`,
      });
      return;
    }

    if (match.ambiguous) {
      console.error(
        "Código asociado a más de una variante:",
        match
      );

      setScannerStatus({
        type: "error",
        message:
          `El código ${scannedCode} está duplicado. ` +
          "No se agregó ningún producto por seguridad.",
      });
      return;
    }

    if (match.variant) {
      addToCart(
        match.product,
        match.variant,
        false
      );
      return;
    }

    openProduct(match.product);
  }

  function handleScannerSubmit(event) {
    event.preventDefault();
    processScannedCode(scannerValue);
    setScannerValue("");

    window.setTimeout(() => scannerInputRef.current?.focus(), 30);
  }

  async function handleCheckout(event) {
    event.preventDefault();

    if (cart.length === 0) {
      alert("Agrega al menos un producto a la venta.");
      return;
    }

    const cleanCustomerDocument =
      normalizeCustomerDocument(
        checkout.customerDocument
      );

    const cleanCustomerPhone =
      normalizeCustomerPhone(
        checkout.customerPhone
      );

    const hasCustomerIdentifier =
      Boolean(
        cleanCustomerDocument ||
          cleanCustomerPhone
      );

    if (
      hasCustomerIdentifier &&
      customerLookup.status === "searching"
    ) {
      alert(
        "Espera un momento mientras validamos los datos del cliente."
      );
      return;
    }

    if (
      hasCustomerIdentifier &&
      customerLookup.status !== "found" &&
      !String(
        checkout.customerName || ""
      ).trim()
    ) {
      alert(
        "No encontramos este cliente. Escribe su nombre para registrar la venta con estos datos."
      );
      return;
    }

    if (
      checkout.paymentMethod === "efectivo" &&
      cartSummary.amountReceived < cartSummary.total
    ) {
      alert("El dinero recibido no puede ser menor al total de la venta.");
      return;
    }

    if (checkout.paymentMethod === "mixto") {
      if (cartSummary.mixedPayments.length < 2) {
        alert(
          "El pago mixto debe tener al menos dos métodos con valor."
        );
        return;
      }

      const methods = cartSummary.mixedPayments.map(
        (payment) => payment.method
      );

      if (new Set(methods).size !== methods.length) {
        alert(
          "No repitas el mismo método en el pago mixto."
        );
        return;
      }

      if (
        Math.abs(
          cartSummary.mixedPaid -
            cartSummary.total
        ) > 0.5
      ) {
        alert(
          `El pago mixto debe sumar exactamente ${formatCurrency(
            cartSummary.total
          )}.`
        );
        return;
      }
    }

    try {
      setSelling(true);

      const seller = getCurrentUserActor();

      const sale = await createMultiItemSale({
        items: cart.map((item) =>
          item.isManual
            ? {
                isManual: true,
                manualLineId:
                  item.manualLineId,
                productName:
                  item.productName ||
                  item.product?.name ||
                  "Producto rápido",
                productCode:
                  item.productCode || "",
                size:
                  item.size ||
                  item.variant?.size ||
                  "Talla única",
                quantity:
                  item.quantity,
                unitPrice:
                  item.unitPrice,
                costPrice:
                  item.costPrice || 0,
                note:
                  item.manualNote || "",
              }
            : {
                productId: item.productId,
                variantId: item.variantId,
                size: item.variant.size,
                quantity: item.quantity,
                isPromotion:
                  Boolean(
                    item.isPromotion
                  ),
                pricingMode:
                  item.isPromotion
                    ? "promotion"
                    : "normal",
              }
        ),

        customerId: checkout.customerId,
        customerName: checkout.customerName,
        customerDocument: checkout.customerDocument,
        customerPhone: checkout.customerPhone,
        paymentMethod: checkout.paymentMethod,
        payments:
          checkout.paymentMethod === "mixto"
            ? cartSummary.mixedPayments
            : [],
        discount: cartSummary.discount,
        amountReceived:
          checkout.paymentMethod === "efectivo"
            ? cartSummary.amountReceived
            : cartSummary.total,
        notes: checkout.notes,
        source: "pos",
        storeId: STORE_ID,
        seller,
      });

      setCompletedSale(sale);
      setCart([]);
      setCheckout(emptyCheckout);
      setCustomerLookup({
        status: "idle",
        mode: "",
        value: "",
        customer: null,
      });
      setMobileCartOpen(false);
      setScannerStatus(null);
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo registrar la venta.");
    } finally {
      setSelling(false);
    }
  }

  return (
    <main className="min-h-screen bg-white px-[clamp(10px,1.2vw,24px)] py-[clamp(10px,1vw,20px)] text-black">
      <section className="mx-auto w-full max-w-[1920px]">
        <header className="flex flex-col gap-[clamp(10px,1vw,16px)] min-[900px]:flex-row min-[900px]:items-end min-[900px]:justify-between">
          <div>
            <h1 className="text-[clamp(22px,1.7vw,32px)] font-medium tracking-[-0.045em]">
              Punto de venta
            </h1>

            <p className="mt-1 text-[clamp(10px,0.75vw,13px)] text-black/50">
              Escanea, agrega productos y registra ventas completas
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
               type="button"
  onClick={() => navigate("/admin/ventas/historial")}

              className="inline-flex h-[clamp(38px,2.7vw,44px)] items-center justify-center gap-2 rounded-[clamp(11px,0.8vw,16px)] border border-black/[0.08] bg-white px-[clamp(12px,1vw,18px)] text-[clamp(10px,0.72vw,13px)] font-medium shadow-[0_10px_30px_rgba(0,0,0,0.035)] transition hover:bg-black/[0.025]"
            >
              <ReceiptText size={16} />
              Historial
              <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] text-black/55">
                {sales.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setQuickProductOpen(true)
              }
              className="inline-flex h-[clamp(38px,2.7vw,44px)] items-center justify-center gap-2 rounded-[clamp(11px,0.8vw,16px)] border border-black/[0.08] bg-white px-[clamp(12px,1vw,18px)] text-[clamp(10px,0.72vw,13px)] font-medium shadow-[0_10px_30px_rgba(0,0,0,0.035)] transition hover:bg-black/[0.025]"
            >
              <PackagePlus size={16} />
              Producto rápido
            </button>

            <button
              type="button"
              onClick={() => scannerInputRef.current?.focus()}
              className="inline-flex h-[clamp(38px,2.7vw,44px)] items-center justify-center gap-2 rounded-[clamp(11px,0.8vw,16px)] bg-red-600 px-[clamp(14px,1.1vw,20px)] text-[clamp(10px,0.72vw,13px)] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
            >
              <ScanLine size={17} />
              Activar escáner
            </button>
          </div>
        </header>

        <form
          onSubmit={handleScannerSubmit}
          className="relative mt-[clamp(12px,1vw,20px)] overflow-hidden rounded-[clamp(18px,1.5vw,28px)] border border-black/[0.07] bg-white p-[clamp(8px,0.75vw,13px)] shadow-[0_16px_45px_rgba(0,0,0,0.045)]"
        >

          <div className="relative grid gap-[clamp(8px,0.7vw,12px)] min-[900px]:grid-cols-[clamp(160px,15vw,220px)_minmax(0,1fr)_auto] min-[900px]:items-center">
            <div className="flex items-center gap-3 rounded-[20px] bg-gradient-to-br from-red-600 to-red-500 px-4 py-3 text-white shadow-lg shadow-red-600/15">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                <ScanLine size={20} />
              </div>

              <div className="min-w-0">
                <p className="text-[12px] font-semibold">Escaneo inteligente</p>
                <p className="mt-0.5 truncate text-[10px] text-white/70">
                  Lector USB o código manual
                </p>
              </div>
            </div>

            <label className="relative block">
              <Barcode
                size={19}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-red-500"
              />

              <input
                ref={scannerInputRef}
                value={scannerValue}
                onChange={(event) => setScannerValue(event.target.value)}
                className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfbfc] pl-12 pr-4 text-[14px] text-black outline-none transition placeholder:text-black/35 focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-600/10"
                placeholder="Escanea o escribe el código del producto..."
                autoComplete="off"
              />
            </label>

            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 text-[13px] font-semibold text-white shadow-lg shadow-red-600/20 transition hover:-translate-y-0.5 hover:bg-red-700"
            >
              <Plus size={17} />
              Agregar producto
            </button>
          </div>

          {scannerStatus && (
            <div
              className={`relative mt-3 flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-[12px] ${
                scannerStatus.type === "success"
                  ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                  : "border-red-100 bg-red-50 text-red-700"
              }`}
            >
              {scannerStatus.type === "success" ? (
                <CheckCircle2 size={15} />
              ) : (
                <X size={15} />
              )}
              {scannerStatus.message}
            </div>
          )}
        </form>

        <section className="mt-[clamp(10px,0.85vw,16px)] grid min-h-[calc(100vh-220px)] gap-[clamp(8px,0.75vw,14px)] min-[900px]:grid-cols-[minmax(0,1fr)_clamp(300px,24vw,430px)]">
          <div className="min-w-0 rounded-[clamp(18px,1.4vw,28px)] border border-white bg-white/95 p-[clamp(8px,0.8vw,15px)] shadow-[0_20px_65px_rgba(0,0,0,0.055)] ring-1 ring-black/[0.045] backdrop-blur">
            <div className="grid gap-[clamp(6px,0.6vw,10px)] min-[900px]:grid-cols-[minmax(220px,1.4fr)_minmax(150px,.8fr)_minmax(120px,.7fr)_minmax(150px,.7fr)]">
              <label className="relative block">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
                />

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-[clamp(36px,2.6vw,44px)] w-full rounded-[clamp(10px,0.85vw,16px)] border border-black/[0.08] bg-white pl-[clamp(36px,2.7vw,44px)] pr-[clamp(10px,0.8vw,16px)] text-[clamp(9px,0.72vw,13px)] outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  placeholder="Buscar producto, código, categoría o talla..."
                />
              </label>

              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-[clamp(36px,2.6vw,44px)] rounded-[clamp(10px,0.85vw,16px)] border border-black/[0.08] bg-white px-[clamp(10px,0.8vw,16px)] text-[clamp(9px,0.72vw,13px)] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="all">Todas las categorías</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>

              <select
                value={sizeFilter}
                onChange={(event) => setSizeFilter(event.target.value)}
                className="h-[clamp(36px,2.6vw,44px)] rounded-[clamp(10px,0.85vw,16px)] border border-black/[0.08] bg-white px-[clamp(10px,0.8vw,16px)] text-[clamp(9px,0.72vw,13px)] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="all">Todas las tallas</option>
                {availableSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>

              <select
                value={stockFilter}
                onChange={(event) => setStockFilter(event.target.value)}
                className="h-[clamp(36px,2.6vw,44px)] rounded-[clamp(10px,0.85vw,16px)] border border-black/[0.08] bg-white px-[clamp(10px,0.8vw,16px)] text-[clamp(9px,0.72vw,13px)] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              >
                <option value="available">Disponibles (stock mayor a 0)</option>
                <option value="low">Stock bajo (1 a 3)</option>
                <option value="empty">Agotados</option>
                <option value="all">Todos</option>
              </select>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium">Productos</p>
                <p className="mt-0.5 text-[12px] text-black/45">
                  {filteredProducts.length} resultado(s)
                </p>
              </div>

              <div className="rounded-full bg-red-50 px-3 py-1.5 text-[11px] text-red-600">
                Selecciona para agregar
              </div>
            </div>

            <section className="mt-4">
              {loading ? (
                <div className="rounded-[22px] bg-black/[0.025] p-10 text-center text-[13px] text-black/45">
                  Cargando productos en tiempo real...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="rounded-[22px] bg-black/[0.025] p-10 text-center">
                  <PackageSearch size={34} className="mx-auto text-black/30" />
                  <h2 className="mt-4 text-[17px] font-medium">
                    No hay productos para mostrar
                  </h2>
                  <p className="mt-2 text-[13px] text-black/45">
                    Ajusta los filtros o revisa el inventario.
                  </p>
                </div>
              ) : (
                <div
                  className="grid gap-[clamp(7px,0.65vw,11px)]"
                  style={{
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(min(100%, clamp(145px, 11vw, 205px)), 1fr))",
                  }}
                >
                  {filteredProducts.map((product) => (
                    <ProductSaleCard
                      key={product.id}
                      product={product}
                      onAdd={() => openProduct(product)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="hidden min-[900px]:block">
            <CartPanel
              cart={cart}
              checkout={checkout}
              summary={cartSummary}
              selling={selling}
              customerLookup={customerLookup}
              onUpdateCheckout={updateCheckout}
              onCustomerDocumentChange={handleCustomerDocumentChange}
              onCustomerPhoneChange={handleCustomerPhoneChange}
              onClearCustomer={clearCustomerSelection}
              onUpdateMixedPayment={updateMixedPayment}
              onAddMixedPaymentRow={addMixedPaymentRow}
              onRemoveMixedPaymentRow={removeMixedPaymentRow}
              onUpdateQuantity={updateCartQuantity}
              onRemoveItem={removeCartItem}
              onClear={clearCart}
              onSubmit={handleCheckout}
            />
          </aside>
        </section>
      </section>

      <MobileCartBar
        summary={cartSummary}
        onOpen={() => setMobileCartOpen(true)}
      />

      {mobileCartOpen && (
        <MobileCartDrawer
          cart={cart}
          checkout={checkout}
          summary={cartSummary}
          selling={selling}
          customerLookup={customerLookup}
          onClose={() => setMobileCartOpen(false)}
          onUpdateCheckout={updateCheckout}
          onCustomerDocumentChange={handleCustomerDocumentChange}
          onCustomerPhoneChange={handleCustomerPhoneChange}
          onClearCustomer={clearCustomerSelection}
          onUpdateMixedPayment={updateMixedPayment}
          onAddMixedPaymentRow={addMixedPaymentRow}
          onRemoveMixedPaymentRow={removeMixedPaymentRow}
          onUpdateQuantity={updateCartQuantity}
          onRemoveItem={removeCartItem}
          onClear={clearCart}
          onSubmit={handleCheckout}
        />
      )}

      {quickProductOpen && (
        <QuickProductModal
          onClose={() =>
            setQuickProductOpen(false)
          }
          onAdd={addQuickProduct}
        />
      )}

      {variantProduct && (
        <VariantSelectorModal
          product={variantProduct}
          onClose={() => setVariantProduct(null)}
          onSelect={(
            variant,
            isPromotion
          ) =>
            addToCart(
              variantProduct,
              variant,
              isPromotion
            )
          }
        />
      )}

      {showHistory && (
        <SalesHistoryModal
          sales={sales}
          onClose={() => setShowHistory(false)}
          onSelectSale={(sale) => {
            setCompletedSale(sale);
            setShowHistory(false);
          }}
        />
      )}

      {completedSale && (
        <CompletedSaleModal
          sale={completedSale}
          onClose={() => setCompletedSale(null)}
          onPrint={() => setReceiptSale(completedSale)}
          onNewSale={() => {
            setCompletedSale(null);
            setReceiptSale(null);
            scannerInputRef.current?.focus();
          }}
        />
      )}

      {receiptSale && (
       <ThermalReceipt
  sale={receiptSale}
  open={Boolean(receiptSale)}
  onClose={() => setReceiptSale(null)}
  defaultPaperSize="80mm"
  store={{
    name: "MASTER CAPS",
    logoUrl: "/logo.png",
    footerMessage: "Gracias por tu compra",
    secondaryMessage:
      "Conserva este recibo para cambios o garantías",
  }}
/>
      )}
    </main>
  );
}

function ProductSaleCard({ product, onAdd }) {
  const stock = getTotalStock(product);
  const variants = getAvailableVariants(product);
  const coverImage = getProductCoverImage(product);
  const stockStatus = getStockStatus(stock);
  const promotionActive =
    isPromotionProduct(product);
  const promotionStock =
    getProductPromotionStock(product);
  const regularPrice =
    Number(product.salePrice || 0);

  return (
    <article className="group min-w-0 overflow-hidden rounded-[clamp(13px,0.95vw,18px)] bg-white shadow-[0_10px_28px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.055] transition hover:-translate-y-0.5 hover:shadow-[0_16px_38px_rgba(0,0,0,0.065)]">
      <button
        type="button"
        onClick={onAdd}
        disabled={stock <= 0}
        className="block w-full min-w-0 text-left disabled:cursor-not-allowed"
      >
        <div className="relative aspect-[1.18/1] overflow-hidden bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={product.name}
              className="h-full w-full bg-white object-contain p-1.5 transition duration-300 group-hover:scale-[1.025]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera size={23} className="text-black/22" />
            </div>
          )}

          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {promotionActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[8px] font-medium text-black shadow-sm">
                <BadgePercent size={8} />
                PROMO
              </span>
            )}

            <span
              className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${stockStatus.badgeClass}`}
            >
              {stockStatus.label}
            </span>
          </div>

          {variants.length > 0 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/72 px-2 py-0.5 text-[8px] text-white backdrop-blur">
              {variants.length} talla(s)
            </span>
          )}
        </div>

        <div className="p-[clamp(8px,0.7vw,11px)]">
          <p className="truncate text-[9px] text-black/42">
            {product.code || "Sin código"} · {product.categoryName || "Sin categoría"}
          </p>

          <h3 className="mt-1 truncate text-[clamp(10px,0.75vw,13px)] font-medium leading-tight">
            {product.name}
          </h3>

          <div className="mt-1.5 flex min-h-[20px] flex-wrap gap-1">
            {variants.slice(0, 3).map((variant) => (
              <span
                key={variant.id}
                className="rounded-full bg-black/[0.035] px-1.5 py-0.5 text-[8px] text-black/58"
              >
                {variant.size}
              </span>
            ))}

            {variants.length > 3 && (
              <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[8px] text-red-600">
                +{variants.length - 3}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[clamp(11px,0.85vw,15px)] font-medium tracking-[-0.035em]">
                {formatCurrency(
                  regularPrice
                )}
              </p>

              {promotionActive && (
                <p className="mt-0.5 truncate text-[7.5px] font-medium text-amber-700">
                  Promo{" "}
                  {formatCurrency(
                    product.promotionPrice
                  )}{" "}
                  · {promotionStock} u.
                </p>
              )}

              <p className={`mt-0.5 text-[9px] ${stockStatus.stockClass}`}>
                {stock} u.
              </p>
            </div>

            <span className="inline-flex h-[clamp(28px,2vw,34px)] shrink-0 items-center gap-1 rounded-[clamp(8px,0.65vw,10px)] bg-red-600 px-[clamp(8px,0.7vw,11px)] text-[clamp(7.5px,0.58vw,9px)] font-medium text-white shadow-sm shadow-red-600/15">
              <Plus size={12} />
              Agregar
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}
function CartPanel(props) {
  const {
    cart,
    checkout,
    summary,
    selling,
    customerLookup,
    onUpdateCheckout,
    onCustomerDocumentChange,
    onCustomerPhoneChange,
    onClearCustomer,
    onUpdateMixedPayment,
    onAddMixedPaymentRow,
    onRemoveMixedPaymentRow,
    onUpdateQuantity,
    onRemoveItem,
    onClear,
    onSubmit,
  } = props;

  return (
    <section className="sticky top-[clamp(8px,0.8vw,16px)] flex max-h-[calc(100vh-20px)] flex-col overflow-hidden rounded-[clamp(18px,1.4vw,28px)] bg-white shadow-[0_18px_55px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.07]">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <ShoppingCart size={19} />
          </div>

          <div>
            <h2 className="text-[clamp(12px,0.9vw,16px)] font-medium">Venta actual</h2>
            <p className="mt-0.5 text-[11px] text-black/45">
              {summary.totalItems} unidad(es) · {summary.uniqueItems} línea(s)
            </p>
          </div>
        </div>

        {cart.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-xl px-3 py-2 text-[11px] text-red-600 transition hover:bg-red-50"
          >
            Vaciar
          </button>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(10px,0.85vw,16px)] py-[clamp(10px,0.85vw,16px)]">
          {cart.length === 0 ? (
            <EmptyCart />
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <CartItem
                  key={item.cartKey}
                  item={item}
                  onUpdateQuantity={onUpdateQuantity}
                  onRemove={onRemoveItem}
                />
              ))}
            </div>
          )}

          <CheckoutFields
            checkout={checkout}
            summary={summary}
            customerLookup={customerLookup}
            onUpdate={onUpdateCheckout}
            onCustomerDocumentChange={onCustomerDocumentChange}
            onCustomerPhoneChange={onCustomerPhoneChange}
            onClearCustomer={onClearCustomer}
            onUpdateMixedPayment={onUpdateMixedPayment}
            onAddMixedPaymentRow={onAddMixedPaymentRow}
            onRemoveMixedPaymentRow={onRemoveMixedPaymentRow}
          />
        </div>

        <CartTotals
          summary={summary}
          selling={selling}
          disabled={cart.length === 0}
          paymentMethod={checkout.paymentMethod}
        />
      </form>
    </section>
  );
}

function EmptyCart() {
  return (
    <div className="rounded-[22px] bg-black/[0.025] px-5 py-8 text-center">
      <ShoppingBag size={30} className="mx-auto text-black/25" />
      <p className="mt-3 text-[14px] font-medium">El carrito está vacío</p>
      <p className="mt-1 text-[12px] leading-5 text-black/45">
        Escanea un código o selecciona productos para iniciar la venta.
      </p>
    </div>
  );
}

function CartItem({ item, onUpdateQuantity, onRemove }) {
  const coverImage = item.isManual
    ? { url: "" }
    : getProductCoverImage(item.product);
  const promotionActive =
    Boolean(item.isPromotion);
  const effectivePrice =
    Number(item.unitPrice || 0);
  const subtotal =
    effectivePrice *
    Number(item.quantity || 0);

  return (
    <article className="rounded-[19px] border border-black/[0.06] bg-white p-3">
      <div className="flex gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={item.product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera size={19} className="text-black/25" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[12px] font-medium">
                {item.product?.name ||
                  item.productName ||
                  "Producto rápido"}
              </h3>
              <p className="mt-1 text-[10px] text-black/45">
                {item.isManual
                  ? `Venta rápida · ${item.variant?.size || item.size || "Talla única"}`
                  : `${item.product.code} · Talla ${item.variant.size}`}
              </p>

              {item.isManual && (
                <span className="mt-1.5 inline-flex rounded-full bg-black/[0.045] px-2 py-0.5 text-[7.5px] font-medium text-black/55">
                  SIN INVENTARIO
                </span>
              )}

              {promotionActive && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[7.5px] font-medium text-amber-700 ring-1 ring-amber-100">
                    <BadgePercent size={8} />
                    PROMO
                  </span>

                  <span className="text-[8px] text-red-600">
                    {formatCurrency(effectivePrice)}
                  </span>

                  <span className="text-[7.5px] text-black/30 line-through">
                    {formatCurrency(item.regularUnitPrice)}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onRemove(item.cartKey)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50"
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateQuantity(item.cartKey, item.quantity - 1)}
                disabled={item.quantity <= 1}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] disabled:opacity-35"
              >
                <Minus size={12} />
              </button>

              <input
                type="text"
                inputMode="numeric"
                value={item.quantity}
                onChange={(event) =>
                  onUpdateQuantity(item.cartKey, event.target.value)
                }
                className="h-7 w-10 rounded-lg border border-black/[0.08] text-center text-[11px] outline-none focus:border-red-600"
              />

              <button
                type="button"
                onClick={() => onUpdateQuantity(item.cartKey, item.quantity + 1)}
                disabled={
                  !item.isManual &&
                  item.quantity >=
                    Number(
                      item.variant?.stock || 0
                    )
                }
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] disabled:opacity-35"
              >
                <Plus size={12} />
              </button>
            </div>

            <p className="text-[13px] font-medium">
              {formatCurrency(subtotal)}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function CheckoutFields({
  checkout,
  summary,
  customerLookup,
  onUpdate,
  onCustomerDocumentChange,
  onCustomerPhoneChange,
  onClearCustomer,
  onUpdateMixedPayment,
  onAddMixedPaymentRow,
  onRemoveMixedPaymentRow,
}) {
  const hasCustomerDocument = Boolean(
    normalizeCustomerDocument(
      checkout.customerDocument
    )
  );

  const hasCustomerPhone = Boolean(
    normalizeCustomerPhone(
      checkout.customerPhone
    )
  );

  const hasCustomerIdentifier =
    hasCustomerDocument ||
    hasCustomerPhone;

  const lookupLabel =
    customerLookup?.mode === "phone"
      ? "teléfono"
      : "cédula";

  return (
    <section className="mt-4 border-t border-black/[0.06] pt-4">
      <div className="flex items-center gap-2">
        <User size={15} className="text-black/50" />
        <p className="text-[12px] font-medium">Datos de la venta</p>
      </div>

      <div className="mt-3 grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <label>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] text-black/45">
                Cédula
              </span>

              {hasCustomerIdentifier && (
                <button
                  type="button"
                  onClick={onClearCustomer}
                  className="text-[9px] text-red-600 transition hover:text-red-700"
                >
                  Limpiar
                </button>
              )}
            </div>

            <input
              value={checkout.customerDocument}
              onChange={(event) =>
                onCustomerDocumentChange(
                  event.target.value
                )
              }
              inputMode="numeric"
              autoComplete="off"
              className="h-10 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="Opcional"
            />
          </label>

          <label>
            <span className="mb-1.5 block text-[10px] text-black/45">
              Teléfono
            </span>

            <input
              value={checkout.customerPhone}
              onChange={(event) =>
                onCustomerPhoneChange(
                  event.target.value
                )
              }
              inputMode="tel"
              autoComplete="off"
              className="h-10 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] outline-none placeholder:text-black/30 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="También sirve para buscar"
            />
          </label>
        </div>

        {!hasCustomerIdentifier && (
          <div className="rounded-xl bg-black/[0.025] px-3 py-2.5 text-[9.5px] leading-4 text-black/42">
            Puedes identificar al cliente por cédula o por teléfono. Si no tienes ninguno, también puedes dejar la venta sin cliente.
          </div>
        )}

        {hasCustomerIdentifier &&
          customerLookup?.status === "searching" && (
            <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[10px] text-red-600">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-200 border-t-red-600" />
              Buscando cliente por {lookupLabel}...
            </div>
          )}

        {hasCustomerIdentifier &&
          customerLookup?.status === "found" && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-3">
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 ring-1 ring-emerald-100">
                  <CheckCircle2 size={16} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-emerald-700">
                    Cliente encontrado por {lookupLabel}
                  </p>

                  <p className="mt-1 truncate text-[12px] font-medium text-black">
                    {checkout.customerName ||
                      "Cliente registrado"}
                  </p>

                  <p className="mt-0.5 truncate text-[9px] text-black/45">
                    {checkout.customerDocument
                      ? `CC ${checkout.customerDocument}`
                      : "Sin cédula registrada"}
                    {checkout.customerPhone
                      ? ` · ${checkout.customerPhone}`
                      : ""}
                  </p>
                </div>
              </div>
            </div>
          )}

        {hasCustomerIdentifier &&
          customerLookup?.status === "not-found" && (
            <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-3">
              <p className="text-[10px] font-medium text-orange-700">
                Cliente no encontrado
              </p>

              <p className="mt-0.5 text-[9px] leading-4 text-black/42">
                No encontramos un cliente con esa {lookupLabel}. Puedes completar el nombre y continuar la venta.
              </p>
            </div>
          )}

        {(customerLookup?.status === "not-found" ||
          customerLookup?.status === "idle" ||
          !hasCustomerIdentifier) && (
          <input
            value={checkout.customerName}
            onChange={(event) =>
              onUpdate(
                "customerName",
                event.target.value
              )
            }
            className="h-10 rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            placeholder="Nombre del cliente · opcional si no asocias cliente"
          />
        )}

        {customerLookup?.status === "found" &&
          !checkout.customerName && (
            <input
              value={checkout.customerName}
              onChange={(event) =>
                onUpdate(
                  "customerName",
                  event.target.value
                )
              }
              className="h-10 rounded-xl border border-black/[0.08] bg-white px-3 text-[11px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="Nombre del cliente"
            />
          )}

        <select
          value={checkout.paymentMethod}
          onChange={(event) => onUpdate("paymentMethod", event.target.value)}
          className="h-10 rounded-xl border border-black/[0.08] bg-white px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
        >
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="nequi">Nequi</option>
          <option value="daviplata">Daviplata</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="addi">Addi</option>
          <option value="mixto">Mixto</option>
          <option value="otro">Otro</option>
        </select>

        {checkout.paymentMethod === "mixto" && (
          <div className="rounded-2xl border border-black/[0.07] bg-[#fafafa] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium text-black/75">
                  Distribución del pago
                </p>
                <p className="mt-0.5 text-[8.5px] leading-4 text-black/42">
                  Divide el total entre dos o más métodos.
                </p>
              </div>

              <button
                type="button"
                onClick={onAddMixedPaymentRow}
                disabled={
                  checkout.mixedPayments.length >=
                  MIXED_PAYMENT_OPTIONS.length
                }
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-2 text-[8px] font-medium text-black/60 transition hover:bg-black/[0.025] disabled:opacity-35"
              >
                <Plus size={11} />
                Método
              </button>
            </div>

            <div className="mt-2 space-y-1.5">
              {checkout.mixedPayments.map(
                (payment, index) => (
                  <div
                    key={`${index}-${payment.method}`}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(90px,.9fr)_28px] gap-1.5"
                  >
                    <select
                      value={payment.method}
                      onChange={(event) =>
                        onUpdateMixedPayment(
                          index,
                          "method",
                          event.target.value
                        )
                      }
                      className="h-8 min-w-0 rounded-lg border border-black/[0.08] bg-white px-2 text-[8.5px] outline-none focus:border-red-600"
                    >
                      {MIXED_PAYMENT_OPTIONS.map(
                        (option) => (
                          <option
                            key={option.value}
                            value={option.value}
                          >
                            {option.label}
                          </option>
                        )
                      )}
                    </select>

                    <input
                      type="text"
                      inputMode="numeric"
                      value={payment.amount}
                      onChange={(event) =>
                        onUpdateMixedPayment(
                          index,
                          "amount",
                          event.target.value
                        )
                      }
                      className="h-8 min-w-0 rounded-lg border border-black/[0.08] bg-white px-2 text-right text-[8.5px] outline-none focus:border-red-600"
                      placeholder="$ 0"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        onRemoveMixedPaymentRow(index)
                      }
                      disabled={
                        checkout.mixedPayments.length <= 2
                      }
                      className="flex h-8 w-7 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 disabled:opacity-25"
                      aria-label="Quitar método"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              )}
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-black/[0.05]">
                <p className="text-[7px] text-black/38">Total</p>
                <p className="mt-0.5 text-[8.5px] font-medium">
                  {formatCurrency(summary.total)}
                </p>
              </div>

              <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-black/[0.05]">
                <p className="text-[7px] text-black/38">Distribuido</p>
                <p className="mt-0.5 text-[8.5px] font-medium">
                  {formatCurrency(summary.mixedPaid)}
                </p>
              </div>

              <div
                className={`rounded-lg px-2 py-1.5 ring-1 ${
                  summary.mixedPending <= 0 &&
                  summary.mixedExcess <= 0
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                    : "bg-red-50 text-red-700 ring-red-100"
                }`}
              >
                <p className="text-[7px] opacity-70">
                  {summary.mixedExcess > 0
                    ? "Exceso"
                    : "Pendiente"}
                </p>
                <p className="mt-0.5 text-[8.5px] font-medium">
                  {formatCurrency(
                    summary.mixedExcess > 0
                      ? summary.mixedExcess
                      : summary.mixedPending
                  )}
                </p>
              </div>
            </div>

            <p className="mt-2 text-[7.5px] leading-3.5 text-black/40">
              Addi se mantiene como método independiente porque su desembolso se confirma después.
            </p>
          </div>
        )}

        {checkout.paymentMethod === "addi" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700 ring-1 ring-amber-200">
                <Clock3 size={15} />
              </div>

              <div className="min-w-0">
                <p className="text-[10px] font-medium text-amber-800">
                  Pago por Addi
                </p>
                <p className="mt-0.5 text-[9px] leading-4 text-black/48">
                  La venta se registrará y descontará inventario normalmente,
                  pero el desembolso quedará pendiente hasta confirmar que Addi
                  realizó el pago.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-[10px] text-black/45">Descuento</span>
            <input
              type="text"
              inputMode="numeric"
              value={checkout.discount}
              onChange={(event) => onUpdate("discount", event.target.value)}
              className="mt-1 h-10 w-full min-w-0 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
              placeholder="0"
            />
          </label>

          {checkout.paymentMethod !== "mixto" ? (
            <label>
              <span className="text-[10px] text-black/45">
                {checkout.paymentMethod === "efectivo"
                  ? "Dinero recibido"
                  : checkout.paymentMethod === "addi"
                    ? "Monto financiado"
                    : "Total pagado"}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={
                  checkout.paymentMethod === "efectivo"
                    ? checkout.amountReceived
                    : summary.total
                }
                onChange={(event) =>
                  onUpdate("amountReceived", event.target.value)
                }
                disabled={checkout.paymentMethod !== "efectivo"}
                className="mt-1 h-10 w-full min-w-0 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45"
                placeholder="0"
              />
            </label>
          ) : (
            <div className="flex items-end">
              <div className="flex h-10 w-full items-center justify-between rounded-xl border border-black/[0.07] bg-[#fafafa] px-3">
                <span className="text-[9px] text-black/45">
                  Distribuido
                </span>
                <strong className="text-[10px] font-medium">
                  {formatCurrency(summary.mixedPaid)}
                </strong>
              </div>
            </div>
          )}
        </div>

        {checkout.paymentMethod === "efectivo" && (
          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2">
            <span className="text-[11px] text-emerald-700">Cambio</span>
            <strong className="text-[13px] font-medium text-emerald-700">
              {formatCurrency(summary.change)}
            </strong>
          </div>
        )}

        <input
          value={checkout.notes}
          onChange={(event) => onUpdate("notes", event.target.value)}
          className="h-10 rounded-xl border border-black/[0.08] px-3 text-[12px] outline-none placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
          placeholder="Notas opcionales"
        />
      </div>
    </section>
  );
}

function CartTotals({ summary, selling, disabled, paymentMethod }) {
  return (
    <div className="border-t border-black/[0.06] bg-white px-[clamp(12px,1vw,20px)] py-[clamp(10px,0.85vw,16px)]">
      <div className="space-y-2 text-[12px]">
        {Number(summary.promotionSavings || 0) > 0 && (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-black/40">Precio normal</span>
              <span className="text-black/40 line-through">
                {formatCurrency(summary.regularSubtotal)}
              </span>
            </div>

            <div className="flex justify-between gap-4 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-700">
              <span>Promociones aplicadas</span>
              <span>
                - {formatCurrency(summary.promotionSavings)}
              </span>
            </div>
          </>
        )}

        <div className="flex justify-between gap-4">
          <span className="text-black/50">Subtotal</span>
          <span>{formatCurrency(summary.subtotal)}</span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-black/50">Descuento</span>
          <span>- {formatCurrency(summary.discount)}</span>
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-black/[0.07] pt-3">
          <div>
            <p className="text-[11px] text-black/45">Total a pagar</p>
            <p className="mt-0.5 text-[clamp(19px,1.55vw,26px)] font-medium tracking-[-0.05em]">
              {formatCurrency(summary.total)}
            </p>
          </div>

          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] text-emerald-600">
            Ganancia {formatCurrency(summary.profit)}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={disabled || selling}
        className="mt-[clamp(10px,0.85vw,16px)] inline-flex h-[clamp(40px,3vw,48px)] w-full items-center justify-center gap-2 rounded-[clamp(12px,0.9vw,16px)] bg-red-600 px-[clamp(14px,1vw,20px)] text-[clamp(10px,0.78vw,14px)] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-black/15 disabled:shadow-none"
      >
        <CreditCard size={17} />
        {selling
          ? "Procesando venta..."
          : paymentMethod === "addi"
            ? "Registrar venta Addi"
            : paymentMethod === "mixto"
              ? "Cobrar pago mixto"
              : "Cobrar venta"}
      </button>
    </div>
  );
}

function MobileCartBar({ summary, onOpen }) {
  return (
    <div className="fixed inset-x-3 bottom-3 z-40 min-[900px]:hidden">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-16 w-full items-center justify-between rounded-[22px] border border-red-100 bg-white px-4 text-black shadow-[0_18px_55px_rgba(0,0,0,0.16)]"
      >
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-red-600">
            <ShoppingCart size={19} />
            {summary.totalItems > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[9px] font-medium text-red-600">
                {summary.totalItems}
              </span>
            )}
          </div>

          <div className="text-left">
            <p className="text-[10px] text-black/45">Venta actual</p>
            <p className="text-[16px] font-medium">
              {formatCurrency(summary.total)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px]">
          Ver carrito
          <ChevronRight size={17} />
        </div>
      </button>
    </div>
  );
}

function MobileCartDrawer(props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm min-[900px]:hidden">
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-hidden rounded-t-[30px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[12px] text-red-600">Punto de venta</p>
            <h2 className="mt-0.5 text-[18px] font-medium">Carrito</h2>
          </div>

          <button
            type="button"
            onClick={props.onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-73px)] overflow-y-auto">
          <CartPanel
            cart={props.cart}
            checkout={props.checkout}
            summary={props.summary}
            selling={props.selling}
            customerLookup={props.customerLookup}
            onUpdateCheckout={props.onUpdateCheckout}
            onCustomerDocumentChange={props.onCustomerDocumentChange}
            onCustomerPhoneChange={props.onCustomerPhoneChange}
            onClearCustomer={props.onClearCustomer}
            onUpdateMixedPayment={props.onUpdateMixedPayment}
            onAddMixedPaymentRow={props.onAddMixedPaymentRow}
            onRemoveMixedPaymentRow={props.onRemoveMixedPaymentRow}
            onUpdateQuantity={props.onUpdateQuantity}
            onRemoveItem={props.onRemoveItem}
            onClear={props.onClear}
            onSubmit={props.onSubmit}
          />
        </div>
      </div>
    </div>
  );
}


function QuickProductModal({
  onClose,
  onAdd,
}) {
  const [form, setForm] =
    useState(emptyQuickProduct);

  function update(field, value) {
    setForm((current) => ({
      ...current,
      [field]:
        field === "unitPrice" ||
        field === "costPrice"
          ? formatMoneyInput(value)
          : value,
    }));
  }

  function submit(event) {
    event.preventDefault();

    const added = onAdd(form);

    if (added) {
      setForm(emptyQuickProduct);
    }
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section className="max-h-[92svh] w-full overflow-hidden rounded-t-[24px] bg-white shadow-2xl sm:max-w-[520px] sm:rounded-[24px]">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-red-600">
              Venta rápida
            </p>
            <h2 className="mt-1 text-[17px] font-medium tracking-[-0.03em]">
              Producto sin inventario
            </h2>
            <p className="mt-1 text-[9px] text-black/42">
              Quedará registrado en la venta, pero no modifica inventario ni catálogo.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.07] bg-white text-black/50 transition hover:bg-black/[0.025]"
          >
            <X size={17} />
          </button>
        </div>

        <form
          onSubmit={submit}
          className="max-h-[calc(92svh-78px)] overflow-y-auto p-4 sm:p-5"
        >
          <div className="grid gap-3">
            <label>
              <span className="text-[10px] font-medium text-black/55">
                Nombre del producto *
              </span>
              <input
                value={form.productName}
                onChange={(event) =>
                  update(
                    "productName",
                    event.target.value
                  )
                }
                className="mt-1 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Ej. Buzo oversize nuevo"
                autoFocus
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="text-[10px] font-medium text-black/55">
                  Código opcional
                </span>
                <input
                  value={form.productCode}
                  onChange={(event) =>
                    update(
                      "productCode",
                      event.target.value
                    )
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none focus:border-red-600"
                  placeholder="Sin código"
                />
              </label>

              <label>
                <span className="text-[10px] font-medium text-black/55">
                  Talla
                </span>
                <input
                  value={form.size}
                  onChange={(event) =>
                    update(
                      "size",
                      event.target.value
                    )
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none focus:border-red-600"
                  placeholder="M, 32, única..."
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label>
                <span className="text-[10px] font-medium text-black/55">
                  Cantidad *
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(event) =>
                    update(
                      "quantity",
                      event.target.value.replace(
                        /\D/g,
                        ""
                      )
                    )
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none focus:border-red-600"
                />
              </label>

              <label>
                <span className="text-[10px] font-medium text-black/55">
                  Precio venta *
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.unitPrice}
                  onChange={(event) =>
                    update(
                      "unitPrice",
                      event.target.value
                    )
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none focus:border-red-600"
                  placeholder="$ 0"
                />
              </label>

              <label>
                <span className="text-[10px] font-medium text-black/55">
                  Costo
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.costPrice}
                  onChange={(event) =>
                    update(
                      "costPrice",
                      event.target.value
                    )
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none focus:border-red-600"
                  placeholder="$ 0"
                />
              </label>
            </div>

            <label>
              <span className="text-[10px] font-medium text-black/55">
                Nota opcional
              </span>
              <input
                value={form.note}
                onChange={(event) =>
                  update(
                    "note",
                    event.target.value
                  )
                }
                className="mt-1 h-10 w-full rounded-xl border border-black/[0.08] px-3 text-[11px] outline-none focus:border-red-600"
                placeholder="Ej. llegó hoy y aún no está cargado"
              />
            </label>
          </div>

          <div className="mt-4 rounded-xl bg-[#fafafa] px-3 py-2.5 text-[9px] leading-4 text-black/45 ring-1 ring-black/[0.05]">
            Esta venta sí aparecerá en historial, recibo, cliente y vendedor. No crea automáticamente el producto en inventario.
          </div>

          <button
            type="submit"
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-[11px] font-medium text-white shadow-lg shadow-red-600/15 transition hover:bg-red-700"
          >
            <Plus size={15} />
            Agregar a la venta
          </button>
        </form>
      </section>
    </div>
  );
}

function VariantSelectorModal({
  product,
  onClose,
  onSelect,
}) {
  const variants =
    getAvailableVariants(product);
  const coverImage =
    getProductCoverImage(product);
  const promotionActive =
    isPromotionProduct(product);
  const promotionStock =
    getProductPromotionStock(product);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[12px] text-red-600">
              Seleccionar talla y tipo de venta
            </p>
            <h2 className="mt-1 text-[19px] font-medium">
              {product.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-5">
          <div className="flex items-center gap-3 rounded-[20px] bg-black/[0.025] p-3">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white">
              {coverImage.url ? (
                <img
                  src={coverImage.url}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Camera
                  size={22}
                  className="text-black/25"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-black/45">
                {product.code || "Sin código"}
              </p>

              <p className="mt-1 text-[17px] font-medium">
                {formatCurrency(
                  product.salePrice
                )}
              </p>

              {promotionActive && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[7.5px] font-medium text-amber-700 ring-1 ring-amber-100">
                    <BadgePercent size={8} />
                    PROMO
                  </span>
                  <span className="text-[9px] font-medium text-red-600">
                    {formatCurrency(
                      product.promotionPrice
                    )}
                  </span>
                  <span className="text-[8px] text-black/38">
                    {promotionStock} u. seleccionada(s)
                  </span>
                </div>
              )}
            </div>
          </div>

          {promotionActive &&
            product.promotionNote && (
              <div className="mt-3 rounded-[14px] border border-amber-100 bg-amber-50/70 px-3 py-2.5">
                <p className="text-[8px] font-medium uppercase tracking-[0.08em] text-amber-700">
                  Observación de promoción
                </p>
                <p className="mt-1 text-[9px] leading-4 text-black/55">
                  {product.promotionNote}
                </p>
              </div>
            )}

          <p className="mt-5 text-[13px] font-medium">
            Elige la talla y si sale del stock normal o promocional
          </p>

          <div className="mt-3 space-y-2">
            {variants.map((variant) => {
              const normalStock =
                getNormalStockForVariant(
                  product,
                  variant
                );
              const promoStock =
                getPromotionStockForVariant(
                  product,
                  variant
                );

              return (
                <div
                  key={variant.id}
                  className="rounded-[18px] border border-black/[0.07] bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium">
                        Talla {variant.size}
                      </p>
                      <p className="mt-0.5 text-[8.5px] text-black/38">
                        Stock físico: {variant.stock} u.
                      </p>
                    </div>

                    <span className="rounded-full bg-black/[0.035] px-2.5 py-1 text-[8px] text-black/50">
                      {variant.stock} total
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={normalStock <= 0}
                      onClick={() =>
                        onSelect(
                          variant,
                          false
                        )
                      }
                      className="min-h-12 rounded-xl border border-black/[0.08] bg-white px-3 text-left transition hover:border-black disabled:cursor-not-allowed disabled:bg-black/[0.025] disabled:text-black/25"
                    >
                      <p className="text-[9px] font-medium uppercase tracking-[0.08em]">
                        Normal
                      </p>
                      <p className="mt-0.5 text-[8px] text-black/42">
                        {normalStock} u. ·{" "}
                        {formatCurrency(
                          product.salePrice
                        )}
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={promoStock <= 0}
                      onClick={() =>
                        onSelect(
                          variant,
                          true
                        )
                      }
                      className={`min-h-12 rounded-xl border px-3 text-left transition disabled:cursor-not-allowed disabled:bg-black/[0.025] disabled:text-black/25 ${
                        promoStock > 0
                          ? "border-amber-200 bg-amber-50/60 hover:border-amber-400"
                          : "border-black/[0.06]"
                      }`}
                    >
                      <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-amber-700">
                        Promoción
                      </p>
                      <p className="mt-0.5 text-[8px] text-black/48">
                        {promoStock} u. ·{" "}
                        {formatCurrency(
                          product.promotionPrice
                        )}
                      </p>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function SalesHistoryModal({ sales, onClose, onSelectSale }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[90vh] w-full max-w-[820px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[12px] text-red-600">Registro comercial</p>
            <h2 className="mt-1 text-[20px] font-medium">
              Historial de ventas
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.035]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-73px)] overflow-y-auto p-5">
          {sales.length === 0 ? (
            <div className="rounded-[22px] bg-black/[0.025] p-10 text-center">
              <ReceiptText size={32} className="mx-auto text-black/25" />
              <p className="mt-3 text-[14px] font-medium">
                Aún no hay ventas registradas
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sales.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => onSelectSale(sale)}
                  className="flex w-full items-center justify-between gap-4 rounded-[20px] border border-black/[0.06] bg-white p-4 text-left transition hover:bg-black/[0.02]"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {sale.saleNumber || "Venta anterior"}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-black/45">
                      {sale.totalItems || 0} artículo(s) · {sale.paymentMethod === "mixto" ? "pago mixto" : sale.paymentMethod || "efectivo"} · {sale.sellerName || "Sin vendedor"}
                    </p>

                    {sale.paymentMethod === "addi" && (
                      <span
                        className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[8px] font-medium ${
                          sale.addiStatus === "settled"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {sale.addiStatus === "settled"
                          ? "Addi recibido"
                          : "Addi pendiente"}
                      </span>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[15px] font-medium">
                      {formatCurrency(sale.total)}
                    </p>
                    <p className="mt-1 text-[10px] text-black/45">
                      Ver comprobante
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CompletedSaleModal({ sale, onClose, onNewSale, onPrint }) {
  const isAddi = sale.paymentMethod === "addi";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-[520px] overflow-hidden rounded-[30px] bg-white p-6 text-center shadow-2xl">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            isAddi
              ? "bg-amber-50 text-amber-700"
              : "bg-emerald-50 text-emerald-600"
          }`}
        >
          {isAddi ? <Clock3 size={32} /> : <CheckCircle2 size={34} />}
        </div>

        <p className="mt-5 text-[12px] text-red-600">
          {sale.saleNumber || "Venta registrada"}
        </p>

        <h2 className="mt-1 text-[25px] font-medium tracking-[-0.045em]">
          {isAddi ? "Venta registrada" : "Venta completada"}
        </h2>

        <p className="mt-2 text-[13px] text-black/50">
          {isAddi
            ? "El inventario fue actualizado y el desembolso de Addi quedó pendiente."
            : "El inventario fue actualizado correctamente."}
        </p>

        {isAddi && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">
            <p className="text-[10px] font-medium text-amber-800">
              Pendiente de desembolso
            </p>
            <p className="mt-1 text-[10px] leading-4 text-black/48">
              Esta operación aparecerá en Pagos Addi hasta que confirmes que el dinero fue recibido.
            </p>
          </div>
        )}

        <div className="mt-5 rounded-[22px] bg-black/[0.025] p-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-black/45">Artículos</span>
            <strong className="text-[13px] font-medium">
              {sale.totalItems || 0}
            </strong>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px] text-black/45">Método</span>
            <strong className="text-[13px] font-medium capitalize">
              {sale.paymentMethod}
            </strong>
          </div>

          {sale.paymentMethod === "mixto" &&
            Array.isArray(sale.payments) && (
              <div className="mt-2 space-y-1 rounded-xl bg-white px-3 py-2 ring-1 ring-black/[0.05]">
                {sale.payments.map((payment) => (
                  <div
                    key={`${payment.method}-${payment.amount}`}
                    className="flex items-center justify-between text-[10px]"
                  >
                    <span className="capitalize text-black/45">
                      {payment.method}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}

          <div className="mt-3 flex items-end justify-between border-t border-black/[0.07] pt-3">
            <span className="text-[12px] text-black/45">Total</span>
            <strong className="text-[24px] font-medium tracking-[-0.04em]">
              {formatCurrency(sale.total)}
            </strong>
          </div>

          {Number(sale.change || 0) > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2">
              <span className="text-[11px] text-emerald-700">Cambio</span>
              <strong className="text-[13px] text-emerald-700">
                {formatCurrency(sale.change)}
              </strong>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onPrint}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-[13px] font-medium text-red-600 transition hover:border-red-300 hover:bg-red-100"
        >
          <Printer size={16} />
          Ver e imprimir recibo
        </button>

        <button
          type="button"
          onClick={onNewSale}
          className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
        >
          <ShoppingBag size={16} />
          Nueva venta
        </button>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 text-[12px] text-black/45 transition hover:text-black"
        >
          Cerrar
        </button>
      </section>
    </div>
  );
}