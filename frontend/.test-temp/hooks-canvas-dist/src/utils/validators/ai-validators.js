import { AI_TASK_DEFAULTS, AI_PROVIDER_MODELS } from '@/constants/ai.constants';
export function createValidResult() {
    return { valid: true, message: '' };
}
export function createInvalidResult(message) {
    return { valid: false, message: message };
}
export var VALID_AI_TASK_TYPES = [
    'image-gen',
    'video-gen',
    'model-gen',
    'image-to-ply',
    'multi-view-restore',
    'model-render-transfer',
    'image-hd',
    'floorplan-colorize',
];
export var VALID_AI_PROVIDERS = [
    'openai',
    'anthropic',
    'stability',
    'runway',
    'meshy',
    'pika',
    'tripo',
    'laozhang-veo',
];
export function isValidAITaskType(type) {
    return typeof type === 'string' && VALID_AI_TASK_TYPES.includes(type);
}
export function isValidAIProvider(provider) {
    return typeof provider === 'string' && VALID_AI_PROVIDERS.includes(provider);
}
export function isValidAIModelType(model) {
    if (typeof model !== 'string') {
        return false;
    }
    for (var _i = 0, _a = Object.values(AI_PROVIDER_MODELS); _i < _a.length; _i++) {
        var models = _a[_i];
        if (models && models.includes(model)) {
            return true;
        }
    }
    return false;
}
export function validateAITaskType(type) {
    if (!isValidAITaskType(type)) {
        return createInvalidResult("Invalid AI task type: ".concat(String(type)));
    }
    return createValidResult();
}
export function validateAIProvider(provider) {
    if (!isValidAIProvider(provider)) {
        return createInvalidResult("Invalid AI provider: ".concat(String(provider)));
    }
    return createValidResult();
}
export function validateAIModel(model) {
    if (!isValidAIModelType(model)) {
        return createInvalidResult("Invalid AI model: ".concat(String(model)));
    }
    return createValidResult();
}
export function validateProviderModelCombination(provider, model) {
    var providerModels = AI_PROVIDER_MODELS[provider];
    if (!providerModels || !providerModels.includes(model)) {
        return createInvalidResult("Provider ".concat(provider, " does not support model ").concat(model));
    }
    return createValidResult();
}
export function validateAITimeout(timeout, taskType) {
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
        var defaultTimeout = AI_TASK_DEFAULTS.timeout[taskType];
        if (timeout > defaultTimeout * 2) {
            return createInvalidResult("Timeout ".concat(timeout, "ms is far above default ").concat(defaultTimeout, "ms."));
        }
    }
    return createValidResult();
}
export function validateRetryCount(retryCount) {
    if (typeof retryCount !== 'number' || !Number.isInteger(retryCount) || retryCount < 0) {
        return createInvalidResult('Retry count must be a non-negative integer.');
    }
    if (retryCount > AI_TASK_DEFAULTS.maxRetries) {
        return createInvalidResult("Retry count exceeds maximum ".concat(AI_TASK_DEFAULTS.maxRetries, "."));
    }
    return createValidResult();
}
export function validateMaxRetries(maxRetries) {
    if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0) {
        return createInvalidResult('Max retries must be a non-negative integer.');
    }
    if (maxRetries > 10) {
        return createInvalidResult('Max retries cannot exceed 10.');
    }
    return createValidResult();
}
export function validateTaskPriority(priority) {
    if (priority !== 'high' && priority !== 'normal' && priority !== 'low') {
        return createInvalidResult('Priority must be high, normal, or low.');
    }
    return createValidResult();
}
export function validateAITaskInput(input) {
    if (typeof input !== 'object' || input === null) {
        return createInvalidResult('AI task input must be an object.');
    }
    var taskInput = input;
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
export function validateAIConfig(config) {
    if (typeof config !== 'object' || config === null) {
        return createInvalidResult('AI config must be an object.');
    }
    var aiConfig = config;
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
export function validateTaskStatus(status) {
    var validStatuses = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
    if (typeof status !== 'string' || !validStatuses.includes(status)) {
        return createInvalidResult("Invalid task status: ".concat(String(status)));
    }
    return createValidResult();
}
export function validateAITask(task) {
    if (typeof task !== 'object' || task === null) {
        return createInvalidResult('AI task must be an object.');
    }
    var aiTask = task;
    if (typeof aiTask.id !== 'string' || aiTask.id.length === 0) {
        return createInvalidResult('Task id must be a non-empty string.');
    }
    var typeResult = validateAITaskType(aiTask.type);
    if (!typeResult.valid)
        return typeResult;
    var providerResult = validateAIProvider(aiTask.provider);
    if (!providerResult.valid)
        return providerResult;
    if (aiTask.model && aiTask.provider) {
        var modelResult = validateAIModel(aiTask.model);
        if (!modelResult.valid)
            return modelResult;
        var comboResult = validateProviderModelCombination(aiTask.provider, aiTask.model);
        if (!comboResult.valid)
            return comboResult;
    }
    var statusResult = validateTaskStatus(aiTask.status);
    if (!statusResult.valid)
        return statusResult;
    if (typeof aiTask.nodeId !== 'string' || aiTask.nodeId.length === 0) {
        return createInvalidResult('Node id must be a non-empty string.');
    }
    var inputResult = validateAITaskInput(aiTask.input);
    if (!inputResult.valid)
        return inputResult;
    if (typeof aiTask.progress !== 'number' || aiTask.progress < 0 || aiTask.progress > 100) {
        return createInvalidResult('Progress must be between 0 and 100.');
    }
    return createValidResult();
}
export function validatePrompt(prompt, maxLength) {
    if (maxLength === void 0) { maxLength = 10000; }
    if (typeof prompt !== 'string') {
        return createInvalidResult('Prompt must be a string.');
    }
    if (prompt.length > maxLength) {
        return createInvalidResult("Prompt exceeds maximum length ".concat(maxLength, "."));
    }
    return createValidResult();
}
export function canRetryTask(retryCount, maxRetries) {
    if (maxRetries === void 0) { maxRetries = AI_TASK_DEFAULTS.maxRetries; }
    if (retryCount >= maxRetries) {
        return createInvalidResult("Reached maximum retries ".concat(maxRetries, "."));
    }
    return createValidResult();
}
export function getRemainingRetries(retryCount, maxRetries) {
    if (maxRetries === void 0) { maxRetries = AI_TASK_DEFAULTS.maxRetries; }
    return Math.max(0, maxRetries - retryCount);
}
export function getDefaultTimeout(taskType) {
    return AI_TASK_DEFAULTS.timeout[taskType];
}
export function getDefaultPriority(taskType) {
    return AI_TASK_DEFAULTS.priority[taskType];
}
