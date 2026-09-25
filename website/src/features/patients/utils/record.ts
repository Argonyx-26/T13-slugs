import { format, parseISO } from 'date-fns';
import type {
  AllergyState,
  EvidenceSource,
  Fact,
  Likelihood,
  News2,
  PatientCard,
  RiskItem,
  RiskLevel,
  TriageAssessment,
  TriageLevel,
  Vitals
} from '../api/types';

/** Same patterns the backend uses (rag/context.py), so both sides agree on what "no allergies" looks like. */
export const NO_ALLERGY =
  /\b(no known|nkda|nka\b|none known|no drug allerg|no allerg|denies (any )?(drug )?allerg)/i;

/** An entry that is only "unknown" / "none mentioned" says nothing either way: it is left out. */
export const UNKNOWN_ALLERGY =
  /^\W*(unknown|not (asked|assessed|discussed|mentioned|recorded|stated)|none (mentioned|reported|discussed|stated)|n\/?a)\W*$/i;

/** True only if every part says "no allergies": 'Penicillin (rash); no known food allergies' is a real allergy. */
export function saysNoAllergy(text: string): boolean {
  const parts = text.split(/[;\n]/).filter((p) => p.trim());
  return parts.length > 0 && parts.every((p) => NO_ALLERGY.test(p));
}

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
  const known = allergies.filter((a) => !UNKNOWN_ALLERGY.test(a.value));
  const none = known.filter((a) => saysNoAllergy(a.value));
  const real = known.filter((a) => !saysNoAllergy(a.value));
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

/** Same order as the backend's triage_queue(): critical, high, medium, then everyone else. */
export const TRIAGE_ORDER: Record<TriageLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

/** The card's triage line: the top finding, or that the vital signs were normal. */
export function triageSummary(a: TriageAssessment | null): PatientCard['triage'] {
  if (!a) return null;
  return {
    level: a.level,
    label: a.findings[0]?.title ?? 'Vital signs normal',
    news2: a.news2?.score ?? null,
    urgency: a.urgency
  };
}

const CONSCIOUSNESS: Record<NonNullable<Vitals['consciousness']>, string> = {
  alert: 'Alert',
  new_confusion: 'New confusion',
  voice: 'Responds to voice',
  pain: 'Responds to pain',
  unresponsive: 'Unresponsive'
};

export interface VitalReading {
  key: string;
  label: string;
  value: string;
  /** NEWS2 points for this sign (0-3), when it is part of NEWS2 */
  points: number | null;
}

/** The measured vital signs in display order, each with its NEWS2 points. Unmeasured ones are left out. */
export function vitalReadings(v: Vitals, news2: News2 | null): VitalReading[] {
  const pts = (k: string) => news2?.points[k] ?? null;
  const rows: (VitalReading | null)[] = [
    v.systolic_bp != null
      ? {
          key: 'systolic_bp',
          label: 'Blood pressure',
          value: `${v.systolic_bp}/${v.diastolic_bp ?? '?'} mmHg`,
          points: pts('systolic_bp')
        }
      : null,
    v.heart_rate != null
      ? {
          key: 'heart_rate',
          label: 'Pulse',
          value: `${v.heart_rate}/min`,
          points: pts('heart_rate')
        }
      : null,
    v.resp_rate != null
      ? {
          key: 'resp_rate',
          label: 'Breathing',
          value: `${v.resp_rate}/min`,
          points: pts('resp_rate')
        }
      : null,
    v.spo2 != null
      ? {
          key: 'spo2',
          label: 'Oxygen',
          value: `${v.spo2}%${v.on_oxygen ? ' on O₂' : ''}`,
          points: pts('spo2')
        }
      : null,
    v.temperature_c != null
      ? {
          key: 'temperature',
          label: 'Temperature',
          value: `${v.temperature_c} °C`,
          points: pts('temperature')
        }
      : null,
    v.consciousness
      ? {
          key: 'consciousness',
          label: 'Consciousness',
          value: CONSCIOUSNESS[v.consciousness],
          points: pts('consciousness')
        }
      : null,
    v.blood_glucose != null
      ? {
          key: 'blood_glucose',
          label: 'Blood sugar',
          value: `${v.blood_glucose} mg/dL`,
          points: null
        }
      : null,
    v.weight_kg != null
      ? { key: 'weight_kg', label: 'Weight', value: `${v.weight_kg} kg`, points: null }
      : null
  ];
  return rows.filter((r): r is VitalReading => r !== null);
}

const seenRank = (p: PatientCard) => (p.visitStatus === 'seen' ? 1 : 0);
const triageRank = (p: PatientCard) => (p.triage ? TRIAGE_ORDER[p.triage.level] : TRIAGE_ORDER.low);

/**
 * Today's order, as the clinic should see patients: waiting before seen, then urgency now
 * (triage; not yet triaged ranks with low, never below it), then predicted risk, then token.
 */
export function compareQueue(a: PatientCard, b: PatientCard): number {
  return (
    seenRank(a) - seenRank(b) ||
    triageRank(a) - triageRank(b) ||
    RISK_ORDER[a.risk.level] - RISK_ORDER[b.risk.level] ||
    (a.token ?? 999) - (b.token ?? 999)
  );
}

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
