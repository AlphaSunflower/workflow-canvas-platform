import { AdminController } from "../modules/admin/admin.controller.ts";
import { AdminRepository } from "../modules/admin/admin.repository.ts";
import { AdminService } from "../modules/admin/admin.service.ts";
import type { AuthService } from "../modules/auth/auth.service.ts";
import { createObjectStorageAdapter } from "../modules/storage/object-storage.factory.ts";
import type { ApiCompositionContext } from "./api-composition.context.ts";

export function composeAdminModule(
  context: ApiCompositionContext,
  authService: AuthService,
) {
  const env = context.requireEnv();
  const adminService = context.resolve(
    "adminService",
    () => new AdminService(new AdminRepository({
      env,
      rootDir: context.rootDir,
      objectStorage: createObjectStorageAdapter(env.objectStorage, context.rootDir),
    })),
  );

  return {
    services: {
      adminService,
    },
    controllers: {
      adminController: context.resolve(
        "adminController",
        () => new AdminController(adminService, authService),
      ),
    },
  };
}
