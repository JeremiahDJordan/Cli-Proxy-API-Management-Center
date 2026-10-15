import { expect, test } from 'bun:test';
import { maskQuotaIdentity, summarizeProvider } from '@/features/quota/ledger';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { ClaudeQuotaState } from '@/types';

const entries: QuotaFileEntry[] = ['one', 'two', 'three'].map((name) => ({
  type: 'claude',
  file: { name },
}));
const quota = (usedPercent: number | null, resetAtMs = 200): ClaudeQuotaState => ({
  status: 'success',
  windows: [
    { id: 'seven-day', label: 'Weekly', periodHours: 168, usedPercent, resetAtMs, resetLabel: '' },
  ],
});

test('provider totals retain unknown gaps and the earliest actual reset', () => {
  const states = [quota(25), quota(80, 100), undefined];
  expect(
    summarizeProvider('claude', entries, (entry) => states[entries.indexOf(entry)])
  ).toMatchObject({
    remaining: 95,
    capacity: 300,
    loaded: 2,
    segments: [75, 20, null],
    resetAtMs: 100,
  });
});

test('stale, missing, disabled and nonfinite values are not available capacity', () => {
  for (const state of [undefined, quota(null), quota(NaN), { ...quota(0), stale: true }]) {
    expect(summarizeProvider('claude', entries, () => state).remaining).toBeNull();
  }
  expect(
    summarizeProvider(
      'claude',
      [{ type: 'claude', file: { name: 'disabled', disabled: true } }],
      () => quota(0)
    ).remaining
  ).toBeNull();
});

test('different model buckets are never summed as the same quota', () => {
  const scoped = quota(10);
  scoped.windows[0].id = 'seven-day-fable';
  const states = [scoped, quota(10), undefined];
  expect(
    summarizeProvider('claude', entries, (entry) => states[entries.indexOf(entry)])
  ).toMatchObject({ remaining: 90, loaded: 1, segments: [90, null, null] });
});

test('email masking removes full identities from filenames and labels', () => {
  expect(maskQuotaIdentity('claude-person@example.com.json')).not.toContain('person@example.com');
  expect(maskQuotaIdentity('claude-person@example.com.json')).toBe('claude-p•••@e•••.com.json');
  expect(maskQuotaIdentity('person@example.com')).toBe('p•••@e•••.com');
  expect(maskQuotaIdentity('work-account.json')).toBe('work-account.json');
});
