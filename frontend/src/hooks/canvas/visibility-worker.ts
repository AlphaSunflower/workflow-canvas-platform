import {
  computeVisibleNodesSerialized,
  type SerializableVisibleNodesRequest,
  type SerializableVisibleNodeResult,
} from './useVisibleNodes';

interface VisibilityWorkerRequest {
  id: string;
  payload: SerializableVisibleNodesRequest;
}

interface VisibilityWorkerSuccess {
  id: string;
  success: true;
  result: SerializableVisibleNodeResult[];
}

interface VisibilityWorkerFailure {
  id: string;
  success: false;
  error: string;
}

declare const self: Worker;

self.onmessage = (event: MessageEvent<VisibilityWorkerRequest>): void => {
  const request = event.data;

  try {
    const result = computeVisibleNodesSerialized(request.payload);
    const response: VisibilityWorkerSuccess = {
      id: request.id,
      success: true,
      result,
    };
    self.postMessage(response);
  } catch (error) {
    const response: VisibilityWorkerFailure = {
      id: request.id,
      success: false,
      error: error instanceof Error ? error.message : 'Visibility worker failed',
    };
    self.postMessage(response);
  }
};

export {};
