import type { IncomingMessage } from "node:http";

import {
  getRequestContextValue,
  setRequestContextValue,
} from "@newworkflow/backend-shared";
import type { AuthenticatedAccount } from "./auth.service.ts";

const CURRENT_USER_CONTEXT_KEY = "auth.currentUser";

export function setCurrentUserContext(
  request: IncomingMessage,
  account: AuthenticatedAccount,
): void {
  setRequestContextValue(request, CURRENT_USER_CONTEXT_KEY, account);
}

export function getCurrentUserContext(
  request: IncomingMessage,
): AuthenticatedAccount | undefined {
  return getRequestContextValue<AuthenticatedAccount>(
    request,
    CURRENT_USER_CONTEXT_KEY,
  );
}
