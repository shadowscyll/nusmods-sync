import { describe, expect, it } from 'vitest';

import { buildImportUrl, buildShareUrl } from '../src/nusmods/applyTimetable';
import { parsePersistedTimetable } from '../src/nusmods/readTimetable';
import { persistedState } from './fixtures';

describe('read → normalize → native restore URL', () => {
  it('serializes ordinary and TA selections into the format NUSMods imports', () => {
    const data = parsePersistedTimetable(persistedState(), '/timetable/sem-1');
    const timetable = { ...data, updatedAt: 123, deviceId: 'device_test' };
    const url = new URL(buildImportUrl(timetable));
    expect(url.pathname).toBe('/timetable/sem-1/share');
    expect(url.searchParams.get('CS2040S')).toBe('LEC:1,TUT:03');
    expect(url.searchParams.get('CS1010S')).toBe('TUT:(1|MON|0900|1000|COM1-0203|1_2_3)');
    expect(url.searchParams.get('hidden')).toBe('CS2040S');
    expect(url.searchParams.get('ta')).toBe('CS1010S');
  });

  it('creates a native NUSMods share link without the extension auto-import marker', () => {
    const data = parsePersistedTimetable(persistedState(), '/timetable/sem-1');
    const timetable = { ...data, updatedAt: 123, deviceId: 'device_test' };
    const url = new URL(buildShareUrl(timetable));
    expect(url.pathname).toBe('/timetable/sem-1/share');
    expect(url.searchParams.get('CS2040S')).toBe('LEC:1,TUT:03');
    expect(url.hash).toBe('');
  });
});
