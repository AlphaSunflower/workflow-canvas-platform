import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { useProtectedResourceUrl } from '../../hooks/file/useProtectedResourceUrl';
import { isEphemeralResourceUrl } from '../../services/protected-resource';
import { createModuleLogger } from '../../utils';

type FileType = 'image' | 'video' | 'model3d';

const log = createModuleLogger('file-thumbnail');

interface FileThumbnailProps {
  src?: string;
  fallbackSrc?: string;
  alt: string;
  fileType: FileType;
  width?: number;
  height?: number;
  className?: string;
  onClick?: () => void;
  onLoad?: () => void;
  onError?: () => void;
}

function canFallback(primary: string | undefined, fallback: string | undefined): boolean {
  if (!fallback || !primary || fallback === primary) {
    return false;
  }

  return true;
}

const FileThumbnailInner: React.FC<FileThumbnailProps> = ({
  src,
  fallbackSrc,
  alt,
  fileType,
  width = 120,
  height = 68,
  className = '',
  onClick,
  onLoad,
  onError,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [activeSrc, setActiveSrc] = useState<string | undefined>(src);
  const [hasAttemptedFallback, setHasAttemptedFallback] = useState(false);
  const protectedResource = useProtectedResourceUrl(activeSrc, {
    enabled: Boolean(activeSrc) && !hasError,
  });
  const resolvedSrc = protectedResource.resolvedUrl;
  const canTryFallback = useMemo(
    () => canFallback(src, fallbackSrc),
    [fallbackSrc, src],
  );

  useEffect(() => {
    setActiveSrc(src);
    setHasAttemptedFallback(false);
    setHasError(false);
    setIsLoaded(false);
  }, [fallbackSrc, src]);

  useEffect(() => {
    if (
      !protectedResource.error
      || hasAttemptedFallback
      || !canTryFallback
      || !fallbackSrc
      || fallbackSrc === activeSrc
    ) {
      return;
    }

    setHasAttemptedFallback(true);
    setActiveSrc(fallbackSrc);
    setHasError(false);
    setIsLoaded(false);
    log.info('protectedResourceError', 'Thumbnail protected resource resolution failed, falling back to alternate source', {
      alt,
      fileType,
      failedSrc: activeSrc,
      fallbackSrc,
      error: protectedResource.error,
    });
  }, [
    activeSrc,
    alt,
    canTryFallback,
    fallbackSrc,
    fileType,
    hasAttemptedFallback,
    protectedResource.error,
  ]);

  const handleLoad = useCallback((): void => {
    setIsLoaded(true);
    onLoad?.();
    log.debug('handleLoad', `Thumbnail loaded: ${alt}`);
  }, [alt, onLoad]);

  const handleError = useCallback((): void => {
    if (
      !hasAttemptedFallback
      && canTryFallback
      && fallbackSrc
      && fallbackSrc !== activeSrc
      && (
        isEphemeralResourceUrl(activeSrc)
        || protectedResource.isEphemeral
      )
    ) {
      setHasAttemptedFallback(true);
      setActiveSrc(fallbackSrc);
      setHasError(false);
      setIsLoaded(false);
      log.info('handleError', 'Ephemeral thumbnail source failed, falling back to persistent source', {
        alt,
        fileType,
        failedSrc: activeSrc,
        fallbackSrc,
      });
      return;
    }

    if (
      !hasAttemptedFallback
      && canTryFallback
      && fallbackSrc
      && fallbackSrc !== activeSrc
    ) {
      setHasAttemptedFallback(true);
      setActiveSrc(fallbackSrc);
      setIsLoaded(false);
      return;
    }

    setHasError(true);
    onError?.();
    log.warn('handleError', `Thumbnail failed to load: ${alt}`);
  }, [
    activeSrc,
    alt,
    canTryFallback,
    fallbackSrc,
    fileType,
    hasAttemptedFallback,
    onError,
    protectedResource.isEphemeral,
  ]);

  const handleClick = useCallback((): void => {
    onClick?.();
    log.debug('handleClick', `Thumbnail clicked: ${alt}`);
  }, [alt, onClick]);

  const getPlaceholderIcon = (): string => {
    switch (fileType) {
      case 'image':
        return '🖼️';
      case 'video':
        return '🎬';
      case 'model3d':
        return '🧊';
      default:
        return '📄';
    }
  };

  const renderContent = (): JSX.Element => {
    if (hasError || !resolvedSrc) {
      return (
        <div className="file-thumbnail__placeholder">
          <span className="file-thumbnail__placeholder-icon">{getPlaceholderIcon()}</span>
          <span className="file-thumbnail__placeholder-text">{alt}</span>
        </div>
      );
    }

    if (fileType === 'video') {
      return (
        <div className="file-thumbnail__video-wrapper">
          <video
            src={resolvedSrc}
            className="file-thumbnail__video"
            onLoadStart={handleLoad}
            onError={handleError}
            muted
          />
          <div className="file-thumbnail__video-overlay">
            <span className="file-thumbnail__play-icon">▶</span>
          </div>
        </div>
      );
    }

    return (
      <img
        src={resolvedSrc}
        alt={alt}
        className={`file-thumbnail__image ${isLoaded ? 'file-thumbnail__image--loaded' : ''}`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
      />
    );
  };

  return (
    <div
      className={`file-thumbnail file-thumbnail--${fileType} ${className}`}
      style={{ width, height }}
      onClick={handleClick}
    >
      {!isLoaded && !hasError && protectedResource.loading && (
        <div className="file-thumbnail__loading">
          <div className="file-thumbnail__spinner" />
        </div>
      )}
      {renderContent()}
    </div>
  );
};

FileThumbnailInner.displayName = 'FileThumbnailInner';
export const FileThumbnail = memo(FileThumbnailInner);
FileThumbnail.displayName = 'FileThumbnail';
