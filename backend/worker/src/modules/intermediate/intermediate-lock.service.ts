export interface IntermediateLockHandle {
  key: string;
  release(): Promise<void>;
}

export class IntermediateLockService {
  private readonly lockRetryDelayMs: number;
  private readonly lockTimeoutMs: number;
  private readonly activeKeys = new Set<string>();

  constructor(options?: {
    lockRetryDelayMs?: number;
    lockTimeoutMs?: number;
  }) {
    this.lockRetryDelayMs = options?.lockRetryDelayMs ?? 25;
    this.lockTimeoutMs = options?.lockTimeoutMs ?? 5_000;
  }

  async acquire(key: string): Promise<IntermediateLockHandle> {
    const startedAt = Date.now();

    while (this.activeKeys.has(key)) {
      if (Date.now() - startedAt >= this.lockTimeoutMs) {
        throw new Error(`INTERMEDIATE_LOCK_TIMEOUT:${key}`);
      }

      await this.delay(this.lockRetryDelayMs);
    }

    this.activeKeys.add(key);

    return {
      key,
      release: async () => {
        this.activeKeys.delete(key);
      },
    };
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

