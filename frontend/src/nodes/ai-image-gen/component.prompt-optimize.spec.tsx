import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import { createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  AI_IMAGE_INPUT_PORT_ID,
  getAIImageGenGroupInputHandle,
} from './groups';
import {
  AIImageGenPromptOptimizeRequestController,
  resolveAIImageGenPromptOptimizeAvailability,
} from './prompt-optimize';

function createImageNode(sequence: number, fileName = `image-${sequence}.png`) {
  return createDefaultFileNodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 10, y: sequence * 10 },
    'image',
    `file-${sequence}`,
    fileName,
    1024,
    'image/png',
    {
      width: 1024,
      height: 768,
    },
  );
}

function createResolvedGroups(imageCount: number): WorkflowResolvedNodeGroupState[] {
  return [{
    group: {
      id: 'group-1',
      label: 'Group 1',
      order: 0,
    },
    ports: [{
      portId: AI_IMAGE_INPUT_PORT_ID,
      label: '图片序列',
      handle: getAIImageGenGroupInputHandle('group-1'),
      inputs: Array.from({ length: imageCount }, (_, index) => {
        const sourceNode = createImageNode(index + 1);

        return {
          groupId: 'group-1',
          portId: AI_IMAGE_INPUT_PORT_ID,
          handle: getAIImageGenGroupInputHandle('group-1'),
          connection: {
            id: `connection-${index + 1}`,
            type: 'file-reference' as const,
            sourceId: sourceNode.id.value,
            targetId: 'node-1',
            targetHandle: getAIImageGenGroupInputHandle('group-1'),
            order: index,
          },
          sourceNode,
        };
      }),
    }],
  }];
}

test('AI image gen prompt optimize button availability requires exactly one configured input group', () => {
  const available = resolveAIImageGenPromptOptimizeAvailability({
    prompt: '改成欧式风格',
    configuredGroupCount: 1,
    resolvedGroups: createResolvedGroups(2),
  });

  assert.equal(available.enabled, true);
  assert.equal(available.reason, null);
  assert.equal(available.referenceCount, 2);

  const twoConfiguredGroups = resolveAIImageGenPromptOptimizeAvailability({
    prompt: '改成欧式风格',
    configuredGroupCount: 2,
    resolvedGroups: createResolvedGroups(1),
  });

  assert.equal(twoConfiguredGroups.enabled, false);
  assert.equal(twoConfiguredGroups.reason, '仅支持单输入组节点使用 AI 提示词优化');
});

test('AI image gen prompt optimize availability rejects empty prompt and invalid reference counts', () => {
  const emptyPrompt = resolveAIImageGenPromptOptimizeAvailability({
    prompt: '   ',
    configuredGroupCount: 1,
    resolvedGroups: createResolvedGroups(1),
  });
  assert.equal(emptyPrompt.enabled, false);
  assert.equal(emptyPrompt.reason, '请先输入提示词');

  const noImage = resolveAIImageGenPromptOptimizeAvailability({
    prompt: '提示词',
    configuredGroupCount: 1,
    resolvedGroups: createResolvedGroups(0),
  });
  assert.equal(noImage.enabled, true);
  assert.equal(noImage.reason, null);
  assert.equal(noImage.referenceCount, 0);

  const tooManyImages = resolveAIImageGenPromptOptimizeAvailability({
    prompt: '提示词',
    configuredGroupCount: 1,
    resolvedGroups: createResolvedGroups(6),
  });
  assert.equal(tooManyImages.enabled, false);
  assert.equal(tooManyImages.reason, '唯一输入组最多支持 5 张输入图片');
});

test('AI image gen prompt optimize request controller cancels stale request and accepts only latest finish', () => {
  const controller = new AIImageGenPromptOptimizeRequestController();

  const first = controller.start();
  assert.equal(first.signal.aborted, false);

  const second = controller.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(controller.finish(first.requestId), false);
  assert.equal(controller.finish(second.requestId), true);

  const third = controller.start();
  controller.cancel();
  assert.equal(third.signal.aborted, true);
  assert.equal(controller.finish(third.requestId), false);
});

test('AI image gen prompt optimize refill uses latest result only by request id', () => {
  const controller = new AIImageGenPromptOptimizeRequestController();
  let promptDraft = '原始提示词';
  let configPrompt = '原始提示词';

  const first = controller.start();
  const second = controller.start();

  function applyResult(requestId: number, optimizedPrompt: string): void {
    if (!controller.finish(requestId)) {
      return;
    }

    promptDraft = optimizedPrompt;
    configPrompt = optimizedPrompt;
  }

  applyResult(first.requestId, '旧请求结果');
  assert.equal(promptDraft, '原始提示词');
  assert.equal(configPrompt, '原始提示词');

  applyResult(second.requestId, '最新请求结果');
  assert.equal(promptDraft, '最新请求结果');
  assert.equal(configPrompt, '最新请求结果');
});
