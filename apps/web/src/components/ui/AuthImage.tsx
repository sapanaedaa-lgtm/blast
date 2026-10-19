"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";

interface AuthImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function AuthImage({ src, alt, className }: AuthImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;

    apiClient
      .get(src, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        created = URL.createObjectURL(res.data);
        setObjectUrl(created);
      })
      .catch(() => {
        // Keep the image empty on error.
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (!objectUrl) return null;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objectUrl} alt={alt} className={className} />;
}
