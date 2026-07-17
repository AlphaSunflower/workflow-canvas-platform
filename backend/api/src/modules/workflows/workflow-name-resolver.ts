export const DEFAULT_WORKFLOW_NAME = "新建画布";
export const DEFAULT_WORKFLOW_GROUP_NAME = "新建分组";

const WINDOWS_LIKE_SUFFIX_PATTERN = /^(.*) \((\d+)\)$/;

export interface ParsedWindowsLikeName {
  normalizedName: string;
  baseName: string;
  sequenceNumber: number;
  hasSequenceSuffix: boolean;
}

export interface ResolveWindowsLikeNameOptions {
  desiredName: string | null | undefined;
  fallbackBaseName: string;
  existingNames: Iterable<string>;
}

export interface ResolvedWindowsLikeName {
  requestedName: string;
  resolvedName: string;
  usedFallbackName: boolean;
  conflicted: boolean;
  parsedRequestedName: ParsedWindowsLikeName;
}

function canonicalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function formatWindowsLikeName(baseName: string, sequenceNumber: number): string {
  if (sequenceNumber <= 1) {
    return baseName;
  }

  return `${baseName} (${sequenceNumber})`;
}

export function normalizeWindowsLikeNameInput(
  desiredName: string | null | undefined,
  fallbackBaseName: string,
): {
  requestedName: string;
  usedFallbackName: boolean;
} {
  const normalizedDesiredName = typeof desiredName === "string"
    ? desiredName.trim()
    : "";

  if (normalizedDesiredName) {
    return {
      requestedName: normalizedDesiredName,
      usedFallbackName: false,
    };
  }

  return {
    requestedName: fallbackBaseName.trim(),
    usedFallbackName: true,
  };
}

export function parseWindowsLikeName(name: string): ParsedWindowsLikeName {
  const normalizedName = name.trim();
  const matched = normalizedName.match(WINDOWS_LIKE_SUFFIX_PATTERN);

  if (matched) {
    const baseName = matched[1]?.trim() ?? "";
    const sequenceNumber = Number(matched[2]);

    if (baseName && Number.isInteger(sequenceNumber) && sequenceNumber >= 2) {
      return {
        normalizedName,
        baseName,
        sequenceNumber,
        hasSequenceSuffix: true,
      };
    }
  }

  return {
    normalizedName,
    baseName: normalizedName,
    sequenceNumber: 1,
    hasSequenceSuffix: false,
  };
}

export function resolveWindowsLikeName(
  options: ResolveWindowsLikeNameOptions,
): ResolvedWindowsLikeName {
  const normalized = normalizeWindowsLikeNameInput(
    options.desiredName,
    options.fallbackBaseName,
  );
  const parsedRequestedName = parseWindowsLikeName(normalized.requestedName);
  const existingParsedNames = Array.from(options.existingNames)
    .map((name) => parseWindowsLikeName(name))
    .filter((item) => item.normalizedName.length > 0);
  const requestedCanonicalName = canonicalizeName(parsedRequestedName.normalizedName);
  const conflicted = existingParsedNames.some((item) =>
    canonicalizeName(item.normalizedName) === requestedCanonicalName
  );

  if (!conflicted) {
    return {
      requestedName: normalized.requestedName,
      resolvedName: parsedRequestedName.normalizedName,
      usedFallbackName: normalized.usedFallbackName,
      conflicted: false,
      parsedRequestedName,
    };
  }

  const requestedCanonicalBaseName = canonicalizeName(parsedRequestedName.baseName);
  const occupiedSequenceNumbers = new Set<number>();

  for (const existingName of existingParsedNames) {
    if (canonicalizeName(existingName.baseName) !== requestedCanonicalBaseName) {
      continue;
    }

    occupiedSequenceNumbers.add(existingName.sequenceNumber);
  }

  let nextSequenceNumber = parsedRequestedName.hasSequenceSuffix
    ? parsedRequestedName.sequenceNumber + 1
    : 2;

  while (occupiedSequenceNumbers.has(nextSequenceNumber)) {
    nextSequenceNumber += 1;
  }

  return {
    requestedName: normalized.requestedName,
    resolvedName: formatWindowsLikeName(parsedRequestedName.baseName, nextSequenceNumber),
    usedFallbackName: normalized.usedFallbackName,
    conflicted: true,
    parsedRequestedName,
  };
}
