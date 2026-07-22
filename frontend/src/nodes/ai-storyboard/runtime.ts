import type { StoryboardShotData, Workflow } from '@/types';
import type { WorkflowConnectionInput } from '@/contracts/workflow';
import {
  createNodeActionOnlyExecutionRequest,
  type NodeActionOnlyExecutionRequest,
} from '@/execution-runtime/node-action-only-execution';
import type {
  NodeActionContext,
  NodeActionDefinition,
  NodeDefinition,
  NodeExecutionPlan,
  NodeValidationResult,
} from '../types';
import type { StoryboardNodeActionServices } from './storyboard-action.contracts';

function resolveStoryboardServices(context: NodeActionContext): StoryboardNodeActionServices {
  if (!context.services || typeof context.services !== 'object') {
    throw new Error('Storyboard node action services are unavailable.');
  }

  return context.services as StoryboardNodeActionServices;
}

function getShotById(node: NodeActionContext['node'], shotId?: string): StoryboardShotData | null {
  if (!shotId) {
    return null;
  }

  const shots = Array.isArray(node.config.shots) ? node.config.shots : [];
  return shots.find((shot) => shot.id === shotId) ?? null;
}

function validateStoryboardShotAction(context: NodeActionContext): NodeValidationResult {
  const shot = getShotById(context.node, context.targetId);
  if (!shot) {
    return {
      valid: false,
      reason: 'Current storyboard shot does not exist.',
    };
  }

  return { valid: true };
}

const storyboardArrangeAction: NodeActionDefinition = {
  id: 'arrange',
  label: 'Arrange Storyboard',
  run: async (context) => {
    await resolveStoryboardServices(context).arrange(context.node.id.value, {
      signal: context.options.signal,
    });
  },
};

const storyboardShotImageAction: NodeActionDefinition = {
  id: 'shot-image',
  label: 'Generate Shot Image',
  targetRequired: true,
  validate: validateStoryboardShotAction,
  run: async (context) => {
    await resolveStoryboardServices(context).runShotImage(
      context.node.id.value,
      context.targetId!,
      {
        signal: context.options.signal,
      },
    );
  },
};

const storyboardShotVideoAction: NodeActionDefinition = {
  id: 'shot-video',
  label: 'Generate Shot Video',
  targetRequired: true,
  validate: validateStoryboardShotAction,
  run: async (context) => {
    await resolveStoryboardServices(context).runShotVideo(
      context.node.id.value,
      context.targetId!,
      {
        signal: context.options.signal,
        suppressNotifications: Boolean(context.options.suppressNotifications),
      },
    );
  },
};

const storyboardBatchVideoAction: NodeActionDefinition = {
  id: 'batch-video',
  label: 'Generate Batch Videos',
  run: async (context) => {
    await resolveStoryboardServices(context).runBatchVideo(context.node.id.value, {
      signal: context.options.signal,
    });
  },
};

const storyboardStoryArrangeAction: NodeActionDefinition = {
  id: 'story-arrange',
  label: 'Generate Storyboard from Story',
  run: async (context) => {
    const storyText = typeof context.options.storyText === 'string' ? context.options.storyText : '';
    const creationType = typeof context.options.creationType === 'string' ? context.options.creationType : 'custom';
    await resolveStoryboardServices(context).runStoryArrange(
      context.node.id.value,
      storyText,
      creationType as 'architecture' | 'product' | 'narrative' | 'custom',
      {
        signal: context.options.signal,
      },
    );
  },
};

export const aiStoryboardNodeActions: NodeDefinition['actions'] = [
  storyboardArrangeAction,
  storyboardShotImageAction,
  storyboardShotVideoAction,
  storyboardBatchVideoAction,
  storyboardStoryArrangeAction,
];

export function getAIStoryboardActionIds(): string[] {
  return (aiStoryboardNodeActions ?? []).map((action) => action.id);
}

export const canUseAIStoryboardWorkspace: NodeDefinition['execution']['canRun'] = () => ({ valid: true });

export function createStoryboardExecutionPlan(): NodeExecutionPlan {
  return {
    files: [],
    references: [],
    config: {},
  };
}

export function createAIStoryboardNodeActionOnlyExecutionRequest(): NodeActionOnlyExecutionRequest {
  return createNodeActionOnlyExecutionRequest({
    actionIds: getAIStoryboardActionIds(),
    plan: createStoryboardExecutionPlan(),
  });
}

export const aiStoryboardExecution: NodeDefinition['execution'] = {
  mode: 'node-action-only',
  taskType: 'video-gen',
  provider: 'laozhang',
  canRun: canUseAIStoryboardWorkspace,
};

export function createAIStoryboardExecutionPlan(
  _workflow: Workflow,
  _nodeId: string,
  _inputs: WorkflowConnectionInput[],
): ReturnType<typeof createStoryboardExecutionPlan> {
  return createStoryboardExecutionPlan();
}
