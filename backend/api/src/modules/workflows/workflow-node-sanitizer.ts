function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeStringUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.startsWith("blob:")
    || normalized.startsWith("data:")
    || normalized.startsWith("file:")
  ) {
    return undefined;
  }

  return normalized;
}

export class WorkflowNodeSanitizer {
  sanitize(nodes: Record<string, unknown>): Record<string, unknown> {
    const nextNodes: Record<string, unknown> = {};

    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!isRecord(node)) {
        nextNodes[nodeId] = node;
        continue;
      }

      const nextNode: Record<string, unknown> = {
        ...node,
      };

      if (nextNode.file !== undefined) {
        delete nextNode.file;
      }

      if (nextNode.localFile !== undefined) {
        delete nextNode.localFile;
      }

      if (nextNode.objectUrl !== undefined) {
        delete nextNode.objectUrl;
      }

      if (nextNode.localState !== undefined) {
        delete nextNode.localState;
      }

      const sanitizedPreviewUrl = sanitizeStringUrl(nextNode.previewUrl);
      if (sanitizedPreviewUrl) {
        nextNode.previewUrl = sanitizedPreviewUrl;
      } else if (nextNode.previewUrl !== undefined) {
        delete nextNode.previewUrl;
      }

      const sanitizedThumbnailUrl = sanitizeStringUrl(nextNode.thumbnailUrl);
      if (sanitizedThumbnailUrl) {
        nextNode.thumbnailUrl = sanitizedThumbnailUrl;
      } else if (nextNode.thumbnailUrl !== undefined) {
        delete nextNode.thumbnailUrl;
      }

      if (nextNode.imageAsset !== undefined) {
        delete nextNode.imageAsset;
      }

      nextNodes[nodeId] = nextNode;
    }

    return nextNodes;
  }
}
