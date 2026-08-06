import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Images,
  MapPin,
  Menu,
  PackageSearch,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";

import {
  normalizeText,
  subscribeCategories,
} from "../../services/categories.service";
import {
  subscribeMainCategories,
} from "../../services/mainCategories.service";
import {
  getProductCoverImage,
  getProductImages,
  normalizeProductVariants,
  subscribeProducts,
} from "../../services/products.service";
import { formatCurrency } from "../../utils/money";
import { useReservationCart } from "../../services/reservationCart.store";
import ReservationCartDrawer from "../../components/catalog/ReservationCartDrawer";
import { subscribeReservationSettings } from "../../services/reservations.service";

const WHATSAPP_NUMBER = "573118169948";
const WHATSAPP_MESSAGE =
  "Hola Master Caps, quiero recibir asesoría sobre los productos del catálogo.";

const HERO_AUTOPLAY_MS = 6500;

const GLOBAL_CATALOG_GROUPS = [
  {
    id: "hombre",
    name: "HOMBRE",
    imageBaseName: "hombre",
    description:
      "Prendas, conjuntos y colecciones masculinas.",
  },
  {
    id: "accesorios",
    name: "ACCESORIOS",
    imageBaseName: "accesosios",
    description:
      "Bolsos, billeteras y complementos.",
  },
  {
    id: "gorras",
    name: "GORRAS",
    imageBaseName: "gorras",
    description:
      "Gorras urbanas, deportivas y agropecuarias.",
  },
];

function getGlobalGroupImageCandidates(
  imageBaseName
) {
  const normalizedBaseNames =
    imageBaseName === "accesosios"
      ? ["accesorios", "accesosios"]
      : [imageBaseName];

  const extensions = [
    "webp",
    "png",
    "jpg",
    "jpeg",
  ];

  return normalizedBaseNames.flatMap(
    (baseName) =>
      extensions.map(
        (extension) =>
          `/images/store/${baseName}.${extension}`
      )
  );
}

function GlobalGroupImage({
  imageBaseName,
  alt,
  className,
  loading = "lazy",
  fetchPriority = "auto",
}) {
  const candidates = useMemo(
    () =>
      getGlobalGroupImageCandidates(
        imageBaseName
      ),
    [imageBaseName]
  );

  const [candidateIndex, setCandidateIndex] =
    useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [imageBaseName]);

  const currentSrc =
    candidates[candidateIndex] ||
    candidates[0];

  return (
    <img
      key={`${imageBaseName}-${candidateIndex}`}
      src={currentSrc}
      alt={alt}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      draggable="false"
      onError={() => {
        setCandidateIndex(
          (current) =>
            current <
            candidates.length - 1
              ? current + 1
              : current
        );
      }}
      className={className}
    />
  );
}

function getGlobalGroupId(mainCategory) {
  const normalizedName = normalizeText(
    mainCategory?.name
  );

  if (
    normalizedName.includes("gorra") ||
    normalizedName.includes("cap")
  ) {
    return "gorras";
  }

  if (
    normalizedName.includes("accesorio") ||
    normalizedName.includes("billetera") ||
    normalizedName.includes("bolso") ||
    normalizedName.includes("reloj") ||
    normalizedName.includes("gafa") ||
    normalizedName.includes("correa") ||
    normalizedName.includes("perfume")
  ) {
    return "accesorios";
  }

  return "hombre";
}


const STORE_HERO_SLIDES = [
  {
    id: "store-01",
    image: "/images/store/mastercaps-tienda-01-1920.webp",
    imageSrcSet:
      "/images/store/mastercaps-tienda-01-1920.webp 1920w, /images/store/mastercaps-tienda-01-3840.webp 3840w",
    secondaryImage: "/images/store/mastercaps-tienda-04.webp",
    eyebrow: "TIENDA FÍSICA · UBATÉ",
    title: "CONOCE MASTER CAPS",
    description:
      "Un espacio creado para descubrir moda, accesorios, gorras y piezas seleccionadas en un solo lugar.",
  },
  {
    id: "store-02",
    image: "/images/store/mastercaps-tienda-02-1920.webp",
    imageSrcSet:
      "/images/store/mastercaps-tienda-02-1920.webp 1920w, /images/store/mastercaps-tienda-02-3840.webp 3840w",
    secondaryImage: "/images/store/mastercaps-tienda-05.webp",
    eyebrow: "MODA Y ACCESORIOS",
    title: "TODO TU ESTILO EN UN SOLO LUGAR",
    description:
      "Explora prendas, bolsos, relojes, gorras y colecciones disponibles en nuestra tienda.",
  },
  {
    id: "store-03",
    image: "/images/store/mastercaps-tienda-03-1920.webp",
    imageSrcSet:
      "/images/store/mastercaps-tienda-03-1920.webp 1920w, /images/store/mastercaps-tienda-03-3840.webp 3840w",
    secondaryImage: "/images/store/mastercaps-tienda-01.webp",
    eyebrow: "EXPERIENCIA MASTER CAPS",
    title: "VISÍTANOS EN UBATÉ",
    description:
      "Conoce el espacio, descubre nuevas referencias y recibe atención personalizada.",
  },
  {
    id: "store-04",
    image: "/images/store/mastercaps-tienda-04-1920.webp",
    imageSrcSet:
      "/images/store/mastercaps-tienda-04-1920.webp 1920w, /images/store/mastercaps-tienda-04-3840.webp 3840w",
    secondaryImage: "/images/store/mastercaps-tienda-02.webp",
    eyebrow: "COLECCIONES SELECCIONADAS",
    title: "GORRAS, ROPA Y ACCESORIOS",
    description:
      "Una selección amplia para combinar, regalar o renovar tu estilo.",
  },
  {
    id: "store-05",
    image: "/images/store/mastercaps-tienda-05-1920.webp",
    imageSrcSet:
      "/images/store/mastercaps-tienda-05-1920.webp 1920w, /images/store/mastercaps-tienda-05-3840.webp 3840w",
    secondaryImage: "/images/store/mastercaps-tienda-03.webp",
    eyebrow: "MASTER CAPS",
    title: "DETALLES QUE MARCAN LA DIFERENCIA",
    description:
      "Encuentra diseños, colores y referencias para cada ocasión.",
  },
];


function getProductVariants(product) {
  return normalizeProductVariants(
    product?.variants,
    product?.size,
    product?.stock
  );
}

function getAvailableVariants(product) {
  return getProductVariants(product).filter(
    (variant) => Number(variant.stock || 0) > 0
  );
}

function getTotalStock(product) {
  return getProductVariants(product).reduce(
    (total, variant) =>
      total + Number(variant.stock || 0),
    0
  );
}

function normalizeDisplayName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es-CO");
}

function safeText(value) {
  return String(value ?? "").trim();
}

function productHasImage(product) {
  return Boolean(getProductCoverImage(product)?.url);
}

function getProductSecondaryImage(product) {
  const images = getProductImages(product).filter(
    (image) => Boolean(image?.url)
  );

  return images[1]?.url || images[0]?.url || "";
}

function getMainCategoryForProduct(
  product,
  categoryById
) {
  const subcategory = categoryById.get(
    safeText(product?.categoryId)
  );

  return safeText(
    subcategory?.parentCategoryId
  );
}

function getMainCategoryNameForProduct(
  product,
  categoryById,
  mainCategoryById
) {
  const mainCategoryId =
    getMainCategoryForProduct(
      product,
      categoryById
    );

  return normalizeDisplayName(
    mainCategoryById.get(mainCategoryId)?.name
  );
}

function getCategoryPath(
  product,
  categoryById,
  mainCategoryById
) {
  const subcategory = categoryById.get(
    safeText(product?.categoryId)
  );

  const mainName =
    getMainCategoryNameForProduct(
      product,
      categoryById,
      mainCategoryById
    );

  const subcategoryName =
    normalizeDisplayName(
      subcategory?.name ||
        product?.categoryName
    );

  return [mainName, subcategoryName]
    .filter(Boolean)
    .join(" / ");
}

export default function CatalogPage() {
  const { storeId = "master-caps" } =
    useParams();

  const location = useLocation();
  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const [products, setProducts] =
    useState([]);
  const [categories, setCategories] =
    useState([]);
  const [
    mainCategories,
    setMainCategories,
  ] = useState([]);

  const [
    reservationSettings,
    setReservationSettings,
  ] = useState({
    defaultReservationDays: 7,
  });

  const [search, setSearch] = useState(
    () => searchParams.get("q") || ""
  );

  const [
    globalGroupFilter,
    setGlobalGroupFilter,
  ] = useState(
    () =>
      searchParams.get("grupo") ||
      "all"
  );

  const [
    mainCategoryFilter,
    setMainCategoryFilter,
  ] = useState(
    () =>
      searchParams.get("principal") ||
      "all"
  );

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState(
    () =>
      searchParams.get("categoria") ||
      "all"
  );

  const [sizeFilter, setSizeFilter] =
    useState(
      () =>
        searchParams.get("talla") ||
        "all"
    );

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);
  const [filtersOpen, setFiltersOpen] =
    useState(false);
  const [cartOpen, setCartOpen] =
    useState(false);
  const [searchOpen, setSearchOpen] =
    useState(false);
  const [heroIndex, setHeroIndex] =
    useState(0);

  const cart = useReservationCart(storeId);

  const [loading, setLoading] =
    useState(true);

  const restorationDoneRef =
    useRef(false);
  const productsReadyRef = useRef(false);
  const categoriesReadyRef = useRef(false);
  const mainCategoriesReadyRef =
    useRef(false);

  useEffect(() => {
    setLoading(true);

    function updateLoadingState() {
      if (
        productsReadyRef.current &&
        categoriesReadyRef.current &&
        mainCategoriesReadyRef.current
      ) {
        setLoading(false);
      }
    }

    const unsubscribeProducts =
      subscribeProducts(
        (productsData) => {
          setProducts(productsData);
          productsReadyRef.current = true;
          updateLoadingState();
        },
        () => {
          productsReadyRef.current = true;
          updateLoadingState();
          alert(
            "No se pudo cargar el catálogo en tiempo real."
          );
        },
        storeId
      );

    const unsubscribeCategories =
      subscribeCategories(
        (categoriesData) => {
          setCategories(
            categoriesData.map(
              (category) => ({
                ...category,
                name: normalizeDisplayName(
                  category.name
                ),
              })
            )
          );

          categoriesReadyRef.current = true;
          updateLoadingState();
        },
        () => {
          categoriesReadyRef.current = true;
          updateLoadingState();
          alert(
            "No se pudieron cargar las subcategorías del catálogo."
          );
        },
        storeId
      );

    const unsubscribeMainCategories =
      subscribeMainCategories(
        (mainCategoriesData) => {
          setMainCategories(
            mainCategoriesData
              .filter(
                (category) =>
                  category.isActive !== false
              )
              .map((category) => ({
                ...category,
                name: normalizeDisplayName(
                  category.name
                ),
              }))
          );

          mainCategoriesReadyRef.current =
            true;
          updateLoadingState();
        },
        () => {
          mainCategoriesReadyRef.current =
            true;
          updateLoadingState();
          alert(
            "No se pudieron cargar las categorías principales."
          );
        },
        storeId,
        {
          includeArchived: false,
        }
      );

    const unsubscribeSettings =
      subscribeReservationSettings(
        setReservationSettings,
        () => {},
        storeId
      );

    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeMainCategories();
      unsubscribeSettings();
    };
  }, [storeId]);

  useEffect(() => {
    if (
      !mobileMenuOpen &&
      !filtersOpen &&
      !cartOpen &&
      !searchOpen
    ) {
      return undefined;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [
    mobileMenuOpen,
    filtersOpen,
    cartOpen,
    searchOpen,
  ]);

  useEffect(() => {
    const nextParams =
      new URLSearchParams();

    if (
      globalGroupFilter !== "all"
    ) {
      nextParams.set(
        "grupo",
        globalGroupFilter
      );
    }

    if (
      mainCategoryFilter !== "all"
    ) {
      nextParams.set(
        "principal",
        mainCategoryFilter
      );
    }

    if (categoryFilter !== "all") {
      nextParams.set(
        "categoria",
        categoryFilter
      );
    }

    if (sizeFilter !== "all") {
      nextParams.set(
        "talla",
        sizeFilter
      );
    }

    const cleanSearch = search.trim();

    if (cleanSearch) {
      nextParams.set("q", cleanSearch);
    }

    setSearchParams(nextParams, {
      replace: true,
    });
  }, [
    globalGroupFilter,
    mainCategoryFilter,
    categoryFilter,
    sizeFilter,
    search,
    setSearchParams,
  ]);

  useEffect(() => {
    if (
      loading ||
      restorationDoneRef.current
    ) {
      return;
    }

    restorationDoneRef.current = true;

    const savedScrollY = Number(
      location.state
        ?.catalogNavigation?.scrollY ||
        sessionStorage.getItem(
          `catalog-scroll:${storeId}:${location.search}`
        ) ||
        0
    );

    if (savedScrollY > 0) {
      requestAnimationFrame(() => {
        window.scrollTo({
          top: savedScrollY,
          behavior: "auto",
        });
      });
    }
  }, [
    loading,
    location.search,
    location.state,
    storeId,
  ]);

  useEffect(() => {
    const storageKey =
      `catalog-scroll:${storeId}:${location.search}`;

    const saveScroll = () => {
      sessionStorage.setItem(
        storageKey,
        String(window.scrollY)
      );
    };

    window.addEventListener(
      "scroll",
      saveScroll,
      {
        passive: true,
      }
    );

    return () => {
      window.removeEventListener(
        "scroll",
        saveScroll
      );
      saveScroll();
    };
  }, [location.search, storeId]);

  const categoryById = useMemo(
    () =>
      new Map(
        categories.map((category) => [
          category.id,
          category,
        ])
      ),
    [categories]
  );

  const mainCategoryById =
    useMemo(
      () =>
        new Map(
          mainCategories.map(
            (category) => [
              category.id,
              category,
            ]
          )
        ),
      [mainCategories]
    );

  const getProductGlobalGroup = useMemo(
    () => (product) => {
      const mainCategoryId =
        getMainCategoryForProduct(
          product,
          categoryById
        );

      return getGlobalGroupId(
        mainCategoryById.get(
          mainCategoryId
        )
      );
    },
    [
      categoryById,
      mainCategoryById,
    ]
  );

  const availableProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          getTotalStock(product) > 0
      ),
    [products]
  );

  const heroSlides = STORE_HERO_SLIDES;

  useEffect(() => {
    if (heroSlides.length <= 1) {
      return undefined;
    }

    const timer = window.setInterval(
      () => {
        setHeroIndex((current) =>
          current >=
          heroSlides.length - 1
            ? 0
            : current + 1
        );
      },
      HERO_AUTOPLAY_MS
    );

    return () =>
      window.clearInterval(timer);
  }, [heroSlides.length]);

  useEffect(() => {
    if (
      heroIndex >
      heroSlides.length - 1
    ) {
      setHeroIndex(0);
    }
  }, [
    heroIndex,
    heroSlides.length,
  ]);

  const productsForSizeFilter = useMemo(() => {
    if (categoryFilter !== "all") {
      return availableProducts.filter(
        (product) =>
          safeText(product.categoryId) ===
          categoryFilter
      );
    }

    if (mainCategoryFilter !== "all") {
      return availableProducts.filter(
        (product) =>
          getMainCategoryForProduct(
            product,
            categoryById
          ) === mainCategoryFilter
      );
    }

    if (globalGroupFilter !== "all") {
      return availableProducts.filter(
        (product) =>
          getProductGlobalGroup(
            product
          ) === globalGroupFilter
      );
    }

    return availableProducts;
  }, [
    availableProducts,
    categoryFilter,
    mainCategoryFilter,
    globalGroupFilter,
    categoryById,
    getProductGlobalGroup,
  ]);

  const availableSizes = useMemo(() => {
    const sizes =
      productsForSizeFilter.flatMap(
        (product) =>
          getAvailableVariants(
            product
          ).map(
            (variant) =>
              safeText(variant.size)
          )
      );

    return [...new Set(sizes)]
      .filter(Boolean)
      .sort((left, right) =>
        String(left).localeCompare(
          String(right),
          "es-CO",
          {
            numeric: true,
            sensitivity: "base",
          }
        )
      );
  }, [productsForSizeFilter]);

  useEffect(() => {
    if (
      sizeFilter !== "all" &&
      !availableSizes.includes(
        sizeFilter
      )
    ) {
      setSizeFilter("all");
    }
  }, [
    availableSizes,
    sizeFilter,
  ]);

  const filteredSubcategories =
    useMemo(() => {
      if (
        mainCategoryFilter === "all"
      ) {
        return categories;
      }

      return categories.filter(
        (category) =>
          safeText(
            category.parentCategoryId
          ) === mainCategoryFilter
      );
    }, [
      categories,
      mainCategoryFilter,
    ]);

  const visibleProducts = useMemo(() => {
    const cleanSearch = search
      .trim()
      .toLocaleLowerCase("es-CO");

    return availableProducts.filter(
      (product) => {
        const variants =
          getAvailableVariants(product);

        const productMainCategoryId =
          getMainCategoryForProduct(
            product,
            categoryById
          );

        const categoryPath =
          getCategoryPath(
            product,
            categoryById,
            mainCategoryById
          );

        const matchesSearch =
          !cleanSearch ||
          safeText(product.name)
            .toLocaleLowerCase("es-CO")
            .includes(cleanSearch) ||
          safeText(product.code)
            .toLocaleLowerCase("es-CO")
            .includes(cleanSearch) ||
          categoryPath
            .toLocaleLowerCase("es-CO")
            .includes(cleanSearch) ||
          variants.some((variant) =>
            safeText(variant.size)
              .toLocaleLowerCase(
                "es-CO"
              )
              .includes(cleanSearch)
          );

        const matchesGlobalGroup =
          globalGroupFilter === "all" ||
          getProductGlobalGroup(
            product
          ) === globalGroupFilter;

        const matchesMainCategory =
          mainCategoryFilter === "all" ||
          productMainCategoryId ===
            mainCategoryFilter;

        const matchesSubcategory =
          categoryFilter === "all" ||
          safeText(
            product.categoryId
          ) === categoryFilter;

        const matchesSize =
          sizeFilter === "all" ||
          variants.some(
            (variant) =>
              safeText(
                variant.size
              ) === sizeFilter
          );

        return (
          matchesSearch &&
          matchesGlobalGroup &&
          matchesMainCategory &&
          matchesSubcategory &&
          matchesSize
        );
      }
    );
  }, [
    availableProducts,
    search,
    globalGroupFilter,
    mainCategoryFilter,
    categoryFilter,
    sizeFilter,
    categoryById,
    mainCategoryById,
    getProductGlobalGroup,
  ]);

  const isHomeView =
    globalGroupFilter === "all" &&
    mainCategoryFilter === "all" &&
    categoryFilter === "all" &&
    sizeFilter === "all" &&
    !search.trim();

  const isGlobalGroupLanding =
    globalGroupFilter !== "all" &&
    mainCategoryFilter === "all" &&
    categoryFilter === "all" &&
    sizeFilter === "all" &&
    !search.trim();

  const isMainCategoryLanding =
    mainCategoryFilter !== "all" &&
    categoryFilter === "all" &&
    sizeFilter === "all" &&
    !search.trim();

  const selectedMainCategory =
    mainCategoryById.get(
      mainCategoryFilter
    ) || null;

  const selectedSubcategory =
    categoryById.get(
      categoryFilter
    ) || null;

  const globalGroupShowcases = useMemo(
    () =>
      GLOBAL_CATALOG_GROUPS.map(
        (group) => {
          const groupProducts =
            availableProducts.filter(
              (product) =>
                getProductGlobalGroup(
                  product
                ) === group.id
            );

          return {
            ...group,
            products: groupProducts,
          };
        }
      ).filter(
        (group) =>
          group.products.length > 0
      ),
    [
      availableProducts,
      getProductGlobalGroup,
    ]
  );

  const selectedGlobalGroup =
    GLOBAL_CATALOG_GROUPS.find(
      (group) =>
        group.id ===
        globalGroupFilter
    ) || null;

  const selectedGlobalMainCategories =
    useMemo(() => {
      if (!isGlobalGroupLanding) {
        return [];
      }

      return mainCategories
        .filter(
          (mainCategory) =>
            getGlobalGroupId(
              mainCategory
            ) ===
            globalGroupFilter
        )
        .map((mainCategory) => {
          const categoryProducts =
            availableProducts.filter(
              (product) =>
                getMainCategoryForProduct(
                  product,
                  categoryById
                ) ===
                mainCategory.id
            );

          const imageProduct =
            categoryProducts.find(
              (product) =>
                getProductCoverImage(
                  product
                )?.url
            );

          const subcategories =
            categories
              .filter(
                (category) =>
                  safeText(
                    category.parentCategoryId
                  ) ===
                  mainCategory.id
              )
              .filter(
                (category) =>
                  categoryProducts.some(
                    (product) =>
                      safeText(
                        product.categoryId
                      ) === category.id
                  )
              );

          return {
            ...mainCategory,
            products: categoryProducts,
            subcategories,
            imageUrl:
              getProductCoverImage(
                imageProduct
              )?.url || "",
          };
        })
        .filter(
          (mainCategory) =>
            mainCategory.products.length >
            0
        );
    }, [
      isGlobalGroupLanding,
      mainCategories,
      availableProducts,
      categoryById,
      categories,
      globalGroupFilter,
    ]);

  const selectedSubcategoryShowcases = useMemo(() => {
    if (!isMainCategoryLanding) {
      return [];
    }

    return categories
      .filter(
        (category) =>
          safeText(category.parentCategoryId) ===
          mainCategoryFilter
      )
      .map((category) => {
        const categoryProducts =
          availableProducts.filter(
            (product) =>
              safeText(product.categoryId) ===
              category.id
          );

        const imageProduct =
          categoryProducts.find((product) =>
            Boolean(
              getProductCoverImage(product)?.url
            )
          );

        return {
          ...category,
          products: categoryProducts,
          imageUrl:
            getProductCoverImage(imageProduct)
              ?.url || "",
        };
      })
      .filter(
        (category) =>
          category.products.length > 0
      )
      .sort((left, right) =>
        safeText(left.name).localeCompare(
          safeText(right.name),
          "es-CO"
        )
      );
  }, [
    isMainCategoryLanding,
    categories,
    mainCategoryFilter,
    availableProducts,
  ]);



  useEffect(() => {
    if (
      mainCategoryFilter === "all" ||
      categoryFilter !== "all"
    ) {
      return;
    }

    const eligibleSubcategories =
      categories.filter(
        (category) => {
          if (
            safeText(
              category.parentCategoryId
            ) !== mainCategoryFilter
          ) {
            return false;
          }

          return availableProducts.some(
            (product) =>
              safeText(
                product.categoryId
              ) === category.id
          );
        }
      );

    if (
      eligibleSubcategories.length === 1
    ) {
      setCategoryFilter(
        eligibleSubcategories[0].id
      );
      setSizeFilter("all");
    }
  }, [
    mainCategoryFilter,
    categoryFilter,
    categories,
    availableProducts,
  ]);


  useEffect(() => {
    const urls = [
      ...heroSlides.flatMap(
        (slide) => [
          slide.image,
          slide.secondaryImage,
        ]
      ),
      ...globalGroupShowcases
        .slice(0, 6)
        .map((category) => category.imageUrl),
      ...selectedSubcategoryShowcases
        .slice(0, 6)
        .map((subcategory) => subcategory.imageUrl),
    ]
      .map((url) => safeText(url))
      .filter(Boolean);

    const uniqueUrls = [...new Set(urls)];

    uniqueUrls.forEach((url) => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    });
  }, [
    heroSlides,
    globalGroupShowcases,
    selectedSubcategoryShowcases,
  ]);

  const latestProducts = useMemo(
    () =>
      [...availableProducts]
        .sort((left, right) => {
          const leftTime =
            left.createdAt?.toMillis?.() ||
            left.updatedAt?.toMillis?.() ||
            0;

          const rightTime =
            right.createdAt?.toMillis?.() ||
            right.updatedAt?.toMillis?.() ||
            0;

          return rightTime - leftTime;
        })
        .slice(0, 8),
    [availableProducts]
  );

  const featuredSubcategories =
    useMemo(() => {
      return categories
        .map((category) => {
          const categoryProducts =
            availableProducts.filter(
              (product) =>
                safeText(
                  product.categoryId
                ) === category.id
            );

          return {
            ...category,
            products: categoryProducts,
          };
        })
        .filter(
          (category) =>
            category.products.length >= 2
        )
        .sort(
          (left, right) =>
            right.products.length -
            left.products.length
        )
        .slice(0, 3);
    }, [
      categories,
      availableProducts,
    ]);

  function selectGlobalGroup(value) {
    setGlobalGroupFilter(value);
    setMainCategoryFilter("all");
    setCategoryFilter("all");
    setSizeFilter("all");
    setSearch("");
    setMobileMenuOpen(false);
    setFiltersOpen(false);

    requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }

  function selectMainCategory(value) {
    const selectedMain =
      mainCategoryById.get(value);

    if (selectedMain) {
      setGlobalGroupFilter(
        getGlobalGroupId(
          selectedMain
        )
      );
    }

    const eligibleSubcategories =
      categories.filter(
        (category) => {
          if (
            safeText(
              category.parentCategoryId
            ) !== value
          ) {
            return false;
          }

          return availableProducts.some(
            (product) =>
              safeText(
                product.categoryId
              ) === category.id
          );
        }
      );

    setMainCategoryFilter(value);
    setCategoryFilter(
      eligibleSubcategories.length === 1
        ? eligibleSubcategories[0].id
        : "all"
    );
    setSizeFilter("all");
    setMobileMenuOpen(false);
    setFiltersOpen(false);

    requestAnimationFrame(() => {
      document
        .getElementById("catalog-products")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });
  }

  function selectSubcategory(value) {
    const category =
      categoryById.get(value);

    if (
      category?.parentCategoryId
    ) {
      setMainCategoryFilter(
        category.parentCategoryId
      );
    }

    setCategoryFilter(value);
    setSizeFilter("all");
    setMobileMenuOpen(false);
    setFiltersOpen(false);

    requestAnimationFrame(() => {
      document
        .getElementById("catalog-products")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });
  }

  function clearFilters() {
    setGlobalGroupFilter("all");
    setMainCategoryFilter("all");
    setCategoryFilter("all");
    setSizeFilter("all");
    setSearch("");
  }

  function previousHero() {
    if (heroSlides.length <= 1) {
      return;
    }

    setHeroIndex((current) =>
      current <= 0
        ? heroSlides.length - 1
        : current - 1
    );
  }

  function nextHero() {
    if (heroSlides.length <= 1) {
      return;
    }

    setHeroIndex((current) =>
      current >=
      heroSlides.length - 1
        ? 0
        : current + 1
    );
  }

  const activeHeroSlide =
    heroSlides[heroIndex] || heroSlides[0];

  return (
    <>
      <style>{`
        html {
          scroll-behavior: smooth;
        }

        body {
          background: #ffffff;
        }

        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
        }

        *::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        *::-webkit-scrollbar-track {
          background: transparent;
        }

        *::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.16);
          border-radius: 999px;
        }

        *::-webkit-scrollbar-thumb:hover {
          background: rgba(220, 38, 38, 0.55);
        }
      `}</style>

      <main className="min-h-screen bg-white text-black">
        <div className="bg-black px-4 py-2 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-white sm:text-[11px]">
          Envíos a todo Colombia · Aparta tus productos favoritos
        </div>

        <CatalogHeader
          storeId={storeId}
          globalGroups={GLOBAL_CATALOG_GROUPS}
          activeGlobalGroup={globalGroupFilter}
          cart={cart}
          onOpenCart={() =>
            setCartOpen(true)
          }
          onOpenMenu={() =>
            setMobileMenuOpen(true)
          }
          onOpenSearch={() =>
            setSearchOpen(true)
          }
          onSelectGlobalGroup={
            selectGlobalGroup
          }
          onHome={clearFilters}
        />

        {loading ? (
          <CatalogLoading />
        ) : (
          <>
            {isHomeView && (
              <>
                <HeroSection
                  slide={activeHeroSlide}
                  index={heroIndex}
                  total={heroSlides.length}
                  onPrevious={previousHero}
                  onNext={nextHero}
                  onSelectSlide={setHeroIndex}
                />

                <CategoryShowcaseSection
                  categories={
                    globalGroupShowcases
                  }
                  onSelect={
                    selectGlobalGroup
                  }
                />

                <BenefitsSection
                  reservationDays={
                    reservationSettings.defaultReservationDays
                  }
                />
              </>
            )}

            {isGlobalGroupLanding && (
              <GlobalGroupLandingSection
                group={selectedGlobalGroup}
                mainCategories={
                  selectedGlobalMainCategories
                }
                onBack={clearFilters}
                onSelectMainCategory={
                  selectMainCategory
                }
                onSelectSubcategory={
                  selectSubcategory
                }
              />
            )}

            {isMainCategoryLanding && (
              <SubcategoryLandingSection
                mainCategory={
                  selectedMainCategory
                }
                subcategories={
                  selectedSubcategoryShowcases
                }
                onBack={clearFilters}
                onSelect={
                  selectSubcategory
                }
              />
            )}

            {!isHomeView &&
              !isGlobalGroupLanding &&
              !isMainCategoryLanding && (
            <section
              id="catalog-products"
              className={
                isHomeView
                  ? "border-t border-black/[0.08] px-4 py-14 sm:px-6 lg:px-10 xl:px-16"
                  : "px-4 py-8 sm:px-6 lg:px-10 xl:px-16"
              }
            >
              <CatalogToolbar
                isHomeView={isHomeView}
                search={search}
                onSearchChange={
                  setSearch
                }
                selectedMainCategory={
                  selectedMainCategory
                }
                selectedSubcategory={
                  selectedSubcategory
                }
                mainCategoryFilter={
                  mainCategoryFilter
                }
                categoryFilter={
                  categoryFilter
                }
                sizeFilter={
                  sizeFilter
                }
                availableSizes={
                  availableSizes
                }
                filteredSubcategories={
                  filteredSubcategories
                }
                mainCategories={
                  mainCategories
                }
                visibleCount={
                  visibleProducts.length
                }
                onMainCategoryChange={
                  selectMainCategory
                }
                onSubcategoryChange={
                  selectSubcategory
                }
                onSizeChange={
                  setSizeFilter
                }
                onOpenFilters={() =>
                  setFiltersOpen(true)
                }
                onClearFilters={
                  clearFilters
                }
              />

              {visibleProducts.length ===
              0 ? (
                <EmptyCatalog
                  onClear={clearFilters}
                />
              ) : (
                <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 sm:gap-y-10 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleProducts.map(
                    (product) => (
                      <EditorialProductCard
                        key={product.id}
                        product={product}
                        storeId={storeId}
                        catalogSearch={
                          location.search
                        }
                        categoryPath={getCategoryPath(
                          product,
                          categoryById,
                          mainCategoryById
                        )}
                        navigationState={{
                          mainCategoryFilter,
                          categoryFilter,
                          sizeFilter,
                          search,
                        }}
                      />
                    )
                  )}
                </div>
              )}
            </section>
              )}
          </>
        )}

        <CatalogFooter />

        {mobileMenuOpen && (
          <MobileCatalogMenu
            globalGroups={
              GLOBAL_CATALOG_GROUPS
            }
            activeGlobalGroup={
              globalGroupFilter
            }
            mainCategories={
              mainCategories
            }
            categories={categories}
            cartCount={
              cart.summary.totalItems
            }
            onClose={() =>
              setMobileMenuOpen(false)
            }
            onOpenCart={() => {
              setMobileMenuOpen(false);
              setCartOpen(true);
            }}
            onSelectGlobalGroup={
              selectGlobalGroup
            }
            onSelectMainCategory={
              selectMainCategory
            }
            onSelectSubcategory={
              selectSubcategory
            }
            onHome={clearFilters}
          />
        )}

        {filtersOpen && (
          <CatalogFiltersDrawer
            mainCategories={
              mainCategories
            }
            categories={categories}
            availableSizes={
              availableSizes
            }
            mainCategoryFilter={
              mainCategoryFilter
            }
            categoryFilter={
              categoryFilter
            }
            sizeFilter={
              sizeFilter
            }
            onMainCategoryChange={
              selectMainCategory
            }
            onSubcategoryChange={
              selectSubcategory
            }
            onSizeChange={
              setSizeFilter
            }
            onClear={clearFilters}
            onClose={() =>
              setFiltersOpen(false)
            }
          />
        )}

        {searchOpen && (
          <SearchOverlay
            value={search}
            onChange={setSearch}
            onClose={() =>
              setSearchOpen(false)
            }
            onSubmit={() => {
              setSearchOpen(false);

              requestAnimationFrame(
                () => {
                  document
                    .getElementById(
                      "catalog-products"
                    )
                    ?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                }
              );
            }}
          />
        )}

        <ReservationCartDrawer
          open={cartOpen}
          onClose={() =>
            setCartOpen(false)
          }
          storeId={storeId}
          cart={cart}
        />

        <FixedWhatsAppButton />
      </main>
    </>
  );
}

function CatalogHeader({
  globalGroups,
  activeGlobalGroup,
  cart,
  onOpenCart,
  onOpenMenu,
  onOpenSearch,
  onSelectGlobalGroup,
  onHome,
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-black/[0.08] bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex min-h-[104px] max-w-[1800px] items-center justify-between gap-5 px-4 sm:min-h-[116px] sm:px-6 lg:min-h-[126px] lg:px-10 xl:px-16">
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex h-11 w-11 items-center justify-center lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu size={23} />
        </button>

        <button
          type="button"
          onClick={onHome}
          className="shrink-0"
          aria-label="Ir al inicio"
        >
          <img
            src="/logo.png"
            alt="Master Caps"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="h-[74px] w-auto object-contain sm:h-[88px] lg:h-[104px] xl:h-[112px]"
          />
        </button>

        <nav className="hidden flex-1 items-center justify-center gap-10 lg:flex">
          {globalGroups.map(
            (group) => (
              <button
                key={group.id}
                type="button"
                onClick={() =>
                  onSelectGlobalGroup(
                    group.id
                  )
                }
                className={`border-b-2 pb-2 text-[12px] font-medium uppercase tracking-[0.12em] transition xl:text-[13px] ${
                  activeGlobalGroup ===
                  group.id
                    ? "border-black text-black"
                    : "border-transparent text-black/65 hover:border-red-600 hover:text-red-600"
                }`}
              >
                {group.name}
              </button>
            )
          )}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-11 w-11 items-center justify-center transition hover:text-red-600"
            aria-label="Buscar"
          >
            <Search size={21} />
          </button>

          <button
            type="button"
            onClick={onOpenCart}
            className="relative flex h-11 w-11 items-center justify-center transition hover:text-red-600"
            aria-label="Abrir carrito"
          >
            <ShoppingBag size={21} />

            {cart.summary.totalItems >
              0 && (
              <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-medium text-white ring-2 ring-white">
                {cart.summary.totalItems}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

function HeroSection({
  slide,
  index,
  total,
  onPrevious,
  onNext,
  onSelectSlide,
}) {
  return (
    <section className="bg-white px-3 pb-5 pt-3 sm:px-5 sm:pb-7 lg:px-8 lg:pt-5">
      <div className="relative mx-auto max-w-[1800px] overflow-hidden bg-black/[0.03] shadow-[0_18px_55px_rgba(0,0,0,0.08)]">
        <div className="relative aspect-[16/8.2] min-h-[300px] w-full overflow-hidden sm:min-h-[380px] lg:min-h-[470px] xl:min-h-[520px]">
          <picture className="absolute inset-0 block h-full w-full">
            <source
              srcSet={slide.imageSrcSet}
              sizes="100vw"
              type="image/webp"
            />

            <img
              src={slide.image}
              srcSet={slide.imageSrcSet}
              sizes="100vw"
              alt={`Tienda Master Caps ${index + 1}`}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              draggable="false"
              className="h-full w-full select-none object-cover object-center [image-rendering:auto]"
            />
          </picture>

          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent" />

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={onPrevious}
                className="absolute left-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/20 text-white backdrop-blur-md transition hover:bg-white hover:text-black sm:left-5 sm:h-11 sm:w-11"
                aria-label="Imagen anterior"
              >
                <ChevronLeft size={19} />
              </button>

              <button
                type="button"
                onClick={onNext}
                className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-white/90 text-black shadow-lg backdrop-blur-md transition hover:bg-red-600 hover:text-white sm:right-5 sm:h-11 sm:w-11"
                aria-label="Imagen siguiente"
              >
                <ChevronRight size={19} />
              </button>

              <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/25 px-3 py-2 backdrop-blur-md">
                {Array.from({
                  length: total,
                }).map((_, slideIndex) => (
                  <button
                    key={slideIndex}
                    type="button"
                    onClick={() =>
                      onSelectSlide(
                        slideIndex
                      )
                    }
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      slideIndex === index
                        ? "w-7 bg-white"
                        : "w-1.5 bg-white/45 hover:bg-white/75"
                    }`}
                    aria-label={`Ir a imagen ${slideIndex + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CategoryShowcaseSection({
  categories,
  onSelect,
}) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <section id="catalog-categories" className="scroll-mt-28 px-4 py-16 sm:px-6 lg:px-10 xl:px-16">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-8 flex items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-black/40">
              Explora Master Caps
            </p>

            <h2 className="mt-2 text-[28px] font-medium uppercase tracking-[-0.04em] sm:text-[38px]">
              Compra por categoría
            </h2>
          </div>

          <p className="hidden max-w-[430px] text-right text-[12px] leading-6 text-black/45 md:block">
            Navega por las categorías principales y encuentra cada producto organizado en su colección correspondiente.
          </p>
        </div>

        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 2xl:grid-cols-4">
          {categories.map(
            (category, categoryIndex) => (
              <button
                key={category.id}
                type="button"
                onClick={() =>
                  onSelect(category.id)
                }
                className="group flex min-h-[430px] w-[82vw] max-w-[340px] shrink-0 snap-start flex-col text-left sm:min-h-[470px] sm:w-auto sm:max-w-none"
              >
                <div className="relative aspect-[4/4.35] w-full overflow-hidden bg-white">
                  <GlobalGroupImage
                    imageBaseName={
                      category.imageBaseName
                    }
                    alt={category.name}
                    loading={
                      categoryIndex < 2
                        ? "eager"
                        : "lazy"
                    }
                    fetchPriority={
                      categoryIndex === 0
                        ? "high"
                        : "auto"
                    }
                    className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-[1.025] sm:p-3"
                  />
                </div>

                <div className="flex flex-1 flex-col border-t border-black/[0.09] bg-white px-1 pb-2 pt-4 text-black">
                  <p className="text-[9px] uppercase tracking-[0.18em] text-black/40">
                    {category.products.length} producto(s)
                  </p>

                  <h3 className="mt-2 line-clamp-2 text-[23px] font-medium uppercase leading-tight tracking-[-0.035em]">
                    {category.name}
                  </h3>

                  <span className="mt-auto inline-flex w-fit items-center gap-3 border-b border-black pb-1 pt-5 text-[9px] font-medium uppercase tracking-[0.18em] transition group-hover:border-red-600 group-hover:text-red-600">
                    Explorar
                    <ArrowRight size={13} />
                  </span>
                </div>
              </button>
            )
          )}
        </div>
      </div>
    </section>
  );
}

function GlobalGroupLandingSection({
  group,
  mainCategories,
  onBack,
  onSelectMainCategory,
  onSelectSubcategory,
}) {
  if (!group) {
    return null;
  }

  const isDirectSubcategoryGroup =
    group.id === "accesorios" ||
    group.id === "gorras";

  const groupSubcategories = [
    ...new Map(
      mainCategories
        .flatMap(
          (mainCategory) =>
            (
              mainCategory.subcategories ||
              []
            ).map(
              (subcategory) => {
                const imageProduct =
                  mainCategory.products?.find(
                    (product) =>
                      safeText(
                        product.categoryId
                      ) ===
                        subcategory.id &&
                      getProductCoverImage(
                        product
                      )?.url
                  );

                return {
                  ...subcategory,
                  products:
                    mainCategory.products?.filter(
                      (product) =>
                        safeText(
                          product.categoryId
                        ) ===
                        subcategory.id
                    ) || [],
                  imageUrl:
                    getProductCoverImage(
                      imageProduct
                    )?.url || "",
                };
              }
            )
        )
        .map((subcategory) => [
          subcategory.id,
          subcategory,
        ])
    ).values(),
  ].sort((left, right) =>
    String(left.name).localeCompare(
      String(right.name),
      "es-CO"
    )
  );

  return (
    <section className="px-4 py-7 sm:px-6 lg:px-10 lg:py-12 xl:px-16">
      <div className="mx-auto max-w-[1800px]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.15em] text-black/48 transition hover:text-red-600"
        >
          <ArrowLeft size={14} />
          Volver al inicio
        </button>

        <div className="mt-6 overflow-hidden bg-white">
          <GlobalGroupImage
            imageBaseName={
              group.imageBaseName
            }
            alt={group.name}
            loading="eager"
            fetchPriority="high"
            className="block h-auto w-full object-contain object-center"
          />
        </div>

        {/* MÓVIL: SOLO TEXTO */}
        <div className="mt-5 border-t border-black/[0.1] lg:hidden">
          {isDirectSubcategoryGroup ? (
            <>
              {groupSubcategories.map(
                (subcategory) => (
                  <button
                    key={subcategory.id}
                    type="button"
                    onClick={() =>
                      onSelectSubcategory(
                        subcategory.id
                      )
                    }
                    className="flex min-h-[62px] w-full items-center justify-between gap-4 border-b border-black/[0.1] py-4 text-left"
                  >
                    <span className="text-[13px] font-medium uppercase tracking-[0.055em]">
                      {subcategory.name}
                    </span>

                    <ChevronRight
                      size={17}
                      className="shrink-0"
                    />
                  </button>
                )
              )}

              <button
                type="button"
                onClick={() => {
                  const firstMain =
                    mainCategories[0];

                  if (firstMain) {
                    onSelectMainCategory(
                      firstMain.id
                    );
                  }
                }}
                className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 bg-black px-4 text-[9px] font-medium uppercase tracking-[0.14em] text-white"
              >
                Ver todo {group.name}
                <ArrowRight size={13} />
              </button>
            </>
          ) : (
            mainCategories.map(
              (mainCategory) => (
                <button
                  key={mainCategory.id}
                  type="button"
                  onClick={() =>
                    onSelectMainCategory(
                      mainCategory.id
                    )
                  }
                  className="flex min-h-[62px] w-full items-center justify-between gap-4 border-b border-black/[0.1] py-4 text-left"
                >
                  <span className="text-[13px] font-medium uppercase tracking-[0.055em]">
                    {mainCategory.name}
                  </span>

                  <ChevronRight
                    size={17}
                    className="shrink-0"
                  />
                </button>
              )
            )
          )}
        </div>

        {/* ESCRITORIO */}
        <div className="mt-8 hidden lg:block">
          {isDirectSubcategoryGroup ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {groupSubcategories.map(
                (
                  subcategory,
                  index
                ) => (
                  <button
                    key={subcategory.id}
                    type="button"
                    onClick={() =>
                      onSelectSubcategory(
                        subcategory.id
                      )
                    }
                    className="group overflow-hidden border border-black/[0.08] bg-white text-left"
                  >
                    <div className="relative aspect-[4/4.35] overflow-hidden bg-white">
                      {subcategory.imageUrl ? (
                        <img
                          src={
                            subcategory.imageUrl
                          }
                          alt={
                            subcategory.name
                          }
                          loading={
                            index < 3
                              ? "eager"
                              : "lazy"
                          }
                          decoding="async"
                          className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-[1.025]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-black/[0.025]">
                          <Camera
                            size={34}
                            className="text-black/20"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex min-h-[112px] items-center justify-between gap-5 border-t border-black/[0.08] px-5 py-5">
                      <div>
                        <p className="text-[8px] uppercase tracking-[0.16em] text-black/38">
                          {
                            subcategory.products
                              .length
                          }{" "}
                          producto(s)
                        </p>

                        <h2 className="mt-2 text-[21px] font-medium uppercase tracking-[-0.03em]">
                          {subcategory.name}
                        </h2>
                      </div>

                      <ArrowRight
                        size={18}
                        className="shrink-0 transition group-hover:translate-x-1 group-hover:text-red-600"
                      />
                    </div>
                  </button>
                )
              )}
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {mainCategories.map(
                (mainCategory, index) => (
                  <button
                    key={mainCategory.id}
                    type="button"
                    onClick={() =>
                      onSelectMainCategory(
                        mainCategory.id
                      )
                    }
                    className="group overflow-hidden border border-black/[0.08] bg-white text-left"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-black/[0.025]">
                      {mainCategory.imageUrl ? (
                        <img
                          src={
                            mainCategory.imageUrl
                          }
                          alt={
                            mainCategory.name
                          }
                          loading={
                            index < 3
                              ? "eager"
                              : "lazy"
                          }
                          decoding="async"
                          className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-[1.025]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Camera
                            size={34}
                            className="text-black/20"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex min-h-[112px] items-center justify-between gap-4 border-t border-black/[0.08] px-5 py-5">
                      <div>
                        <p className="text-[8px] uppercase tracking-[0.16em] text-black/38">
                          {
                            mainCategory.products
                              .length
                          }{" "}
                          producto(s)
                        </p>

                        <h2 className="mt-2 text-[22px] font-medium uppercase tracking-[-0.035em]">
                          {mainCategory.name}
                        </h2>
                      </div>

                      <ArrowRight
                        size={18}
                        className="shrink-0 transition group-hover:translate-x-1 group-hover:text-red-600"
                      />
                    </div>
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SubcategoryLandingSection({
  mainCategory,
  subcategories,
  onBack,
  onSelect,
}) {
  return (
    <section className="px-4 py-12 sm:px-6 lg:px-10 xl:px-16">
      <div className="mx-auto max-w-[1800px]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-black/50 transition hover:text-red-600"
        >
          <ChevronLeft size={14} />
          Todas las categorías
        </button>

        <div className="mt-7 border-b border-black/[0.1] pb-7">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-black/38">
            Categoría principal
          </p>

          <h1 className="mt-2 text-[34px] font-medium uppercase tracking-[-0.045em] sm:text-[48px]">
            {mainCategory?.name || "COLECCIÓN"}
          </h1>

          <p className="mt-3 max-w-[620px] text-[12px] leading-6 text-black/45">
            Selecciona una subcategoría para ver todos los productos disponibles.
          </p>
        </div>

        {subcategories.length === 0 ? (
          <div className="mt-8 border border-black/[0.08] px-5 py-14 text-center">
            <PackageSearch
              size={34}
              className="mx-auto text-black/25"
            />

            <p className="mt-4 text-[14px] font-medium uppercase">
              No hay subcategorías con productos disponibles
            </p>
          </div>
        ) : (
          <div className="-mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 2xl:grid-cols-4">
            {subcategories.map(
              (subcategory, subcategoryIndex) => (
                <button
                  key={subcategory.id}
                  type="button"
                  onClick={() =>
                    onSelect(subcategory.id)
                  }
                  className="group flex min-h-[430px] w-[82vw] max-w-[340px] shrink-0 snap-start flex-col text-left sm:min-h-[470px] sm:w-auto sm:max-w-none"
                >
                  <div className="relative aspect-[4/4.35] w-full overflow-hidden bg-white">
                    {subcategory.imageUrl ? (
                      <img
                        src={subcategory.imageUrl}
                        alt={subcategory.name}
                        loading={subcategoryIndex < 2 ? "eager" : "lazy"}
                        decoding="async"
                        fetchPriority={subcategoryIndex === 0 ? "high" : "auto"}
                        className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-[1.025] sm:p-3"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-black/[0.025]">
                        <Camera size={34} className="text-black/20" />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col border-t border-black/[0.09] bg-white px-1 pb-2 pt-4 text-black">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-black/40">
                      {subcategory.products.length} producto(s)
                    </p>

                    <h2 className="mt-2 line-clamp-2 text-[22px] font-medium uppercase leading-tight tracking-[-0.035em]">
                      {subcategory.name}
                    </h2>

                    <span className="mt-auto inline-flex w-fit items-center gap-3 border-b border-black pb-1 pt-5 text-[9px] font-medium uppercase tracking-[0.18em] transition group-hover:border-red-600 group-hover:text-red-600">
                      Ver productos
                      <ArrowRight size={13} />
                    </span>
                  </div>
                </button>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ProductEditorialSection({
  title,
  description,
  products,
  storeId,
  catalogSearch,
  categoryById,
  mainCategoryById,
  navigationState,
  actionLabel,
  onAction,
}) {
  if (!products?.length) {
    return null;
  }

  return (
    <section className="border-t border-black/[0.08] px-4 py-14 sm:px-6 lg:px-10 xl:px-16">
      <div className="mx-auto max-w-[1800px]">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[25px] font-medium uppercase tracking-[-0.035em] sm:text-[34px]">
              {title}
            </h2>

            <p className="mt-2 text-[12px] leading-6 text-black/45">
              {description}
            </p>
          </div>

          {onAction && (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex items-center gap-3 self-start border-b border-black pb-1 text-[10px] font-medium uppercase tracking-[0.18em] transition hover:border-red-600 hover:text-red-600 sm:self-auto"
            >
              {actionLabel ||
                "VER TODO"}
              <ArrowRight size={14} />
            </button>
          )}
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 lg:grid-cols-4">
          {products.map((product) => (
            <EditorialProductCard
              key={product.id}
              product={product}
              storeId={storeId}
              catalogSearch={
                catalogSearch
              }
              categoryPath={getCategoryPath(
                product,
                categoryById,
                mainCategoryById
              )}
              navigationState={
                navigationState
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CatalogToolbar({
  isHomeView,
  search,
  onSearchChange,
  selectedMainCategory,
  selectedSubcategory,
  mainCategoryFilter,
  categoryFilter,
  sizeFilter,
  availableSizes,
  filteredSubcategories,
  mainCategories,
  visibleCount,
  onMainCategoryChange,
  onSubcategoryChange,
  onSizeChange,
  onOpenFilters,
  onClearFilters,
}) {
  const title =
    selectedSubcategory?.name ||
    selectedMainCategory?.name ||
    (isHomeView
      ? "TODOS LOS PRODUCTOS"
      : "RESULTADOS");

  return (
    <div className="mx-auto max-w-[1800px]">
      <div className="flex flex-col gap-5 border-b border-black/[0.1] pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-black/38">
            Catálogo Master Caps
          </p>

          <h2 className="mt-2 text-[30px] font-medium uppercase tracking-[-0.045em] sm:text-[42px]">
            {title}
          </h2>

          <p className="mt-2 text-[12px] text-black/45">
            {visibleCount} producto(s) disponibles
          </p>
        </div>

        <label className="relative block w-full lg:max-w-[420px]">
          <Search
            size={18}
            className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-black/40"
          />

          <input
            value={search}
            onChange={(event) =>
              onSearchChange(
                event.target.value
              )
            }
            className="h-12 w-full border-b border-black bg-transparent pl-8 pr-2 text-[12px] outline-none placeholder:text-black/35 focus:border-red-600"
            placeholder="BUSCAR PRODUCTO, CÓDIGO, CATEGORÍA O TALLA"
          />
        </label>
      </div>

      <div className="mt-5 hidden grid-cols-3 gap-3 lg:grid">
        <select
          value={mainCategoryFilter}
          onChange={(event) =>
            onMainCategoryChange(
              event.target.value
            )
          }
          className="h-11 border border-black/[0.12] bg-white px-4 text-[11px] uppercase tracking-[0.08em] outline-none focus:border-black"
        >
          <option value="all">
            Todas las categorías
          </option>

          {mainCategories.map(
            (category) => (
              <option
                key={category.id}
                value={category.id}
              >
                {category.name}
              </option>
            )
          )}
        </select>

        <select
          value={categoryFilter}
          onChange={(event) =>
            onSubcategoryChange(
              event.target.value
            )
          }
          className="h-11 border border-black/[0.12] bg-white px-4 text-[11px] uppercase tracking-[0.08em] outline-none focus:border-black"
        >
          <option value="all">
            Todas las subcategorías
          </option>

          {filteredSubcategories.map(
            (category) => (
              <option
                key={category.id}
                value={category.id}
              >
                {category.name}
              </option>
            )
          )}
        </select>

        <select
          value={sizeFilter}
          onChange={(event) =>
            onSizeChange(
              event.target.value
            )
          }
          className="h-11 border border-black/[0.12] bg-white px-4 text-[11px] uppercase tracking-[0.08em] outline-none focus:border-black"
        >
          <option value="all">
            Todas las tallas
          </option>

          {availableSizes.map((size) => (
            <option
              key={size}
              value={size}
            >
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 lg:hidden">
        <button
          type="button"
          onClick={onOpenFilters}
          className="inline-flex h-11 items-center gap-2 border border-black px-4 text-[10px] font-medium uppercase tracking-[0.14em]"
        >
          <SlidersHorizontal
            size={15}
          />
          Filtros
        </button>

        <button
          type="button"
          onClick={onClearFilters}
          className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/50"
        >
          Limpiar
        </button>
      </div>
    </div>
  );
}

function EditorialProductCard({
  product,
  storeId,
  catalogSearch,
  categoryPath,
  navigationState,
}) {
  const variants =
    getAvailableVariants(product);
  const totalStock =
    getTotalStock(product);
  const images =
    getProductImages(product).filter(
      (image) => Boolean(image?.url)
    );
  const coverImage =
    getProductCoverImage(product);
  const hoverImage =
    images[1]?.url || "";

  return (
    <article className="group min-w-0">
      <Link
        to={`/catalogo/${storeId}/apartar/${product.id}${catalogSearch || ""}`}
        state={{
          catalogNavigation: {
            ...navigationState,
            scrollY: window.scrollY,
          },
        }}
        className="block"
      >
        <div className="relative aspect-[4/5] overflow-hidden bg-[#f1f0ee]">
          {coverImage?.url ? (
            <>
              <img
                src={coverImage.url}
                alt={product.name}
                loading="lazy"
                decoding="async"
                className={`absolute inset-0 h-full w-full object-cover transition duration-700 ${
                  hoverImage
                    ? "group-hover:opacity-0"
                    : "group-hover:scale-105"
                }`}
              />

              {hoverImage && (
                <img
                  src={hoverImage}
                  alt={`${product.name} segunda vista`}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover opacity-0 transition duration-700 group-hover:scale-105 group-hover:opacity-100"
                />
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera
                size={36}
                className="text-black/20"
              />
            </div>
          )}

          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
            <span className="bg-white px-2.5 py-1 text-[8px] font-medium uppercase tracking-[0.14em] text-black shadow-sm">
              Disponible
            </span>

            {images.length > 1 && (
              <span className="inline-flex items-center gap-1 bg-black/75 px-2 py-1 text-[8px] text-white">
                <Images size={10} />
                {images.length}
              </span>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 translate-y-full bg-black px-4 py-3 text-white transition duration-300 group-hover:translate-y-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[9px] uppercase tracking-[0.16em]">
                Ver producto
              </span>

              <ArrowRight size={14} />
            </div>
          </div>
        </div>

        <div className="pt-3">
          <p className="line-clamp-1 text-[8px] uppercase tracking-[0.14em] text-black/40 sm:text-[9px]">
            {categoryPath ||
              "COLECCIÓN"}
          </p>

          <h3 className="mt-1 line-clamp-2 text-[11px] font-medium uppercase leading-5 sm:text-[13px]">
            {product.name}
          </h3>

          <p className="mt-1.5 text-[13px] font-medium sm:text-[15px]">
            {formatCurrency(
              product.salePrice
            )}
          </p>

          <div className="mt-2 flex min-h-[26px] flex-wrap gap-1">
            {variants
              .slice(0, 5)
              .map((variant) => (
                <span
                  key={variant.id}
                  className="border border-black/[0.16] px-2 py-1 text-[8px] uppercase"
                >
                  {variant.size}
                </span>
              ))}

            {variants.length > 5 && (
              <span className="px-1 py-1 text-[8px] text-black/45">
                +{variants.length - 5}
              </span>
            )}
          </div>

          <p className="mt-2 text-[9px] text-emerald-700">
            {totalStock} unidad(es) disponibles
          </p>
        </div>
      </Link>
    </article>
  );
}

function BenefitsSection({
  reservationDays,
}) {
  const [activeBenefit, setActiveBenefit] =
    useState(0);

  const benefits = [
    {
      icon: Truck,
      title: "ENVÍOS A TODO COLOMBIA",
      description:
        "Recibe tus productos en cualquier ciudad del país.",
    },
    {
      icon: CalendarClock,
      title: `APARTADOS POR ${reservationDays} DÍA(S)`,
      description:
        "Separa tus productos favoritos y completa el pago dentro del plazo.",
    },
    {
      icon: ShieldCheck,
      title: "STOCK Y RESERVAS SEGURAS",
      description:
        "El sistema valida nuevamente cada talla antes de confirmar.",
    },
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveBenefit((current) =>
        current >= benefits.length - 1
          ? 0
          : current + 1
      );
    }, 3500);

    return () =>
      window.clearInterval(timer);
  }, [benefits.length]);

  function goToBenefit(index) {
    setActiveBenefit(index);
  }

  return (
    <section className="border-t border-black/[0.08] px-4 py-9 sm:px-6 sm:py-12 lg:px-10 lg:py-16 xl:px-16">
      <div className="mx-auto max-w-[1800px]">
        {/* CARRUSEL AUTOMÁTICO MÓVIL */}
        <div className="sm:hidden">
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                transform: `translateX(-${activeBenefit * 100}%)`,
              }}
            >
              {benefits.map((benefit) => {
                const Icon = benefit.icon;

                return (
                  <article
                    key={benefit.title}
                    className="flex min-h-[205px] w-full shrink-0 flex-col items-center justify-center border border-black/[0.08] bg-white px-6 py-7 text-center"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.035]">
                      <Icon
                        size={23}
                        strokeWidth={1.45}
                      />
                    </div>

                    <h3 className="mt-5 text-[11px] font-medium uppercase tracking-[0.08em]">
                      {benefit.title}
                    </h3>

                    <p className="mx-auto mt-3 max-w-[270px] text-[9px] leading-5 text-black/45">
                      {benefit.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            {benefits.map(
              (benefit, index) => (
                <button
                  key={benefit.title}
                  type="button"
                  onClick={() =>
                    goToBenefit(index)
                  }
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    activeBenefit === index
                      ? "w-7 bg-black"
                      : "w-1.5 bg-black/20"
                  }`}
                  aria-label={`Ver beneficio ${index + 1}`}
                />
              )
            )}
          </div>
        </div>

        {/* CUADRÍCULA TABLET Y ESCRITORIO */}
        <div className="hidden gap-6 sm:grid sm:grid-cols-3">
          {benefits.map((benefit) => {
            const Icon = benefit.icon;

            return (
              <article
                key={benefit.title}
                className="flex min-h-[230px] flex-col items-center justify-center border border-black/[0.08] bg-white px-5 py-7 text-center"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.035]">
                  <Icon
                    size={23}
                    strokeWidth={1.45}
                  />
                </div>

                <h3 className="mt-5 text-[11px] font-medium uppercase tracking-[0.08em]">
                  {benefit.title}
                </h3>

                <p className="mx-auto mt-3 max-w-[260px] text-[9px] leading-5 text-black/45">
                  {benefit.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CatalogFooter() {
  const [openSection, setOpenSection] =
    useState("");

  function toggleSection(sectionId) {
    setOpenSection((current) =>
      current === sectionId
        ? ""
        : sectionId
    );
  }

  const mobileSections = [
    {
      id: "legal",
      title: "LEGAL Y CONDICIONES",
      content: (
        <div className="space-y-2">
          <p>
            Los apartados están sujetos a disponibilidad y validación final de stock.
          </p>

          <p>
            Las imágenes pueden presentar pequeñas variaciones de color según la pantalla.
          </p>
        </div>
      ),
    },
    {
      id: "orders",
      title: "PEDIDOS",
      content: (
        <div className="space-y-2">
          <p>
            Consulta el estado de tu apartado directamente con nuestro equipo.
          </p>

          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
              "Hola Master Caps, quiero consultar el estado de mi pedido o apartado."
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-b border-black pb-1 font-medium text-black"
          >
            Consultar por WhatsApp
            <ArrowRight size={12} />
          </a>
        </div>
      ),
    },
    {
      id: "help",
      title: "¿NECESITAS AYUDA?",
      content: (
        <div className="space-y-2">
          <p>
            Te ayudamos con tallas, disponibilidad, apartados y entregas.
          </p>

          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
              WHATSAPP_MESSAGE
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-b border-black pb-1 font-medium text-black"
          >
            Hablar con un asesor
            <ArrowRight size={12} />
          </a>
        </div>
      ),
    },
    {
      id: "stores",
      title: "TIENDAS",
      content: (
        <div className="flex items-start gap-3">
          <MapPin
            size={16}
            className="mt-0.5 shrink-0 text-red-600"
          />

          <address className="not-italic">
            <strong className="block font-medium text-black">
              MASTER CAPS
            </strong>

            <span className="mt-1 block">
              Ubaté, Cundinamarca
            </span>

            <span className="block">
              Cra. 8 #10-51
            </span>
          </address>
        </div>
      ),
    },
  ];

  return (
    <>
      {/* FOOTER COMPACTO MÓVIL */}
      <footer className="border-t border-black/[0.1] bg-white px-4 pb-[calc(74px+env(safe-area-inset-bottom))] pt-8 text-black sm:px-6 lg:hidden">
        <div className="mx-auto max-w-[560px]">
          <div className="flex items-center justify-between gap-4 pb-7">
            <img
              src="/logo.png"
              alt="Master Caps"
              loading="lazy"
              decoding="async"
              className="h-[72px] w-auto object-contain"
            />

            <div className="text-right">
              <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-black/35">
                Atención
              </p>

              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
                  WHATSAPP_MESSAGE
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em]"
              >
                WhatsApp
                <ArrowRight size={11} />
              </a>
            </div>
          </div>

          <div className="border-t border-black/[0.14]">
            {mobileSections.map(
              (section) => {
                const isOpen =
                  openSection ===
                  section.id;

                return (
                  <div
                    key={section.id}
                    className="border-b border-black/[0.14]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        toggleSection(
                          section.id
                        )
                      }
                      className="flex min-h-[66px] w-full items-center justify-between gap-4 py-4 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="text-[14px] font-normal tracking-[-0.01em]">
                        {section.title}
                      </span>

                      <Plus
                        size={17}
                        className={`shrink-0 transition duration-300 ${
                          isOpen
                            ? "rotate-45"
                            : ""
                        }`}
                      />
                    </button>

                    <div
                      className={`grid transition-all duration-300 ${
                        isOpen
                          ? "grid-rows-[1fr] pb-4"
                          : "grid-rows-[0fr]"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="pr-7 text-[10px] leading-5 text-black/55">
                          {section.content}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>

          <div className="flex flex-col gap-2 pt-5 text-[8px] uppercase tracking-[0.14em] text-black/32">
            <p>
              © {new Date().getFullYear()} Master Caps
            </p>

            <p>
              Catálogo y disponibilidad en tiempo real
            </p>
          </div>
        </div>
      </footer>

      {/* FOOTER PREMIUM ESCRITORIO */}
      <footer className="relative hidden overflow-hidden bg-[#090909] px-10 pb-7 pt-16 text-white lg:block xl:px-16">
        <div className="pointer-events-none absolute -right-20 -top-36 h-[420px] w-[420px] rounded-full bg-red-600/10 blur-[110px]" />

        <div className="relative mx-auto max-w-[1800px]">
          <div className="grid gap-16 border-b border-white/10 pb-12 md:grid-cols-[1.35fr_.8fr_.9fr]">
            <div>
              <img
                src="/logo.png"
                alt="Master Caps"
                loading="lazy"
                decoding="async"
                className="h-28 w-auto object-contain brightness-0 invert"
              />

              <p className="mt-5 max-w-[500px] text-[11px] leading-6 text-white/55">
                Moda, accesorios y productos seleccionados con inventario, tallas y apartados gestionados en tiempo real.
              </p>

              <div className="mt-6 inline-flex items-center gap-3 border border-white/12 bg-white/[0.035] px-4 py-3">
                <ShieldCheck
                  size={17}
                  className="text-red-500"
                />

                <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/75">
                  Compra y apartado seguro
                </span>
              </div>
            </div>

            <div>
              <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/35">
                Visítanos
              </p>

              <div className="mt-5 flex items-start gap-3">
                <MapPin
                  size={18}
                  className="mt-0.5 shrink-0 text-red-500"
                />

                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.06em]">
                    Master Caps
                  </p>

                  <address className="mt-2 not-italic text-[11px] leading-6 text-white/55">
                    Ubaté, Cundinamarca
                    <br />
                    Cra. 8 #10-51
                  </address>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/35">
                Atención personalizada
              </p>

              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
                  WHATSAPP_MESSAGE
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-3 border-b border-white/35 pb-2 text-[12px] font-medium uppercase tracking-[0.08em] transition hover:border-red-500 hover:text-red-500"
              >
                WhatsApp +57 311 816 9948
                <ArrowRight size={14} />
              </a>

              <p className="mt-5 max-w-[330px] text-[10px] leading-5 text-white/45">
                Escríbenos para consultar productos, disponibilidad, entregas y condiciones de apartado.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-6 text-[8px] uppercase tracking-[0.16em] text-white/30">
            <p>
              © {new Date().getFullYear()} Master Caps
            </p>

            <p>
              Catálogo y disponibilidad en tiempo real
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

function EmptyCatalog({
  onClear,
}) {
  return (
    <div className="mx-auto mt-8 max-w-[1800px] border border-black/[0.08] px-5 py-16 text-center">
      <PackageSearch
        size={38}
        className="mx-auto text-black/25"
      />

      <h2 className="mt-5 text-[22px] font-medium uppercase tracking-[-0.03em]">
        No encontramos productos
      </h2>

      <p className="mt-2 text-[12px] text-black/45">
        Ajusta la búsqueda, categoría, subcategoría o talla seleccionada.
      </p>

      <button
        type="button"
        onClick={onClear}
        className="mt-6 bg-black px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-white"
      >
        Ver todo el catálogo
      </button>
    </div>
  );
}

function CatalogLoading() {
  return (
    <section className="flex min-h-[620px] items-center justify-center bg-[#f4f3f1]">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-black/15 border-t-black" />

        <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.18em] text-black/45">
          Cargando catálogo
        </p>
      </div>
    </section>
  );
}

function MobileCatalogMenu({
  globalGroups,
  activeGlobalGroup,
  mainCategories,
  categories,
  cartCount,
  onClose,
  onOpenCart,
  onSelectGlobalGroup,
  onSelectMainCategory,
  onSelectSubcategory,
  onHome,
}) {
  const initialGroup =
    activeGlobalGroup !== "all"
      ? activeGlobalGroup
      : globalGroups[0]?.id || "";

  const [menuGroup, setMenuGroup] =
    useState(initialGroup);

  const visibleMainCategories =
    mainCategories.filter(
      (mainCategory) =>
        getGlobalGroupId(
          mainCategory
        ) === menuGroup
    );

  const selectedMenuGroup =
    globalGroups.find(
      (group) =>
        group.id === menuGroup
    );

  const visibleSubcategories = [
    ...new Map(
      visibleMainCategories
        .flatMap((mainCategory) =>
          categories.filter(
            (category) =>
              safeText(
                category.parentCategoryId
              ) === mainCategory.id
          )
        )
        .map((subcategory) => [
          subcategory.id,
          subcategory,
        ])
    ).values(),
  ].sort((left, right) =>
    String(left.name).localeCompare(
      String(right.name),
      "es-CO"
    )
  );

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm lg:hidden">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label="Cerrar menú"
      />

      <aside className="relative flex h-full w-[92%] max-w-[430px] flex-col overflow-hidden bg-white shadow-[18px_0_60px_rgba(0,0,0,0.18)]">
        {/* CABECERA FIJA */}
        <div className="shrink-0 border-b border-black/[0.08] bg-white">
          <div className="flex items-center justify-between px-5 py-4">
            <button
              type="button"
              onClick={() => {
                onHome();
                onClose();
              }}
              aria-label="Ir al inicio"
            >
              <img
                src="/logo.png"
                alt="Master Caps"
                className="h-16 w-auto object-contain"
              />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center"
              aria-label="Cerrar menú"
            >
              <X size={21} />
            </button>
          </div>

          <div className="grid grid-cols-3 border-t border-black/[0.06]">
            {globalGroups.map(
              (group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() =>
                    setMenuGroup(
                      group.id
                    )
                  }
                  className={`min-h-[48px] border-b-2 px-2 text-[8px] font-medium uppercase tracking-[0.07em] transition ${
                    menuGroup === group.id
                      ? "border-black text-black"
                      : "border-transparent text-black/42"
                  }`}
                >
                  {group.name}
                </button>
              )
            )}
          </div>
        </div>

        {/* IMAGEN COMPLETA Y FIJA */}
        <div className="shrink-0 border-b border-black/[0.08] bg-[#f5f5f5]">
          <div className="relative h-[150px] overflow-hidden">
            <GlobalGroupImage
              imageBaseName={
                selectedMenuGroup?.imageBaseName ||
                "hombre"
              }
              alt={
                selectedMenuGroup?.name ||
                menuGroup
              }
              loading="eager"
              fetchPriority="high"
              className="h-full w-full object-contain object-center"
            />
          </div>
        </div>

        {/* ÚNICA ZONA CON SCROLL */}
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-2 [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.18)_transparent]">
          {menuGroup === "hombre"
            ? visibleMainCategories.map(
                (mainCategory) => (
                  <button
                    key={
                      mainCategory.id
                    }
                    type="button"
                    onClick={() => {
                      onSelectMainCategory(
                        mainCategory.id
                      );
                      onClose();
                    }}
                    className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-black/[0.09] text-left"
                  >
                    <span className="text-[11px] font-medium uppercase tracking-[0.055em]">
                      {
                        mainCategory.name
                      }
                    </span>

                    <ChevronRight
                      size={15}
                      className="shrink-0"
                    />
                  </button>
                )
              )
            : visibleSubcategories.map(
                (subcategory) => (
                  <button
                    key={
                      subcategory.id
                    }
                    type="button"
                    onClick={() => {
                      onSelectSubcategory(
                        subcategory.id
                      );
                      onClose();
                    }}
                    className="flex min-h-[52px] w-full items-center justify-between gap-3 border-b border-black/[0.09] text-left"
                  >
                    <span className="text-[11px] font-medium uppercase tracking-[0.055em]">
                      {
                        subcategory.name
                      }
                    </span>

                    <ChevronRight
                      size={15}
                      className="shrink-0"
                    />
                  </button>
                )
              )}
        </nav>

        {/* BOTONES FIJOS INFERIORES */}
        <div className="shrink-0 border-t border-black/[0.08] bg-white px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 shadow-[0_-14px_35px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            onClick={() => {
              onSelectGlobalGroup(
                menuGroup
              );
              onClose();
            }}
            className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 bg-black px-4 text-[9px] font-medium uppercase tracking-[0.14em] text-white transition active:scale-[0.99]"
          >
            Ver todo{" "}
            {
              selectedMenuGroup?.name
            }
            <ArrowRight size={13} />
          </button>

          <button
            type="button"
            onClick={onOpenCart}
            className="mt-3 flex min-h-[50px] w-full items-center justify-between bg-black px-5 text-[10px] font-medium uppercase tracking-[0.14em] text-white transition active:scale-[0.99]"
          >
            <span className="inline-flex items-center gap-2">
              <ShoppingBag
                size={16}
              />
              Carrito
            </span>

            <span>{cartCount}</span>
          </button>
        </div>
      </aside>
    </div>
  );
}

function CatalogFiltersDrawer({
  mainCategories,
  categories,
  availableSizes,
  mainCategoryFilter,
  categoryFilter,
  sizeFilter,
  onMainCategoryChange,
  onSubcategoryChange,
  onSizeChange,
  onClear,
  onClose,
}) {
  const visibleSubcategories =
    mainCategoryFilter === "all"
      ? categories
      : categories.filter(
          (category) =>
            safeText(
              category.parentCategoryId
            ) === mainCategoryFilter
        );

  return (
    <div className="fixed inset-0 z-[95] bg-black/50 backdrop-blur-sm lg:hidden">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Cerrar filtros"
      />

      <aside className="absolute bottom-0 left-0 right-0 max-h-[88vh] overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/[0.08] pb-4">
          <h2 className="text-[17px] font-medium uppercase tracking-[-0.02em]">
            Filtros
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center"
          >
            <X size={20} />
          </button>
        </div>

        <FilterSelect
          label="Categoría principal"
          value={mainCategoryFilter}
          onChange={onMainCategoryChange}
          options={[
            {
              value: "all",
              label:
                "Todas las categorías",
            },
            ...mainCategories.map(
              (category) => ({
                value: category.id,
                label: category.name,
              })
            ),
          ]}
        />

        <FilterSelect
          label="Subcategoría"
          value={categoryFilter}
          onChange={onSubcategoryChange}
          options={[
            {
              value: "all",
              label:
                "Todas las subcategorías",
            },
            ...visibleSubcategories.map(
              (category) => ({
                value: category.id,
                label: category.name,
              })
            ),
          ]}
        />

        <FilterSelect
          label="Talla"
          value={sizeFilter}
          onChange={onSizeChange}
          options={[
            {
              value: "all",
              label:
                "Todas las tallas",
            },
            ...availableSizes.map(
              (size) => ({
                value: size,
                label: size,
              })
            ),
          ]}
        />

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClear}
            className="h-12 border border-black text-[10px] font-medium uppercase tracking-[0.14em]"
          >
            Limpiar
          </button>

          <button
            type="button"
            onClick={onClose}
            className="h-12 bg-black text-[10px] font-medium uppercase tracking-[0.14em] text-white"
          >
            Ver resultados
          </button>
        </div>
      </aside>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}) {
  return (
    <label className="mt-5 block">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/45">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-2 h-12 w-full border border-black/[0.14] bg-white px-4 text-[11px] uppercase outline-none"
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchOverlay({
  value,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-white">
      <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-5 py-5 sm:px-8">
        <div className="flex items-center justify-between">
          <img
            src="/logo.png"
            alt="Master Caps"
            className="h-16 w-auto object-contain"
          />

          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center"
          >
            <X size={23} />
          </button>
        </div>

        <div className="flex flex-1 items-center">
          <form
            className="w-full"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-black/40">
              Buscar en Master Caps
            </p>

            <div className="mt-4 flex items-center border-b-2 border-black">
              <Search
                size={27}
                className="mr-4 shrink-0"
              />

              <input
                autoFocus
                value={value}
                onChange={(event) =>
                  onChange(
                    event.target.value
                  )
                }
                className="h-20 min-w-0 flex-1 bg-transparent text-[24px] uppercase tracking-[-0.03em] outline-none placeholder:text-black/25 sm:text-[38px]"
                placeholder="¿QUÉ ESTÁS BUSCANDO?"
              />
            </div>

            <button
              type="submit"
              className="mt-7 inline-flex h-12 items-center gap-3 bg-black px-7 text-[10px] font-medium uppercase tracking-[0.18em] text-white"
            >
              Ver resultados
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function FixedWhatsAppButton() {
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    WHATSAPP_MESSAGE
  )}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[calc(18px+env(safe-area-inset-bottom))] right-4 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_18px_45px_rgba(220,38,38,0.34)] ring-4 ring-white transition hover:-translate-y-1 hover:bg-red-700 sm:bottom-6 sm:right-6 sm:h-[60px] sm:w-[60px]"
      aria-label="Contactar por WhatsApp"
      title="Asesoría por WhatsApp"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8 fill-current sm:h-9 sm:w-9"
        aria-hidden="true"
      >
        <path d="M16.04 4C9.41 4 4 9.38 4 15.98c0 2.1.56 4.16 1.62 5.97L4 28l6.23-1.63a12.08 12.08 0 0 0 5.81 1.48h.01C22.68 27.85 28 22.49 28 15.89 28 9.31 22.67 4 16.04 4Zm.01 21.83h-.01c-1.74 0-3.45-.47-4.94-1.36l-.35-.21-3.7.97.99-3.6-.23-.37a9.86 9.86 0 0 1-1.52-5.28c0-5.47 4.48-9.93 9.99-9.93 2.67 0 5.18 1.04 7.06 2.91a9.83 9.83 0 0 1 2.93 7.01c0 5.47-4.47 9.86-10.22 9.86Zm5.46-7.37c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.03-1.05 2.51s1.08 2.91 1.23 3.11c.15.2 2.13 3.25 5.16 4.55.72.31 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.08-.12-.27-.2-.57-.35Z" />
      </svg>
    </a>
  );
}