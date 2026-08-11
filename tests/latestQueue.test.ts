import { describe, expect, it, vi } from 'vitest';

import { LatestAsyncQueue } from '../src/content/latestQueue';

describe('latest async queue', () => {
  it('collapses queued intermediate values while work is in progress', async () => {
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => { finishFirst = resolve; });
    const worker = vi.fn(async (value: number) => {
      if (value === 1) await first;
    });
    const queue = new LatestAsyncQueue(worker);

    queue.push(1);
    await Promise.resolve();
    queue.push(2);
    queue.push(3);
    finishFirst();
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(2));

    expect(worker.mock.calls.map(([value]) => value)).toEqual([1, 3]);
  });
});
