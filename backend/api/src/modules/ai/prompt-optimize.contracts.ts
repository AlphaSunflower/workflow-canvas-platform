import {
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE,
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION,
} from "./prompt-optimize.constants.ts";

export interface PromptOptimizeCommand {
  workflowId: string;
  nodeId: string;
  nodeType: typeof AI_IMAGE_GEN_PROMPT_OPTIMIZE_NODE_TYPE;
  prompt: string;
  referenceFileIds: string[];
}

export interface PromptOptimizeResult {
  optimizedPrompt: string;
  model: string;
  referenceCount: number;
  promptVersion: typeof AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION;
}
