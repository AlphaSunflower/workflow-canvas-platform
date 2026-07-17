import type { FileAssetResponse } from "@newworkflow/backend-shared/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRestorableLocalFileSource(node: Record<string, unknown>): boolean {
  if (!isRecord(node.source)) {
    return false;
  }

  const source = node.source;
  if (source.type !== "imported" || !isRecord(source.localSource)) {
    return false;
  }

  const referenceId = typeof source.localSource.referenceId === "string"
    ? source.localSource.referenceId.trim()
    : "";

  return source.localSource.status === "linked" && referenceId.length > 0;
}

function toImageAssetFromFile(file: FileAssetResponse): Record<string, unknown> {
  return {
    assetId: file.fileId,
    source: "remote",
    variants: {
      ...(file.thumbnailUrl
        ? {
            thumbnail: {
              url: file.thumbnailUrl,
              ...(typeof file.width === "number" ? { width: file.width } : {}),
              ...(typeof file.height === "number" ? { height: file.height } : {}),
              updatedAt: Date.now(),
            },
          }
        : {}),
      ...(file.previewUrl
        ? {
            preview: {
              url: file.previewUrl,
              ...(typeof file.width === "number" ? { width: file.width } : {}),
              ...(typeof file.height === "number" ? { height: file.height } : {}),
              updatedAt: Date.now(),
            },
          }
        : {}),
      ...(file.downloadUrl
        ? {
            original: {
              url: file.downloadUrl,
              ...(typeof file.width === "number" ? { width: file.width } : {}),
              ...(typeof file.height === "number" ? { height: file.height } : {}),
              updatedAt: Date.now(),
            },
          }
        : {}),
    },
    intrinsicSize: (
      typeof file.width === "number"
      && typeof file.height === "number"
    )
      ? {
          width: file.width,
          height: file.height,
        }
      : undefined,
    version: 1,
  };
}

export class WorkflowFileHydrator {
  hydrateNodes(
    nodes: Record<string, unknown>,
    filesById: Map<string, FileAssetResponse>,
  ): Record<string, unknown> {
    const nextNodes: Record<string, unknown> = {};

    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!isRecord(node)) {
        nextNodes[nodeId] = node;
        continue;
      }

      const nextNode: Record<string, unknown> = {
        ...node,
      };
      const fileId = typeof nextNode.fileId === "string" ? nextNode.fileId : null;
      const file = fileId ? filesById.get(fileId) ?? null : null;
      const useRemoteFallback = !hasRestorableLocalFileSource(nextNode);

      if (file) {
        if (typeof file.displayName === "string" && file.displayName.trim()) {
          nextNode.fileName = file.displayName;
        } else if (typeof file.originalName === "string" && file.originalName.trim()) {
          nextNode.fileName = file.originalName;
        }

        if (typeof file.size === "number") {
          nextNode.fileSize = file.size;
        }

        if (typeof file.mimeType === "string" && file.mimeType.trim()) {
          nextNode.mimeType = file.mimeType;
        }

        const metadata = isRecord(nextNode.metadata) ? { ...nextNode.metadata } : {};
        if (typeof file.width === "number") {
          metadata.width = file.width;
        }
        if (typeof file.height === "number") {
          metadata.height = file.height;
        }
        nextNode.metadata = metadata;

        if (useRemoteFallback && (file.previewUrl || file.thumbnailUrl)) {
          if (file.previewUrl) {
            nextNode.previewUrl = file.previewUrl;
          } else {
            delete nextNode.previewUrl;
          }

          if (file.thumbnailUrl) {
            nextNode.thumbnailUrl = file.thumbnailUrl;
          } else {
            delete nextNode.thumbnailUrl;
          }
        } else if (useRemoteFallback) {
          delete nextNode.previewUrl;
          delete nextNode.thumbnailUrl;
        }

        if (
          useRemoteFallback &&
          (nextNode.type === "image" || nextNode.type === "video") &&
          file.fileType === "image"
        ) {
          nextNode.imageAsset = toImageAssetFromFile(file);
        }
      }

      nextNodes[nodeId] = nextNode;
    }

    return nextNodes;
  }
}
