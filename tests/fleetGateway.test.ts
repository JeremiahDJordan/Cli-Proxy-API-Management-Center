import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { AxiosAdapter } from 'axios';
import { apiClient } from '@/services/api/client';
import {
  FLEET_ACTIVITY_PATH,
  FLEET_STATUS_PATH,
  FleetRouteUnavailableError,
  fleetGatewayApi,
  normalizeFleetActivity,
  normalizeFleetGateStatus,
} from '@/services/api/fleetGateway';
import {
  buildGatewayDenialRows,
  classifyGatewayFailure,
  gatewayActivityLevel,
  initialGatewayPart,
  settleGatewayFailure,
  settleGatewaySuccess,
  shouldPollGatewayPart,
  sumGatewayDenials,
} from '@/features/dashboard/gateway';

afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

/** Shaped like the fleet.5 plugin's `Status` JSON (internal/fleet/plugin.go). */
const fleetStatus = {
  generated_at: '2026-10-28T15:00:05.123456789Z',
  version: '1.0.0',
  settings: {
    key_names: ['macbook', 'homelab'],
    exclusive: true,
    gate: true,
    scheduler: true,
    claude_cache_ttl: '5m0s',
    claude_extended_cache_ttl: '1h0m0s',
    codex_idle_ttl: '30m0s',
  },
  accounts: [{ auth_id: 'claude-account-fixture.json', provider: 'claude', views: {} }],
  session_bindings: 3,
  gate_denials: { fleet_route_denied: 1, fleet_unconfirmed_client: 4 },
  recent_denials: [
    {
      at: '2026-10-28T14:59:00Z',
      code: 'fleet_route_denied',
      key: 'macbook',
      route: 'POST /v1/chat/completions',
    },
    {
      at: '2026-10-28T15:00:01.5Z',
      code: 'fleet_unconfirmed_client',
      trace_id: 'a1b2c3d4',
      key: 'homelab',
      provider: 'claude',
      model: 'claude-opus-5-5',
      format: 'claude',
      failed: ['x-app: cli', 'metadata.user_id (no request body to inspect)'],
      classified: 'after selection',
      checks: {
        user_agent: 'curl/8.7.1',
        originator: '',
        entrypoint: 'sdk-ts',
        body_inspected: false,
        native_entrypoint: false,
        x_app_cli: false,
        claude_cli_user_agent: false,
        claude_code_beta: false,
        metadata_user_id: false,
        codex_user_agent: false,
        official_originator: false,
      },
    },
    {
      at: '2026-10-28T15:00:01.5Z',
      code: 'fleet_unconfirmed_client',
      trace_id: 'e5f6a7b8',
      provider: 'codex',
      model: 'gpt-5.5',
      failed: ['official Originator (got none)'],
      classified: 'before selection',
      checks: { user_agent: 'codex_cli_rs/0.9', body_inspected: true },
    },
  ],
  recent_picks: [
    {
      at: '2026-10-28T15:00:00Z',
      provider: 'claude',
      model: 'claude-opus-5-5',
      session_hash: '0123456789ab',
      auth_id: 'claude-account-fixture.json',
      reason: 'affinity',
      candidates: 2,
    },
  ],
};

describe('fleet gateway transport', () => {
  test('requests the backend-declared v0 paths beside the v8 prefix with the management key', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.invalid/gateway/v8/management',
      managementKey: 'fixture-only',
    });
    const seen: string[] = [];
    const adapter: AxiosAdapter = async (config) => {
      // An absolute request URL overrides the client's v8 baseURL.
      seen.push(String(config.url));
      expect(config.headers.Authorization).toBe('Bearer fixture-only');
      return {
        data: config.url?.endsWith('activity') ? { requests: 0, quiet: true } : fleetStatus,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };
    const get = spyOn(apiClient, 'get').mockImplementation((url, config) =>
      apiClient.getRaw(url, { ...config, adapter }).then((response) => response.data)
    );
    try {
      await fleetGatewayApi.getActivity();
      await fleetGatewayApi.getGateStatus();
    } finally {
      get.mockRestore();
    }
    expect(seen).toEqual([
      `https://proxy.invalid/gateway${FLEET_ACTIVITY_PATH}`,
      `https://proxy.invalid/gateway${FLEET_STATUS_PATH}`,
    ]);
  });

  test('treats a non-JSON answer (a proxy page) as an unavailable route', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue('<!doctype html><title>app</title>');
    try {
      await expect(fleetGatewayApi.getActivity()).rejects.toBeInstanceOf(
        FleetRouteUnavailableError
      );
      await expect(fleetGatewayApi.getGateStatus()).rejects.toBeInstanceOf(
        FleetRouteUnavailableError
      );
    } finally {
      get.mockRestore();
    }
  });
});

describe('fleet status normalization', () => {
  const status = normalizeFleetGateStatus(fleetStatus);

  test('keeps only gate fields: no accounts, picks, session hashes or key lists', () => {
    expect(Object.keys(status).sort()).toEqual([
      'denialTotals',
      'gateEnabled',
      'pluginVersion',
      'recentDenials',
      'recentDenialsReported',
    ]);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('claude-account-fixture.json');
    expect(serialized).not.toContain('0123456789ab');
    expect(serialized).not.toContain('key_names');
    expect(status.gateEnabled).toBe(true);
    expect(status.pluginVersion).toBe('1.0.0');
  });

  test('sorts totals by count and recent denials newest first, ties by arrival', () => {
    expect(status.denialTotals).toEqual([
      { code: 'fleet_unconfirmed_client', count: 4 },
      { code: 'fleet_route_denied', count: 1 },
    ]);
    expect(sumGatewayDenials(status.denialTotals)).toBe(5);
    expect(status.recentDenials.map((denial) => denial.traceId || denial.code)).toEqual([
      'e5f6a7b8',
      'a1b2c3d4',
      'fleet_route_denied',
    ]);
    const [, claude] = status.recentDenials;
    expect(claude).toEqual({
      at: Date.parse('2026-10-28T15:00:01.5Z'),
      code: 'fleet_unconfirmed_client',
      traceId: 'a1b2c3d4',
      keyName: 'homelab',
      provider: 'claude',
      model: 'claude-opus-5-5',
      format: 'claude',
      route: '',
      failed: ['x-app: cli', 'metadata.user_id (no request body to inspect)'],
      selection: 'after',
      checks: { userAgent: 'curl/8.7.1', originator: '', entrypoint: 'sdk-ts' },
    });
  });

  test('distinguishes an empty list (null) from a plugin that predates recent denials', () => {
    const empty = normalizeFleetGateStatus({ gate_denials: {}, recent_denials: null });
    expect(empty.recentDenialsReported).toBe(true);
    expect(empty.recentDenials).toEqual([]);
    const older = normalizeFleetGateStatus({ gate_denials: { fleet_route_denied: 2 } });
    expect(older.recentDenialsReported).toBe(false);
    expect(older.denialTotals).toEqual([{ code: 'fleet_route_denied', count: 2 }]);
  });

  test('drops malformed denials and unreadable times', () => {
    const { recentDenials } = normalizeFleetGateStatus({
      gate_denials: {},
      recent_denials: [null, { code: '' }, { at: '0001-01-01T00:00:00Z', code: 'x', failed: [1] }],
    });
    expect(recentDenials).toHaveLength(1);
    expect(recentDenials[0].at).toBeNull();
    expect(recentDenials[0].failed).toEqual([]);
    expect(recentDenials[0].checks).toBeNull();
  });
});

describe('fleet activity', () => {
  test('normalizes counters and the quiet flag', () => {
    const busy = normalizeFleetActivity({
      requests: 2,
      websockets: 3,
      websocket_turns: 1,
      steering_websockets: 0,
      draining: false,
      quiet: false,
    });
    expect(busy).toEqual({
      requests: 2,
      websockets: 3,
      websocketTurns: 1,
      steeringWebsockets: 0,
      draining: false,
      quiet: false,
    });
    expect(gatewayActivityLevel(busy)).toBe('busy');
    expect(gatewayActivityLevel({ ...busy, quiet: true })).toBe('quiet');
    expect(gatewayActivityLevel({ ...busy, draining: true })).toBe('draining');
    // Idle WebSockets alone do not make the gateway busy.
    expect(normalizeFleetActivity({ requests: 0, websockets: 4, websocket_turns: 0 }).quiet).toBe(
      true
    );
  });
});

describe('gateway route states', () => {
  const failure = (status?: number) => Object.assign(new Error('failed'), { status });

  test('maps missing routes, refused keys and other failures', () => {
    expect(classifyGatewayFailure(failure(404))).toBe('unsupported');
    expect(classifyGatewayFailure(failure(501))).toBe('unsupported');
    expect(classifyGatewayFailure(new FleetRouteUnavailableError('/x'))).toBe('unsupported');
    expect(classifyGatewayFailure(failure(401))).toBe('unauthorized');
    expect(classifyGatewayFailure(failure(403))).toBe('unauthorized');
    expect(classifyGatewayFailure(failure(500))).toBe('error');
    expect(classifyGatewayFailure(failure())).toBe('error');
    expect(shouldPollGatewayPart('unsupported')).toBe(false);
    expect(shouldPollGatewayPart('unauthorized')).toBe(false);
    expect(shouldPollGatewayPart('error')).toBe(true);
  });

  test('keeps earlier data through a transient error but not when the route is gone', () => {
    const ready = settleGatewaySuccess({ requests: 1 });
    expect(settleGatewayFailure(ready, failure(502))).toEqual({
      state: 'error',
      data: { requests: 1 },
      error: 'failed',
    });
    expect(settleGatewayFailure(ready, failure(404))).toEqual({
      state: 'unsupported',
      data: null,
      error: '',
    });
    expect(initialGatewayPart().state).toBe('loading');
  });
});

describe('recent denial rows', () => {
  test('formats time, target and client details without inventing values', () => {
    const { recentDenials } = normalizeFleetGateStatus(fleetStatus);
    const rows = buildGatewayDenialRows(recentDenials, (ms) => new Date(ms).toISOString());
    expect(rows.map((row) => row.key)).toHaveLength(new Set(rows.map((row) => row.key)).size);
    expect(rows[1]).toMatchObject({
      time: '2026-10-28T15:00:01.500Z',
      target: 'claude · claude-opus-5-5',
      userAgent: 'curl/8.7.1',
      entrypoint: 'sdk-ts',
      originator: '',
      keyName: 'homelab',
      traceId: 'a1b2c3d4',
      selection: 'after',
    });
    expect(rows[2]).toMatchObject({
      target: '',
      userAgent: '',
      route: 'POST /v1/chat/completions',
      traceId: '',
      selection: '',
      keyName: 'macbook',
    });
    expect(buildGatewayDenialRows([{ ...recentDenials[0], at: null }], () => 'x')[0].time).toBe('');
  });
});

describe('gateway locale and page contracts', () => {
  const locales = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko'];
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const dashboardOf = (lang: string) =>
    (JSON.parse(read(`src/i18n/locales/${lang}.json`)) as { dashboard: Record<string, string> })
      .dashboard;
  const placeholders = (value: string) => (value.match(/\{\{\w+\}\}/g) ?? []).sort();

  test('every gateway key exists in all six locales with the same placeholders', () => {
    const english = dashboardOf('en');
    const keys = Object.keys(english).filter((key) => key.startsWith('gateway_'));
    expect(keys.length).toBeGreaterThan(30);
    for (const lang of locales) {
      const dashboard = dashboardOf(lang);
      for (const key of keys) {
        expect(typeof dashboard[key]).toBe('string');
        expect(placeholders(dashboard[key])).toEqual(placeholders(english[key]));
      }
    }
  });

  test('the panel uses only keys that exist', () => {
    const source = read('src/features/dashboard/components/GatewayPanels.tsx');
    const english = dashboardOf('en');
    const used = new Set(
      [...source.matchAll(/'dashboard\.(gateway_[a-z_]+)'/g)].map((match) => match[1])
    );
    for (const level of ['quiet', 'busy', 'draining']) used.add(`gateway_level_${level}`);
    for (const key of used) expect(english[key]).toBeDefined();
  });

  test('polling stops while the page is hidden', () => {
    const hook = read('src/features/dashboard/hooks/useGatewayFleet.ts');
    expect(hook).toContain('visibilitychange');
    expect(hook).toMatch(/if \(!enabled \|\| !visible\) return;/);
  });
});
