import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// Quota actions run inside a React hook that Bun cannot render here (no DOM renderer, and
// server rendering skips effects); keep this a small source contract so hidden emails never
// reach refresh/reset notifications, including ones that complete after emails are hidden.
const hook = readFileSync(
  new URL('../src/features/quota/hooks/useQuotaActions.ts', import.meta.url),
  'utf8'
);
const page = readFileSync(new URL('../src/features/quota/QuotaPage.tsx', import.meta.url), 'utf8');

describe('quota action privacy contract', () => {
  test('notifications and confirmations use the display-name formatter', () => {
    expect(hook).not.toMatch(/name: file\.name/);
    // Completion notifications run after an await and must read the formatter current at
    // that moment; the confirmation reads the same ref.
    expect(hook).not.toMatch(/name: displayName\(/);
    expect(hook.match(/name: displayNameRef\.current\(file\.name\)/g)?.length).toBe(5);
  });

  test('the latest formatter replaces the one captured when a request started', () => {
    // Requests finishing after unmount fall back to masked names: the remounted page hides
    // emails by default, and the old hook's ref would otherwise keep a revealing formatter.
    expect(hook).toMatch(
      /useEffect\(\(\) => \{\s*displayNameRef\.current = displayName;\s*return \(\) => \{\s*displayNameRef\.current = maskQuotaIdentity;\s*\};\s*\}, \[displayName\]\)/
    );
  });

  test('the page passes its visibility-aware formatter to the actions hook', () => {
    expect(page).toMatch(/useQuotaActions\(\s*disableControls,\s*displayNameFor\s*\)/);
  });
});
