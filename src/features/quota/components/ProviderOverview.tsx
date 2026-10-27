import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import type { ProviderSummary } from '../ledger';
import { quotaClasses } from './quotaClasses';
import { QuotaMeter } from './QuotaMeter';
import styles from './ProviderOverview.module.scss';

export function ProviderOverview({
  summaries,
  resolvedTheme,
}: {
  summaries: ProviderSummary[];
  resolvedTheme: ResolvedTheme;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  return (
    <section className={styles.overview} aria-label={t('quota_management.provider_overview')}>
      {summaries.map((summary) => {
        const reset = buildResetDisplay(null, summary.resetAtMs, now, i18n.resolvedLanguage);
        const icon = getAuthFileIcon(summary.type, resolvedTheme);
        return (
          <article className={styles.provider} key={summary.type}>
            <header className={styles.heading}>
              <strong>
                {icon && <img src={icon} alt="" />}
                {getTypeLabel(t, summary.type)}
              </strong>
              <span>{t('quota_management.meta_credentials', { count: summary.count })}</span>
            </header>
            <div className={styles.label}>
              {summary.labelKey
                ? t(summary.labelKey)
                : (summary.label ?? t('quota_management.weekly_summary'))}
            </div>
            <div className={styles.total}>
              <strong>
                {summary.remaining === null ? '--' : `${Math.round(summary.remaining)}%`}
              </strong>
              <span>{t('quota_management.summary_capacity', { count: summary.capacity })}</span>
            </div>
            <div className={styles.segments} aria-hidden="true">
              {(summary.segments.length ? summary.segments : [null]).map((value, index) => (
                <QuotaMeter key={index} percent={value} classes={quotaClasses} />
              ))}
            </div>
            <p className={styles.reset}>
              {reset ? (
                <>
                  {reset.relative} · {reset.absolute}
                </>
              ) : (
                t('quota_management.summary_unavailable')
              )}
            </p>
            <p className={styles.loaded}>
              {t('quota_management.summary_loaded', {
                count: summary.loaded,
                total: summary.count,
              })}
            </p>
          </article>
        );
      })}
    </section>
  );
}
