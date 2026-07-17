import { useEffect, useState } from 'react';

import {
  acquireProtectedResourceUrl,
  isEphemeralResourceUrl,
  isProtectedResourceUrl,
} from '@/services/protected-resource';

interface UseProtectedResourceUrlResult {
  resolvedUrl?: string;
  loading: boolean;
  error?: string;
  isEphemeral: boolean;
}

interface UseProtectedResourceUrlOptions {
  enabled?: boolean;
}

export function useProtectedResourceUrl(
  url?: string,
  options: UseProtectedResourceUrlOptions = {},
): UseProtectedResourceUrlResult {
  const enabled = options.enabled ?? true;
  const initialResolvedUrl = url && !isProtectedResourceUrl(url)
    ? url
    : undefined;
  const [state, setState] = useState<UseProtectedResourceUrlResult>({
    resolvedUrl: initialResolvedUrl,
    loading: false,
    isEphemeral: Boolean(initialResolvedUrl && isEphemeralResourceUrl(initialResolvedUrl)),
  });

  useEffect(() => {
    if (!url || !enabled) {
      setState({
        resolvedUrl: undefined,
        loading: false,
        error: undefined,
        isEphemeral: false,
      });
      return;
    }

    if (!isProtectedResourceUrl(url)) {
      setState((current) => (
        current.resolvedUrl === url && current.loading === false && current.error === undefined
          ? current
          : {
            resolvedUrl: url,
            loading: false,
            error: undefined,
            isEphemeral: isEphemeralResourceUrl(url),
          }
      ));
      return;
    }

    const controller = new AbortController();
    let released = false;
    let releaseHandle: (() => void) | undefined;

    setState({
      resolvedUrl: undefined,
      loading: true,
      error: undefined,
      isEphemeral: false,
    });

    void acquireProtectedResourceUrl(url, { signal: controller.signal })
      .then((handle) => {
        if (released) {
          handle.release();
          return;
        }

        releaseHandle = handle.release;
        setState({
          resolvedUrl: handle.url,
          loading: false,
          isEphemeral: isEphemeralResourceUrl(handle.url),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          resolvedUrl: undefined,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to resolve protected resource.',
          isEphemeral: false,
        });
      });

    return () => {
      released = true;
      controller.abort();
      releaseHandle?.();
    };
  }, [enabled, url]);

  return state;
}
