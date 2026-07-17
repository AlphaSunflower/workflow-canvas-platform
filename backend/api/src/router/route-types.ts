import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type { URL } from "node:url";

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  params: Record<string, string>;
}

export interface RouteDefinition {
  method: string;
  pattern: string;
  handler: (context: RouteContext) => Promise<void>;
}
