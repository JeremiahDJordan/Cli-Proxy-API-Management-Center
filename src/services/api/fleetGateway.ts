/**
 * Fleet gateway routes (our CLIProxyAPI fork).
 *
 * Both routes are backend-declared paths under /v0/management, not v8 fallbacks: the fork
 * registers `fleet/activity` itself and the fleet plugin declares `fleet/status` through the
 * plugin host, whose management base is /v0/management. Both use management authentication.
 *
 * Only the fields the dashboard shows are kept. The status also lists accounts, scheduler
 * picks (auth IDs, session hashes) and configured key names; none of that leaves this module.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export const FLEET_ACTIVITY_PATH = '/v0/management/fleet/activity';
export const FLEET_STATUS_PATH = '/v0/management/fleet/status';

export interface FleetActivity {
  /** HTTP requests being served, excluding the activity route itself. */
  requests: number;
  /** Open Responses WebSocket connections. */
  websockets: number;
  /** Responses WebSocket requests read and not yet answered. */
  websocketTurns: number;
  /** WebSockets opened with Codex response steering; busy for their whole life. */
  steeringWebsockets: number;
  draining: boolean;
  quiet: boolean;
}

export type FleetDenialSelection = 'before' | 'after' | '';

export interface FleetClientChecks {
  userAgent: string;
  originator: string;
  entrypoint: string;
}

export interface FleetGateDenial {
  /** Milliseconds since the epoch, or null when the backend time is unreadable. */
  at: number | null;
  code: string;
  traceId: string;
  /** The fleet client key's configured name (a label; digests are never reported). */
  keyName: string;
  provider: string;
  model: string;
  format: string;
  route: string;
  failed: string[];
  selection: FleetDenialSelection;
  checks: FleetClientChecks | null;
}

export interface FleetDenialTotal {
  code: string;
  count: number;
}

export interface FleetGateStatus {
  pluginVersion: string;
  gateEnabled: boolean;
  /** Per code, largest first. */
  denialTotals: FleetDenialTotal[];
  /** False for plugin versions before fleet.5, which report totals only. */
  recentDenialsReported: boolean;
  /** Newest first. */
  recentDenials: FleetGateDenial[];
}

/** A response that is not the route's JSON, e.g. an HTML page from a proxy in front. */
export class FleetRouteUnavailableError extends Error {
  constructor(path: string) {
    super(`${path} did not return gateway JSON`);
    this.name = 'FleetRouteUnavailableError';
  }
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

export const normalizeFleetActivity = (raw: unknown): FleetActivity => {
  const data = isRecord(raw) ? raw : {};
  const activity = {
    requests: asCount(data.requests),
    websockets: asCount(data.websockets),
    websocketTurns: asCount(data.websocket_turns),
    steeringWebsockets: asCount(data.steering_websockets),
    draining: data.draining === true,
  };
  const quiet =
    typeof data.quiet === 'boolean'
      ? data.quiet
      : activity.requests === 0 && activity.websocketTurns === 0;
  return { ...activity, quiet };
};

const normalizeSelection = (value: unknown): FleetDenialSelection => {
  const text = asText(value).toLowerCase();
  if (text.startsWith('before')) return 'before';
  if (text.startsWith('after')) return 'after';
  return '';
};

const normalizeChecks = (value: unknown): FleetClientChecks | null => {
  if (!isRecord(value)) return null;
  return {
    userAgent: asText(value.user_agent),
    originator: asText(value.originator),
    entrypoint: asText(value.entrypoint),
  };
};

const parseInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  // Go's zero time marshals as year 1; treat it as unknown.
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

export const normalizeFleetDenial = (value: unknown): FleetGateDenial | null => {
  if (!isRecord(value)) return null;
  const code = asText(value.code);
  if (!code) return null;
  return {
    at: parseInstant(value.at),
    code,
    traceId: asText(value.trace_id),
    keyName: asText(value.key),
    provider: asText(value.provider),
    model: asText(value.model),
    format: asText(value.format),
    route: asText(value.route),
    failed: Array.isArray(value.failed) ? value.failed.map(asText).filter(Boolean) : [],
    selection: normalizeSelection(value.classified),
    checks: normalizeChecks(value.checks),
  };
};

export const normalizeFleetGateStatus = (raw: unknown): FleetGateStatus => {
  const data = isRecord(raw) ? raw : {};
  const settings = isRecord(data.settings) ? data.settings : {};
  const totals = isRecord(data.gate_denials) ? data.gate_denials : {};
  const denialTotals = Object.entries(totals)
    .map(([code, count]) => ({ code: code.trim(), count: asCount(count) }))
    .filter((entry) => entry.code && entry.count > 0)
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  // The plugin appends denials in order; sort by time and keep that order for ties.
  const recentDenials = (Array.isArray(data.recent_denials) ? data.recent_denials : [])
    .map(normalizeFleetDenial)
    .map((denial, index) => ({ denial, index }))
    .filter((entry): entry is { denial: FleetGateDenial; index: number } => entry.denial !== null)
    .sort((a, b) => (b.denial.at ?? 0) - (a.denial.at ?? 0) || b.index - a.index)
    .map((entry) => entry.denial);
  return {
    pluginVersion: asText(data.version),
    gateEnabled: settings.gate === true,
    denialTotals,
    // Go marshals an empty list as null, so presence of the key is what marks support.
    recentDenialsReported: 'recent_denials' in data,
    recentDenials,
  };
};

export const fleetGatewayApi = {
  async getActivity(): Promise<FleetActivity> {
    const data = await apiClient.get<unknown>(apiClient.backendUrl(FLEET_ACTIVITY_PATH));
    if (!isRecord(data) || typeof data.requests !== 'number') {
      throw new FleetRouteUnavailableError(FLEET_ACTIVITY_PATH);
    }
    return normalizeFleetActivity(data);
  },

  async getGateStatus(): Promise<FleetGateStatus> {
    const data = await apiClient.get<unknown>(apiClient.backendUrl(FLEET_STATUS_PATH));
    if (!isRecord(data) || !('gate_denials' in data)) {
      throw new FleetRouteUnavailableError(FLEET_STATUS_PATH);
    }
    return normalizeFleetGateStatus(data);
  },
};
