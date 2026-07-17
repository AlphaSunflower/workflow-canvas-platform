import type {
  FILE_SOURCE_TYPES,
  FILE_TYPES,
  INTERMEDIATE_ARTIFACT_TYPES,
  TASK_FILE_ROLES,
} from "../constants/file.ts";

export type FileSourceType = (typeof FILE_SOURCE_TYPES)[number];

export type FileType = (typeof FILE_TYPES)[number];

export type TaskFileRole = (typeof TASK_FILE_ROLES)[number];

export type IntermediateArtifactType =
  (typeof INTERMEDIATE_ARTIFACT_TYPES)[number];
