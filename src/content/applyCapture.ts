import type { TimetableData } from '../shared/types';
import { timetablesEqual } from '../sync/comparison';

export type PendingApply = {
  target: TimetableData;
  expiresAt: number;
};

export function evaluateApplyCapture(
  pending: PendingApply | undefined,
  observed: TimetableData,
  now = Date.now(),
): { suppress: boolean; pending?: PendingApply } {
  if (!pending) return { suppress: false };
  if (timetablesEqual(pending.target, observed)) return { suppress: true };
  if (now < pending.expiresAt) return { suppress: true, pending };
  return { suppress: false };
}
