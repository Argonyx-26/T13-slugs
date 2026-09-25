import { format, parseISO } from 'date-fns';
import type {
  AllergyState,
  EvidenceSource,
  Fact,
  Likelihood,
  PatientCard,
  RiskItem,
  RiskLevel
} from '../api/types';

/** Same pattern the backend uses (rag/context.py), so both sides agree on what "no allergies" looks like. */
export const NO_ALLERGY = /\b(no known|nkda|none known|no drug allerg|no allerg)/i;

export const LIKELIHOOD_ORDER: Record<Likelihood, number> = { high: 0, moderate: 1, low: 2 };

export const DISCLAIMER =
  "Possible outcomes estimated from the stored records to support the doctor's own assessment. " +
  'They are not a diagnosis, advice or a treatment recommendation.';

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  clinic_db: 'Clinic record',
  doctor_notes: "Doctor's note",
  ai_scribe: 'AI scribe note (not yet reviewed)',
  transcript: "Today's consultation",
  rule_table: 'Drug rule table',
  web: 'Published source'
};

export function sourceLabel(source: EvidenceSource): string {
  return SOURCE_LABEL[source];
}

/** '2026-09-10' -> '10 Sep 2026' */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'date not recorded';
  try {
    return format(parseISO(iso), 'd MMM yyyy');
  } catch {
    return iso;
  }
}

/** A blank allergy record stays "unknown": it never reads as "no allergies". */
export function allergyStatus(allergies: Fact[]): { state: AllergyState; label: string } {
  const none = allergies.filter((a) => NO_ALLERGY.test(a.value));
  const real = allergies.filter((a) => !NO_ALLERGY.test(a.value));
  if (real.length && none.length) return { state: 'conflict', label: 'Allergy records disagree' };
  if (real.length) return { state: 'present', label: real.map((a) => a.value).join(', ') };
  if (none.length) return { state: 'none', label: 'No known drug allergies' };
  return { state: 'unknown', label: 'Allergy status not recorded' };
}

export function sortRisks(risks: RiskItem[]): RiskItem[] {
  return risks.toSorted((a, b) => LIKELIHOOD_ORDER[a.likelihood] - LIKELIHOOD_ORDER[b.likelihood]);
}

/** The card's risk: the highest likelihood on record. Nothing on record at all is "unknown", not "low". */
export function riskSummary(risks: RiskItem[], hasRecords: boolean): PatientCard['risk'] {
  const top = sortRisks(risks)[0];
  if (top) return { level: top.likelihood, label: top.label, count: risks.length };
  if (hasRecords) return { level: 'low', label: 'No risks flagged', count: 0 };
  return { level: 'unknown', label: 'Not assessed yet', count: 0 };
}

export const RISK_ORDER: Record<RiskLevel, number> = { high: 0, moderate: 1, unknown: 2, low: 3 };

/** 'An allergic reaction is likely on further exposure to penicillin.' -> a short card label */
export function labelFromOutcome(outcome: string, max = 48): string {
  const first = outcome.split(/[.;:,]/)[0].trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
