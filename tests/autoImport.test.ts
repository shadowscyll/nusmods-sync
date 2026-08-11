import { describe, expect, it, vi } from 'vitest';

import {
  AUTO_IMPORT_HASH,
  findNativeImportButton,
  hideNativeImportMessages,
  isAutoImportUrl,
  startAutoImport,
} from '../src/nusmods/autoImport';
import { applyTimetable } from '../src/nusmods/applyTimetable';
import { timetable } from './fixtures';

describe('automatic native import', () => {
  it('only recognizes extension-marked NUSMods share routes', () => {
    expect(isAutoImportUrl({ pathname: '/timetable/sem-1/share', hash: AUTO_IMPORT_HASH })).toBe(true);
    expect(isAutoImportUrl({ pathname: '/timetable/sem-1/share', hash: '' })).toBe(false);
    expect(isAutoImportUrl({ pathname: '/timetable/sem-1', hash: AUTO_IMPORT_HASH })).toBe(false);
  });

  it('finds only the official shared-timetable import action', () => {
    document.body.innerHTML = `
      <button class="btn-success">Import</button>
      <div class="alert-success">
        <h3>This timetable was shared with you</h3>
        <button class="btn-success" type="button">Import</button>
      </div>`;
    expect(findNativeImportButton()?.closest('.alert-success')).not.toBeNull();
  });

  it('clears the marker and clicks the native import action', () => {
    window.history.replaceState(null, '', `/timetable/sem-1/share?CS1010S=LEC%3A1${AUTO_IMPORT_HASH}`);
    document.body.innerHTML = `
      <div class="alert-success">
        <h3>This timetable was shared with you</h3>
        <button class="btn-success" type="button">Import</button>
      </div>`;
    const button = findNativeImportButton();
    const click = vi.spyOn(button!, 'click');
    startAutoImport(window, document);
    expect(click).toHaveBeenCalledOnce();
    expect(document.getElementById('nusmods-sync-hide-native-import')).not.toBeNull();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?CS1010S=LEC%3A1');
  });

  it('opens the share route inside the SPA without reloading the page', () => {
    window.history.replaceState(null, '', '/timetable/sem-1');
    document.body.innerHTML = `
      <div class="alert-success">
        <h3>This timetable was shared with you</h3>
        <button class="btn-success" type="button">Import</button>
      </div>`;
    const button = findNativeImportButton();
    const click = vi.spyOn(button!, 'click');
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate, { once: true });

    const value = timetable({ academicYear: '2025-2026', semester: 1 });
    applyTimetable(value, value);

    expect(window.location.pathname).toBe('/timetable/sem-1/share');
    expect(popstate).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it('hides native shared and imported timetable notices', () => {
    document.body.innerHTML = `
      <div role="alert">Timetable imported successfully</div>
      <div role="alert">Unrelated NUSMods message</div>`;
    hideNativeImportMessages(document);
    const notices = document.querySelectorAll<HTMLElement>('[role="alert"]');
    expect(notices[0].style.getPropertyValue('display')).toBe('none');
    expect(notices[0].getAttribute('aria-hidden')).toBe('true');
    expect(notices[1].style.getPropertyValue('display')).toBe('');
  });
});
