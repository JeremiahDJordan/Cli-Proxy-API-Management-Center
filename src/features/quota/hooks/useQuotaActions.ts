/**
 * 单卡额度操作：刷新 + Codex 重置积分。
 * 流程 1:1 移植旧 QuotaSection（confirm modal、resetting 再入守卫、
 * generation-guarded commit、成功/失败通知），仅把 config 换成 adapter。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { maskQuotaIdentity } from '../ledger';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import { getQuotaMap, getQuotaSetter, type QuotaAdapter, type QuotaCardState } from '../providers';

const getQuotaState = (adapter: QuotaAdapter, file: AuthFileItem): QuotaCardState | undefined =>
  getQuotaMap(adapter)[getQuotaCacheKey(file)];

/**
 * `displayName` formats file names for notifications and confirmations only; API calls
 * and cache keys always use the raw name. Completion notifications read the latest
 * formatter, so hiding emails while a request is in flight still hides them; requests
 * that finish after the page unmounts (it remounts with emails hidden) show masked names.
 */
export function useQuotaActions(disableControls: boolean, displayName: (name: string) => string) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);
  const displayNameRef = useRef(displayName);
  useEffect(() => {
    displayNameRef.current = displayName;
    return () => {
      displayNameRef.current = maskQuotaIdentity;
    };
  }, [displayName]);

  const refreshQuota = useCallback(
    async (file: AuthFileItem, adapter: QuotaAdapter) => {
      if (disableControls || file.disabled) return;
      const cacheKey = getQuotaCacheKey(file);
      if (resettingQuotaName === cacheKey) return;
      if (getQuotaState(adapter, file)?.status === 'loading') return;
      const cacheGeneration = captureQuotaCacheGeneration(file.name);
      const setQuota = getQuotaSetter(adapter);

      setQuota((prev) => ({
        ...prev,
        [cacheKey]: adapter.buildLoadingState(),
      }));

      try {
        const data = await adapter.fetchQuota(file, t);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          const successState = adapter.buildSuccessState(data);
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: successState,
          }));
          void enrichQuotaInBackground(adapter, file, data, successState, t);
          showNotification(
            t('auth_files.quota_refresh_success', { name: displayNameRef.current(file.name) }),
            'success'
          );
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: adapter.buildErrorState(message, status),
          }));
          showNotification(
            t('auth_files.quota_refresh_failed', {
              name: displayNameRef.current(file.name),
              message,
            }),
            'error'
          );
        });
      }
    },
    [disableControls, resettingQuotaName, showNotification, t]
  );

  const resetQuota = useCallback(
    (file: AuthFileItem, adapter: QuotaAdapter) => {
      const resetQuotaFn = adapter.resetQuota;
      if (!resetQuotaFn) return;
      if (disableControls || file.disabled) return;
      const cacheKey = getQuotaCacheKey(file);
      if (getQuotaState(adapter, file)?.status === 'loading') return;
      if (resettingQuotaName === cacheKey) return;

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', {
          name: displayNameRef.current(file.name),
        }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          const cacheGeneration = captureQuotaCacheGeneration(file.name);
          const setQuota = getQuotaSetter(adapter);
          setResettingQuotaName(cacheKey);
          try {
            const data = await resetQuotaFn(file, t);
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => ({
                ...prev,
                [cacheKey]: adapter.buildSuccessState(data),
              }));
              showNotification(
                t('codex_quota.reset_success', { name: displayNameRef.current(file.name) }),
                'success'
              );
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              showNotification(
                t('codex_quota.reset_failed', { name: displayNameRef.current(file.name), message }),
                'error'
              );
            });
          } finally {
            setResettingQuotaName((current) => (current === cacheKey ? null : current));
          }
        },
      });
    },
    [disableControls, resettingQuotaName, showConfirmation, showNotification, t]
  );

  return { resettingQuotaName, refreshQuota, resetQuota };
}
