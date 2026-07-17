import {
  areVisibleNodeMapsEqual,
  computeVisibleNodes,
  materializeVisibleNodeMap,
  serializeVisibleNodesInput,
  type ComputeVisibleNodesOptions,
  type SerializableVisibleNodesRequest,
  type SerializableVisibleNodeResult,
  type VisibleNodeMap,
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

type VisibilityWorkerResponse = VisibilityWorkerSuccess | VisibilityWorkerFailure;

interface PendingTask {
  resolve: (value: VisibleNodeMap) => void;
  reject: (reason?: unknown) => void;
}

interface VisibilityWorkerClientOptions {
  createWorker?: () => Worker;
  compareWithMainThread?: boolean;
}

let workerInstance: Worker | null = null;
let sequence = 0;
let workerDisabled = false;
const pendingTasks = new Map<string, PendingTask>();

export function canUseVisibilityWorker(
  flag: string | undefined = import.meta.env?.VITE_CANVAS_VISIBILITY_WORKER
): boolean {
  return typeof Worker !== 'undefined' && flag !== 'false';
}

export function shouldCompareVisibilityWorkerResult(
  flag: string | undefined = import.meta.env?.VITE_CANVAS_VISIBILITY_WORKER_COMPARE
): boolean {
  return flag === 'true';
}

function getWorker(createWorker?: () => Worker): Worker {
  if (workerInstance) {
    return workerInstance;
  }

  workerInstance = createWorker
    ? createWorker()
    : new Worker(new URL('./visibility-worker.ts', import.meta.url), { type: 'module' });
  workerInstance.addEventListener('message', handleWorkerMessage as EventListener);
  workerInstance.addEventListener('error', handleWorkerError as EventListener);
  return workerInstance;
}

function handleWorkerMessage(event: MessageEvent<VisibilityWorkerResponse>): void {
  const message = event.data;
  const task = pendingTasks.get(message.id);
  if (!task) {
    return;
  }

  pendingTasks.delete(message.id);
  if (!message.success) {
    task.reject(new Error(message.error));
    return;
  }

  task.resolve(materializeVisibleNodeMap(message.result));
}

function handleWorkerError(): void {
  workerDisabled = true;
  pendingTasks.forEach((task) => {
    task.reject(new Error('Visibility worker crashed'));
  });
  pendingTasks.clear();

  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

export async function computeVisibleNodesWithWorker(
  options: ComputeVisibleNodesOptions,
  clientOptions: VisibilityWorkerClientOptions = {},
): Promise<VisibleNodeMap> {
  const mainThreadFallback = (): VisibleNodeMap => computeVisibleNodes(options);

  if (workerDisabled || !canUseVisibilityWorker()) {
    return mainThreadFallback();
  }

  const payload = serializeVisibleNodesInput(options);
  const id = `visibility-worker-${sequence += 1}`;

  try {
    const worker = getWorker(clientOptions.createWorker);
    const workerResult = await new Promise<VisibleNodeMap>((resolve, reject) => {
      pendingTasks.set(id, { resolve, reject });
      const message: VisibilityWorkerRequest = { id, payload };
      worker.postMessage(message);
    });

    const compareResults = clientOptions.compareWithMainThread ?? shouldCompareVisibilityWorkerResult();
    if (compareResults) {
      const mainThreadResult = mainThreadFallback();
      if (!areVisibleNodeMapsEqual(workerResult, mainThreadResult)) {
        return mainThreadResult;
      }
    }

    return workerResult;
  } catch {
    workerDisabled = true;
    return mainThreadFallback();
  }
}

export function resetVisibilityWorkerClientForTests(): void {
  pendingTasks.clear();
  workerDisabled = false;
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
