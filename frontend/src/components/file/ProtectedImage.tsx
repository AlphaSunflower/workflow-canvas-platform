import React from 'react';

import { useProtectedResourceUrl } from '../../hooks/file/useProtectedResourceUrl';

interface ProtectedImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  draggable?: boolean;
}

export const ProtectedImage: React.FC<ProtectedImageProps> = ({
  src,
  alt,
  className,
  fallback = null,
  draggable = false,
}) => {
  const { resolvedUrl } = useProtectedResourceUrl(src, {
    enabled: Boolean(src),
  });

  if (!resolvedUrl) {
    return <>{fallback}</>;
  }

  return <img src={resolvedUrl} alt={alt} className={className} draggable={draggable} />;
};

ProtectedImage.displayName = 'ProtectedImage';
