import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import type { AnyNodeData, FileNodeData } from '@/types';
import { isAINodeData, isFileNodeData } from '@/utils';
import { AI_STORYBOARD_INPUT_PORT_ID } from './constants';
import type { StoryboardResolvedInputImage } from './types';

function extractPromptHint(node: AnyNodeData | null | undefined): string | undefined {
  if (!node || !isAINodeData(node)) {
    return undefined;
  }

  const prompt = node.config.prompt;
  return typeof prompt === 'string' && prompt.trim().length > 0
    ? prompt.trim()
    : undefined;
}

function resolveSourceFileId(node: FileNodeData): string {
  return node.fileId;
}

function resolvePromptHintForInput(
  sourceNode: FileNodeData,
  options?: {
    getNodeById?: (nodeId: string) => AnyNodeData | null;
  },
): string | undefined {
  return extractPromptHint(
    sourceNode.source.producerNodeId
      ? options?.getNodeById?.(sourceNode.source.producerNodeId)
      : null,
  );
}

export function resolveStoryboardInputImages(
  resolvedGroups: WorkflowResolvedNodeGroupState[],
  options?: {
    getNodeById?: (nodeId: string) => AnyNodeData | null;
  },
): StoryboardResolvedInputImage[] {
  return resolvedGroups
    .flatMap((groupState) => {
      const inputPort = groupState.ports.find((port) => port.portId === AI_STORYBOARD_INPUT_PORT_ID);
      return inputPort?.inputs ?? [];
    })
    .filter((input) => isFileNodeData(input.sourceNode) && input.sourceNode.type === 'image')
    .map((input, index) => {
      const sourceNode = input.sourceNode;
      const promptHint = resolvePromptHintForInput(sourceNode, options);
      const sourceFileId = resolveSourceFileId(sourceNode);

      return {
        sourceNodeId: sourceNode.id.value,
        sourceFileId,
        sourceImageFileId: sourceFileId,
        sourceNode,
        fileName: sourceNode.fileName,
        promptHint,
        order: index,
      } satisfies StoryboardResolvedInputImage;
    });
}
