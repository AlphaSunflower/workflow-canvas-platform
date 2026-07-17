import {
  checkPostgresHealth,
  sendApiError,
  sendJson,
} from "@newworkflow/backend-shared";
import type { ApiHealthResponseData } from "@newworkflow/backend-shared";
import type { ServiceEnv } from "@newworkflow/backend-shared";
import type { ApiDependencies } from "../composition/api-dependencies.types.ts";
import { registerModuleRoutes } from "./register-module-routes.ts";
import type {
  RouteContext,
  RouteDefinition,
} from "./route-types.ts";

interface CompiledRouteDefinition extends RouteDefinition {
  segments: string[];
}

function normalizePathname(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean);
}

function compileRoutes(routes: RouteDefinition[]): CompiledRouteDefinition[] {
  return routes.map((route) => ({
    ...route,
    segments: normalizePathname(route.pattern),
  }));
}

function matchRoute(
  route: CompiledRouteDefinition,
  method: string,
  pathname: string,
): Record<string, string> | null {
  if (route.method !== method) {
    return null;
  }

  const pathnameSegments = normalizePathname(pathname);
  if (pathnameSegments.length !== route.segments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < route.segments.length; index += 1) {
    const routeSegment = route.segments[index] ?? "";
    const pathnameSegment = pathnameSegments[index] ?? "";

    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathnameSegment);
      continue;
    }

    if (routeSegment !== pathnameSegment) {
      return null;
    }
  }

  return params;
}

export class ApiRouter {
  private readonly routes: CompiledRouteDefinition[];

  constructor(routes: RouteDefinition[]) {
    this.routes = compileRoutes(routes);
  }

  async handle(
    context: Omit<RouteContext, "params">,
    runtimeEnv: ServiceEnv,
  ): Promise<boolean> {
    const {
      request,
      response,
      requestUrl,
    } = context;

    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      const databaseHealth = await checkPostgresHealth(
        runtimeEnv.persistenceMode,
        runtimeEnv.database,
      );
      const payload: ApiHealthResponseData = {
        service: "backend-api",
        status: databaseHealth.status === "error" ? "degraded" : "ok",
        port: runtimeEnv.port,
        persistenceMode: runtimeEnv.persistenceMode,
        database: databaseHealth,
        timestamp: new Date().toISOString(),
      };
      sendJson(response, 200, payload);
      return true;
    }

    const requestMethod = request.method ?? "GET";

    for (const route of this.routes) {
      const params = matchRoute(route, requestMethod, requestUrl.pathname);

      if (!params) {
        continue;
      }

      await route.handler({
        ...context,
        params,
      });
      return true;
    }

    sendApiError(response, 404, 40400, "NOT_FOUND", "Route not found.");
    return true;
  }
}

export function createApiRouter(
  controllers: ApiDependencies["controllers"],
): ApiRouter {
  return new ApiRouter(registerModuleRoutes(controllers));
}
