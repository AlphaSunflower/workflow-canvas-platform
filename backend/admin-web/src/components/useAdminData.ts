import type { DependencyList } from "react";
import { useEffect, useState } from "react";
import { ApiClientError, isAccessDenied } from "../api/admin-api.ts";

interface AdminDataState<TData> {
  data: TData | null;
  loading: boolean;
  error: string | null;
}

function formatError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return "当前账号没有访问权限。";
    }

    if (error.status === 401) {
      return "登录状态已失效。";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "请求失败。";
}

export function useAdminData<TData>(
  load: () => Promise<TData>,
  deps: DependencyList,
  onUnauthorized: () => void,
): AdminDataState<TData> {
  const [state, setState] = useState<AdminDataState<TData>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    load()
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        if (isAccessDenied(error)) {
          onUnauthorized();
        }

        setState({
          data: null,
          loading: false,
          error: formatError(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, deps);

  return state;
}
