import { CAPTURE_BURST_SETTLE_MS, NUSMODS_STORAGE_EVENT, NUSMODS_STORAGE_KEY, WATCH_INTERVAL_MS } from '../shared/constants';
import { debugLog } from '../shared/log';
import type { TimetableData } from '../shared/types';
import { readTimetable } from './readTimetable';

export type StopWatching = () => void;

export function watchTimetable(onChange: (timetable: TimetableData) => void): StopWatching {
  let previousSignature = '';
  let settleId: number | undefined;
  let burstActive = false;
  let trailingPending = false;

  const emit = () => {
    try {
      const timetable = readTimetable();
      debugLog('Timetable changed');
      onChange(timetable);
    } catch (error) {
      debugLog('Timetable read skipped', error);
    }
  };

  const settle = () => {
    settleId = undefined;
    burstActive = false;
    if (!trailingPending) return;
    trailingPending = false;
    emit();
  };

  const check = () => {
    const raw = window.localStorage.getItem(NUSMODS_STORAGE_KEY) ?? '';
    const signature = `${window.location.pathname}\u0000${raw}`;
    if (signature === previousSignature) return;
    previousSignature = signature;
    window.clearTimeout(settleId);
    if (!burstActive) {
      burstActive = true;
      emit();
    } else {
      trailingPending = true;
    }
    settleId = window.setTimeout(settle, CAPTURE_BURST_SETTLE_MS);
  };

  const intervalId = window.setInterval(check, WATCH_INTERVAL_MS);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === NUSMODS_STORAGE_KEY) check();
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(NUSMODS_STORAGE_EVENT, check);
  check();

  return () => {
    window.clearInterval(intervalId);
    window.clearTimeout(settleId);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(NUSMODS_STORAGE_EVENT, check);
  };
}
