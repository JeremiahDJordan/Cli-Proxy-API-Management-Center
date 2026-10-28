import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import type { FleetActivity, FleetGateStatus } from '@/services/api';
import {
  buildGatewayDenialRows,
  gatewayActivityLevel,
  sumGatewayDenials,
  type GatewayPart,
} from '../gateway';
import dashboardStyles from '../dashboard.module.scss';
import styles from './GatewayPanels.module.scss';

const DASH = '—';

interface GatewayPanelsProps {
  connected: boolean;
  activity: GatewayPart<FleetActivity>;
  gate: GatewayPart<FleetGateStatus>;
  refreshing: boolean;
  onRefresh: () => void;
}

/** Muted line for a route that is missing, refused or failing. */
function PartNote({ part }: { part: GatewayPart<unknown> }) {
  const { t } = useTranslation();
  if (part.state === 'unsupported') {
    return <p className={dashboardStyles.emptyNote}>{t('dashboard.gateway_unsupported')}</p>;
  }
  if (part.state === 'unauthorized') {
    return <p className={dashboardStyles.emptyNote}>{t('dashboard.gateway_unauthorized')}</p>;
  }
  if (part.state === 'error') {
    return (
      <p className={part.data ? styles.staleNote : dashboardStyles.emptyNote} role="status">
        {part.data
          ? t('dashboard.gateway_stale', { error: part.error })
          : t('dashboard.gateway_error', { error: part.error })}
      </p>
    );
  }
  return null;
}

const orDash = (value: string): ReactNode => value || DASH;

export function GatewayPanels({
  connected,
  activity,
  gate,
  refreshing,
  onRefresh,
}: GatewayPanelsProps) {
  const { t, i18n } = useTranslation();

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [i18n.language]
  );

  const rows = useMemo(
    () => buildGatewayDenialRows(gate.data?.recentDenials ?? [], (ms) => timeFormatter.format(ms)),
    [gate.data, timeFormatter]
  );

  if (activity.state === 'unsupported' && gate.state === 'unsupported') {
    return (
      <div className={dashboardStyles.panel}>
        <p className={dashboardStyles.emptyNote}>{t('dashboard.gateway_unsupported_all')}</p>
      </div>
    );
  }

  const live = activity.data;
  const level = live ? gatewayActivityLevel(live) : null;
  const status = gate.data;
  const denialTotal = status ? sumGatewayDenials(status.denialTotals) : 0;

  const activityRows = live
    ? [
        { label: t('dashboard.gateway_requests'), value: live.requests },
        { label: t('dashboard.gateway_turns'), value: live.websocketTurns },
        { label: t('dashboard.gateway_websockets'), value: live.websockets },
        ...(live.steeringWebsockets > 0
          ? [{ label: t('dashboard.gateway_steering'), value: live.steeringWebsockets }]
          : []),
      ]
    : [];

  const selectionLabel = (selection: string) => {
    if (selection === 'before') return t('dashboard.gateway_selection_before');
    if (selection === 'after') return t('dashboard.gateway_selection_after');
    return DASH;
  };

  return (
    <>
      <div className={dashboardStyles.detailGrid}>
        <div className={dashboardStyles.panel}>
          <header className={styles.panelHeadRow}>
            <div className={dashboardStyles.panelHead}>
              <span className={dashboardStyles.eyebrow}>
                {t('dashboard.gateway_activity_eyebrow')}
              </span>
              <h3 className={dashboardStyles.panelTitle}>
                {t('dashboard.gateway_activity_title')}
              </h3>
            </div>
            {level && (
              <span className={`${styles.levelBadge} ${styles[`level_${level}`]}`}>
                {level !== 'quiet' && <i className={styles.levelDot} aria-hidden="true" />}
                {t(`dashboard.gateway_level_${level}`)}
              </span>
            )}
          </header>
          {live ? (
            <dl className={dashboardStyles.specList}>
              {activityRows.map((row) => (
                <div key={row.label} className={dashboardStyles.specRow}>
                  <dt className={dashboardStyles.specLabel}>{row.label}</dt>
                  <dd className={`${dashboardStyles.specValue} ${dashboardStyles.specMono}`}>
                    {row.value.toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>
          ) : activity.state === 'loading' ? (
            <p className={dashboardStyles.emptyNote}>{connected ? t('common.loading') : DASH}</p>
          ) : null}
          <PartNote part={activity} />
        </div>

        <div className={dashboardStyles.panel}>
          <header className={styles.panelHeadRow}>
            <div className={dashboardStyles.panelHead}>
              <span className={dashboardStyles.eyebrow}>
                {t('dashboard.gateway_totals_eyebrow')}
              </span>
              <h3 className={dashboardStyles.panelTitle}>{t('dashboard.gateway_totals_title')}</h3>
            </div>
            {status && (
              <strong className={styles.totalFigure}>{denialTotal.toLocaleString()}</strong>
            )}
          </header>
          {status ? (
            <>
              {status.denialTotals.length === 0 ? (
                <p className={dashboardStyles.emptyNote}>{t('dashboard.gateway_totals_empty')}</p>
              ) : (
                <ul className={dashboardStyles.typeList}>
                  {status.denialTotals.map((entry) => (
                    <li key={entry.code} className={`${dashboardStyles.typeChip} ${styles.code}`}>
                      {entry.code}
                      <b>{entry.count.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.metaLine}>
                {[
                  status.gateEnabled
                    ? t('dashboard.gateway_gate_on')
                    : t('dashboard.gateway_gate_off'),
                  status.pluginVersion
                    ? t('dashboard.gateway_plugin_version', { version: status.pluginVersion })
                    : '',
                  t('dashboard.gateway_totals_since_start'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </>
          ) : gate.state === 'loading' ? (
            <p className={dashboardStyles.emptyNote}>{connected ? t('common.loading') : DASH}</p>
          ) : null}
          <PartNote part={gate} />
        </div>
      </div>

      {gate.state !== 'unsupported' && gate.state !== 'unauthorized' && (
        <div className={dashboardStyles.panel}>
          <header className={styles.panelHeadRow}>
            <div className={dashboardStyles.panelHead}>
              <span className={dashboardStyles.eyebrow}>
                {t('dashboard.gateway_recent_eyebrow')}
              </span>
              <h3 className={dashboardStyles.panelTitle}>{t('dashboard.gateway_recent_title')}</h3>
              <p className={styles.panelDescription}>{t('dashboard.gateway_recent_description')}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              loading={refreshing}
              disabled={!connected}
            >
              {t('common.refresh')}
            </Button>
          </header>
          {!status ? null : !status.recentDenialsReported ? (
            <p className={dashboardStyles.emptyNote}>{t('dashboard.gateway_recent_unsupported')}</p>
          ) : rows.length === 0 ? (
            <p className={dashboardStyles.emptyNote}>{t('dashboard.gateway_recent_empty')}</p>
          ) : (
            <Table className={styles.denialTable} aria-label={t('dashboard.gateway_recent_title')}>
              <TableHeader>
                <tr>
                  <TableHead>{t('dashboard.gateway_col_time')}</TableHead>
                  <TableHead>{t('dashboard.gateway_col_code')}</TableHead>
                  <TableHead>{t('dashboard.gateway_col_failed')}</TableHead>
                  <TableHead>{t('dashboard.gateway_col_target')}</TableHead>
                  <TableHead>{t('dashboard.gateway_col_client')}</TableHead>
                  <TableHead>{t('dashboard.gateway_col_route')}</TableHead>
                  <TableHead>{t('dashboard.gateway_col_request')}</TableHead>
                  <TableHead>{t('dashboard.gateway_col_selection')}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className={styles.nowrap}>{orDash(row.time)}</TableCell>
                    <TableCell className={styles.code}>{row.code}</TableCell>
                    <TableCell>
                      {row.failed.length === 0 ? (
                        DASH
                      ) : (
                        <ul className={styles.failedList}>
                          {row.failed.map((check) => (
                            <li key={check}>{check}</li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell>
                      {orDash(row.target)}
                      {row.format && <span className={styles.detail}>{row.format}</span>}
                    </TableCell>
                    <TableCell className={styles.client}>
                      <span className={styles.userAgent} title={row.userAgent || undefined}>
                        {orDash(row.userAgent)}
                      </span>
                      {row.originator && (
                        <span className={styles.detail}>
                          {t('dashboard.gateway_originator', { value: row.originator })}
                        </span>
                      )}
                      {row.entrypoint && (
                        <span className={styles.detail}>
                          {t('dashboard.gateway_entrypoint', { value: row.entrypoint })}
                        </span>
                      )}
                      {row.keyName && (
                        <span className={styles.detail}>
                          {t('dashboard.gateway_key_name', { value: row.keyName })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={styles.code}>{orDash(row.route)}</TableCell>
                    <TableCell className={styles.code}>{orDash(row.traceId)}</TableCell>
                    <TableCell className={styles.nowrap}>{selectionLabel(row.selection)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </>
  );
}
