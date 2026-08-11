import { afterEach, describe, expect, it, vi } from 'vitest';

import { NUSMODS_STORAGE_EVENT, NUSMODS_STORAGE_KEY } from '../src/shared/constants';
import { watchTimetable } from '../src/nusmods/watchTimetable';
import { persistedState } from './fixtures';

describe('timetable watcher', () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('captures an isolated same-page storage notification immediately', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/timetable/sem-1');
    window.localStorage.setItem(NUSMODS_STORAGE_KEY, persistedState());
    const onChange = vi.fn();
    const stop = watchTimetable(onChange);
    await vi.advanceTimersByTimeAsync(250);
    onChange.mockClear();

    const changed = JSON.parse(persistedState()) as Record<string, string>;
    const lessons = JSON.parse(changed.lessons) as Record<string, Record<string, unknown>>;
    lessons['1'].CS2040S = { Lecture: ['2'], Tutorial: ['03'] };
    changed.lessons = JSON.stringify(lessons);
    window.localStorage.setItem(NUSMODS_STORAGE_KEY, JSON.stringify(changed));
    window.dispatchEvent(new Event(NUSMODS_STORAGE_EVENT));

    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].modules.find((item: { moduleCode: string }) => item.moduleCode === 'CS2040S')
      .selections[0].selection.classNo).toBe('2');
    stop();
  });

  it('emits only the immediate and final values from a rapid burst', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/timetable/sem-1');
    window.localStorage.setItem(NUSMODS_STORAGE_KEY, persistedState());
    const onChange = vi.fn();
    const stop = watchTimetable(onChange);
    await vi.advanceTimersByTimeAsync(250);
    onChange.mockClear();

    const changed = JSON.parse(persistedState()) as Record<string, string>;
    const lessons = JSON.parse(changed.lessons) as Record<string, Record<string, unknown>>;
    for (const classNo of ['2', '3', '4']) {
      lessons['1'].CS2040S = { Lecture: [classNo], Tutorial: ['03'] };
      changed.lessons = JSON.stringify(lessons);
      window.localStorage.setItem(NUSMODS_STORAGE_KEY, JSON.stringify(changed));
      window.dispatchEvent(new Event(NUSMODS_STORAGE_EVENT));
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].modules.find((item: { moduleCode: string }) => item.moduleCode === 'CS2040S')
      .selections[0].selection.classNo).toBe('4');
    stop();
  });
});
