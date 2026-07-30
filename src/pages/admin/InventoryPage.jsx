import { useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  Edit3,
  ExternalLink,
  Eye,
  GripVertical,
  ImagePlus,
  Images,
  Package,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  getOrCreateCategory,
  STORE_ID,
  subscribeCategories,
} from "../../services/categories.service";

import {
  createProduct,
  deleteProduct,
  getNextProductCodePreview,
  getProductCoverImage,
  getProductImages,
  normalizeProductVariants,
  subscribeProducts,
  updateProduct,
  MAX_PRODUCT_IMAGES,
} from "../../services/products.service";

import {
  calculateProfit,
  formatCurrency,
} from "../../utils/money";

import { getCurrentUserActor } from "../../services/auth.service";
import BarcodeLabel from "../../components/products/BarcodeLabel";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { getBlob, ref as storageRef } from "firebase/storage";
import { storage } from "../../firebase/firebase";

import {
  BACKGROUND_PROCESSING_MODES,
  standardizeProductImage,
  standardizeProductImages,
} from "../../services/productImageProcessing.service";

const createVariantId = () =>
  `variant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const createLocalImageId = () =>
  `image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const createInitialVariants = () => [
  {
    id: createVariantId(),
    size: "Talla única",
    stock: "1",
    barcode: "",
  },
];

const createEmptyForm = () => ({
  name: "",
  code: "",
  categoryId: "",
  categoryName: "",
  newCategoryName: "",
  costPrice: "",
  salePrice: "",
  variants: createInitialVariants(),
});

function normalizeSize(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "Talla única";

  const normalized = cleanValue.toUpperCase();

  if (
    normalized === "TALLA UNICA" ||
    normalized === "TALLA ÚNICA" ||
    normalized === "UNICA" ||
    normalized === "ÚNICA"
  ) {
    return "Talla única";
  }

  return normalized;
}

function normalizeProductName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trimStart()
    .toLocaleUpperCase("es-CO");
}

function normalizeCategoryName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trimStart()
    .toLocaleUpperCase("es-CO");
}

function reorderItems(items, fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function getTotalStock(product) {
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return product.variants.reduce(
      (total, variant) => total + Number(variant.stock || 0),
      0
    );
  }

  return Number(product?.stock || 0);
}

function getProductSizes(product) {
  const variants = normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );

  return variants.map((variant) => variant.size);
}

function getStockStatus(stock) {
  const value = Number(stock || 0);

  if (value <= 0) {
    return {
      label: "Agotado",
      text: "Stock: 0 unidades",
      filter: "out",
      badgeClass: "bg-red-50 text-red-600",
      stockClass: "text-red-600",
    };
  }

  if (value <= 6) {
    return {
      label: "Stock bajo",
      text: `Stock: ${value} unidades`,
      filter: "low",
      badgeClass: "bg-orange-50 text-orange-600",
      stockClass: "text-orange-600",
    };
  }

  return {
    label: "En stock",
    text: `Stock: ${value} unidades`,
    filter: "available",
    badgeClass: "bg-emerald-50 text-emerald-600",
    stockClass: "text-emerald-600",
  };
}

function revokePreview(preview) {
  if (preview?.startsWith("blob:")) {
    URL.revokeObjectURL(preview);
  }
}

function getOnlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatThousands(value) {
  const digits = getOnlyDigits(value);

  if (!digits) return "";

  const cleanDigits = digits.replace(/^0+(?=\d)/, "");

  return cleanDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseMoneyInput(value) {
  const digits = getOnlyDigits(value);

  if (!digits) return 0;

  return Number(digits);
}

function normalizeMoneyInputValue(value) {
  if (value === null || value === undefined || value === "") return "";

  return formatThousands(value);
}


function loadCropImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          "No se pudo abrir la imagen para recortarla. Revisa que el archivo siga disponible."
        )
      );

    image.decoding = "async";

    if (/^https?:\/\//i.test(String(source || ""))) {
      image.crossOrigin = "anonymous";
    }

    image.src = source;
  });
}

async function createLocalEditableImageUrl(source, storagePath = "") {
  const cleanSource = String(source || "").trim();
  const cleanStoragePath = String(storagePath || "").trim();

  if (!cleanSource && !cleanStoragePath) {
    throw new Error("No se encontró la imagen que deseas editar.");
  }

  if (
    cleanSource.startsWith("blob:") ||
    cleanSource.startsWith("data:")
  ) {
    return {
      url: cleanSource,
      revoke: false,
    };
  }

  let blob = null;

  /*
   * Las imágenes existentes se preparan de forma segura para su edición.
   * Esto evita el bloqueo CORS que produce fetch() sobre downloadURL.
   */
  if (cleanStoragePath) {
    try {
      blob = await getBlob(storageRef(storage, cleanStoragePath));
    } catch (error) {
      console.error("No se pudo descargar por ruta de Storage:", error);
    }
  }

  if (!blob && cleanSource) {
    try {
      const response = await fetch(cleanSource, {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        blob = await response.blob();
      }
    } catch (error) {
      console.error("No se pudo descargar por URL pública:", error);
    }
  }

  if (!blob) {
    throw new Error(
      "No se pudo preparar la imagen para editarla. Intenta nuevamente o reemplázala por una nueva."
    );
  }

  if (!blob.type.startsWith("image/")) {
    throw new Error("El archivo recibido no es una imagen válida.");
  }

  return {
    url: URL.createObjectURL(blob),
    revoke: true,
  };
}

function canvasToImageBlob(canvas, mimeType = "image/webp", quality = 0.94) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la imagen recortada."));
    }, mimeType, quality);
  });
}

function getCroppedFileName(originalName = "producto") {
  const cleanName = String(originalName || "producto")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "producto";
  return `${cleanName}-recortada.webp`;
}

async function createCroppedImageFile({
  imageUrl,
  cropPixels,
  rotation = 0,
  fileName = "producto",
  frame = null,
}) {
  const image = await loadCropImage(imageUrl);
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));

  const rotatedWidth = Math.round(
    image.naturalWidth * cos + image.naturalHeight * sin
  );
  const rotatedHeight = Math.round(
    image.naturalWidth * sin + image.naturalHeight * cos
  );

  const rotationCanvas = document.createElement("canvas");
  rotationCanvas.width = rotatedWidth;
  rotationCanvas.height = rotatedHeight;

  const rotationContext = rotationCanvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
  });

  if (!rotationContext) {
    throw new Error("El navegador no permite recortar esta imagen.");
  }

  rotationContext.imageSmoothingEnabled = true;
  rotationContext.imageSmoothingQuality = "high";
  rotationContext.translate(rotatedWidth / 2, rotatedHeight / 2);
  rotationContext.rotate(radians);
  rotationContext.drawImage(
    image,
    -image.naturalWidth / 2,
    -image.naturalHeight / 2
  );

  const safeCrop = {
    x: Math.max(Math.round(cropPixels?.x || 0), 0),
    y: Math.max(Math.round(cropPixels?.y || 0), 0),
    width: Math.max(Math.round(cropPixels?.width || 1), 1),
    height: Math.max(Math.round(cropPixels?.height || 1), 1),
  };

  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = safeCrop.width;
  croppedCanvas.height = safeCrop.height;

  const croppedContext = croppedCanvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
  });

  if (!croppedContext) {
    throw new Error("No se pudo crear el recorte final.");
  }

  croppedContext.imageSmoothingEnabled = true;
  croppedContext.imageSmoothingQuality = "high";
  croppedContext.clearRect(
    0,
    0,
    croppedCanvas.width,
    croppedCanvas.height
  );

  croppedContext.drawImage(
    rotationCanvas,
    safeCrop.x,
    safeCrop.y,
    safeCrop.width,
    safeCrop.height,
    0,
    0,
    safeCrop.width,
    safeCrop.height
  );

  let outputCanvas = croppedCanvas;

  if (frame) {
    const outputSize = Math.max(
      Number(frame.outputSize || 1200),
      600
    );
    const scale = Math.min(
      Math.max(Number(frame.scale || 0.82), 0.25),
      1.5
    );
    const offsetX = Math.min(
      Math.max(Number(frame.offsetX || 0), -100),
      100
    );
    const offsetY = Math.min(
      Math.max(Number(frame.offsetY || 0), -100),
      100
    );

    outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputSize;
    outputCanvas.height = outputSize;

    const outputContext = outputCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    if (!outputContext) {
      throw new Error("No se pudo crear el lienzo blanco final.");
    }

    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, outputSize, outputSize);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";

    const fitScale = Math.min(
      outputSize / croppedCanvas.width,
      outputSize / croppedCanvas.height
    );

    const drawWidth =
      croppedCanvas.width * fitScale * scale;
    const drawHeight =
      croppedCanvas.height * fitScale * scale;

    const movementRangeX = outputSize * 0.32;
    const movementRangeY = outputSize * 0.32;

    const drawX =
      (outputSize - drawWidth) / 2 +
      (offsetX / 100) * movementRangeX;
    const drawY =
      (outputSize - drawHeight) / 2 +
      (offsetY / 100) * movementRangeY;

    outputContext.drawImage(
      croppedCanvas,
      drawX,
      drawY,
      drawWidth,
      drawHeight
    );
  } else {
    const flatCanvas = document.createElement("canvas");
    flatCanvas.width = croppedCanvas.width;
    flatCanvas.height = croppedCanvas.height;

    const flatContext = flatCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    if (!flatContext) {
      throw new Error("No se pudo preparar la vista previa.");
    }

    flatContext.fillStyle = "#ffffff";
    flatContext.fillRect(
      0,
      0,
      flatCanvas.width,
      flatCanvas.height
    );
    flatContext.drawImage(croppedCanvas, 0, 0);
    outputCanvas = flatCanvas;
  }

  const blob = await canvasToImageBlob(outputCanvas);

  return new File(
    [blob],
    getCroppedFileName(fileName),
    {
      type: "image/webp",
      lastModified: Date.now(),
    }
  );
}

export default function InventoryPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [form, setForm] = useState(createEmptyForm());

  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");

  const [pendingCoverFile, setPendingCoverFile] = useState(null);
  const [pendingCoverPreview, setPendingCoverPreview] = useState("");

  const [existingImages, setExistingImages] = useState([]);
  const [galleryFiles, setGalleryFiles] = useState([]);
  const [pendingGalleryFiles, setPendingGalleryFiles] = useState([]);
  const [removedImagePaths, setRemovedImagePaths] = useState([]);

  const [editingProduct, setEditingProduct] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [labelProduct, setLabelProduct] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [suggestedCode, setSuggestedCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");

  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingImages, setProcessingImages] = useState(false);
  const [imageProcessingProgress, setImageProcessingProgress] = useState({
    current: 0,
    total: 0,
    progress: 0,
    message: "",
  });
  const [cropEditor, setCropEditor] = useState(null);
  const [savingCrop, setSavingCrop] = useState(false);
  const [normalizingNames, setNormalizingNames] = useState(false);
  const [nameNormalizationProgress, setNameNormalizationProgress] = useState({ current: 0, total: 0 });
  const [draggedGalleryItem, setDraggedGalleryItem] = useState(null);

  const productsPerPage = 8;

  useEffect(() => {
    setLoading(true);

    const unsubscribeProducts = subscribeProducts(
      (productsData) => {
        setProducts(productsData);
        setLoading(false);

        setDetailProduct((current) => {
          if (!current) return null;
          return productsData.find((product) => product.id === current.id) || null;
        });

        setLabelProduct((current) => {
          if (!current) return null;
          return productsData.find((product) => product.id === current.id) || null;
        });
      },
      () => {
        setLoading(false);
        alert("No se pudo escuchar el inventario en tiempo real.");
      },
      STORE_ID
    );

    const unsubscribeCategories = subscribeCategories(
      (categoriesData) =>
        setCategories(
          categoriesData.map((category) => ({
            ...category,
            name: normalizeCategoryName(category.name),
          }))
        ),
      () => alert("No se pudieron escuchar las categorías en tiempo real."),
      STORE_ID
    );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
    };
  }, []);

  useEffect(() => {
    return () => {
      revokePreview(coverPreview);
      revokePreview(pendingCoverPreview);
      galleryFiles.forEach((image) => revokePreview(image.preview));
      pendingGalleryFiles.forEach((image) => revokePreview(image.preview));
    };
  }, []);

  const profit = useMemo(() => {
    return calculateProfit(
      parseMoneyInput(form.costPrice),
      parseMoneyInput(form.salePrice)
    );
  }, [form.costPrice, form.salePrice]);

  const formTotalStock = useMemo(() => {
    return form.variants.reduce(
      (total, variant) => total + Number(variant.stock || 0),
      0
    );
  }, [form.variants]);

  const availableSizes = useMemo(() => {
    const sizes = products.flatMap((product) => getProductSizes(product));

    return [...new Set(sizes)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return products.filter((product) => {
      const productSizes = getProductSizes(product);
      const totalStock = getTotalStock(product);
      const stockStatus = getStockStatus(totalStock);

      const matchesSearch =
        !cleanSearch ||
        String(product.name || "").toLowerCase().includes(cleanSearch) ||
        String(product.code || "").toLowerCase().includes(cleanSearch) ||
        String(product.categoryName || "").toLowerCase().includes(cleanSearch) ||
        productSizes.some((size) =>
          String(size || "").toLowerCase().includes(cleanSearch)
        );

      const matchesCategory =
        categoryFilter === "all" || product.categoryId === categoryFilter;

      const matchesSize =
        sizeFilter === "all" || productSizes.includes(sizeFilter);

      const matchesStock =
        stockFilter === "all" || stockStatus.filter === stockFilter;

      return matchesSearch && matchesCategory && matchesSize && matchesStock;
    });
  }, [products, search, categoryFilter, sizeFilter, stockFilter]);

  const totalPages = Math.max(
    Math.ceil(filteredProducts.length / productsPerPage),
    1
  );

  const paginatedProducts = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * productsPerPage;

    return filteredProducts.slice(start, start + productsPerPage);
  }, [filteredProducts, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, sizeFilter, stockFilter]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]:
        field === "name"
          ? normalizeProductName(value)
          : field === "newCategoryName" || field === "categoryName"
            ? normalizeCategoryName(value)
            : value,
    }));
  }

  function updateVariant(variantId, field, value) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) =>
        variant.id === variantId ? { ...variant, [field]: value } : variant
      ),
    }));
  }

  function addVariant() {
    setForm((current) => ({
      ...current,
      variants: [
        ...current.variants,
        {
          id: createVariantId(),
          size: "",
          stock: "0",
          barcode: "",
        },
      ],
    }));
  }

  function removeVariant(variantId) {
    setForm((current) => {
      if (current.variants.length <= 1) return current;

      return {
        ...current,
        variants: current.variants.filter(
          (variant) => variant.id !== variantId
        ),
      };
    });
  }

  function moveExistingGalleryImage(imageId, direction) {
    setExistingImages((current) => {
      const cover = current.find((image) => image.type === "cover") || current[0] || null;
      const gallery = current.filter((image) => image.id !== cover?.id);
      const fromIndex = gallery.findIndex((image) => image.id === imageId);
      if (fromIndex < 0) return current;
      const toIndex = Math.min(Math.max(fromIndex + direction, 0), gallery.length - 1);
      const reordered = reorderItems(gallery, fromIndex, toIndex);
      const ordered = cover ? [cover, ...reordered] : reordered;
      return ordered.map((image, index) => ({
        ...image,
        type: index === 0 ? "cover" : "gallery",
        sortOrder: index,
      }));
    });
  }

  function moveNewGalleryImage(imageId, direction) {
    setGalleryFiles((current) => {
      const fromIndex = current.findIndex((image) => image.id === imageId);
      if (fromIndex < 0) return current;
      const toIndex = Math.min(Math.max(fromIndex + direction, 0), current.length - 1);
      return reorderItems(current, fromIndex, toIndex);
    });
  }

  function movePendingGalleryImage(imageId, direction) {
    setPendingGalleryFiles((current) => {
      const fromIndex = current.findIndex((image) => image.id === imageId);
      if (fromIndex < 0) return current;
      const toIndex = Math.min(Math.max(fromIndex + direction, 0), current.length - 1);
      return reorderItems(current, fromIndex, toIndex);
    });
  }

  function handleGalleryDragStart(group, imageId) {
    setDraggedGalleryItem({ group, imageId });
  }

  function handleGalleryDrop(group, targetId) {
    if (!draggedGalleryItem || draggedGalleryItem.group !== group || draggedGalleryItem.imageId === targetId) {
      setDraggedGalleryItem(null);
      return;
    }

    const setter = group === "existing"
      ? setExistingImages
      : group === "new"
        ? setGalleryFiles
        : setPendingGalleryFiles;

    setter((current) => {
      if (group === "existing") {
        const cover = current.find((image) => image.type === "cover") || current[0] || null;
        const gallery = current.filter((image) => image.id !== cover?.id);
        const fromIndex = gallery.findIndex((image) => image.id === draggedGalleryItem.imageId);
        const toIndex = gallery.findIndex((image) => image.id === targetId);
        const reordered = reorderItems(gallery, fromIndex, toIndex);
        const ordered = cover ? [cover, ...reordered] : reordered;
        return ordered.map((image, index) => ({
          ...image,
          type: index === 0 ? "cover" : "gallery",
          sortOrder: index,
        }));
      }

      const fromIndex = current.findIndex((image) => image.id === draggedGalleryItem.imageId);
      const toIndex = current.findIndex((image) => image.id === targetId);
      return reorderItems(current, fromIndex, toIndex);
    });

    setDraggedGalleryItem(null);
  }

  function clearMediaPreviews() {
    revokePreview(coverPreview);
    revokePreview(pendingCoverPreview);
    galleryFiles.forEach((image) => revokePreview(image.preview));
    pendingGalleryFiles.forEach((image) => revokePreview(image.preview));
  }

  function resetForm() {
    clearMediaPreviews();

    setForm(createEmptyForm());
    setCoverFile(null);
    setCoverPreview("");
    setPendingCoverFile(null);
    setPendingCoverPreview("");
    setExistingImages([]);
    setGalleryFiles([]);
    setPendingGalleryFiles([]);
    setRemovedImagePaths([]);

    setEditingProduct(null);
    setSuggestedCode("");
    setCodeTouched(false);
    setLoadingCode(false);
  }

  async function loadSuggestedCode() {
    try {
      setLoadingCode(true);

      const nextCode = await getNextProductCodePreview(STORE_ID);

      setSuggestedCode(nextCode);
      setCodeTouched(false);

      setForm((current) => ({
        ...current,
        code: nextCode,
      }));
    } catch (error) {
      console.error(error);

      setSuggestedCode("");
      setCodeTouched(false);

      setForm((current) => ({
        ...current,
        code: "",
      }));

      alert("No se pudo calcular el siguiente código automático.");
    } finally {
      setLoadingCode(false);
    }
  }

  async function openCreateForm() {
    resetForm();
    setShowForm(true);

    setForm((current) => ({
      ...current,
      code: "Calculando...",
    }));

    await loadSuggestedCode();
  }

  function closeForm() {
    resetForm();
    setShowForm(false);
  }

  function openPublicCatalog() {
    const catalogUrl = `${window.location.origin}/catalogo/${STORE_ID}`;

    window.open(catalogUrl, "_blank", "noopener,noreferrer");

    navigator.clipboard
      ?.writeText(catalogUrl)
      .then(() => console.log("Link del catálogo copiado:", catalogUrl))
      .catch(() =>
        console.log("No se pudo copiar automáticamente:", catalogUrl)
      );
  }

  function getProjectedImageCount({ includePending = true } = {}) {
    const hasExistingCover = existingImages.some(
      (image) => image.type === "cover"
    ) || existingImages.length > 0;

    const newCoverAddsSlot =
      !hasExistingCover && Boolean(coverFile || pendingCoverFile);

    return (
      existingImages.length +
      galleryFiles.length +
      Number(newCoverAddsSlot) +
      (includePending ? pendingGalleryFiles.length : 0)
    );
  }

  function clearPendingCover() {
    revokePreview(pendingCoverPreview);
    setPendingCoverFile(null);
    setPendingCoverPreview("");
  }

  function removePendingCover() {
    clearPendingCover();
  }

  async function handleCoverChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || processingImages) return;

    revokePreview(pendingCoverPreview);

    setPendingCoverFile(file);
    setPendingCoverPreview(URL.createObjectURL(file));
  }

  async function processPendingCover(backgroundMode) {
    if (!pendingCoverFile || processingImages) return;

    try {
      setProcessingImages(true);
      setImageProcessingProgress({
        current: 1,
        total: 1,
        progress: 0,
        message:
          backgroundMode === BACKGROUND_PROCESSING_MODES.REMOVE
            ? "Preparando portada para quitar fondo..."
            : "Preparando portada original...",
      });

      const processedFile = await standardizeProductImage(pendingCoverFile, {
        backgroundMode,
        onProgress: ({ progress, message }) => {
          setImageProcessingProgress({
            current: 1,
            total: 1,
            progress,
            message,
          });
        },
      });

      revokePreview(coverPreview);
      revokePreview(pendingCoverPreview);

      setCoverFile(processedFile);
      setCoverPreview(URL.createObjectURL(processedFile));
      setPendingCoverFile(null);
      setPendingCoverPreview("");
    } catch (error) {
      console.error(error);
      alert(
        error.message ||
          "No se pudo preparar la imagen de portada."
      );
    } finally {
      setProcessingImages(false);
      setImageProcessingProgress({
        current: 0,
        total: 0,
        progress: 0,
        message: "",
      });
    }
  }

  async function handleGalleryChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (files.length === 0 || processingImages) return;

    const currentCount = getProjectedImageCount();
    const availableSlots = MAX_PRODUCT_IMAGES - currentCount;

    if (availableSlots <= 0) {
      alert(`Puedes tener máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`);
      return;
    }

    const acceptedFiles = files.slice(0, availableSlots);

    if (acceptedFiles.length < files.length) {
      alert(
        `Solo se agregarán ${acceptedFiles.length} imágenes porque el máximo es ${MAX_PRODUCT_IMAGES}.`
      );
    }

    const newPendingImages = acceptedFiles.map((file) => ({
      id: createLocalImageId(),
      file,
      preview: URL.createObjectURL(file),
    }));

    setPendingGalleryFiles((current) => [...current, ...newPendingImages]);
  }

  function removePendingGalleryImage(imageId) {
    setPendingGalleryFiles((current) => {
      const imageToRemove = current.find((image) => image.id === imageId);

      if (imageToRemove) {
        revokePreview(imageToRemove.preview);
      }

      return current.filter((image) => image.id !== imageId);
    });
  }

  async function processPendingGalleryImage(imageId, backgroundMode) {
    const pendingImage = pendingGalleryFiles.find((image) => image.id === imageId);

    if (!pendingImage || processingImages) return;

    try {
      setProcessingImages(true);
      setImageProcessingProgress({
        current: 1,
        total: 1,
        progress: 0,
        message:
          backgroundMode === BACKGROUND_PROCESSING_MODES.REMOVE
            ? "Preparando imagen para quitar fondo..."
            : "Preparando imagen original...",
      });

      const processedFile = await standardizeProductImage(pendingImage.file, {
        backgroundMode,
        onProgress: ({ progress, message }) => {
          setImageProcessingProgress({
            current: 1,
            total: 1,
            progress,
            message,
          });
        },
      });

      revokePreview(pendingImage.preview);

      setGalleryFiles((current) => [
        ...current,
        {
          id: createLocalImageId(),
          file: processedFile,
          preview: URL.createObjectURL(processedFile),
        },
      ]);

      setPendingGalleryFiles((current) =>
        current.filter((image) => image.id !== imageId)
      );
    } catch (error) {
      console.error(error);
      alert(
        error.message ||
          "No se pudo preparar la imagen seleccionada."
      );
    } finally {
      setProcessingImages(false);
      setImageProcessingProgress({
        current: 0,
        total: 0,
        progress: 0,
        message: "",
      });
    }
  }

  async function processPendingGalleryImages(backgroundMode) {
    if (pendingGalleryFiles.length === 0 || processingImages) return;

    const pendingFiles = [...pendingGalleryFiles];

    try {
      setProcessingImages(true);
      setImageProcessingProgress({
        current: 1,
        total: pendingFiles.length,
        progress: 0,
        message:
          backgroundMode === BACKGROUND_PROCESSING_MODES.REMOVE
            ? "Preparando imágenes para quitar fondo..."
            : "Preparando imágenes originales...",
      });

      const processedFiles = await standardizeProductImages(
        pendingFiles.map((image) => image.file),
        {
          backgroundMode,
          onFileStart: ({ index, total }) => {
            setImageProcessingProgress({
              current: index + 1,
              total,
              progress: 0,
              message: "Preparando imagen...",
            });
          },
          onFileProgress: ({
            index,
            total,
            progress,
            message,
          }) => {
            setImageProcessingProgress({
              current: index + 1,
              total,
              progress,
              message,
            });
          },
        }
      );

      const newImages = processedFiles.map((processedFile) => ({
        id: createLocalImageId(),
        file: processedFile,
        preview: URL.createObjectURL(processedFile),
      }));

      pendingFiles.forEach((image) => revokePreview(image.preview));

      setGalleryFiles((current) => [...current, ...newImages]);
      setPendingGalleryFiles((current) =>
        current.filter(
          (image) => !pendingFiles.some((pending) => pending.id === image.id)
        )
      );
    } catch (error) {
      console.error(error);
      alert(
        error.message ||
          "No se pudieron preparar las imágenes seleccionadas."
      );
    } finally {
      setProcessingImages(false);
      setImageProcessingProgress({
        current: 0,
        total: 0,
        progress: 0,
        message: "",
      });
    }
  }

  function removeNewGalleryImage(imageId) {
    setGalleryFiles((current) => {
      const imageToRemove = current.find((image) => image.id === imageId);

      if (imageToRemove) {
        revokePreview(imageToRemove.preview);
      }

      return current.filter((image) => image.id !== imageId);
    });
  }

  function removeExistingImage(imageId) {
    setExistingImages((current) => {
      const imageToRemove = current.find((image) => image.id === imageId);

      if (imageToRemove?.path) {
        setRemovedImagePaths((paths) => [
          ...new Set([...paths, imageToRemove.path]),
        ]);
      }

      const remainingImages = current.filter((image) => image.id !== imageId);

      return remainingImages.map((image, index) => ({
        ...image,
        type: index === 0 ? "cover" : "gallery",
        sortOrder: index,
      }));
    });
  }

  function makeExistingImageCover(imageId) {
    revokePreview(coverPreview);
    revokePreview(pendingCoverPreview);

    setCoverFile(null);
    setCoverPreview("");
    setPendingCoverFile(null);
    setPendingCoverPreview("");

    setExistingImages((current) => {
      const selectedImage = current.find((image) => image.id === imageId);
      if (!selectedImage) return current;

      const remainingImages = current.filter((image) => image.id !== imageId);

      return [selectedImage, ...remainingImages].map((image, index) => ({
        ...image,
        type: index === 0 ? "cover" : "gallery",
        sortOrder: index,
      }));
    });
  }

  function makeNewGalleryImageCover(imageId) {
    const selectedImage = galleryFiles.find((image) => image.id === imageId);
    if (!selectedImage) return;

    revokePreview(coverPreview);
    revokePreview(pendingCoverPreview);

    setCoverFile(selectedImage.file);
    setCoverPreview(selectedImage.preview);
    setPendingCoverFile(null);
    setPendingCoverPreview("");

    setGalleryFiles((current) =>
      current.filter((image) => image.id !== imageId)
    );
  }

  function removeNewCover() {
    revokePreview(coverPreview);
    setCoverFile(null);
    setCoverPreview("");
  }

  function openCropEditor({ sourceUrl, sourceFile = null, targetType, targetId = "", existingImage = null }) {
    if (!sourceUrl || processingImages || savingCrop) return;
    setCropEditor({ sourceUrl, sourceFile, targetType, targetId, existingImage });
  }

  function closeCropEditor() {
    if (!savingCrop) setCropEditor(null);
  }

  async function saveCroppedImage({
    cropPixels,
    rotation,
    imageUrl,
    frame,
  }) {
    if (!cropEditor || !cropPixels || savingCrop) return;

    try {
      setSavingCrop(true);
      const originalName =
        cropEditor.sourceFile?.name ||
        cropEditor.existingImage?.name ||
        cropEditor.existingImage?.path?.split("/").pop() ||
        `${form.name || "producto"}.webp`;

      const croppedFile = await createCroppedImageFile({
        imageUrl: imageUrl || cropEditor.sourceUrl,
        cropPixels,
        rotation,
        fileName: originalName,
        frame,
      });
      const nextPreview = URL.createObjectURL(croppedFile);

      if (cropEditor.targetType === "pending-cover") {
        revokePreview(pendingCoverPreview);
        setPendingCoverFile(croppedFile);
        setPendingCoverPreview(nextPreview);
      } else if (cropEditor.targetType === "new-cover") {
        revokePreview(coverPreview);
        setCoverFile(croppedFile);
        setCoverPreview(nextPreview);
      } else if (cropEditor.targetType === "pending-gallery") {
        setPendingGalleryFiles((current) =>
          current.map((image) => {
            if (image.id !== cropEditor.targetId) return image;
            revokePreview(image.preview);
            return { ...image, file: croppedFile, preview: nextPreview };
          })
        );
      } else if (cropEditor.targetType === "new-gallery") {
        setGalleryFiles((current) =>
          current.map((image) => {
            if (image.id !== cropEditor.targetId) return image;
            revokePreview(image.preview);
            return { ...image, file: croppedFile, preview: nextPreview };
          })
        );
      } else if (cropEditor.targetType === "existing") {
        const image = cropEditor.existingImage;
        if (image?.path) {
          setRemovedImagePaths((paths) => [...new Set([...paths, image.path])]);
        }

        setExistingImages((current) => {
          const remaining = current.filter((item) => item.id !== image?.id);
          return remaining.map((item, index) => ({
            ...item,
            type: image?.type === "cover" ? "gallery" : item.type,
            sortOrder: image?.type === "cover" ? index + 1 : index,
          }));
        });

        if (image?.type === "cover") {
          revokePreview(coverPreview);
          setCoverFile(croppedFile);
          setCoverPreview(nextPreview);
        } else {
          setGalleryFiles((current) => [
            ...current,
            {
              id: createLocalImageId(),
              file: croppedFile,
              preview: nextPreview,
              editedFromExisting: true,
            },
          ]);
        }
      }

      setCropEditor(null);
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo guardar el recorte de la imagen.");
    } finally {
      setSavingCrop(false);
    }
  }

  function handleEdit(product) {
    resetForm();

    const normalizedVariants = normalizeProductVariants(
      product.variants,
      product.size,
      product.stock
    );

    const images = getProductImages(product);
    const coverImage = getProductCoverImage(product);

    setEditingProduct(product);
    setSuggestedCode("");
    setCodeTouched(true);

    setForm({
      name: normalizeProductName(product.name),
      code: product.code || "",
      categoryId: product.categoryId || "",
      categoryName: normalizeCategoryName(product.categoryName),
      newCategoryName: "",
      costPrice: normalizeMoneyInputValue(product.costPrice),
      salePrice: normalizeMoneyInputValue(product.salePrice),
      variants: normalizedVariants.map((variant) => ({
        id: variant.id || createVariantId(),
        size: variant.size || "Talla única",
        stock: String(variant.stock || 0),
        barcode: String(variant.barcode || ""),
      })),
    });

    setExistingImages(images);
    setCoverPreview(coverImage.url || "");
    setCoverFile(null);
    setPendingCoverFile(null);
    setPendingCoverPreview("");
    setGalleryFiles([]);
    setPendingGalleryFiles([]);
    setRemovedImagePaths([]);

    setShowForm(true);
  }

  function handleCodeChange(value) {
    setCodeTouched(true);
    updateForm("code", value);
  }

  function validateVariants() {
    if (!Array.isArray(form.variants) || form.variants.length === 0) {
      alert("Agrega al menos una talla al producto.");
      return null;
    }

    const normalizedVariants = form.variants.map((variant) => ({
      id: variant.id || createVariantId(),
      size: normalizeSize(variant.size),
      stock: Number(variant.stock || 0),
      barcode: String(variant.barcode || "").trim(),
    }));

    const invalidStock = normalizedVariants.some(
      (variant) =>
        !Number.isFinite(variant.stock) ||
        variant.stock < 0 ||
        !Number.isInteger(variant.stock)
    );

    if (invalidStock) {
      alert(
        "El stock de cada talla debe ser un número entero mayor o igual a 0."
      );
      return null;
    }

    const sizes = normalizedVariants.map((variant) => variant.size);
    const uniqueSizes = new Set(sizes);

    if (uniqueSizes.size !== sizes.length) {
      alert("No puedes repetir la misma talla dentro del producto.");
      return null;
    }

    return normalizedVariants;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const name = normalizeProductName(form.name).trim();

    const code =
      !editingProduct && !codeTouched && form.code === suggestedCode
        ? ""
        : form.code.trim();

    const costPrice = parseMoneyInput(form.costPrice);
    const salePrice = parseMoneyInput(form.salePrice);
    const normalizedVariants = validateVariants();

    if (!normalizedVariants) return;

    if (processingImages) {
      alert("Espera a que termine el procesamiento de las imágenes.");
      return;
    }

    if (pendingCoverFile || pendingGalleryFiles.length > 0) {
      alert("Decide si quieres quitar fondo o dejar original en las imágenes pendientes.");
      return;
    }

    if (!name) {
      alert("Escribe el nombre del producto.");
      return;
    }

    if (!form.categoryId && !form.newCategoryName.trim()) {
      alert("Selecciona o crea una categoría.");
      return;
    }

    if (costPrice <= 0) {
      alert("El precio de llegada debe ser mayor a cero.");
      return;
    }

    if (salePrice <= 0) {
      alert("El precio de venta debe ser mayor a cero.");
      return;
    }

    const totalImages = getProjectedImageCount({
      includePending: false,
    });

    if (totalImages > MAX_PRODUCT_IMAGES) {
      alert(`Puedes subir máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`);
      return;
    }

    try {
      setSaving(true);

      let selectedCategory = null;

      if (form.newCategoryName.trim()) {
        selectedCategory = await getOrCreateCategory(
          normalizeCategoryName(form.newCategoryName),
          STORE_ID
        );
      } else {
        selectedCategory = categories.find(
          (category) => category.id === form.categoryId
        );
      }

      if (!selectedCategory) {
        alert("No se encontró la categoría seleccionada.");
        return;
      }

      const productPayload = {
        storeId: STORE_ID,
        name,
        code,
        categoryId: selectedCategory.id,
        categoryName: normalizeCategoryName(selectedCategory.name),
        costPrice,
        salePrice,
        profitMargin: profit.profitMargin,
        profitPercent: profit.profitPercent,
        variants: normalizedVariants,
      };

      const actor = getCurrentUserActor();

      const mediaPayload = {
        coverFile,
        galleryFiles: galleryFiles.map((image) => image.file),
        retainedImages: existingImages.map((image, index) => ({
          ...image,
          type: index === 0 ? "cover" : "gallery",
          sortOrder: index,
        })),
        removedImagePaths,
      };

      if (editingProduct) {
        await updateProduct(
          editingProduct.id,
          productPayload,
          mediaPayload,
          editingProduct,
          actor
        );
      } else {
        await createProduct(
          productPayload,
          mediaPayload,
          STORE_ID,
          actor
        );
      }

      closeForm();
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo guardar el producto.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product) {
    const confirmDelete = window.confirm(
      `¿Seguro que deseas eliminar "${product.name}"? También se eliminarán todas sus imágenes y variantes.`
    );

    if (!confirmDelete) return;

    try {
      await deleteProduct(product.id);
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo eliminar el producto.");
    }
  }

  return (
    <main className="min-h-screen bg-white px-3 py-4 sm:px-5 lg:px-6">
      <section className="mx-auto max-w-[1540px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-medium tracking-[-0.045em] text-black">
              Inventario
            </h1>

            <p className="mt-1 text-[13px] font-normal text-black/50">
              Gestiona productos, imágenes, tallas y existencias
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={openPublicCatalog}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-5 text-[13px] font-medium text-black shadow-[0_12px_35px_rgba(0,0,0,0.04)] transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
            >
              <ExternalLink size={16} strokeWidth={1.9} />
              Publicar catálogo
            </button>

            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
            >
              <Plus size={17} strokeWidth={1.9} />
              Nuevo producto
            </button>
          </div>
        </header>

        <section className="mt-5 rounded-[26px] bg-white p-3 shadow-[0_16px_45px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06]">
          <div className="grid gap-3 lg:grid-cols-[1.45fr_0.82fr_0.78fr_0.78fr]">
            <label className="relative block">
              <Search
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/35"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-full rounded-2xl border border-black/[0.08] bg-white pl-11 pr-4 text-[13px] font-normal text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                placeholder="Buscar producto, código, categoría o talla..."
              />
            </label>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
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
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
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
              className="h-11 rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] font-normal text-black outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
            >
              <option value="all">Estado de stock</option>
              <option value="available">En stock</option>
              <option value="low">Stock bajo</option>
              <option value="out">Agotado</option>
            </select>
          </div>

          <section className="mt-4">
            {loading ? (
              <div className="rounded-[22px] bg-black/[0.025] p-8 text-center text-[13px] text-black/45">
                Cargando inventario en tiempo real...
              </div>
            ) : filteredProducts.length === 0 ? (
              <EmptyInventory onCreate={openCreateForm} />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {paginatedProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onView={() => setDetailProduct(product)}
                      onPrintLabels={() => setLabelProduct(product)}
                      onEdit={() => handleEdit(product)}
                      onDelete={() => handleDelete(product)}
                    />
                  ))}
                </div>

                <Pagination
                  page={page}
                  totalPages={totalPages}
                  totalItems={filteredProducts.length}
                  itemsPerPage={productsPerPage}
                  onPageChange={setPage}
                />
              </>
            )}
          </section>
        </section>
      </section>

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onPrintLabels={() => setLabelProduct(detailProduct)}
          onEdit={() => {
            const productToEdit = detailProduct;
            setDetailProduct(null);
            handleEdit(productToEdit);
          }}
        />
      )}

      {labelProduct && (
        <BarcodeLabel
          product={labelProduct}
          open={Boolean(labelProduct)}
          onClose={() => setLabelProduct(null)}
          defaultPreset="dual30x20"
          store={{
            name: "MASTER CAPS",
            logoUrl: "/logo.png",
            showStoreName: false,
          }}
        />
      )}

      {showForm && (
        <ProductFormModal
          editingProduct={editingProduct}
          closeForm={closeForm}
          handleSubmit={handleSubmit}
          handleCoverChange={handleCoverChange}
          handleGalleryChange={handleGalleryChange}
          processPendingCover={processPendingCover}
          removePendingCover={removePendingCover}
          processPendingGalleryImage={processPendingGalleryImage}
          processPendingGalleryImages={processPendingGalleryImages}
          removePendingGalleryImage={removePendingGalleryImage}
          removeNewCover={removeNewCover}
          removeNewGalleryImage={removeNewGalleryImage}
          removeExistingImage={removeExistingImage}
          makeExistingImageCover={makeExistingImageCover}
          makeNewGalleryImageCover={makeNewGalleryImageCover}
          coverPreview={coverPreview}
          coverFile={coverFile}
          pendingCoverFile={pendingCoverFile}
          pendingCoverPreview={pendingCoverPreview}
          existingImages={existingImages}
          galleryFiles={galleryFiles}
          pendingGalleryFiles={pendingGalleryFiles}
          form={form}
          updateForm={updateForm}
          updateVariant={updateVariant}
          addVariant={addVariant}
          removeVariant={removeVariant}
          handleCodeChange={handleCodeChange}
          loadingCode={loadingCode}
          categories={categories}
          saving={saving}
          profit={profit}
          formTotalStock={formTotalStock}
          processingImages={processingImages}
          imageProcessingProgress={imageProcessingProgress}
          openCropEditor={openCropEditor}
          moveExistingGalleryImage={moveExistingGalleryImage}
          moveNewGalleryImage={moveNewGalleryImage}
          movePendingGalleryImage={movePendingGalleryImage}
          handleGalleryDragStart={handleGalleryDragStart}
          handleGalleryDrop={handleGalleryDrop}
          draggedGalleryItem={draggedGalleryItem}
        />
      )}

      {cropEditor && (
        <ProductImageCropModal
          imageUrl={cropEditor.sourceUrl}
          storagePath={cropEditor.existingImage?.path || ""}
          saving={savingCrop}
          onClose={closeCropEditor}
          onSave={saveCroppedImage}
        />
      )}
    </main>
  );
}

function EmptyInventory({ onCreate }) {
  return (
    <div className="rounded-[22px] bg-black/[0.025] p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black/50 ring-1 ring-black/[0.06]">
        <Package size={24} />
      </div>

      <h2 className="mt-4 text-[17px] font-medium text-black">
        No hay productos todavía
      </h2>

      <p className="mt-2 text-[13px] text-black/45">
        Crea el primer producto del inventario.
      </p>

      <button
        type="button"
        onClick={onCreate}
        className="mt-5 rounded-2xl bg-red-600 px-5 py-3 text-[13px] font-medium text-white hover:bg-red-700"
      >
        Crear producto
      </button>
    </div>
  );
}

function ProductCard({ product, onView, onPrintLabels, onEdit, onDelete }) {
  const stock = getTotalStock(product);
  const stockStatus = getStockStatus(stock);
  const coverImage = getProductCoverImage(product);
  const images = getProductImages(product);
  const sizes = getProductSizes(product);

  return (
    <article className="rounded-[24px] bg-white p-3 shadow-[0_14px_40px_rgba(0,0,0,0.035)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(0,0,0,0.07)]">
      <div className="flex gap-3">
        <div className="relative flex h-[86px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[20px] bg-black/[0.025]">
          {coverImage.url ? (
            <img
              src={coverImage.url}
              alt={product.name}
              className="h-full w-full bg-white object-contain p-2"
            />
          ) : (
            <Camera size={25} className="text-black/30" />
          )}

          {images.length > 1 && (
            <span className="absolute bottom-1.5 right-1.5 rounded-lg bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
              {images.length}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-medium text-black">
                {product.name}
              </h3>

              <p className="mt-1 text-[12px] text-black/45">
                {product.code || "Sin código"}
              </p>

              <p className="mt-1 truncate text-[12px] text-black/50">
                {normalizeCategoryName(product.categoryName) || "SIN CATEGORÍA"}
              </p>
            </div>

            <button
              type="button"
              onClick={onView}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] text-black/45 transition hover:bg-black/[0.035] hover:text-black"
              title="Ver detalles"
            >
              <Eye size={15} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {sizes.slice(0, 3).map((size) => (
              <span
                key={size}
                className="inline-flex rounded-full bg-black/[0.025] px-2 py-1 text-[10px] text-black/60"
              >
                {size}
              </span>
            ))}

            {sizes.length > 3 && (
              <span className="inline-flex rounded-full bg-red-50 px-2 py-1 text-[10px] text-red-600">
                +{sizes.length - 3}
              </span>
            )}
          </div>

          <p className={`mt-2 text-[12px] font-normal ${stockStatus.stockClass}`}>
            {stockStatus.text}
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-black/[0.06] pt-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[16px] font-medium tracking-[-0.03em] text-black">
              {formatCurrency(product.salePrice)}
            </p>

            <p className="mt-1 text-[12px] text-black/45">
              Costo: {formatCurrency(product.costPrice)}
            </p>

            <p className="mt-1 text-[12px] text-black/45">
              Ganancia:{" "}
              <span className="text-emerald-600">
                {formatCurrency(product.profitMargin)}
              </span>
            </p>
          </div>

          <span
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-normal ${stockStatus.badgeClass}`}
          >
            {stockStatus.label}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onView}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-[11px] font-medium text-black transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
          >
            <Eye size={14} />
            Ver detalles
          </button>

          <button
            type="button"
            onClick={onPrintLabels}
            disabled={!product.code || stock <= 0}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-red-100 bg-red-50 text-[11px] font-medium text-red-600 transition hover:border-red-200 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              !product.code
                ? "El producto necesita un código"
                : stock <= 0
                  ? "El producto no tiene stock"
                  : "Generar e imprimir etiquetas"
            }
          >
            <Barcode size={14} />
            Etiquetas
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-[11px] font-medium text-black transition hover:border-red-500/25 hover:bg-red-50 hover:text-red-600"
          >
            <Edit3 size={14} />
            Editar
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-red-100 bg-white text-[11px] font-medium text-red-600 transition hover:bg-red-50"
            title="Eliminar producto"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductDetailModal({ product, onClose, onEdit, onPrintLabels }) {
  const images = getProductImages(product);
  const variants = normalizeProductVariants(
    product.variants,
    product.size,
    product.stock
  );
  const totalStock = getTotalStock(product);
  const stockStatus = getStockStatus(totalStock);

  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [product.id]);

  const activeImage = images[activeImageIndex] || null;

  function previousImage() {
    setActiveImageIndex((current) =>
      current <= 0 ? images.length - 1 : current - 1
    );
  }

  function nextImage() {
    setActiveImageIndex((current) =>
      current >= images.length - 1 ? 0 : current + 1
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[92vh] w-full max-w-[920px] overflow-y-auto rounded-[28px] bg-white shadow-2xl">
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-black/[0.06] bg-white/95 px-5 py-4 backdrop-blur-xl">
          <div className="min-w-0">
            <p className="text-[12px] font-normal text-red-600">
              Detalles del producto
            </p>

            <h2 className="mt-0.5 truncate text-[21px] font-medium tracking-[-0.035em] text-black">
              {product.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={19} />
          </button>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[340px_1fr]">
          <div>
            <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[24px] bg-black/[0.025]">
              {activeImage?.url ? (
                <img
                  src={activeImage.url}
                  alt={product.name}
                  className="h-full w-full bg-white object-contain p-2"
                />
              ) : (
                <Camera size={38} className="text-black/30" />
              )}

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={previousImage}
                    className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition hover:bg-white"
                  >
                    <ChevronLeft size={18} />
                  </button>

                  <button
                    type="button"
                    onClick={nextImage}
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition hover:bg-white"
                  >
                    <ChevronRight size={18} />
                  </button>
                </>
              )}

              {activeImage?.type === "cover" && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-[11px] text-white shadow-lg">
                  <Star size={12} fill="currentColor" />
                  Portada
                </span>
              )}
            </div>

            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-5 gap-2">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setActiveImageIndex(index)}
                    className={`relative aspect-square overflow-hidden rounded-xl border-2 transition ${
                      activeImageIndex === index
                        ? "border-red-600"
                        : "border-transparent"
                    }`}
                  >
                    <img
                      src={image.url}
                      alt={`${product.name} ${index + 1}`}
                      className="h-full w-full bg-white object-contain p-2"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="grid gap-2 sm:grid-cols-2">
              <DetailItem label="Código" value={product.code || "Sin código"} />
              <DetailItem
                label="Categoría"
                value={
                  normalizeCategoryName(product.categoryName) ||
                  "SIN CATEGORÍA"
                }
              />
              <DetailItem label="Estado" value={stockStatus.label} />
              <DetailItem
                label="Stock total"
                value={`${totalStock} unidad(es)`}
              />
              <DetailItem
                label="Precio llegada"
                value={formatCurrency(product.costPrice)}
              />
              <DetailItem
                label="Precio venta"
                value={formatCurrency(product.salePrice)}
              />
              <DetailItem
                label="Ganancia"
                value={`${formatCurrency(product.profitMargin)} · ${Number(
                  product.profitPercent || 0
                ).toFixed(1)}%`}
                highlight
              />
              <DetailItem
                label="Imágenes"
                value={`${images.length} archivo(s)`}
              />
            </div>

            <div className="mt-4 rounded-[22px] bg-black/[0.025] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-medium text-black">
                    Tallas y existencias
                  </p>

                  <p className="mt-1 text-[12px] text-black/45">
                    Stock independiente por variante
                  </p>
                </div>

                <span className="rounded-full bg-white px-3 py-1.5 text-[11px] text-black/60 ring-1 ring-black/[0.06]">
                  {variants.length} talla(s)
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {variants.map((variant) => (
                  <div
                    key={variant.id}
                    className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-black/[0.06]"
                  >
                    <span className="text-[13px] font-medium text-black">
                      {variant.size}
                    </span>

                    <span
                      className={`text-[12px] ${
                        Number(variant.stock || 0) > 0
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {variant.stock} unidad(es)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-black/[0.06] bg-white/95 px-5 py-4 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-black/[0.08] px-5 text-[13px] font-medium text-black/70 transition hover:bg-black/[0.035]"
          >
            Cerrar
          </button>

          <button
            type="button"
            onClick={onPrintLabels}
            disabled={!product.code || totalStock <= 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 text-[13px] font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Barcode size={15} />
            Imprimir etiquetas
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="h-10 rounded-xl bg-red-600 px-5 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
          >
            Editar producto
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailItem({ label, value, highlight = false }) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 ${
        highlight ? "bg-red-600 text-white" : "bg-black/[0.025] text-black"
      }`}
    >
      <p
        className={`text-[12px] ${
          highlight ? "text-white/65" : "text-black/45"
        }`}
      >
        {label}
      </p>

      <p className="mt-0.5 truncate text-[14px] font-medium">{value}</p>
    </div>
  );
}

function ProductFormModal({
  editingProduct,
  closeForm,
  handleSubmit,
  handleCoverChange,
  handleGalleryChange,
  processPendingCover,
  removePendingCover,
  processPendingGalleryImage,
  processPendingGalleryImages,
  removePendingGalleryImage,
  removeNewCover,
  removeNewGalleryImage,
  removeExistingImage,
  makeExistingImageCover,
  makeNewGalleryImageCover,
  coverPreview,
  coverFile,
  pendingCoverFile,
  pendingCoverPreview,
  existingImages,
  galleryFiles,
  pendingGalleryFiles,
  form,
  updateForm,
  updateVariant,
  addVariant,
  removeVariant,
  handleCodeChange,
  loadingCode,
  categories,
  saving,
  profit,
  formTotalStock,
  processingImages,
  imageProcessingProgress,
  openCropEditor,
  moveExistingGalleryImage,
  moveNewGalleryImage,
  movePendingGalleryImage,
  handleGalleryDragStart,
  handleGalleryDrop,
  draggedGalleryItem,
}) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  const hasExistingCover =
    existingImages.some((image) => image.type === "cover") ||
    existingImages.length > 0;

  const newCoverAddsSlot =
    !hasExistingCover && Boolean(coverFile || pendingCoverFile);

  const totalImages =
    existingImages.length +
    galleryFiles.length +
    pendingGalleryFiles.length +
    Number(newCoverAddsSlot);

  const currentCoverImage =
    pendingCoverPreview ||
    coverPreview ||
    existingImages.find((image) => image.type === "cover")?.url ||
    existingImages[0]?.url ||
    "";

  const stepMeta = [
    {
      number: 1,
      title: "Información",
      description: "Nombre, código y categoría",
    },
    {
      number: 2,
      title: "Imágenes",
      description: "Portada y galería",
    },
    {
      number: 3,
      title: "Tallas",
      description: "Variantes y existencias",
    },
    {
      number: 4,
      title: "Precios",
      description: "Valores y confirmación",
    },
  ];

  function validateCurrentStep() {
    if (step === 1) {
      if (!form.name.trim()) {
        alert("Escribe el nombre del producto.");
        return false;
      }

      if (!form.categoryId && !form.newCategoryName.trim()) {
        alert("Selecciona o crea una categoría.");
        return false;
      }
    }

    if (step === 2) {
      if (totalImages > MAX_PRODUCT_IMAGES) {
        alert(`Puedes subir máximo ${MAX_PRODUCT_IMAGES} imágenes.`);
        return false;
      }

      if (pendingCoverFile || pendingGalleryFiles.length > 0) {
        alert("Decide si quieres quitar fondo o dejar original en las imágenes pendientes.");
        return false;
      }
    }

    if (step === 3) {
      if (!Array.isArray(form.variants) || form.variants.length === 0) {
        alert("Agrega al menos una talla.");
        return false;
      }

      const normalizedSizes = form.variants.map((variant) =>
        normalizeSize(variant.size)
      );

      if (new Set(normalizedSizes).size !== normalizedSizes.length) {
        alert("No puedes repetir la misma talla.");
        return false;
      }

      const hasInvalidStock = form.variants.some((variant) => {
        const stock = Number(variant.stock || 0);
        return !Number.isInteger(stock) || stock < 0;
      });

      if (hasInvalidStock) {
        alert("El stock debe ser un número entero mayor o igual a cero.");
        return false;
      }
    }

    if (step === 4) {
      if (parseMoneyInput(form.costPrice) <= 0) {
        alert("El precio de llegada debe ser mayor a cero.");
        return false;
      }

      if (parseMoneyInput(form.salePrice) <= 0) {
        alert("El precio de venta debe ser mayor a cero.");
        return false;
      }
    }

    return true;
  }

  function goNext() {
    if (!validateCurrentStep()) return;
    setStep((current) => Math.min(current + 1, totalSteps));
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 1));
  }

  function goToStep(nextStep) {
    setStep(Math.min(Math.max(nextStep, 1), totalSteps));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-3 py-4 backdrop-blur-sm sm:px-4">
      <section className="flex h-[min(760px,92vh)] w-full max-w-[1120px] flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-5 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[12px] font-normal text-red-600">
              {editingProduct ? "Editar producto" : "Nuevo producto"}
            </p>

            <h2 className="mt-0.5 truncate text-[21px] font-medium tracking-[-0.035em] text-black">
              Registro guiado de producto
            </h2>
          </div>

          <button
            type="button"
            onClick={closeForm}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035] text-black/60 transition hover:bg-red-50 hover:text-red-600"
          >
            <X size={20} />
          </button>
        </header>

        <nav className="shrink-0 border-b border-black/[0.06] bg-[#fafafa] px-4 py-2 sm:px-6">
          <div className="grid grid-cols-4 gap-2">
            {stepMeta.map((item) => {
              const active = step === item.number;
              const completed = step > item.number;

              return (
                <button
                  key={item.number}
                  type="button"
                  onClick={() => goToStep(item.number)}
                  className={`min-w-0 rounded-2xl px-2 py-2.5 text-left transition sm:px-3 ${
                    active
                      ? "bg-red-600 text-white shadow-lg shadow-red-600/15"
                      : completed
                        ? "bg-red-50 text-red-600"
                        : "bg-white text-black/45 ring-1 ring-black/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[11px] font-medium ${
                        active
                          ? "bg-white/18 text-white"
                          : completed
                            ? "bg-red-600 text-white"
                            : "bg-black/[0.04] text-black/45"
                      }`}
                    >
                      {item.number}
                    </span>

                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium sm:text-[12px]">
                        {item.title}
                      </p>
                      <p
                        className={`hidden truncate text-[10px] sm:block ${
                          active ? "text-white/65" : "text-black/35"
                        }`}
                      >
                        {item.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        <form
          onSubmit={(event) => event.preventDefault()}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
            {step === 1 && (
              <section className="mx-auto max-w-[760px]">
                <StepHeading
                  title="Información general"
                  description="Define los datos básicos con los que identificarás el producto."
                />

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <InputField
                    label="Nombre del producto"
                    value={form.name}
                    onChange={(value) => updateForm("name", value)}
                    placeholder="Ej: CAMISETA OVERSIZE NEGRA"
                    helper="Se formatea automáticamente en mayúsculas."
                  />

                  <InputField
                    label="Código"
                    value={form.code}
                    onChange={handleCodeChange}
                    disabled={loadingCode}
                    placeholder="Ej: CAM-0001"
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="text-[13px] font-normal text-black/65">
                      Categoría existente
                    </span>

                    <select
                      value={form.categoryId}
                      onChange={(event) => {
                        const selected = categories.find(
                          (category) => category.id === event.target.value
                        );

                        updateForm("categoryId", event.target.value);
                        updateForm("categoryName", selected?.name || "");
                        updateForm("newCategoryName", "");
                      }}
                      className="mt-2 h-11 w-full rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                    >
                      <option value="">
                        {categories.length === 0
                          ? "No hay categorías creadas"
                          : "Seleccionar categoría"}
                      </option>

                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <InputField
                    label="Crear nueva categoría"
                    value={form.newCategoryName}
                    onChange={(value) => {
                      updateForm("newCategoryName", value);
                      updateForm("categoryId", "");
                      updateForm("categoryName", "");
                    }}
                    placeholder="Ej: Camisetas"
                  />
                </div>

                <div className="mt-5 rounded-[24px] bg-black/[0.025] p-4">
                  <p className="text-[13px] font-medium text-black">
                    Resumen inicial
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <SummaryBox label="Producto" value={form.name || "Pendiente"} />
                    <SummaryBox label="Código" value={form.code || "Automático"} />
                    <SummaryBox
                      label="Categoría"
                      value={
                        form.newCategoryName ||
                        form.categoryName ||
                        "Pendiente"
                      }
                    />
                  </div>
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="mx-auto max-w-[980px]">
                <StepHeading
                  title="Imágenes del producto"
                  description="Sube, edita y organiza las imágenes en el orden exacto en que deseas mostrarlas."
                />

                {processingImages && (
                  <div className="mt-4 rounded-[18px] border border-red-100 bg-red-50/60 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-medium text-red-700">
                          Procesando imagen {imageProcessingProgress.current} de{" "}
                          {imageProcessingProgress.total}
                        </p>
                        <p className="mt-0.5 text-[9px] text-red-600/70">
                          {imageProcessingProgress.message}
                        </p>
                      </div>

                      <span className="text-[11px] font-medium text-red-700">
                        {imageProcessingProgress.progress}%
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-red-100">
                      <div
                        className="h-full rounded-full bg-red-600 transition-all duration-300"
                        style={{
                          width: `${Math.max(
                            Math.min(imageProcessingProgress.progress, 100),
                            4
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-3 grid gap-4 lg:grid-cols-[300px_1fr]">
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-medium text-black">
                        Imagen de portada
                      </p>
                      {currentCoverImage && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1.5 text-[10px] text-red-600">
                          <Star size={11} fill="currentColor" />
                          Portada
                        </span>
                      )}
                    </div>

                    <label className="mt-3 block cursor-pointer">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        onChange={handleCoverChange}
                        className="hidden"
                        disabled={processingImages}
                      />

                      <div className="relative flex aspect-square max-h-[300px] items-center justify-center overflow-hidden rounded-[22px] border border-dashed border-black/15 bg-black/[0.025] transition hover:border-red-400 hover:bg-red-50/30">
                        {currentCoverImage ? (
                          <>
                          <img
                            src={currentCoverImage}
                            alt="Vista previa de portada"
                            className="h-full w-full bg-white object-contain p-2"
                          />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openCropEditor({
                                sourceUrl: currentCoverImage,
                                sourceFile: pendingCoverFile || coverFile || null,
                                targetType: pendingCoverFile
                                  ? "pending-cover"
                                  : coverFile
                                    ? "new-cover"
                                    : "existing",
                                existingImage:
                                  !pendingCoverFile && !coverFile
                                    ? existingImages.find((image) => image.type === "cover") || existingImages[0] || null
                                    : null,
                              });
                            }}
                            className="absolute right-3 top-3 inline-flex h-9 items-center gap-2 rounded-xl bg-white/95 px-3 text-[10px] font-medium text-black shadow-lg ring-1 ring-black/[0.06] transition hover:bg-red-50 hover:text-red-600"
                          >
                            <Crop size={14} />
                            Recortar
                          </button>
                          </>
                        ) : (
                          <div className="px-5 text-center">
                            <Camera size={30} className="mx-auto text-black/35" />
                            <p className="mt-3 text-[13px] font-medium text-black">
                              Seleccionar portada
                            </p>
                            <p className="mt-1 text-[11px] text-black/40">
                              JPG, PNG, WEBP o AVIF
                            </p>
                          </div>
                        )}

                        {currentCoverImage && (
                          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 px-3 py-2 text-center text-[10px] text-white backdrop-blur">
                            Pulsa para reemplazar
                          </div>
                        )}
                      </div>
                    </label>

                    {pendingCoverFile && (
                      <BackgroundDecisionCard
                        title="Portada pendiente"
                        description="Revisa la foto y elige qué hacer antes de guardarla."
                        onRemove={() =>
                          processPendingCover(BACKGROUND_PROCESSING_MODES.REMOVE)
                        }
                        onKeep={() =>
                          processPendingCover(BACKGROUND_PROCESSING_MODES.KEEP)
                        }
                        onCancel={removePendingCover}
                        disabled={processingImages}
                      />
                    )}

                    {coverFile && !pendingCoverFile && (
                      <button
                        type="button"
                        onClick={removeNewCover}
                        className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-white text-[11px] text-red-600 transition hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                        Quitar nueva portada
                      </button>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium text-black">
                          Galería
                        </p>
                        <p className="mt-1 text-[11px] text-black/45">
                          {totalImages} de {MAX_PRODUCT_IMAGES} imágenes · arrastra o usa las flechas para ordenar
                        </p>
                      </div>

                      <label
                        className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl px-3 text-[11px] transition ${
                          totalImages >= MAX_PRODUCT_IMAGES
                            ? "pointer-events-none bg-black/[0.04] text-black/30"
                            : "bg-red-50 text-red-600 hover:bg-red-100"
                        }`}
                      >
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif"
                          multiple
                          onChange={handleGalleryChange}
                          className="hidden"
                          disabled={totalImages >= MAX_PRODUCT_IMAGES || processingImages}
                        />
                        <ImagePlus size={14} />
                        Agregar imágenes
                      </label>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                      {existingImages.map((image) => (
                        <GalleryImageItem
                          key={image.id}
                          imageUrl={image.url}
                          isCover={image.type === "cover" && !coverFile && !pendingCoverFile}
                          orderLabel={image.type === "cover" ? "Portada" : `Posición ${Math.max(existingImages.findIndex((item) => item.id === image.id), 1)}`}
                          canMoveBackward={image.type !== "cover" && existingImages.findIndex((item) => item.id === image.id) > 1}
                          canMoveForward={image.type !== "cover" && existingImages.findIndex((item) => item.id === image.id) < existingImages.length - 1}
                          onMoveBackward={() => moveExistingGalleryImage(image.id, -1)}
                          onMoveForward={() => moveExistingGalleryImage(image.id, 1)}
                          draggable={image.type !== "cover"}
                          dragging={draggedGalleryItem?.group === "existing" && draggedGalleryItem?.imageId === image.id}
                          onDragStart={() => handleGalleryDragStart("existing", image.id)}
                          onDrop={() => handleGalleryDrop("existing", image.id)}
                          onSetCover={() => makeExistingImageCover(image.id)}
                          onEdit={() =>
                            openCropEditor({
                              sourceUrl: image.url,
                              targetType: "existing",
                              targetId: image.id,
                              existingImage: image,
                            })
                          }
                          onRemove={() => removeExistingImage(image.id)}
                        />
                      ))}

                      {galleryFiles.map((image) => (
                        <GalleryImageItem
                          key={image.id}
                          imageUrl={image.preview}
                          isCover={false}
                          orderLabel={`Nueva ${galleryFiles.findIndex((item) => item.id === image.id) + 1}`}
                          canMoveBackward={galleryFiles.findIndex((item) => item.id === image.id) > 0}
                          canMoveForward={galleryFiles.findIndex((item) => item.id === image.id) < galleryFiles.length - 1}
                          onMoveBackward={() => moveNewGalleryImage(image.id, -1)}
                          onMoveForward={() => moveNewGalleryImage(image.id, 1)}
                          draggable
                          dragging={draggedGalleryItem?.group === "new" && draggedGalleryItem?.imageId === image.id}
                          onDragStart={() => handleGalleryDragStart("new", image.id)}
                          onDrop={() => handleGalleryDrop("new", image.id)}
                          onSetCover={() => makeNewGalleryImageCover(image.id)}
                          onEdit={() =>
                            openCropEditor({
                              sourceUrl: image.preview,
                              sourceFile: image.file,
                              targetType: "new-gallery",
                              targetId: image.id,
                            })
                          }
                          onRemove={() => removeNewGalleryImage(image.id)}
                          isNew
                        />
                      ))}

                      {pendingGalleryFiles.map((image) => (
                        <PendingGalleryImageItem
                          key={image.id}
                          imageUrl={image.preview}
                          orderLabel={`Pendiente ${pendingGalleryFiles.findIndex((item) => item.id === image.id) + 1}`}
                          canMoveBackward={pendingGalleryFiles.findIndex((item) => item.id === image.id) > 0}
                          canMoveForward={pendingGalleryFiles.findIndex((item) => item.id === image.id) < pendingGalleryFiles.length - 1}
                          onMoveBackward={() => movePendingGalleryImage(image.id, -1)}
                          onMoveForward={() => movePendingGalleryImage(image.id, 1)}
                          draggable
                          dragging={draggedGalleryItem?.group === "pending" && draggedGalleryItem?.imageId === image.id}
                          onDragStart={() => handleGalleryDragStart("pending", image.id)}
                          onDrop={() => handleGalleryDrop("pending", image.id)}
                          onRemoveBackground={() =>
                            processPendingGalleryImage(
                              image.id,
                              BACKGROUND_PROCESSING_MODES.REMOVE
                            )
                          }
                          onKeepBackground={() =>
                            processPendingGalleryImage(
                              image.id,
                              BACKGROUND_PROCESSING_MODES.KEEP
                            )
                          }
                          onEdit={() =>
                            openCropEditor({
                              sourceUrl: image.preview,
                              sourceFile: image.file,
                              targetType: "pending-gallery",
                              targetId: image.id,
                            })
                          }
                          onRemove={() => removePendingGalleryImage(image.id)}
                          disabled={processingImages}
                        />
                      ))}

                      {totalImages < MAX_PRODUCT_IMAGES && (
                        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-black/40 transition hover:border-red-400 hover:bg-red-50 hover:text-red-600">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/avif"
                            multiple
                            onChange={handleGalleryChange}
                            className="hidden"
                            disabled={processingImages}
                          />
                          <Images size={21} />
                          <span className="mt-1 text-[9px]">Añadir fotos</span>
                        </label>
                      )}
                    </div>

                    {pendingGalleryFiles.length > 0 && (
                      <BackgroundDecisionCard
                        className="mt-3"
                        title={`${pendingGalleryFiles.length} imagen(es) pendiente(s)`}
                        description="Elige una acción para preparar estas imágenes."
                        removeLabel="Quitar fondo a todas"
                        keepLabel="Dejar originales"
                        onRemove={() =>
                          processPendingGalleryImages(
                            BACKGROUND_PROCESSING_MODES.REMOVE
                          )
                        }
                        onKeep={() =>
                          processPendingGalleryImages(
                            BACKGROUND_PROCESSING_MODES.KEEP
                          )
                        }
                        disabled={processingImages}
                      />
                    )}
                  </div>
                </div>
              </section>
            )}

            {step === 3 && (
              <section className="mx-auto max-w-[780px]">
                <StepHeading
                  title="Tallas y existencias"
                  description="Registra todas las variantes del mismo producto y su stock."
                />

                <div className="mt-5 rounded-[24px] border border-black/[0.06] bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[13px] font-medium text-black">
                        Variantes del producto
                      </p>
                      <p className="mt-1 text-[11px] text-black/45">
                        Ejemplos: S, M, L, XL, 30, 32 o Talla única
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={addVariant}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-red-50 px-3 text-[11px] font-medium text-red-600 transition hover:bg-red-100"
                    >
                      <Plus size={14} />
                      Agregar talla
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {form.variants.map((variant, index) => (
                      <div
                        key={variant.id}
                        className="grid gap-2 rounded-2xl bg-black/[0.025] p-3 sm:grid-cols-[1fr_160px_40px]"
                      >
                        <InputField
                          label={`Talla ${index + 1}`}
                          value={variant.size}
                          onChange={(value) =>
                            updateVariant(variant.id, "size", value)
                          }
                          placeholder="Ej: S, M, L, XL, 32"
                          compact
                        />

                        <InputField
                          label="Stock"
                          type="number"
                          min="0"
                          value={variant.stock}
                          onChange={(value) =>
                            updateVariant(variant.id, "stock", value)
                          }
                          placeholder="0"
                          compact
                        />

                        <button
                          type="button"
                          onClick={() => removeVariant(variant.id)}
                          disabled={form.variants.length <= 1}
                          className="mt-6 flex h-10 w-10 items-center justify-center rounded-xl border border-red-100 bg-white text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
                          title="Eliminar talla"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-2xl bg-red-50 px-4 py-3">
                    <div>
                      <p className="text-[11px] text-red-600/70">
                        Stock total calculado
                      </p>
                      <p className="mt-0.5 text-[18px] font-medium text-red-600">
                        {formTotalStock} unidad(es)
                      </p>
                    </div>
                    <Package size={22} className="text-red-600" />
                  </div>
                </div>
              </section>
            )}

            {step === 4 && (
              <section className="mx-auto max-w-[780px]">
                <StepHeading
                  title="Precios y confirmación"
                  description="Completa los valores y revisa el producto antes de guardarlo."
                />

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <MoneyInputField
                    label="Precio llegada"
                    value={form.costPrice}
                    onChange={(value) => updateForm("costPrice", value)}
                    placeholder="45.000"
                  />

                  <MoneyInputField
                    label="Precio venta"
                    value={form.salePrice}
                    onChange={(value) => updateForm("salePrice", value)}
                    placeholder="85.000"
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] bg-black/[0.025] p-4">
                    <p className="text-[11px] text-black/45">
                      Ganancia por unidad
                    </p>
                    <p className="mt-1 text-[20px] font-medium text-black">
                      {formatCurrency(profit.profitMargin)}
                    </p>
                  </div>

                  <div className="rounded-[22px] bg-red-600 p-4 text-white">
                    <p className="text-[11px] text-white/65">
                      Porcentaje de ganancia
                    </p>
                    <p className="mt-1 text-[20px] font-medium">
                      {profit.profitPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-[24px] border border-black/[0.06] bg-white p-4">
                  <p className="text-[13px] font-medium text-black">
                    Resumen final
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryBox label="Producto" value={form.name || "Pendiente"} />
                    <SummaryBox
                      label="Categoría"
                      value={
                        form.newCategoryName ||
                        form.categoryName ||
                        "Pendiente"
                      }
                    />
                    <SummaryBox
                      label="Tallas"
                      value={`${form.variants.length} variante(s)`}
                    />
                    <SummaryBox
                      label="Stock total"
                      value={`${formTotalStock} unidad(es)`}
                    />
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <SummaryBox
                      label="Imágenes"
                      value={`${totalImages} archivo(s)`}
                    />
                    <SummaryBox
                      label="Precio venta"
                      value={formatCurrency(parseMoneyInput(form.salePrice))}
                    />
                  </div>
                </div>
              </section>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] bg-white px-5 py-3 sm:px-6">
            <button
              type="button"
              onClick={step === 1 ? closeForm : goBack}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-black/[0.08] px-5 text-[13px] font-medium text-black/70 transition hover:bg-black/[0.035]"
            >
              {step === 1 ? "Cancelar" : "Anterior"}
            </button>

            <div className="hidden text-center sm:block">
              <p className="text-[11px] text-black/40">
                Paso {step} de {totalSteps}
              </p>
            </div>

            {step < totalSteps ? (
              <button
                type="button"
                onClick={goNext}
                disabled={loadingCode}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Siguiente
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || loadingCode || processingImages}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-red-600 px-6 text-[13px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? "Guardando..."
                  : editingProduct
                    ? "Actualizar producto"
                    : "Guardar producto"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}

function StepHeading({ title, description }) {
  return (
    <div>
      <p className="text-[18px] font-medium tracking-[-0.025em] text-black">
        {title}
      </p>
      <p className="mt-1 text-[12px] text-black/45">{description}</p>
    </div>
  );
}

function SummaryBox({ label, value }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white px-4 py-3 ring-1 ring-black/[0.06]">
      <p className="text-[10px] text-black/40">{label}</p>
      <p className="mt-1 truncate text-[12px] font-medium text-black">
        {value}
      </p>
    </div>
  );
}

function BackgroundDecisionCard({
  title,
  description,
  removeLabel = "Quitar fondo",
  keepLabel = "Dejar original",
  onRemove,
  onKeep,
  onCancel,
  disabled = false,
  className = "mt-3",
}) {
  return (
    <div
      className={`${className} rounded-[18px] border border-red-100 bg-red-50/60 p-2.5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-black">{title}</p>
          <p className="mt-0.5 text-[9px] leading-snug text-black/45">
            {description}
          </p>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-black/45 ring-1 ring-black/[0.06] transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            title="Descartar imagen pendiente"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="inline-flex h-8 items-center justify-center rounded-xl bg-red-600 px-3 text-[10.5px] font-medium text-white shadow-lg shadow-red-600/15 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {removeLabel}
        </button>

        <button
          type="button"
          onClick={onKeep}
          disabled={disabled}
          className="inline-flex h-8 items-center justify-center rounded-xl bg-white px-3 text-[10.5px] font-medium text-black ring-1 ring-black/[0.08] transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {keepLabel}
        </button>
      </div>
    </div>
  );
}

function PendingGalleryImageItem({
  imageUrl,
  orderLabel,
  canMoveBackward,
  canMoveForward,
  onMoveBackward,
  onMoveForward,
  draggable = false,
  dragging = false,
  onDragStart,
  onDrop,
  onRemoveBackground,
  onKeepBackground,
  onEdit,
  onRemove,
  disabled = false,
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={`group relative overflow-hidden rounded-2xl bg-black/[0.025] ring-1 ring-orange-200 transition ${
        dragging ? "scale-[0.97] opacity-45" : ""
      }`}
    >
      <div className="relative aspect-square">
        <img
          src={imageUrl}
          alt="Imagen pendiente"
          className="h-full w-full bg-white object-contain p-2"
        />

        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2 py-1 text-[9px] text-white">
          <GripVertical size={10} />
          {orderLabel || "Pendiente"}
        </span>

        <div className="absolute right-1.5 top-1.5 flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-black shadow-sm transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            title="Recortar imagen"
          >
            <Crop size={12} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            title="Descartar imagen"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 border-t border-orange-100 bg-white p-1.5">
        <button type="button" onClick={onMoveBackward} disabled={!canMoveBackward || disabled} className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-black/[0.04] text-[8px] text-black/60 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-25">
          <ArrowUp size={11} /> Antes
        </button>
        <button type="button" onClick={onMoveForward} disabled={!canMoveForward || disabled} className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-black/[0.04] text-[8px] text-black/60 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-25">
          Después <ArrowDown size={11} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 border-t border-orange-100 bg-white p-1.5">
        <button
          type="button"
          onClick={onRemoveBackground}
          disabled={disabled}
          className="h-7 rounded-lg bg-red-600 px-1 text-[8.5px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Quitar
        </button>

        <button
          type="button"
          onClick={onKeepBackground}
          disabled={disabled}
          className="h-7 rounded-lg bg-black/[0.04] px-1 text-[8.5px] font-medium text-black/65 transition hover:bg-black/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Original
        </button>
      </div>
    </div>
  );
}

function GalleryImageItem({
  imageUrl,
  isCover,
  orderLabel,
  canMoveBackward,
  canMoveForward,
  onMoveBackward,
  onMoveForward,
  draggable = false,
  dragging = false,
  onDragStart,
  onDrop,
  onSetCover,
  onEdit,
  onRemove,
  isNew = false,
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={`group relative aspect-square overflow-hidden rounded-2xl bg-black/[0.025] ring-1 ring-black/[0.06] transition ${
        dragging ? "scale-[0.97] opacity-45 ring-2 ring-red-300" : ""
      }`}
    >
      <img
        src={imageUrl}
        alt="Imagen del producto"
        className="h-full w-full bg-white object-contain p-2"
      />

      <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/35" />

      {isCover && (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-[9px] text-white">
          <Star size={9} fill="currentColor" />
          Portada
        </span>
      )}

      {!isCover && (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-[8px] text-white backdrop-blur">
          <GripVertical size={10} />
          {orderLabel || "Galería"}
        </span>
      )}

      {isNew && (
        <span className="absolute right-1.5 top-1.5 rounded-lg bg-white/90 px-2 py-1 text-[9px] text-black">
          Nueva
        </span>
      )}

      <div className="absolute inset-x-1.5 bottom-1.5 grid grid-cols-5 gap-1 opacity-0 transition group-hover:opacity-100">
        <button type="button" onClick={onMoveBackward} disabled={!canMoveBackward || isCover} className="flex h-7 items-center justify-center rounded-lg bg-white/95 text-black transition hover:text-red-600 disabled:opacity-30" title="Mover antes"><ArrowUp size={12} /></button>
        <button type="button" onClick={onMoveForward} disabled={!canMoveForward || isCover} className="flex h-7 items-center justify-center rounded-lg bg-white/95 text-black transition hover:text-red-600 disabled:opacity-30" title="Mover después"><ArrowDown size={12} /></button>
        <button type="button" onClick={onSetCover} className="flex h-7 items-center justify-center rounded-lg bg-white/95 text-black transition hover:text-red-600" title="Usar como portada"><Star size={12} /></button>
        <button type="button" onClick={onEdit} className="flex h-7 items-center justify-center rounded-lg bg-white/95 text-black transition hover:text-red-600" title="Recortar imagen"><Crop size={12} /></button>
        <button type="button" onClick={onRemove} className="flex h-7 items-center justify-center rounded-lg bg-white/95 text-red-600 transition hover:bg-red-50" title="Eliminar imagen"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

function createCenteredCrop(mediaWidth, mediaHeight, aspect) {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 82,
      },
      aspect,
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

function ProductImageCropModal({
  imageUrl,
  storagePath,
  saving,
  onClose,
  onSave,
}) {
  const imageElementRef = useRef(null);

  const [editorStep, setEditorStep] = useState("crop");
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [preparedCropPixels, setPreparedCropPixels] = useState(null);
  const [aspect, setAspect] = useState(undefined);

  const [editableImageUrl, setEditableImageUrl] = useState("");
  const [framedImageUrl, setFramedImageUrl] = useState("");
  const [loadingImage, setLoadingImage] = useState(true);
  const [preparingFrame, setPreparingFrame] = useState(false);
  const [imageError, setImageError] = useState("");

  const [frameScale, setFrameScale] = useState(0.82);
  const [frameOffsetX, setFrameOffsetX] = useState(0);
  const [frameOffsetY, setFrameOffsetY] = useState(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let localUrl = "";
    let shouldRevoke = false;

    async function prepareImage() {
      try {
        setLoadingImage(true);
        setImageError("");
        setEditableImageUrl("");
        setCrop(undefined);
        setCompletedCrop(null);
        setPreparedCropPixels(null);
        setEditorStep("crop");

        const prepared = await createLocalEditableImageUrl(
          imageUrl,
          storagePath
        );

        if (cancelled) {
          if (prepared.revoke) {
            URL.revokeObjectURL(prepared.url);
          }
          return;
        }

        localUrl = prepared.url;
        shouldRevoke = prepared.revoke;
        setEditableImageUrl(prepared.url);
      } catch (error) {
        console.error("Error preparando imagen para recorte:", error);

        if (!cancelled) {
          setImageError(
            error.message ||
              "No se pudo preparar la imagen para recortarla."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingImage(false);
        }
      }
    }

    prepareImage();

    return () => {
      cancelled = true;

      if (shouldRevoke && localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [imageUrl, storagePath]);

  useEffect(() => {
    return () => {
      revokePreview(framedImageUrl);
    };
  }, [framedImageUrl]);

  function handleImageLoad(event) {
    const { width, height } = event.currentTarget;

    setCrop(
      aspect
        ? createCenteredCrop(width, height, aspect)
        : {
            unit: "%",
            x: 8,
            y: 8,
            width: 84,
            height: 84,
          }
    );
  }

  function applyAspect(nextAspect) {
    const image = imageElementRef.current;
    setAspect(nextAspect);

    if (!image) return;

    setCrop(
      nextAspect
        ? createCenteredCrop(image.width, image.height, nextAspect)
        : {
            unit: "%",
            x: 8,
            y: 8,
            width: 84,
            height: 84,
          }
    );
    setCompletedCrop(null);
    setPreparedCropPixels(null);
  }

  function resetCrop() {
    const image = imageElementRef.current;
    if (!image) return;

    setCrop(
      aspect
        ? createCenteredCrop(image.width, image.height, aspect)
        : {
            unit: "%",
            x: 8,
            y: 8,
            width: 84,
            height: 84,
          }
    );
    setCompletedCrop(null);
    setPreparedCropPixels(null);
  }

  function resetFrame() {
    setFrameScale(0.82);
    setFrameOffsetX(0);
    setFrameOffsetY(0);
  }

  function buildNaturalPixelCrop() {
    const image = imageElementRef.current;

    if (
      !image ||
      !completedCrop?.width ||
      !completedCrop?.height
    ) {
      return null;
    }

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    return {
      x: Math.max(
        Math.round(completedCrop.x * scaleX),
        0
      ),
      y: Math.max(
        Math.round(completedCrop.y * scaleY),
        0
      ),
      width: Math.max(
        Math.round(completedCrop.width * scaleX),
        1
      ),
      height: Math.max(
        Math.round(completedCrop.height * scaleY),
        1
      ),
    };
  }

  async function continueToFrame() {
    const naturalCrop = buildNaturalPixelCrop();

    if (!naturalCrop) {
      alert(
        "Selecciona un área válida antes de continuar."
      );
      return;
    }

    try {
      setPreparingFrame(true);

      const previewFile = await createCroppedImageFile({
        imageUrl: editableImageUrl,
        cropPixels: naturalCrop,
        rotation: 0,
        fileName: "vista-previa",
      });

      revokePreview(framedImageUrl);
      setFramedImageUrl(
        URL.createObjectURL(previewFile)
      );
      setPreparedCropPixels(naturalCrop);
      resetFrame();
      setEditorStep("frame");
    } catch (error) {
      console.error(error);
      alert(
        error.message ||
          "No se pudo preparar la imagen recortada."
      );
    } finally {
      setPreparingFrame(false);
    }
  }

  function saveFinalImage() {
    if (!preparedCropPixels) {
      alert(
        "No se encontró un recorte válido para guardar."
      );
      return;
    }

    onSave({
      cropPixels: preparedCropPixels,
      rotation: 0,
      imageUrl: editableImageUrl,
      frame: {
        outputSize: 1200,
        scale: frameScale,
        offsetX: frameOffsetX,
        offsetY: frameOffsetY,
      },
    });
  }

  const editorBlocked =
    saving ||
    loadingImage ||
    preparingFrame ||
    Boolean(imageError) ||
    !editableImageUrl;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-md sm:px-5">
      <style>{`
        .premium-image-crop {
          --crop-accent: #ef2929;
          --crop-accent-soft: rgba(239, 41, 41, 0.22);
          filter: drop-shadow(0 24px 48px rgba(0, 0, 0, 0.28));
        }

        .premium-image-crop .ReactCrop__child-wrapper {
          overflow: hidden;
          border-radius: 18px;
          background:
            linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015));
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.08),
            0 24px 70px rgba(0,0,0,0.34);
        }

        .premium-image-crop .ReactCrop__crop-selection {
          border: 2px solid rgba(255, 255, 255, 0.98);
          border-radius: 10px;
          box-shadow:
            0 0 0 1px rgba(239, 41, 41, 0.9),
            0 0 0 9999em rgba(0, 0, 0, 0.58),
            0 10px 32px rgba(0, 0, 0, 0.28);
          outline: none;
        }

        .premium-image-crop .ReactCrop__crop-selection::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 8px;
          pointer-events: none;
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.28),
            inset 0 0 22px rgba(255,255,255,0.04);
        }

        .premium-image-crop .ReactCrop__drag-handle {
          width: 16px;
          height: 16px;
          border: 3px solid #ffffff;
          border-radius: 999px;
          background: var(--crop-accent);
          box-shadow:
            0 0 0 2px rgba(239, 41, 41, 0.28),
            0 5px 14px rgba(0, 0, 0, 0.32);
        }

        .premium-image-crop .ReactCrop__drag-handle.ord-n,
        .premium-image-crop .ReactCrop__drag-handle.ord-s {
          width: 34px;
          height: 10px;
          border-radius: 999px;
        }

        .premium-image-crop .ReactCrop__drag-handle.ord-e,
        .premium-image-crop .ReactCrop__drag-handle.ord-w {
          width: 10px;
          height: 34px;
          border-radius: 999px;
        }

        .premium-image-crop .ReactCrop__rule-of-thirds-vt::before,
        .premium-image-crop .ReactCrop__rule-of-thirds-vt::after,
        .premium-image-crop .ReactCrop__rule-of-thirds-hz::before,
        .premium-image-crop .ReactCrop__rule-of-thirds-hz::after {
          background-color: rgba(255,255,255,0.58);
          box-shadow: 0 0 8px rgba(255,255,255,0.18);
        }

        .premium-image-crop .ReactCrop__crop-selection:focus-visible {
          box-shadow:
            0 0 0 2px rgba(255,255,255,0.98),
            0 0 0 5px var(--crop-accent-soft),
            0 0 0 9999em rgba(0, 0, 0, 0.58);
        }
      `}</style>
      <section className="flex h-[min(860px,95vh)] w-full max-w-[1210px] flex-col overflow-hidden rounded-[30px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-red-600">
              Editor de imagen ·{" "}
              {editorStep === "crop"
                ? "Paso 1 de 2"
                : "Paso 2 de 2"}
            </p>

            <h2 className="mt-1 text-[21px] font-medium tracking-[-0.035em]">
              {editorStep === "crop"
                ? "Limpiar y recortar fotografía"
                : "Centrar en el recuadro blanco"}
            </h2>

            <p className="mt-1 text-[11px] text-black/42">
              {editorStep === "crop"
                ? "Elimina restos de fondo ajustando libremente los bordes del recorte."
                : "Cambia el tamaño y la posición hasta que el producto quede perfectamente centrado."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.035] text-black/55 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            <X size={19} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_310px]">
          <div className="relative flex min-h-[440px] items-center justify-center overflow-auto bg-[#171717] p-5 sm:p-8">
            {loadingImage && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#171717]">
                <div className="text-center">
                  <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  <p className="mt-3 text-[11px] text-white/65">
                    Preparando imagen...
                  </p>
                </div>
              </div>
            )}

            {imageError && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#171717] px-6">
                <div className="max-w-[430px] rounded-[22px] border border-red-400/20 bg-red-500/10 p-5 text-center">
                  <Camera size={28} className="mx-auto text-red-300" />
                  <p className="mt-3 text-[13px] font-medium text-white">
                    No se pudo cargar la imagen
                  </p>
                  <p className="mt-2 text-[10px] leading-5 text-white/55">
                    {imageError}
                  </p>
                </div>
              </div>
            )}

            {editorStep === "crop" &&
              editableImageUrl &&
              !imageError && (
                <div className="relative flex max-h-full max-w-full items-center justify-center rounded-[26px] border border-white/10 bg-white/[0.025] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:p-5">
                  <div className="pointer-events-none absolute inset-3 rounded-[20px] border border-white/[0.05]" />
                  <ReactCrop
                    crop={crop}
                    onChange={(_, percentCrop) =>
                      setCrop(percentCrop)
                    }
                    onComplete={(pixelCrop) =>
                      setCompletedCrop(pixelCrop)
                    }
                    aspect={aspect}
                    minWidth={30}
                    minHeight={30}
                    keepSelection
                    ruleOfThirds
                    className="premium-image-crop max-h-[630px] max-w-full overflow-visible"
                  >
                    <img
                      ref={imageElementRef}
                      src={editableImageUrl}
                      alt="Imagen para recortar"
                      onLoad={handleImageLoad}
                      className="block max-h-[630px] max-w-full select-none object-contain"
                      draggable={false}
                    />
                  </ReactCrop>
                </div>
              )}

            {editorStep === "frame" &&
              framedImageUrl && (
                <div className="relative aspect-square h-[min(620px,70vh)] max-h-full max-w-full overflow-hidden rounded-[12px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.35)] ring-1 ring-white/15">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.035)_1px,transparent_1px)] bg-[size:25%_25%]" />

                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      transform: `translate(${frameOffsetX * 0.32}%, ${frameOffsetY * 0.32}%)`,
                    }}
                  >
                    <img
                      src={framedImageUrl}
                      alt="Producto centrado"
                      className="max-h-full max-w-full select-none object-contain"
                      draggable={false}
                      style={{
                        transform: `scale(${frameScale})`,
                        transformOrigin: "center",
                      }}
                    />
                  </div>

                  <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px bg-red-500/25" />
                  <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full bg-red-500/25" />
                  <div className="pointer-events-none absolute inset-[8%] rounded-lg border border-dashed border-black/10" />
                </div>
              )}

            <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/72 px-4 py-2 text-[9px] font-medium text-white/80 shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl">
              {editorStep === "crop"
                ? "Ajusta las esquinas y bordes para eliminar los restos"
                : "Usa tamaño y posición para centrar el producto"}
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto border-l border-black/[0.06] bg-white p-5">
            {editorStep === "crop" ? (
              <>
                <div>
                  <p className="text-[12px] font-medium">
                    Forma del recorte
                  </p>

                  <p className="mt-1 text-[9px] leading-4 text-black/40">
                    Usa el modo Libre para limpiar con precisión cualquier borde o esquina.
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[
                      {
                        label: "Libre",
                        value: undefined,
                      },
                      { label: "1:1", value: 1 },
                      { label: "4:5", value: 4 / 5 },
                      { label: "3:4", value: 3 / 4 },
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() =>
                          applyAspect(option.value)
                        }
                        disabled={editorBlocked}
                        className={`h-10 rounded-xl text-[10px] font-medium transition ${
                          aspect === option.value
                            ? "bg-red-600 text-white"
                            : "border border-black/[0.08] bg-white text-black/60 hover:bg-red-50 hover:text-red-600"
                        } disabled:cursor-not-allowed disabled:opacity-45`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 rounded-[18px] border border-black/[0.06] bg-black/[0.025] p-3.5">
                  <div className="flex items-center gap-2">
                    <Crop
                      size={15}
                      className="text-red-600"
                    />
                    <p className="text-[11px] font-medium">
                      Limpieza precisa
                    </p>
                  </div>

                  <p className="mt-2 text-[9px] leading-5 text-black/48">
                    Ajusta los bordes y controladores hasta conservar únicamente el área limpia del producto.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={resetCrop}
                  disabled={editorBlocked}
                  className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.08] text-[11px] font-medium text-black/60 transition hover:bg-black/[0.03] disabled:opacity-40"
                >
                  <RotateCcw size={14} />
                  Restablecer selección
                </button>
              </>
            ) : (
              <>
                <div className="rounded-[18px] border border-emerald-100 bg-emerald-50 p-3.5">
                  <p className="text-[10px] font-medium text-emerald-700">
                    Lienzo final 1:1
                  </p>
                  <p className="mt-1 text-[9px] leading-5 text-black/48">
                    El archivo se guardará en un recuadro blanco de 1200 × 1200 px, ideal para las tarjetas del catálogo.
                  </p>
                </div>

                <CropControl
                  className="mt-5"
                  icon={ZoomIn}
                  leftIcon={ZoomOut}
                  label="Tamaño del producto"
                  value={frameScale}
                  min={0.35}
                  max={1.25}
                  step={0.01}
                  onChange={setFrameScale}
                  suffix={`${Math.round(
                    frameScale * 100
                  )}%`}
                  disabled={editorBlocked}
                />

                <CropControl
                  className="mt-5"
                  icon={ChevronRight}
                  leftIcon={ChevronLeft}
                  label="Posición horizontal"
                  value={frameOffsetX}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={setFrameOffsetX}
                  suffix={
                    frameOffsetX === 0
                      ? "Centro"
                      : String(frameOffsetX)
                  }
                  disabled={editorBlocked}
                />

                <CropControl
                  className="mt-5"
                  icon={ChevronRight}
                  leftIcon={ChevronLeft}
                  label="Posición vertical"
                  value={frameOffsetY}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={setFrameOffsetY}
                  suffix={
                    frameOffsetY === 0
                      ? "Centro"
                      : String(frameOffsetY)
                  }
                  disabled={editorBlocked}
                />

                <button
                  type="button"
                  onClick={resetFrame}
                  disabled={editorBlocked}
                  className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.08] text-[11px] font-medium text-black/60 transition hover:bg-black/[0.03] disabled:opacity-40"
                >
                  <RotateCcw size={14} />
                  Centrar automáticamente
                </button>
              </>
            )}

            <div className="mt-5 rounded-[18px] bg-red-50 p-3.5">
              <p className="text-[10px] font-medium text-red-700">
                Edición no destructiva
              </p>
              <p className="mt-1 text-[9px] leading-5 text-black/48">
                La imagen original se conserva hasta que confirmes los cambios y actualices el producto.
              </p>
            </div>
          </aside>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-black/[0.06] bg-white px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => {
              if (editorStep === "frame") {
                setEditorStep("crop");
                return;
              }

              onClose();
            }}
            disabled={saving || preparingFrame}
            className="h-11 rounded-2xl border border-black/[0.08] px-5 text-[12px] font-medium text-black/65 transition hover:bg-black/[0.03] disabled:opacity-40"
          >
            {editorStep === "frame"
              ? "Volver al recorte"
              : "Cancelar"}
          </button>

          {editorStep === "crop" ? (
            <button
              type="button"
              onClick={continueToFrame}
              disabled={
                editorBlocked ||
                !completedCrop?.width ||
                !completedCrop?.height
              }
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 text-[12px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:opacity-50"
            >
              <ChevronRight size={16} />
              {preparingFrame
                ? "Preparando..."
                : "Continuar y centrar"}
            </button>
          ) : (
            <button
              type="button"
              onClick={saveFinalImage}
              disabled={editorBlocked}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 text-[12px] font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:opacity-50"
            >
              <Check size={16} />
              {saving
                ? "Guardando imagen..."
                : "Aplicar recorte y encuadre"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function CropControl({
  className = "",
  icon: Icon,
  leftIcon: LeftIcon,
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix = "",
  disabled = false,
}) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-red-600" />
          <p className="text-[12px] font-medium">{label}</p>
        </div>
        <span className="text-[10px] text-black/40">{suffix || Number(value).toFixed(2)}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {LeftIcon && <LeftIcon size={14} className="text-black/35" />}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-1.5 w-full cursor-pointer accent-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <Icon size={14} className="text-black/35" />
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
}) {
  const safePage = Math.min(page, totalPages);
  const firstItem =
    totalItems === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const lastItem = Math.min(safePage * itemsPerPage, totalItems);

  return (
    <footer className="mt-4 flex flex-col gap-3 border-t border-black/[0.06] pt-4 md:flex-row md:items-center md:justify-between">
      <p className="text-[12px] font-normal text-black/50">
        Mostrando {firstItem} a {lastItem} de {totalItems} productos
      </p>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange((current) => current - 1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹
        </button>

        {Array.from({ length: Math.min(totalPages, 5) }).map((_, index) => {
          const pageNumber = index + 1;

          return (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                page === pageNumber
                  ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                  : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
              }`}
            >
              {pageNumber}
            </button>
          );
        })}

        {totalPages > 5 && (
          <>
            <span className="px-1 text-[12px] text-black/40">...</span>

            <button
              type="button"
              onClick={() => onPageChange(totalPages)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-[12px] transition ${
                page === totalPages
                  ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                  : "border border-black/[0.08] bg-white text-black/70 hover:bg-black/[0.035]"
              }`}
            >
              {totalPages}
            </button>
          </>
        )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange((current) => current + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-black/70 transition hover:bg-black/[0.035] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ›
        </button>
      </div>

      <div className="hidden h-9 items-center rounded-xl border border-black/[0.08] bg-white px-4 text-[12px] text-black/70 md:flex">
        {itemsPerPage} por página
      </div>
    </footer>
  );
}

function MoneyInputField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  compact = false,
}) {
  return (
    <label>
      <span className="text-[13px] font-normal text-black/65">{label}</span>

      <div className="relative mt-2">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] text-black/35">
          $
        </span>

        <input
          type="text"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(formatThousands(event.target.value))}
          className={`w-full rounded-2xl border border-black/[0.08] bg-white pl-8 pr-4 text-[13px] text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45 ${
            compact ? "h-10" : "h-11"
          }`}
          placeholder={placeholder}
        />
      </div>
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  min,
  compact = false,
  helper = "",
}) {
  const numericInput = type === "number";

  return (
    <label>
      <span className="text-[13px] font-normal text-black/65">{label}</span>

      <input
        type={numericInput ? "text" : type}
        inputMode={numericInput ? "numeric" : undefined}
        pattern={numericInput ? "[0-9]*" : undefined}
        min={numericInput ? undefined : min}
        value={value}
        disabled={disabled}
        onWheel={(event) => {
          if (numericInput) {
            event.currentTarget.blur();
          }
        }}
        onChange={(event) => {
          const nextValue = numericInput
            ? event.target.value.replace(/\D/g, "")
            : event.target.value;

          onChange(nextValue);
        }}
        className={`mt-2 w-full rounded-2xl border border-black/[0.08] bg-white px-4 text-[13px] text-black outline-none transition placeholder:text-black/35 focus:border-red-600 focus:ring-4 focus:ring-red-600/10 disabled:bg-black/[0.025] disabled:text-black/45 ${
          compact ? "h-10" : "h-11"
        }`}
        placeholder={placeholder}
      />
      {helper && (
        <span className="mt-1.5 block text-[9px] text-black/38">{helper}</span>
      )}
    </label>
  );
}