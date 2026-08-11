import { afterEach, describe, expect, it, vi } from 'vitest';

describe('tab messaging', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('injects the content script and retries when an existing tab has no receiver', async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ ok: true, data: 'ready' });
    const executeScript = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('chrome', {
      tabs: { sendMessage },
      scripting: { executeScript },
      runtime: { getManifest: () => ({ content_scripts: [{ js: ['assets/content-loader.js'] }] }) },
    });

    const { sendTabMessage } = await import('../src/shared/messages');
    await expect(sendTabMessage(42, { type: 'READ_TIMETABLE' })).resolves.toEqual({ ok: true, data: 'ready' });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42 }, files: ['assets/content-loader.js'] });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('shows a useful instruction if injection cannot recover the receiver', async () => {
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.')) },
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error('Blocked')) },
      runtime: { getManifest: () => ({ content_scripts: [{ js: ['assets/content-loader.js'] }] }) },
    });

    const { sendTabMessage } = await import('../src/shared/messages');
    await expect(sendTabMessage(42, { type: 'READ_TIMETABLE' })).resolves.toEqual({
      ok: false,
      error: 'Reload the NUSMods tab and try again',
    });
  });
});
