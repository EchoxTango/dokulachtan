// QCStatements → úroveň podpisu (SPEC § 8): QcCompliance → AdES,
// QcCompliance + QcSSCD → QES. AdES se NIKDY nesmí vydávat za QES.
import type { QesLevel } from './types';

export const QC_COMPLIANCE = '0.4.0.1862.1.1';
export const QC_SSCD = '0.4.0.1862.1.4';

export const QC_STATEMENT_NAMES: Record<string, string> = {
  [QC_COMPLIANCE]: 'QcCompliance',
  [QC_SSCD]: 'QcSSCD',
};

export function levelFromQcStatements(qcStatements: string[]): QesLevel {
  const hasCompliance = qcStatements.includes('QcCompliance');
  const hasSscd = qcStatements.includes('QcSSCD');

  if (!hasCompliance) {
    return 'none';
  }

  return hasSscd ? 'qes' : 'ades';
}

export function levelLabel(level: QesLevel): string {
  if (level === 'qes') {
    return 'QES';
  }

  if (level === 'ades') {
    return 'AdES';
  }

  return '—';
}
