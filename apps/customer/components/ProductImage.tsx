"use client";

import { useState, useEffect } from "react";
import { ShoppingBag } from "lucide-react";

interface ProductImageProps {
  src?: string | null;
  alt: string;
  category?: string;
  className?: string;
  aspectRatio?: "square" | "portrait" | "wide";
  priority?: boolean;
}

export function ProductImage({
  src,
  alt,
  className = "",
  aspectRatio = "portrait",
  priority = false,
}: ProductImageProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const aspectClass =
    aspectRatio === "square"
      ? "aspect-square"
      : aspectRatio === "wide"
      ? "aspect-[16/10]"
      : "aspect-[3/4]";

  const finalAspectClass =
    className.includes("h-full") || className.includes("aspect-")
      ? ""
      : aspectClass;

  if (!src || hasError) {
    return (
      <div
        className={`relative overflow-hidden w-full bg-[rgb(var(--surface-muted))] flex items-center justify-center text-ink-500/40 ${finalAspectClass} ${className}`}
      >
        <ShoppingBag className="h-8 w-8" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden w-full bg-[rgb(var(--surface-muted))] ${finalAspectClass} ${className}`}
    >
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        className="buy-fade w-full h-full object-cover"
        ref={(node) => { if (node?.complete && node.naturalWidth > 0) node.dataset.loaded = "true"; }}
        onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }}
        onError={() => setHasError(true)}
      />
    </div>
  );
}
