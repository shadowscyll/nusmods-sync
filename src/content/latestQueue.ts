export class LatestAsyncQueue<T> {
  private latest!: T;
  private hasLatest = false;
  private running = false;

  constructor(
    private readonly worker: (value: T) => Promise<unknown>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  push(value: T): void {
    this.latest = value;
    this.hasLatest = true;
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.hasLatest) {
      const value = this.latest;
      this.hasLatest = false;
      try {
        await this.worker(value);
      } catch (error) {
        this.onError(error);
      }
    }
    this.running = false;
    if (this.hasLatest) void this.drain();
  }
}
