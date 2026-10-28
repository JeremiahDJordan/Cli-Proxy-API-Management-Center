import {
  FleetRouteUnavailableError,
  type FleetActivity,
  type FleetDenialSelection,
  type FleetGateDenial,
} from '@/services/api/fleetGateway';
import { getErrorMessage, isRecord } from '@/utils/helpers';

/** Activity and denials refresh on this cadence while the dashboard is visible. */
export const GATEWAY_REFRESH_MS = 15_000;

export type GatewayFailure = 'unsupported' | 'unauthorized' | 'error';
export type GatewayPartState = 'loading' | 'ready' | GatewayFailure;

/** One gateway route's last result. */
export interface GatewayPart<T> {
  state: GatewayPartState;
  /** Last good data; kept through transient errors, dropped when the route is gone. */
  data: T | null;
  error: string;
}

export const initialGatewayPart = <T>(): GatewayPart<T> => ({
  state: 'loading',
  data: null,
  error: '',
});

const statusOf = (error: unknown): number | undefined =>
  isRecord(error) && typeof error.status === 'number' ? error.status : undefined;

/** Older gateways answer 404 (no route) or 501; a 401/403 means the key was refused. */
export const classifyGatewayFailure = (error: unknown): GatewayFailure => {
  if (error instanceof FleetRouteUnavailableError) return 'unsupported';
  const status = statusOf(error);
  if (status === 404 || status === 405 || status === 501) return 'unsupported';
  if (status === 401 || status === 403) return 'unauthorized';
  return 'error';
};

export const settleGatewaySuccess = <T>(data: T): GatewayPart<T> => ({
  state: 'ready',
  data,
  error: '',
});

export const settleGatewayFailure = <T>(
  previous: GatewayPart<T>,
  error: unknown
): GatewayPart<T> => {
  const state = classifyGatewayFailure(error);
  return {
    state,
    data: state === 'error' ? previous.data : null,
    error: state === 'error' ? getErrorMessage(error) : '',
  };
};

/** Unsupported or refused routes are not polled again until a manual refresh. */
export const shouldPollGatewayPart = (state: GatewayPartState): boolean =>
  state !== 'unsupported' && state !== 'unauthorized';

export type GatewayActivityLevel = 'quiet' | 'busy' | 'draining';

export const gatewayActivityLevel = (activity: FleetActivity): GatewayActivityLevel => {
  if (activity.draining) return 'draining';
  return activity.quiet ? 'quiet' : 'busy';
};

/** One recent-denial table row; empty strings render as a dash. */
export interface GatewayDenialRow {
  key: string;
  time: string;
  code: string;
  failed: string[];
  /** `provider · model`, whichever are known. */
  target: string;
  format: string;
  userAgent: string;
  originator: string;
  entrypoint: string;
  /** The client key's configured name, never its digest. */
  keyName: string;
  route: string;
  traceId: string;
  selection: FleetDenialSelection;
}

export const buildGatewayDenialRows = (
  denials: FleetGateDenial[],
  formatTime: (ms: number) => string
): GatewayDenialRow[] =>
  denials.map((denial, index) => ({
    key: `${denial.at ?? 'unknown'}-${denial.traceId || denial.code}-${index}`,
    time: denial.at === null ? '' : formatTime(denial.at),
    code: denial.code,
    failed: denial.failed,
    target: [denial.provider, denial.model].filter(Boolean).join(' · '),
    format: denial.format,
    userAgent: denial.checks?.userAgent ?? '',
    originator: denial.checks?.originator ?? '',
    entrypoint: denial.checks?.entrypoint ?? '',
    keyName: denial.keyName,
    route: denial.route,
    traceId: denial.traceId,
    selection: denial.selection,
  }));

export const sumGatewayDenials = (totals: Array<{ count: number }>): number =>
  totals.reduce((sum, entry) => sum + entry.count, 0);
