export const FILE_SOURCE_TYPES = [
  "input",
  "intermediate",
  "output",
] as const;

export const FILE_TYPES = [
  "image",
  "video",
  "ply",
  "unknown",
] as const;

export const TASK_FILE_ROLES = [
  "input",
  "reference",
  "intermediate",
  "output",
] as const;

export const INTERMEDIATE_ARTIFACT_TYPES = [
  "lineart",
  "depth",
] as const;
