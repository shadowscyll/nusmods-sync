export const AUTO_IMPORT_HASH = '#nusmods-sync-auto-import';
const HIDE_IMPORT_STYLE_ID = 'nusmods-sync-hide-native-import';
const IMPORT_MESSAGE_PATTERN = /(?:timetable.*(?:imported|shared with you)|(?:imported|shared).*timetable)/iu;

export function isAutoImportUrl(location: Pick<Location, 'pathname' | 'hash'>): boolean {
  return location.pathname.includes('/timetable/') &&
    location.pathname.endsWith('/share') &&
    location.hash === AUTO_IMPORT_HASH;
}

export function findNativeImportButton(root: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button.btn-success')).find((button) => {
    if (button.textContent?.trim() !== 'Import' || button.disabled) return false;
    const alert = button.closest('.alert-success');
    return alert?.textContent?.includes('This timetable was shared with you') ?? false;
  });
}

export function hideNativeImportMessages(root: ParentNode = document): void {
  const candidates = root.querySelectorAll<HTMLElement>(
    '.alert-success, [role="alert"], [class*="toast" i], [class*="notification" i]',
  );
  for (const candidate of candidates) {
    if (IMPORT_MESSAGE_PATTERN.test(candidate.textContent ?? '')) {
      candidate.style.setProperty('display', 'none', 'important');
      candidate.setAttribute('aria-hidden', 'true');
    }
  }
}

export function startAutoImport(
  currentWindow: Window = window,
  root: ParentNode = document,
  timeoutMs = 12_000,
): (() => void) | undefined {
  if (!isAutoImportUrl(currentWindow.location)) return undefined;

  let observer: MutationObserver | undefined;
  let messageObserver: MutationObserver | undefined;
  let timeout: number | undefined;
  const currentDocument = root instanceof Document ? root : root.ownerDocument ?? document;
  const hideStyle = currentDocument.createElement('style');
  currentDocument.getElementById(HIDE_IMPORT_STYLE_ID)?.remove();
  hideStyle.id = HIDE_IMPORT_STYLE_ID;
  hideStyle.textContent = '.alert.alert-success { display: none !important; }';
  currentDocument.head.append(hideStyle);

  const stop = (removeStyle = true): void => {
    observer?.disconnect();
    messageObserver?.disconnect();
    if (timeout !== undefined) currentWindow.clearTimeout(timeout);
    if (removeStyle) hideStyle.remove();
  };
  const tryImport = (): boolean => {
    const button = findNativeImportButton(root);
    if (!button) return false;
    stop(false);
    currentWindow.history.replaceState(
      currentWindow.history.state,
      '',
      `${currentWindow.location.pathname}${currentWindow.location.search}`,
    );
    messageObserver = new MutationObserver(() => hideNativeImportMessages(root));
    messageObserver.observe(root, { childList: true, subtree: true });
    hideNativeImportMessages(root);
    button.click();
    currentWindow.setTimeout(() => {
      hideNativeImportMessages(root);
      messageObserver?.disconnect();
      hideStyle.remove();
    }, 15_000);
    return true;
  };

  if (tryImport()) return stop;
  observer = new MutationObserver(() => tryImport());
  observer.observe(root, { childList: true, subtree: true });
  timeout = currentWindow.setTimeout(() => stop(), timeoutMs);
  return () => stop();
}
