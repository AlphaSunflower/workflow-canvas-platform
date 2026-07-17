import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, ApiClientError, isAccessDenied, type AuthUserProfile } from "./api/admin-api.ts";
import { DetailPageShell } from "./components/DetailPageShell.tsx";
import { AppLayout } from "./components/AppLayout.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { FilesPage } from "./pages/FilesPage.tsx";
import { FileDetailPage } from "./pages/FileDetailPage.tsx";
import { ExecutionsPage } from "./pages/ExecutionsPage.tsx";
import { ExecutionDetailPage } from "./pages/ExecutionDetailPage.tsx";
import { WorkflowsPage } from "./pages/WorkflowsPage.tsx";
import { WorkflowDetailPage } from "./pages/WorkflowDetailPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
import { StorageIssuesPage } from "./pages/StorageIssuesPage.tsx";

export type Route =
  | { name: "overview" }
  | { name: "files" }
  | { name: "file-detail"; fileId: string }
  | { name: "executions" }
  | { name: "execution-detail"; runId: string }
  | { name: "workflows" }
  | { name: "workflow-detail"; workflowId: string }
  | { name: "users" }
  | { name: "storage" };

export interface AppNavigation {
  route: Route;
  navigate: (hash: string) => void;
}

function parseHash(hash: string): Route {
  const normalized = hash.replace(/^#\/?/, "");
  const parts = normalized.split("/").filter(Boolean);

  if (parts[0] === "files" && parts[1]) {
    return { name: "file-detail", fileId: decodeURIComponent(parts[1]) };
  }

  if (parts[0] === "files") {
    return { name: "files" };
  }

  if (parts[0] === "executions" && parts[1]) {
    return { name: "execution-detail", runId: decodeURIComponent(parts[1]) };
  }

  if (parts[0] === "executions") {
    return { name: "executions" };
  }

  if (parts[0] === "workflows" && parts[1]) {
    return { name: "workflow-detail", workflowId: decodeURIComponent(parts[1]) };
  }

  if (parts[0] === "workflows") {
    return { name: "workflows" };
  }

  if (parts[0] === "users") {
    return { name: "users" };
  }

  if (parts[0] === "storage") {
    return { name: "storage" };
  }

  return { name: "overview" };
}

function useHashRoute(): AppNavigation {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash) {
      window.location.hash = "#/overview";
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
  }, []);

  return useMemo(() => ({ route, navigate }), [navigate, route]);
}

function formatError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return "当前账号没有中台访问权限。";
    }

    if (error.status === 401) {
      return "登录状态已失效，请重新登录。";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "请求失败。";
}

function renderRoute(route: Route, navigation: AppNavigation, onUnauthorized: () => void): JSX.Element {
  switch (route.name) {
    case "overview":
      return <OverviewPage onUnauthorized={onUnauthorized} />;
    case "files":
      return <FilesPage navigation={navigation} onUnauthorized={onUnauthorized} />;
    case "file-detail":
      return <FileDetailPage fileId={route.fileId} navigation={navigation} onUnauthorized={onUnauthorized} />;
    case "executions":
      return <ExecutionsPage navigation={navigation} onUnauthorized={onUnauthorized} />;
    case "execution-detail":
      return <ExecutionDetailPage runId={route.runId} navigation={navigation} onUnauthorized={onUnauthorized} />;
    case "workflows":
      return <WorkflowsPage navigation={navigation} onUnauthorized={onUnauthorized} />;
    case "workflow-detail":
      return <WorkflowDetailPage workflowId={route.workflowId} navigation={navigation} onUnauthorized={onUnauthorized} />;
    case "users":
      return <UsersPage onUnauthorized={onUnauthorized} />;
    case "storage":
      return <StorageIssuesPage navigation={navigation} onUnauthorized={onUnauthorized} />;
    default:
      return (
        <DetailPageShell title="页面不可用">
          <p className="muted">未匹配到可用页面。</p>
        </DetailPageShell>
      );
  }
}

export default function App(): JSX.Element {
  const navigation = useHashRoute();
  const [user, setUser] = useState<AuthUserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const stored = adminApi.loadStoredSession();
    if (!stored) {
      setAuthChecking(false);
      return;
    }

    setUser(stored.user);
    adminApi.me()
      .then((profile) => {
        setUser(profile);
        if (profile.role !== "admin") {
          setAuthError("当前账号不是 admin，无法访问中台。");
        }
      })
      .catch((error: unknown) => {
        if (isAccessDenied(error)) {
          adminApi.clearStoredSession();
          setUser(null);
        }
        setAuthError(formatError(error));
      })
      .finally(() => setAuthChecking(false));
  }, []);

  const handleLogin = useCallback((profile: AuthUserProfile) => {
    setUser(profile);
    setAuthError(profile.role === "admin" ? null : "当前账号不是 admin，无法访问中台。");
  }, []);

  const handleLogout = useCallback(() => {
    adminApi.clearStoredSession();
    setUser(null);
    setAuthError(null);
  }, []);

  const handleUnauthorized = useCallback(() => {
    adminApi.clearStoredSession();
    setUser(null);
    setAuthError("登录状态已失效，请重新登录。");
  }, []);

  if (authChecking) {
    return (
      <div className="boot-screen">
        <div className="spinner" />
        <span>正在检查登录状态</span>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <LoginPage
        initialError={authError}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <AppLayout
      route={navigation.route}
      user={user}
      onNavigate={navigation.navigate}
      onLogout={handleLogout}
    >
      {renderRoute(navigation.route, navigation, handleUnauthorized)}
    </AppLayout>
  );
}
