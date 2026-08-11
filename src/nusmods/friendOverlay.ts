import type { FriendTimetable, PopupState, SyncedTimetable } from '../shared/types';

export type OverlayLesson = {
  day: string;
  startTime: string;
  endTime: string;
  moduleCode: string;
  lessonType: string;
  classNo: string;
  venue?: string;
};

export type FreeRange = { start: number; end: number };
export type OverlayRenderResult = {
  status: 'hidden' | 'shown' | 'error';
  lessonCount: number;
  message: string;
};

type ApiLesson = OverlayLesson & { weeks?: unknown };
type ApiModule = { semesterData?: Array<{ semester?: number; timetable?: ApiLesson[] }> };

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const moduleCache = new Map<string, Promise<ApiModule>>();
let renderGeneration = 0;

export function timeToMinutes(time: string): number {
  const digits = time.replace(/\D/gu, '').padStart(4, '0');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  return hours * 60 + minutes;
}

export function commonFreeRanges(
  participantLessons: OverlayLesson[][],
  day: string,
  start: number,
  end: number,
): FreeRange[] {
  if (participantLessons.length < 2) return [];
  const busy = participantLessons
    .flatMap((lessons) => lessons.filter((lesson) => lesson.day === day))
    .map((lesson) => ({ start: Math.max(start, timeToMinutes(lesson.startTime)), end: Math.min(end, timeToMinutes(lesson.endTime)) }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: FreeRange[] = [];
  for (const range of busy) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const free: FreeRange[] = [];
  let cursor = start;
  for (const range of merged) {
    if (range.start - cursor >= 30) free.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (end - cursor >= 30) free.push({ start: cursor, end });
  return free;
}

const COMPARABLE_CLASS_TYPES = /(?:tutorial|laboratory|recitation|seminar|sectional)/iu;

export function isSharedClass(friendLesson: OverlayLesson, ownLessons: OverlayLesson[]): boolean {
  if (!COMPARABLE_CLASS_TYPES.test(friendLesson.lessonType)) return false;
  return ownLessons.some((ownLesson) =>
    ownLesson.moduleCode === friendLesson.moduleCode &&
    ownLesson.lessonType === friendLesson.lessonType &&
    ownLesson.day === friendLesson.day &&
    ownLesson.startTime === friendLesson.startTime &&
    ownLesson.endTime === friendLesson.endTime,
  );
}

async function fetchModule(academicYear: string, moduleCode: string): Promise<ApiModule> {
  const apiYear = academicYear.replaceAll('/', '-');
  const cacheKey = `${apiYear}:${moduleCode}`;
  let request = moduleCache.get(cacheKey);
  if (!request) {
    request = fetch(`https://api.nusmods.com/v2/${encodeURIComponent(apiYear)}/modules/${encodeURIComponent(moduleCode)}.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load ${moduleCode}`);
        return response.json() as Promise<ApiModule>;
      })
      .catch((error: unknown) => {
        moduleCache.delete(cacheKey);
        throw error;
      });
    moduleCache.set(cacheKey, request);
  }
  return request;
}

function lessonFromId(moduleCode: string, lessonType: string, id: string): OverlayLesson | undefined {
  const parts = id.split('|');
  if (parts.length < 5) return undefined;
  const dayToken = parts[1].toUpperCase().slice(0, 3);
  const day = DAYS.find((item) => item.toUpperCase().startsWith(dayToken));
  if (!day || !/^\d{4}$/u.test(parts[2]) || !/^\d{4}$/u.test(parts[3])) return undefined;
  return {
    moduleCode,
    lessonType,
    classNo: parts[0],
    day,
    startTime: parts[2],
    endTime: parts[3],
    venue: parts[4],
  };
}

export async function resolveTimetable(timetable: SyncedTimetable): Promise<OverlayLesson[]> {
  const visibleModules = timetable.modules.filter((module) => !module.hidden);
  const resolved = await Promise.all(visibleModules.map(async (module) => {
    const direct = module.selections.flatMap(({ lessonType, selection }) =>
      selection.kind === 'lessonIds'
        ? selection.lessonIds.flatMap((id) => lessonFromId(module.moduleCode, lessonType, id) ?? [])
        : [],
    );
    const classSelections = module.selections.filter((item) => item.selection.kind === 'classNo');
    if (classSelections.length === 0) return direct;
    const data = await fetchModule(timetable.academicYear, module.moduleCode);
    const lessons = data.semesterData?.find((item) => item.semester === timetable.semester)?.timetable ?? [];
    return [
      ...direct,
      ...classSelections.flatMap(({ lessonType, selection }) => {
        if (selection.kind !== 'classNo') return [];
        return lessons.filter((lesson) => lesson.lessonType === lessonType && lesson.classNo === selection.classNo)
          .map((lesson) => ({
            day: lesson.day,
            startTime: lesson.startTime,
            endTime: lesson.endTime,
            moduleCode: module.moduleCode,
            lessonType,
            classNo: selection.classNo,
            venue: lesson.venue,
          }));
      }),
    ];
  }));
  return resolved.flat();
}

function timetableContainer(): HTMLElement | undefined {
  const candidates = document.querySelectorAll<HTMLElement>('.timetable, div[class*="Timetable_container"]');
  return [...candidates].find((item) => item.querySelector(':scope > ol'));
}

async function waitForTimetable(generation: number): Promise<HTMLElement | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (generation !== renderGeneration) return undefined;
    const container = timetableContainer();
    if (container) return container;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  return undefined;
}

function gridBounds(container: HTMLElement): { start: number; end: number } {
  const times = [...container.querySelectorAll(':scope > div:first-child time')]
    .map((item) => timeToMinutes(item.textContent ?? ''))
    .filter(Number.isFinite);
  return times.length > 0 ? { start: times[0], end: times.at(-1)! + 60 } : { start: 480, end: 1320 };
}

function addRange(
  root: ShadowRoot,
  range: FreeRange,
  bounds: { start: number; end: number },
  vertical: boolean,
): void {
  const element = document.createElement('div');
  element.className = 'freeRange';
  const offset = ((range.start - bounds.start) / (bounds.end - bounds.start)) * 100;
  const size = ((range.end - range.start) / (bounds.end - bounds.start)) * 100;
  if (vertical) Object.assign(element.style, { top: `${offset}%`, height: `${size}%`, left: '0', right: '0' });
  else Object.assign(element.style, { left: `${offset}%`, width: `${size}%`, top: '0', bottom: '0' });
  element.title = `Everyone free · ${String(Math.floor(range.start / 60)).padStart(2, '0')}${String(range.start % 60).padStart(2, '0')}–${String(Math.floor(range.end / 60)).padStart(2, '0')}${String(range.end % 60).padStart(2, '0')}`;
  root.append(element);
}

function addLesson(
  root: ShadowRoot,
  lesson: OverlayLesson,
  bounds: { start: number; end: number },
  vertical: boolean,
  friendIndex: number,
  friend: FriendTimetable,
  shared: boolean,
): void {
  const start = timeToMinutes(lesson.startTime);
  const end = timeToMinutes(lesson.endTime);
  if (end <= bounds.start || start >= bounds.end) return;
  const offset = ((Math.max(start, bounds.start) - bounds.start) / (bounds.end - bounds.start)) * 100;
  const size = ((Math.min(end, bounds.end) - Math.max(start, bounds.start)) / (bounds.end - bounds.start)) * 100;
  const element = document.createElement('div');
  element.className = `friendLesson${shared ? ' sharedClass' : ''}`;
  if (vertical) {
    Object.assign(element.style, { top: `${offset}%`, height: `${size}%`, right: `${2 + friendIndex * 33}px`, width: '32px' });
  } else {
    Object.assign(element.style, { left: `${offset}%`, width: `${size}%`, bottom: `${2 + friendIndex * 25}px`, height: '24px' });
  }
  const label = document.createElement('span');
  label.textContent = lesson.moduleCode;
  element.append(label);
  element.title = `${friend.name} · ${lesson.moduleCode} ${lesson.lessonType} ${lesson.classNo}\n${lesson.day} ${lesson.startTime}–${lesson.endTime}${lesson.venue ? ` · ${lesson.venue}` : ''}`;
  root.append(element);
}

export async function renderFriendOverlay(state: PopupState): Promise<OverlayRenderResult> {
  const generation = ++renderGeneration;
  document.querySelectorAll('[data-nusmods-sync-overlay]').forEach((item) => item.remove());
  const visibleFriends = state.friends.filter(
    (friend): friend is FriendTimetable & { timetable: SyncedTimetable } => friend.enabled && Boolean(friend.timetable),
  );
  const current = state.current;
  if (!current || visibleFriends.length === 0 || !window.location.pathname.startsWith('/timetable')) {
    return { status: 'hidden', lessonCount: 0, message: 'No friend overlays selected' };
  }
  const compatible = visibleFriends.filter((friend) =>
    friend.timetable.academicYear === current.academicYear && friend.timetable.semester === current.semester,
  );
  if (compatible.length === 0) {
    return { status: 'error', lessonCount: 0, message: 'Friends are from a different semester or academic year' };
  }
  let participantLessons: OverlayLesson[][];
  try {
    participantLessons = await Promise.all([
      resolveTimetable(current),
      ...compatible.map((friend) => resolveTimetable(friend.timetable)),
    ]);
  } catch {
    return { status: 'error', lessonCount: 0, message: 'Could not load NUSMods lesson times' };
  }
  const [ownLessons, ...friendLessons] = participantLessons;
  if (generation !== renderGeneration) return { status: 'hidden', lessonCount: 0, message: 'Overlay changed' };
  const container = await waitForTimetable(generation);
  const dayItems = container?.querySelectorAll<HTMLElement>(':scope > ol > li');
  if (!container || !dayItems || dayItems.length === 0) {
    return { status: 'error', lessonCount: 0, message: 'Could not find the NUSMods timetable grid' };
  }
  const bounds = gridBounds(container);
  [...dayItems].forEach((dayItem, dayIndex) => {
    const rows = dayItem.children[1] as HTMLElement | undefined;
    if (!rows) return;
    const day = DAYS[dayIndex];
    const host = document.createElement('div');
    host.dataset.nusmodsSyncOverlay = 'true';
    Object.assign(host.style, { position: 'absolute', inset: '0', zIndex: '30', pointerEvents: 'none', overflow: 'hidden' });
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      .freeRange { position: absolute; z-index: 0; border: 1px dashed rgba(47, 143, 91, .45); background: rgba(64, 181, 111, .12); }
      .friendLesson { position: absolute; z-index: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #364a57; border-radius: 0; background: #597383; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .18); color: #fff; font: 750 11px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; opacity: .94; white-space: nowrap; }
      .friendLesson span { overflow: hidden; padding: 0 4px; text-shadow: 0 1px 1px rgba(0, 0, 0, .38); text-overflow: ellipsis; }
      .sharedClass { z-index: 2; border: 2px solid #25935d; background: #4f806a; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .22); opacity: 1; }
      .sharedClass span { padding: 0 4px; }
      @media (prefers-color-scheme: dark) { .friendLesson { border-color: #8195a1; background: #4b606d; } .sharedClass { border-color: #5ed092; background: #416b59; } .freeRange { background: rgba(64, 181, 111, .09); } }
    `;
    root.append(style);
    if (getComputedStyle(rows).position === 'static') rows.style.position = 'relative';
    const vertical = rows.clientHeight > rows.clientWidth * 0.8;
    if (state.settings.showCommonFreeTime) {
      for (const range of commonFreeRanges([ownLessons, ...friendLessons], day, bounds.start, bounds.end)) addRange(root, range, bounds, vertical);
    }
    compatible.forEach((friend, index) => {
      for (const lesson of friendLessons[index]?.filter((item) => item.day === day) ?? []) {
        addLesson(root, lesson, bounds, vertical, index, friend, isSharedClass(lesson, ownLessons));
      }
    });
    rows.append(host);
  });
  const lessonCount = friendLessons.reduce((count, lessons) => count + lessons.length, 0);
  const sharedCount = friendLessons.flat().filter((lesson) => isSharedClass(lesson, ownLessons)).length;
  return lessonCount > 0
    ? { status: 'shown', lessonCount, message: `${lessonCount} friend lesson${lessonCount === 1 ? '' : 's'} shown${sharedCount > 0 ? ` · ${sharedCount} shared class${sharedCount === 1 ? '' : 'es'}` : ''}` }
    : { status: 'error', lessonCount: 0, message: 'No matching friend lessons were found' };
}
