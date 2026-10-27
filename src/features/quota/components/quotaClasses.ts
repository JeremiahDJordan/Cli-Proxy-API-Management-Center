import { bindQuotaClasses } from '../types';
import bodyStyles from './QuotaBody.module.scss';

/** Bind the quota-page styles to the shared rendering contract. */
export const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');
