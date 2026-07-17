interface WorkerHashRequest {
  id: string;
  file: File;
}

interface WorkerHashSuccess {
  id: string;
  success: true;
  sha256: string;
}

interface WorkerHashFailure {
  id: string;
  success: false;
  error: string;
}

type WorkerHashResponse = WorkerHashSuccess | WorkerHashFailure;

let workerInstance: Worker | null = null;
let workerSequence = 0;
const workerPendingTasks = new Map<string, {
  resolve: (sha256: string) => void;
  reject: (reason?: unknown) => void;
}>();
const fileHashCache = new WeakMap<File, string>();
const fileHashInFlight = new WeakMap<File, Promise<string>>();

function canUseHashWorker(): boolean {
  return typeof Worker !== 'undefined';
}

function getHashWorker(): Worker {
  if (workerInstance) {
    return workerInstance;
  }

  workerInstance = new Worker(
    new URL('./file/file-hash.worker.ts', import.meta.url),
    { type: 'module' },
  );
  workerInstance.addEventListener('message', handleWorkerMessage as EventListener);
  workerInstance.addEventListener('error', handleWorkerError as EventListener);
  return workerInstance;
}

function handleWorkerMessage(event: MessageEvent<WorkerHashResponse>): void {
  const payload = event.data;
  const pending = workerPendingTasks.get(payload.id);
  if (!pending) {
    return;
  }

  workerPendingTasks.delete(payload.id);

  if (!payload.success) {
    pending.reject(new Error(payload.error));
    return;
  }

  pending.resolve(payload.sha256);
}

function handleWorkerError(): void {
  workerPendingTasks.forEach((pending) => {
    pending.reject(new Error('Workflow upload hash worker crashed.'));
  });
  workerPendingTasks.clear();

  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

async function hashWithWorker(file: File): Promise<string> {
  const worker = getHashWorker();
  const id = `workflow-file-hash-${workerSequence += 1}`;
  const payload: WorkerHashRequest = { id, file };

  return new Promise<string>((resolve, reject) => {
    workerPendingTasks.set(id, { resolve, reject });
    worker.postMessage(payload);
  });
}

async function hashOnMainThread(file: File): Promise<string> {
  const { calculateFileHash } = await import('./file/file-service.js');
  return calculateFileHash(file);
}

export async function hashWorkflowFile(file: File, signal?: AbortSignal): Promise<string> {
  const cached = fileHashCache.get(file);
  if (cached) {
    return cached;
  }

  const inFlight = fileHashInFlight.get(file);
  if (inFlight) {
    return inFlight;
  }

  const hashPromise = (async (): Promise<string> => {
    throwIfAborted(signal);
    const sha256 = canUseHashWorker()
      ? await hashWithWorker(file).catch(() => hashOnMainThread(file))
      : await hashOnMainThread(file);
    throwIfAborted(signal);
    fileHashCache.set(file, sha256);
    return sha256;
  })().finally(() => {
    fileHashInFlight.delete(file);
  });

  fileHashInFlight.set(file, hashPromise);
  return hashPromise;
}
