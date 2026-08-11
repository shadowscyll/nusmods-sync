import { afterEach, describe, expect, it, vi } from 'vitest';

import { commonFreeRanges, isSharedClass, resolveTimetable, timeToMinutes, type OverlayLesson } from '../src/nusmods/friendOverlay';
import type { PopupState } from '../src/shared/types';
import { timetable } from './fixtures';

function lesson(day: string, startTime: string, endTime: string): OverlayLesson {
  return { day, startTime, endTime, moduleCode: 'TEST', lessonType: 'Lecture', classNo: '1' };
}

describe('friend timetable overlays', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    window.history.replaceState({}, '', '/');
  });
  it('converts NUSMods times to minutes', () => {
    expect(timeToMinutes('0830')).toBe(510);
    expect(timeToMinutes('18:00')).toBe(1080);
  });

  it('finds gaps where every participant is free', () => {
    const mine = [lesson('Monday', '0900', '1000'), lesson('Monday', '1300', '1400')];
    const friend = [lesson('Monday', '1000', '1130'), lesson('Monday', '1500', '1600')];
    expect(commonFreeRanges([mine, friend], 'Monday', 480, 1080)).toEqual([
      { start: 480, end: 540 },
      { start: 690, end: 780 },
      { start: 840, end: 900 },
      { start: 960, end: 1080 },
    ]);
  });

  it('does not show common-free highlighting without a friend', () => {
    expect(commonFreeRanges([[lesson('Tuesday', '1000', '1100')]], 'Tuesday', 480, 1080)).toEqual([]);
  });

  it('recognizes a shared tutorial, lab, recitation, or seminar slot', () => {
    const mine = [{ ...lesson('Wednesday', '1400', '1500'), moduleCode: 'CS2040S', lessonType: 'Tutorial' }];
    expect(isSharedClass({ ...mine[0], classNo: '03' }, mine)).toBe(true);
    expect(isSharedClass({ ...mine[0], lessonType: 'Lecture' }, mine)).toBe(false);
    expect(isSharedClass({ ...mine[0], startTime: '1500', endTime: '1600' }, mine)).toBe(false);
  });

  it('resolves selected class numbers with NUSMods module data', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        semesterData: [{
          semester: 1,
          timetable: [
            { classNo: '1', lessonType: 'Lecture', day: 'Monday', startTime: '1000', endTime: '1200', venue: 'LT1' },
            { classNo: '03', lessonType: 'Tutorial', day: 'Wednesday', startTime: '1400', endTime: '1500', venue: 'COM1' },
          ],
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveTimetable(timetable({ academicYear: '2099/2100' }))).resolves.toEqual([
      { classNo: '1', lessonType: 'Lecture', day: 'Monday', startTime: '1000', endTime: '1200', venue: 'LT1', moduleCode: 'CS2040S' },
      { classNo: '03', lessonType: 'Tutorial', day: 'Wednesday', startTime: '1400', endTime: '1500', venue: 'COM1', moduleCode: 'CS2040S' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/2099-2100/modules/'));
  });

  it('renders friend lessons and free time inside the NUSMods day grid', async () => {
    window.history.replaceState({}, '', '/timetable/sem-1');
    document.body.innerHTML = `<div class="timetable"><div><time>0800</time><time>0900</time><time>1000</time><time>1100</time><span></span></div><ol>${
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day) => `<li><div>${day}</div><div style="position:relative;display:flex;flex-direction:column"></div></li>`).join('')
    }</ol></div>`;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        semesterData: [{ semester: 1, timetable: [
          { classNo: '1', lessonType: 'Lecture', day: 'Monday', startTime: '0900', endTime: '1000', venue: 'LT1' },
          { classNo: '03', lessonType: 'Tutorial', day: 'Wednesday', startTime: '1000', endTime: '1100', venue: 'COM1' },
        ] }],
      }),
    })));
    const mine = timetable({ academicYear: '2098-2099' });
    const state: PopupState = {
      status: 'synced',
      current: mine,
      history: [],
      settings: { autoSync: true, showCommonFreeTime: true },
      isNusmodsTab: true,
      pairing: { paired: false, relayConfigured: true },
      profiles: [],
      pushStatus: 'offline',
      ownedFriendShares: [],
      friends: [{
        id: 'friend-1',
        name: 'Alex',
        access: { version: 1, endpoint: 'https://relay.invalid', shareId: 'share', encryptionKey: 'key', readToken: 'read' },
        timetable: mine,
        updatedAt: mine.updatedAt,
        enabled: true,
      }],
    };
    const { renderFriendOverlay } = await import('../src/nusmods/friendOverlay');
    await renderFriendOverlay(state);
    const hosts = document.querySelectorAll<HTMLElement>('[data-nusmods-sync-overlay]');
    expect(hosts).toHaveLength(5);
    expect(hosts[0].shadowRoot?.querySelector<HTMLElement>('.friendLesson')?.title).toContain('Alex · CS2040S');
    expect(hosts[0].shadowRoot?.querySelector('.friendLesson')?.textContent).toBe('CS2040S');
    expect(hosts[2].shadowRoot?.querySelector('.friendLesson.sharedClass')).not.toBeNull();
    expect(hosts[1].shadowRoot?.querySelectorAll('.freeRange').length).toBeGreaterThan(0);
  });
});
