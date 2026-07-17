import type { AITaskType, AIProvider, AIModelType, AITask, AITaskInput } from '@/types/ai.types';
import type { AIConfig } from '@/types/node.types';
import type { TaskStatus } from '@/types/base.types';
import { AI_TASK_DEFAULTS, AI_PROVIDER_MODELS } from '@/constants/ai.constants';

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export function createValidResult(): ValidationResult {
  return { valid: true, message: '' };
}

export function createInvalidResult(message: string): ValidationResult {
  return { valid: false, message };
}

export const VALID_AI_TASK_TYPES: readonly AITaskType[] = [
  'image-gen',
  'video-gen',
  'model-gen',
  'image-to-ply',
  'multi-view-restore',
  'model-render-transfer',
  'image-hd',
  'floorplan-colorize',
] as const;

export const VALID_AI_PROVIDERS: readonly AIProvider[] = [
  'openai',
  'anthropic',
  'stability',
  'runway',
  'meshy',
  'pika',
  'tripo',
  'laozhang-veo',
] as const;

export function isValidAITaskType(type: unknown): type is AITaskType {
  return typeof type === 'string' && VALID_AI_TASK_TYPES.includes(type as AITaskType);
}

export function isValidAIProvider(provider: unknown): provider is AIProvider {
  return typeof provider === 'string' && VALID_AI_PROVIDERS.includes(provider as AIProvider);
}

export function isValidAIModelType(model: unknown): model is AIModelType {
  if (typeof model !== 'string') {
    return false;
  }

  for (const models of Object.values(AI_PROVIDER_MODELS)) {
    if (models && models.includes(model as AIModelType)) {
      return true;
    }
  }

  return false;
}

export function validateAITaskType(type: unknown): ValidationResult {
  if (!isValidAITaskType(type)) {
    return createInvalidResult(`Invalid AI task type: ${String(type)}`);
  }
  return createValidResult();
}

export function validateAIProvider(provider: unknown): ValidationResult {
  if (!isValidAIProvider(provider)) {
    return createInvalidResult(`Invalid AI provider: ${String(provider)}`);
  }
  return createValidResult();
}

export function validateAIModel(model: unknown): ValidationResult {
  if (!isValidAIModelType(model)) {
    return createInvalidResult(`Invalid AI model: ${String(model)}`);
  }
  return createValidResult();
}

export function validateProviderModelCombination(provider: AIProvider, model: AIModelType): ValidationResult {
  const providerModels = AI_PROVIDER_MODELS[provider];

  if (!providerModels || !providerModels.includes(model)) {
    return createInvalidResult(`Provider ${provider} does not support model ${model}`);
  }

  return createValidResult();
}

export function validateAITimeout(timeout: unknown, taskType?: AITaskType): ValidationResult {
  if (typeof timeout !== 'number') {
    return createInvalidResult('Timeout must be a number.');
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    return createInvalidResult('Timeout must be a positive finite number.');
  }

  if (timeout > 3600000) {
    return createInvalidResult('Timeout cannot exceed 3600000ms.');
  }

  if (taskType) {
    const defaultTimeout = AI_TASK_DEFAULTS.timeout[taskType];
    if (timeout > defaultTimeout * 2) {
      return createInvalidResult(`Timeout ${timeout}ms is far above default ${defaultTimeout}ms.`);
    }
  }

  return createValidResult();
}

export function validateRetryCount(retryCount: unknown): ValidationResult {
  if (typeof retryCount !== 'number' || !Number.isInteger(retryCount) || retryCount < 0) {
    return createInvalidResult('Retry count must be a non-negative integer.');
  }

  if (retryCount > AI_TASK_DEFAULTS.maxRetries) {
    return createInvalidResult(`Retry count exceeds maximum ${AI_TASK_DEFAULTS.maxRetries}.`);
  }

  return createValidResult();
}

export function validateMaxRetries(maxRetries: unknown): ValidationResult {
  if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0) {
    return createInvalidResult('Max retries must be a non-negative integer.');
  }

  if (maxRetries > 10) {
    return createInvalidResult('Max retries cannot exceed 10.');
  }

  return createValidResult();
}

export function validateTaskPriority(priority: unknown): ValidationResult {
  if (priority !== 'high' && priority !== 'normal' && priority !== 'low') {
    return createInvalidResult('Priority must be high, normal, or low.');
  }
  return createValidResult();
}

export function validateAITaskInput(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) {
    return createInvalidResult('AI task input must be an object.');
  }

  const taskInput = input as Partial<AITaskInput>;
  if (!Array.isArray(taskInput.files)) {
    return createInvalidResult('files must be an array.');
  }
  if (typeof taskInput.config !== 'object' || taskInput.config === null) {
    return createInvalidResult('config must be an object.');
  }
  if (!Array.isArray(taskInput.references)) {
    return createInvalidResult('references must be an array.');
  }

  return createValidResult();
}

export function validateAIConfig(config: unknown): ValidationResult {
  if (typeof config !== 'object' || config === null) {
    return createInvalidResult('AI config must be an object.');
  }

  const aiConfig = config as Partial<AIConfig>;

  if (aiConfig.model !== undefined && typeof aiConfig.model !== 'string') {
    return createInvalidResult('model must be a string.');
  }
  if (aiConfig.prompt !== undefined && typeof aiConfig.prompt !== 'string') {
    return createInvalidResult('prompt must be a string.');
  }
  if (aiConfig.negativePrompt !== undefined && typeof aiConfig.negativePrompt !== 'string') {
    return createInvalidResult('negativePrompt must be a string.');
  }

  return createValidResult();
}

export function validateTaskStatus(status: unknown): ValidationResult {
  const validStatuses: TaskStatus[] = ['queued', 'processing', 'completed', 'failed', 'cancelled'];

  if (typeof status !== 'string' || !validStatuses.includes(status as TaskStatus)) {
    return createInvalidResult(`Invalid task status: ${String(status)}`);
  }

  return createValidResult();
}

export function validateAITask(task: unknown): ValidationResult {
  if (typeof task !== 'object' || task === null) {
    return createInvalidResult('AI task must be an object.');
  }

  const aiTask = task as Partial<AITask>;

  if (typeof aiTask.id !== 'string' || aiTask.id.length === 0) {
    return createInvalidResult('Task id must be a non-empty string.');
  }

  const typeResult = validateAITaskType(aiTask.type);
  if (!typeResult.valid) return typeResult;

  const providerResult = validateAIProvider(aiTask.provider);
  if (!providerResult.valid) return providerResult;

  if (aiTask.model && aiTask.provider) {
    const modelResult = validateAIModel(aiTask.model);
    if (!modelResult.valid) return modelResult;

    const comboResult = validateProviderModelCombination(aiTask.provider, aiTask.model);
    if (!comboResult.valid) return comboResult;
  }

  const statusResult = validateTaskStatus(aiTask.status);
  if (!statusResult.valid) return statusResult;

  if (typeof aiTask.nodeId !== 'string' || aiTask.nodeId.length === 0) {
    return createInvalidResult('Node id must be a non-empty string.');
  }

  const inputResult = validateAITaskInput(aiTask.input);
  if (!inputResult.valid) return inputResult;

  if (typeof aiTask.progress !== 'number' || aiTask.progress < 0 || aiTask.progress > 100) {
    return createInvalidResult('Progress must be between 0 and 100.');
  }

  return createValidResult();
}

export function validatePrompt(prompt: unknown, maxLength: number = 10000): ValidationResult {
  if (typeof prompt !== 'string') {
    return createInvalidResult('Prompt must be a string.');
  }

  if (prompt.length > maxLength) {
    return createInvalidResult(`Prompt exceeds maximum length ${maxLength}.`);
  }

  return createValidResult();
}

export function canRetryTask(retryCount: number, maxRetries: number = AI_TASK_DEFAULTS.maxRetries): ValidationResult {
  if (retryCount >= maxRetries) {
    return createInvalidResult(`Reached maximum retries ${maxRetries}.`);
  }
  return createValidResult();
}

export function getRemainingRetries(retryCount: number, maxRetries: number = AI_TASK_DEFAULTS.maxRetries): number {
  return Math.max(0, maxRetries - retryCount);
}

export function getDefaultTimeout(taskType: AITaskType): number {
  return AI_TASK_DEFAULTS.timeout[taskType];
}

export function getDefaultPriority(taskType: AITaskType): 'high' | 'normal' | 'low' {
  return AI_TASK_DEFAULTS.priority[taskType];
}
