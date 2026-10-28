import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiClient,
  fleetGatewayApi,
  type FleetActivity,
  type FleetGateStatus,
} from '@/services/api';
import { useAuthStore } from '@/stores';
import {
  classifyGatewayFailure,
  GATEWAY_REFRESH_MS,
  initialGatewayPart,
  settleGatewayFailure,
  settleGatewaySuccess,
  shouldPollGatewayPart,
  type GatewayPart,
} from '../gateway';

const isPageVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * Gateway activity and gate denials from the fleet fork's routes.
 *
 * Polls while the page is visible and connected; a route that is missing or refuses the key
 * stops being polled until `refresh` (the header refresh) asks again.
 */
export function useGatewayFleet(enabled: boolean) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const [activity, setActivity] = useState(initialGatewayPart<FleetActivity>);
  const [gate, setGate] = useState(initialGatewayPart<FleetGateStatus>);
  const [visible, setVisible] = useState(isPageVisible);
  const [refreshing, setRefreshing] = useState(false);

  /** Bumped on connection change so responses from the old session are dropped. */
  const sessionRef = useRef(0);
  const pollRef = useRef({ activity: true, gate: true });

  const load = useCallback(
    async (force: boolean) => {
      if (!enabled) return;
      const session = sessionRef.current;
      const revision = apiClient.getConnectionRevision();
      const current = () =>
        session === sessionRef.current && revision === apiClient.getConnectionRevision();

      const track = <T>(
        key: 'activity' | 'gate',
        request: () => Promise<T>,
        setPart: (update: (previous: GatewayPart<T>) => GatewayPart<T>) => void
      ) => {
        if (!force && !pollRef.current[key]) return Promise.resolve();
        return request().then(
          (data) => {
            if (!current()) return;
            pollRef.current[key] = true;
            setPart(() => settleGatewaySuccess(data));
          },
          (error: unknown) => {
            if (!current()) return;
            pollRef.current[key] = shouldPollGatewayPart(classifyGatewayFailure(error));
            setPart((previous) => settleGatewayFailure(previous, error));
          }
        );
      };

      await Promise.all([
        track('activity', fleetGatewayApi.getActivity, setActivity),
        track('gate', fleetGatewayApi.getGateStatus, setGate),
      ]);
    },
    [enabled]
  );

  // A new connection starts from scratch.
  useEffect(() => {
    sessionRef.current += 1;
    pollRef.current = { activity: true, gate: true };
    setActivity(initialGatewayPart<FleetActivity>());
    setGate(initialGatewayPart<FleetGateStatus>());
  }, [enabled, apiBase]);

  useEffect(() => {
    const onVisibilityChange = () => setVisible(isPageVisible());
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Fetch on becoming visible, then on the refresh cadence; nothing while hidden.
  useEffect(() => {
    if (!enabled || !visible) return;
    void load(false);
    const id = window.setInterval(() => void load(false), GATEWAY_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [enabled, visible, apiBase, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { activity, gate, refresh, refreshing };
}
