import type { ServiceEnv } from "@newworkflow/backend-shared";
import { FilesController } from "../modules/files/files.controller.ts";
import { DbFilesRepository } from "../modules/files/db-files.repository.ts";
import type { FilesRepository } from "../modules/files/files.repository.types.ts";
import { JsonFilesRepository } from "../modules/files/json-files.repository.ts";
import { FilesService } from "../modules/files/files.service.ts";
import { createObjectStorageAdapter } from "../modules/storage/object-storage.factory.ts";
import type { AuthService } from "../modules/auth/auth.service.ts";
import type { ApiCompositionContext } from "./api-composition.context.ts";
import { resolveApiRootDir } from "./api-composition.shared.ts";

export interface FilesServiceFactoryInput {
  env?: ServiceEnv;
  filesRepository?: FilesRepository;
  rootDir?: string;
}

export interface FilesRepositoryFactoryInput {
  env?: ServiceEnv;
  rootDir?: string;
}

export function createFilesRepository(
  input: FilesRepositoryFactoryInput = {},
): FilesRepository {
  const rootDir = resolveApiRootDir(input.rootDir);

  if (input.env?.persistenceMode === "db") {
    return new DbFilesRepository(input.env.database, {
      rootDir,
      objectStorage: createObjectStorageAdapter(input.env.objectStorage, rootDir),
    });
  }

  return new JsonFilesRepository(rootDir);
}

export function createFilesService(input: FilesServiceFactoryInput = {}): FilesService {
  return new FilesService(input.filesRepository ?? createFilesRepository(input));
}

export function resolveFilesRepositoryForContext(
  context: ApiCompositionContext,
): FilesRepository {
  const env = context.requireEnv();
  return context.resolve(
    "filesRepository",
    () => createFilesRepository({ env, rootDir: context.rootDir }),
  );
}

export function composeFilesModule(
  context: ApiCompositionContext,
  authService: AuthService,
) {
  const filesService = context.resolve(
    "filesService",
    () => createFilesService({
      filesRepository: resolveFilesRepositoryForContext(context),
    }),
  );

  return {
    services: {
      filesService,
    },
    controllers: {
      filesController: context.resolve(
        "filesController",
        () => new FilesController(filesService, authService),
      ),
    },
  };
}
