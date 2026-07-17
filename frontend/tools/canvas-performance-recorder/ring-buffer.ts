export class CanvasPerformanceRingBuffer<T extends { ts: number }> {
  private readonly valuesList: T[] = [];
  private readonly durationMs: number;
  private readonly maxEvents: number;

  constructor(options: {
    durationMs: number;
    maxEvents: number;
  }) {
    this.durationMs = Math.max(1, options.durationMs);
    this.maxEvents = Math.max(1, options.maxEvents);
  }

  push(value: T): void {
    this.valuesList.push(value);
    this.prune(value.ts);
  }

  values(): T[] {
    return [...this.valuesList];
  }

  clear(): void {
    this.valuesList.length = 0;
  }

  get size(): number {
    return this.valuesList.length;
  }

  prune(now: number): void {
    const minTs = now - this.durationMs;
    while (this.valuesList.length > 0 && this.valuesList[0]!.ts < minTs) {
      this.valuesList.shift();
    }

    if (this.valuesList.length > this.maxEvents) {
      this.valuesList.splice(0, this.valuesList.length - this.maxEvents);
    }
  }
}
