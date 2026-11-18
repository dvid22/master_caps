import { useState } from "react";
import { Camera } from "lucide-react";

/*
 * Imagen de producto optimizada para listas y tarjetas pequeñas.
 *
 * - Usa la miniatura (≈480 px) cuando existe; la imagen completa (1200 px)
 *   solo se pide si la miniatura falla o no existe.
 * - Muestra al instante la vista previa difuminada guardada en el producto
 *   (placeholder base64), sin ninguna descarga extra.
 * - Carga diferida (lazy) y decodificación asíncrona para no bloquear la página.
 *
 * `image` es un registro de getProductCoverImage()/getProductImages().
 * También acepta `src` directo para registros antiguos (p. ej. líneas de
 * apartados que solo guardaron productImageUrl).
 */
export default function ProductImage({
  image = null,
  src = "",
  alt = "",
  size = "thumb",
  className = "",
  imgClassName = "h-full w-full object-contain",
  eager = false,
  iconSize = 18,
}) {
  const fullUrl = String(image?.url || src || "").trim();
  const thumbUrl = String(image?.thumbnailUrl || "").trim();
  const placeholder = String(image?.placeholder || "").trim();

  const preferredUrl =
    size === "full" ? fullUrl || thumbUrl : thumbUrl || fullUrl;

  const [trackedUrl, setTrackedUrl] = useState(preferredUrl);
  const [currentUrl, setCurrentUrl] = useState(preferredUrl);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Si cambia la imagen del producto, se reinicia el estado (sin efecto extra).
  if (trackedUrl !== preferredUrl) {
    setTrackedUrl(preferredUrl);
    setCurrentUrl(preferredUrl);
    setLoaded(false);
    setFailed(false);
  }

  function handleError() {
    if (fullUrl && currentUrl !== fullUrl) {
      setLoaded(false);
      setCurrentUrl(fullUrl);
      return;
    }

    setFailed(true);
  }

  if (!currentUrl || failed) {
    return (
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-black/[0.025] ${className}`}
      >
        <Camera size={iconSize} className="text-black/25" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      {!loaded &&
        (placeholder ? (
          <img
            src={placeholder}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 scale-110 blur-md ${imgClassName}`}
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-black/[0.035] motion-reduce:animate-none" />
        ))}

      <img
        src={currentUrl}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
        draggable="false"
        onLoad={() => setLoaded(true)}
        onError={handleError}
        className={`relative transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        } ${imgClassName}`}
      />
    </div>
  );
}
