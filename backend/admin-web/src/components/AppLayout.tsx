import type { ReactNode } from "react";
import type { AuthUserProfile } from "../api/admin-api.ts";
import type { Route } from "../App.tsx";

interface AppLayoutProps {
  route: Route;
  user: AuthUserProfile;
  children: ReactNode;
  onNavigate: (hash: string) => void;
  onLogout: () => void;
}

interface NavItem {
  label: string;
  hash: string;
  section: Route["name"][];
}

const NAV_ITEMS: NavItem[] = [
  { label: "总览", hash: "#/overview", section: ["overview"] },
  { label: "文件资产", hash: "#/files", section: ["files", "file-detail"] },
  { label: "执行历史", hash: "#/executions", section: ["executions", "execution-detail"] },
  { label: "Workflow", hash: "#/workflows", section: ["workflows", "workflow-detail"] },
  { label: "用户", hash: "#/users", section: ["users"] },
  { label: "存储问题", hash: "#/storage", section: ["storage"] },
];

export function AppLayout({
  route,
  user,
  children,
  onNavigate,
  onLogout,
}: AppLayoutProps): JSX.Element {
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">NW</div>
          <div>
            <div className="brand-name">NewWorkflow</div>
            <div className="brand-subtitle">Admin</div>
          </div>
        </div>
        <nav className="nav-list" aria-label="中台导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.hash}
              className={item.section.includes(route.name) ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => onNavigate(item.hash)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="account-block">
            <span className="account-name">{user.displayName}</span>
            <span className="account-email">{user.email}</span>
          </div>
          <button className="text-button" type="button" onClick={onLogout}>退出登录</button>
        </div>
      </aside>
      <main className="main-panel">
        {children}
      </main>
    </div>
  );
}
