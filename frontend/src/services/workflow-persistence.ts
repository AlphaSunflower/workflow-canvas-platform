export type WorkflowPersistenceSaveMode = 'immediate' | 'debounced';

export interface WorkflowPersistenceOptions<TPayload, TResult> {
  debounceMs: number;
  save: (payload: TPayload) => Promise<TResult>;
}

export interface WorkflowPersistenceRequestOptions {
  mode?: WorkflowPersistenceSaveMode;
  debounceMs?: number;
}

export interface WorkflowPersistenceState {
  isSaving: boolean;
  hasQueuedSave: boolean;
  hasScheduledSave: boolean;
  lastError: unknown | null;
}

interface PendingRequest<TPayload, TResult> {
  payload: TPayload;
  resolve: (result: TResult) => void;
  reject: (reason?: unknown) => void;
  promise: Promise<TResult>;
}

export interface WorkflowPersistence<TPayload, TResult> {
  save: (payload: TPayload, options?: WorkflowPersistenceRequestOptions) => Promise<TResult>;
  flush: () => Promise<TResult | null>;
  cancel: () => void;
  getState: () => WorkflowPersistenceState;
  subscribe: (listener: () => void) => () => void;
}

export function createWorkflowPersistence<TPayload, TResult>(
  options: WorkflowPersistenceOptions<TPayload, TResult>,
): WorkflowPersistence<TPayload, TResult> {
  let inFlight: Promise<TResult> | null = null;
  let queuedRequest: PendingRequest<TPayload, TResult> | null = null;
  let scheduledRequest: PendingRequest<TPayload, TResult> | null = null;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let lastError: unknown | null = null;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    listeners.forEach((listener) => listener());
  };

  const clearScheduledTimer = (): void => {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
      emit();
    }
  };

  const rejectRequest = (request: PendingRequest<TPayload, TResult> | null, reason: unknown): void => {
    if (request) {
      request.reject(reason);
    }
  };

  const execute = async (request: PendingRequest<TPayload, TResult>): Promise<TResult> => {
    if (inFlight) {
      if (queuedRequest && queuedRequest !== request) {
        rejectRequest(queuedRequest, new Error('Superseded by a newer workflow save request.'));
      }
      queuedRequest = request;
      emit();
      return request.promise;
    }

    inFlight = (async (): Promise<TResult> => options.save(request.payload))();
    lastError = null;
    emit();

    try {
      const result = await inFlight;
      request.resolve(result);
      return result;
    } catch (error) {
      lastError = error;
      request.reject(error);
      throw error;
    } finally {
      inFlight = null;
      emit();
      if (queuedRequest) {
        const nextRequest = queuedRequest;
        queuedRequest = null;
        emit();
        void execute(nextRequest).catch(() => undefined);
      }
    }
  };

  const createRequest = (payload: TPayload): PendingRequest<TPayload, TResult> => {
    let resolveRequest!: (result: TResult) => void;
    let rejectRequestPromise!: (reason?: unknown) => void;
    const promise = new Promise<TResult>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequestPromise = reject;
    });

    return {
      payload,
      resolve: resolveRequest,
      reject: rejectRequestPromise,
      promise,
    };
  };

  const schedule = (request: PendingRequest<TPayload, TResult>, debounceMs: number): Promise<TResult> => {
    clearScheduledTimer();
    rejectRequest(scheduledRequest, new Error('Superseded by a newer workflow save request.'));
    scheduledRequest = request;
    scheduledTimer = setTimeout(() => {
      const nextRequest = scheduledRequest;
      scheduledRequest = null;
      scheduledTimer = null;
      emit();
      if (nextRequest) {
        void execute(nextRequest).catch(() => undefined);
      }
    }, Math.max(0, debounceMs));
    emit();

    return request.promise;
  };

  return {
    subscribe(listener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    save(payload, requestOptions = {}): Promise<TResult> {
      const request = createRequest(payload);
      if (requestOptions.mode === 'debounced') {
        return schedule(request, requestOptions.debounceMs ?? options.debounceMs);
      }

      clearScheduledTimer();
      rejectRequest(scheduledRequest, new Error('Superseded by an immediate workflow save request.'));
      scheduledRequest = null;
      emit();
      void execute(request).catch(() => undefined);
      return request.promise;
    },

    async flush(): Promise<TResult | null> {
      clearScheduledTimer();
      const request = scheduledRequest;
      scheduledRequest = null;
      emit();

      if (request) {
        return execute(request);
      }

      if (queuedRequest) {
        return queuedRequest.promise;
      }

      return inFlight;
    },

    cancel(): void {
      clearScheduledTimer();
      rejectRequest(scheduledRequest, new Error('Workflow save was cancelled.'));
      rejectRequest(queuedRequest, new Error('Workflow save was cancelled.'));
      scheduledRequest = null;
      queuedRequest = null;
      emit();
    },

    getState(): WorkflowPersistenceState {
      return {
        isSaving: inFlight !== null,
        hasQueuedSave: queuedRequest !== null,
        hasScheduledSave: scheduledRequest !== null,
        lastError,
      };
    },
  };
}
