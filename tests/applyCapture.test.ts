import { describe, expect, it } from 'vitest';

import { evaluateApplyCapture } from '../src/content/applyCapture';
import { timetable } from './fixtures';

describe('remote timetable apply capture guard', () => {
  it('suppresses intermediate NUSMods import states', () => {
    const target = timetable({ modules: [] });
    const pending = { target, expiresAt: 20_000 };
    expect(evaluateApplyCapture(pending, timetable(), 10_000)).toEqual({ suppress: true, pending });
  });

  it('clears after observing the imported timetable without echoing it', () => {
    const target = timetable({ modules: [] });
    expect(evaluateApplyCapture({ target, expiresAt: 20_000 }, target, 10_000)).toEqual({ suppress: true });
  });

  it('allows genuine changes after an import times out', () => {
    const target = timetable({ modules: [] });
    expect(evaluateApplyCapture({ target, expiresAt: 20_000 }, timetable(), 20_001)).toEqual({ suppress: false });
  });
});
