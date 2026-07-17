import type { CreateExecutionRequest } from "@newworkflow/backend-shared/api";
import type { CreateExecutionStoreInput } from "./executions.repository.ts";

export interface CreateExecutionErrorMapping {
  code: number;
  message: string;
}

export interface ExecutionNodeDefinition<
  TRequest extends CreateExecutionRequest = CreateExecutionRequest,
> {
  readonly nodeType: TRequest["nodeType"];
  validateRequest(input: unknown): TRequest;
  collectFileIds(input: TRequest): string[];
  buildCreateExecutionStoreInput(input: TRequest): CreateExecutionStoreInput;
  mapValidationError?(error: string): CreateExecutionErrorMapping | null;
}
