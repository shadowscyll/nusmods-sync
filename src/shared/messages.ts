import type { MessageResponse, RuntimeMessage } from './types';
import { webext } from './webext';

export async function sendRuntimeMessage<T>(message: RuntimeMessage): Promise<MessageResponse<T>> {
  try {
    return (await webext.runtime.sendMessage(message)) as MessageResponse<T>;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Extension communication failed',
    };
  }
}

export async function sendTabMessage<T>(
  tabId: number,
  message: RuntimeMessage,
): Promise<MessageResponse<T>> {
  try {
    return (await webext.tabs.sendMessage(tabId, message)) as MessageResponse<T>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const receiverMissing = /receiving end does not exist|could not establish connection/i.test(detail);
    if (receiverMissing && webext.scripting) {
      try {
        const contentScript = webext.runtime.getManifest().content_scripts?.[0]?.js?.[0];
        if (contentScript) {
          await webext.scripting.executeScript({ target: { tabId }, files: [contentScript] });
          return (await webext.tabs.sendMessage(tabId, message)) as MessageResponse<T>;
        }
      } catch {
        // Fall through to the useful user-facing error below.
      }
    }
    return {
      ok: false,
      error: receiverMissing ? 'Reload the NUSMods tab and try again' : detail || 'NUSMods page is not ready',
    };
  }
}
