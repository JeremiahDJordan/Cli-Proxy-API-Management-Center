import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

/** Hide identities in visible text, tooltips and the timeline until explicitly revealed. */
export function maskQuotaIdentity(name: string): string {
  const extension = name.endsWith('.json') ? '.json' : '';
  const value = extension ? name.slice(0, -extension.length) : name;
  return (
    value.replace(
      /([a-z0-9._%+-]+)@([a-z0-9.-]+)\.([a-z]{2,})/gi,
      (_match, user: string, domain: string, suffix: string) => {
        const parts = user.match(/^(claude|codex|antigravity|kimi|xai|devin|meta)-(.+)$/i);
        const label = parts ? `${parts[1]}-${parts[2].slice(0, 1)}` : user.slice(0, 1);
        return `${label}•••@${domain.slice(0, 1)}•••.${suffix}`;
      }
    ) + extension
  );
}

export interface ProviderSummary {
  type: QuotaProviderType;
  count: number;
  loaded: number;
  remaining: number | null;
  capacity: number;
  resetAtMs: number | null;
  segments: (number | null)[];
  labelKey: string | null;
  label: string | null;
}

/** Never treat unloaded, stale or missing quota as 100% available. */
export function summarizeProvider(
  type: QuotaProviderType,
  entries: QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined
): ProviderSummary {
  const matching = entries.filter((entry) => entry.type === type);
  const eligible = matching.map((entry) => {
    const state = quotaFor(entry);
    if (
      !state ||
      state.status !== 'success' ||
      entry.file.disabled ||
      (type !== 'claude' && type !== 'codex')
    )
      return null;
    const quota = state as ClaudeQuotaState | CodexQuotaState;
    return 'stale' in quota && quota.stale ? null : quota;
  });
  const weekly = eligible.flatMap(
    (quota) =>
      quota?.windows.filter(
        (window) =>
          window.periodHours === 168 || window.id === 'weekly' || window.id === 'seven-day'
      ) ?? []
  );
  const selectedId = (weekly.find((window) => /fable|opus|sonnet/.test(window.id)) ?? weekly[0])
    ?.id;
  let resetAtMs: number | null = null;
  let labelKey: string | null = null;
  let label: string | null = null;
  const segments = eligible.map((quota) => {
    const window = quota?.windows.find((item) => item.id === selectedId);
    if (!window || window.usedPercent === null || !Number.isFinite(window.usedPercent)) return null;
    labelKey ??= window.labelKey ?? null;
    label ??= window.label;
    if (window.resetAtMs != null && (resetAtMs === null || window.resetAtMs < resetAtMs)) {
      resetAtMs = window.resetAtMs;
    }
    return Math.max(0, Math.min(100, 100 - window.usedPercent));
  });
  const known = segments.filter((value): value is number => value !== null);
  return {
    type,
    count: matching.length,
    loaded: known.length,
    remaining: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    capacity: matching.length * 100,
    resetAtMs,
    segments,
    labelKey,
    label,
  };
}
