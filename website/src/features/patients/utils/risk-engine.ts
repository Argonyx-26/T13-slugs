// ============================================================
// Triage rules: vital signs + complaint + history -> a risk level with reasons
// ============================================================
// A line-for-line port of the backend's risk engine (backend/rag/risk.py on the
// sanjana-rag branch), so demo mode triages a desk check-in exactly as the backend
// would. red_flags.json is the backend's file, copied unchanged. When the rules
// change there, change them here too. Fixed rules only; demo coverage for a
// hackathon, not a validated clinical tool.
// ============================================================

import type { News2, TriageAssessment, TriageFinding, TriageLevel, Vitals } from '../api/types';
import redFlags from '../data/red_flags.json';

const LEVELS: TriageLevel[] = ['low', 'medium', 'high', 'critical'];
const rank = (l: TriageLevel) => LEVELS.indexOf(l);

export const URGENCY: Record<TriageLevel, string> = {
  critical:
    'Emergency: the doctor sees the patient now. Be ready to transfer to a hospital emergency department.',
  high: 'Urgent: the patient goes to the front of the queue.',
  medium: 'Priority: see soon, and recheck vital signs every 30 minutes while waiting.',
  low: 'Routine: normal queue order.'
};

export const TRIAGE_DISCLAIMER =
  'Rule-based decision support for prioritising patients. It flags risk and cites its reasons; ' +
  'it does not diagnose, and the doctor makes every clinical decision.';

/** A history record the rules can cite */
export interface HistoryItem {
  text: string;
  /** ISO date or timestamp */
  recorded_at: string;
}

type Finding = TriageFinding;

// ---------- 1. NEWS2 ----------
// (upper bound inclusive, points), checked in order
const BANDS: Record<string, [number, number][]> = {
  resp_rate: [
    [8, 3],
    [11, 1],
    [20, 0],
    [24, 2],
    [Infinity, 3]
  ],
  spo2: [
    [91, 3],
    [93, 2],
    [95, 1],
    [Infinity, 0]
  ],
  systolic_bp: [
    [90, 3],
    [100, 2],
    [110, 1],
    [219, 0],
    [Infinity, 3]
  ],
  heart_rate: [
    [40, 3],
    [50, 1],
    [90, 0],
    [110, 1],
    [130, 2],
    [Infinity, 3]
  ],
  temperature: [
    [35.0, 3],
    [36.0, 1],
    [38.0, 0],
    [39.0, 1],
    [Infinity, 2]
  ]
};

const NEWS2_NAMES: Record<string, string> = {
  resp_rate: 'breathing rate',
  spo2: 'oxygen saturation',
  systolic_bp: 'blood pressure',
  heart_rate: 'pulse',
  temperature: 'temperature',
  oxygen: 'supplemental oxygen',
  consciousness: 'consciousness'
};

const CONSCIOUSNESS: Record<string, string> = {
  new_confusion: 'new confusion',
  voice: 'responds only to voice',
  pain: 'responds only to pain',
  unresponsive: 'unresponsive',
  alert: 'alert'
};

const points = (value: number, bands: [number, number][]) =>
  bands.find(([upper]) => value <= upper)![1];

const temp = (c: number) => `${c.toFixed(1)} °C`;

function reading(name: string, v: Vitals): string {
  switch (name) {
    case 'resp_rate':
      return `breathing rate ${v.resp_rate}/min`;
    case 'spo2':
      return `oxygen saturation ${v.spo2}%`;
    case 'systolic_bp':
      return `blood pressure ${v.systolic_bp}/${v.diastolic_bp || '?'} mmHg`;
    case 'heart_rate':
      return `pulse ${v.heart_rate}/min`;
    case 'temperature':
      return `temperature ${temp(v.temperature_c!)}`;
    case 'oxygen':
      return 'on supplemental oxygen';
    default:
      return CONSCIOUSNESS[v.consciousness ?? ''] ?? 'consciousness not recorded';
  }
}

/** null when nothing NEWS2 uses was measured */
export function news2(v: Vitals): News2 | null {
  const pts: Record<string, number> = {};
  const missing: string[] = [];
  const values: Record<string, number | null> = {
    resp_rate: v.resp_rate,
    spo2: v.spo2,
    systolic_bp: v.systolic_bp,
    heart_rate: v.heart_rate,
    temperature: v.temperature_c
  };
  for (const [name, value] of Object.entries(values)) {
    if (value == null) missing.push(NEWS2_NAMES[name]);
    else pts[name] = points(value, BANDS[name]);
  }
  if (v.consciousness == null) missing.push('consciousness');
  else pts.consciousness = v.consciousness === 'alert' ? 0 : 3;
  if (!Object.keys(pts).length) return null;
  pts.oxygen = v.on_oxygen ? 2 : 0;
  const score = Object.values(pts).reduce((a, b) => a + b, 0);
  const band =
    score >= 7
      ? 'high'
      : score >= 5
        ? 'medium'
        : Object.values(pts).includes(3)
          ? 'low-medium'
          : 'low';
  return { score, band, points: pts, missing };
}

function news2Findings(n: News2, v: Vitals): Finding[] {
  const scored = Object.entries(n.points)
    .filter(([, p]) => p)
    .map(([k, p]) => `${reading(k, v)} (+${p})`);
  if (n.score >= 5) {
    return [
      {
        level: n.score >= 7 ? 'critical' : 'high',
        source: 'news2',
        title: `NEWS2 ${n.score}: ${n.band} clinical risk`,
        reasons: scored,
        action:
          n.score >= 7
            ? 'Emergency assessment now; NEWS2 7+ in hospital triggers the emergency team.'
            : 'Urgent assessment by the doctor; recheck all vital signs within 30 minutes.',
        evidence: []
      }
    ];
  }
  if (n.band === 'low-medium') {
    const red = Object.entries(n.points)
      .filter(([, p]) => p === 3)
      .map(([k]) => `${reading(k, v)} (+3)`);
    return [
      {
        level: 'medium',
        source: 'news2',
        title: 'A vital sign in the danger range',
        reasons: [...red, `NEWS2 total ${n.score}`],
        action: 'Doctor to review soon; recheck vital signs within 30 minutes.',
        evidence: []
      }
    ];
  }
  return [];
}

// ---------- Matching helpers ----------
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const term = (t: string) => new RegExp(`\\b${escape(t.toLowerCase())}`);

/** The symptoms (in the patient's words) that any of the terms match, in order, once each */
function matched(terms: string[], symptoms: string[]): string[] {
  const pats = terms.map(term);
  return symptoms.filter((s) => pats.some((p) => p.test(s)));
}

function historyHits(terms: string[], history: HistoryItem[]): HistoryItem[] {
  const pats = terms.map(term);
  return history.filter((h) => pats.some((p) => p.test(h.text.toLowerCase())));
}

const NEGATED = /^\s*(no|denies|denied|without|not|absence of)\b/i;

/** Lower-cased, negations dropped ('no chest pain'), and a measured fever added as a symptom */
function cleanSymptoms(symptoms: string[], v: Vitals | null): string[] {
  const out = symptoms
    .filter((s) => s.trim() && !NEGATED.test(s))
    .map((s) => s.trim().toLowerCase());
  if (v?.temperature_c != null && v.temperature_c >= 38.0) {
    out.push(`fever (${temp(v.temperature_c)} measured)`);
  }
  return [...new Set(out)];
}

const cite = (h: HistoryItem) => `${h.recorded_at.slice(0, 10)}: ${h.text}`;
const unique = (xs: string[]) => [...new Set(xs)];

// ---------- 2. Thresholds NEWS2 leaves out ----------
const HTN_EMERGENCY = [
  'chest pain',
  'breathless',
  'shortness of breath',
  'severe headache',
  'confus',
  'blurred vision',
  'weakness',
  'slurred speech',
  'fits',
  'seizure'
];
const DKA = [
  'vomit',
  'abdominal pain',
  'stomach pain',
  'belly pain',
  'deep breathing',
  'rapid breathing',
  'fruity',
  'drows',
  'confus'
];
const DIABETES = [
  'diabet',
  'insulin',
  'metformin',
  'glimepiride',
  'gliclazide',
  'sitagliptin',
  'vildagliptin'
];
const HYPERTENSION = [
  'hypertension',
  'high blood pressure',
  'amlodipine',
  'telmisartan',
  'losartan',
  'ramipril',
  'enalapril',
  'hydrochlorothiazide',
  'chlorthalidone'
];
const PREGNANT = ['pregnan', 'antenatal'];
const PRE_ECLAMPSIA = [
  'headache',
  'blurred vision',
  'visual',
  'flashing lights',
  'swelling',
  'swollen',
  'upper abdominal pain',
  'abdominal pain',
  'breathless',
  'vomit'
];

/** Raised blood pressure (140/90+) in a pregnant patient, from today's symptoms or the record */
function preEclampsia(v: Vitals, symptoms: string[], history: HistoryItem[]): Finding[] {
  if ((v.systolic_bp ?? 0) < 140 && (v.diastolic_bp ?? 0) < 90) return [];
  const said = matched(PREGNANT, symptoms);
  const onRecord = historyHits(PREGNANT, history);
  if (!said.length && !onRecord.length) return [];
  const severeBp = (v.systolic_bp ?? 0) >= 160 || (v.diastolic_bp ?? 0) >= 110;
  const features = matched(PRE_ECLAMPSIA, symptoms).filter((s) => !said.includes(s));
  const urgent = severeBp || features.length > 0;
  return [
    {
      level: urgent ? 'critical' : 'high',
      source: 'vitals',
      title: 'Possible pre-eclampsia',
      reasons: [
        `blood pressure ${v.systolic_bp || '?'}/${v.diastolic_bp || '?'} mmHg in pregnancy`,
        ...(features.length ? [`with ${features.join(', ')}`] : []),
        ...(onRecord.length ? [`Pregnancy on record (${cite(onRecord[0])})`] : [])
      ],
      action: urgent
        ? 'Emergency: same-day obstetric assessment. Check urine protein now.'
        : 'Urgent: check urine protein and repeat the blood pressure; obstetric review today.',
      evidence: []
    }
  ];
}

const vitalFinding = (
  level: TriageLevel,
  title: string,
  reasons: string[],
  action: string
): Finding => ({ level, source: 'vitals', title, reasons, action, evidence: [] });

function vitalFindings(v: Vitals, symptoms: string[], history: HistoryItem[]): Finding[] {
  const out = preEclampsia(v, symptoms, history);
  if ((v.systolic_bp ?? 0) >= 180 || (v.diastolic_bp ?? 0) >= 120) {
    const bp = `blood pressure ${v.systolic_bp || '?'}/${v.diastolic_bp || '?'} mmHg`;
    const withSymptoms = matched(HTN_EMERGENCY, symptoms);
    out.push({
      level: withSymptoms.length ? 'critical' : 'high',
      source: 'vitals',
      title: withSymptoms.length
        ? 'Possible hypertensive emergency'
        : 'Severely raised blood pressure',
      reasons: [bp, ...(withSymptoms.length ? [`with ${withSymptoms.join(', ')}`] : [])],
      action: withSymptoms.length
        ? 'Emergency: organ damage is possible at this pressure with these symptoms; arrange transfer.'
        : "Urgent: recheck after 5 minutes' rest; the doctor reviews today.",
      evidence: []
    });
  }

  const g = v.blood_glucose;
  if (g != null) {
    const diabetic = historyHits(DIABETES, history);
    const dkaSymptoms = matched(DKA, symptoms);
    if (g < 54) {
      out.push(
        vitalFinding(
          'critical',
          'Severe low blood sugar',
          [`blood glucose ${g} mg/dL`],
          'Emergency: treat low blood sugar now per protocol, then recheck in 15 minutes.'
        )
      );
    } else if (g < 70) {
      out.push(
        vitalFinding(
          'high',
          'Low blood sugar',
          [`blood glucose ${g} mg/dL`],
          'Urgent: give fast-acting sugar if the patient can swallow; recheck in 15 minutes.'
        )
      );
    } else if (g >= 250 && dkaSymptoms.length && (diabetic.length || g >= 300)) {
      out.push(
        vitalFinding(
          'critical',
          'Possible diabetic ketoacidosis',
          [
            `blood glucose ${g} mg/dL`,
            `with ${dkaSymptoms.join(', ')}`,
            ...(diabetic.length ? [`Diabetes on record: ${diabetic[0].text}`] : [])
          ],
          'Emergency: check ketones if available and arrange hospital transfer.'
        )
      );
    } else if (g >= 300) {
      out.push(
        vitalFinding(
          'high',
          'Very high blood sugar',
          [`blood glucose ${g} mg/dL`],
          'Urgent: check ketones if available; the doctor reviews today.'
        )
      );
    } else if (g >= 200) {
      out.push(
        vitalFinding(
          'medium',
          'High blood sugar',
          [
            `random blood glucose ${g} mg/dL (diabetic range is 200+)`,
            ...(diabetic.length ? [] : ['no diabetes on record'])
          ],
          diabetic.length
            ? 'Diabetes control is poor today; review medicines and HbA1c.'
            : 'Confirm with fasting glucose and HbA1c.'
        )
      );
    }
  }
  return out;
}

// ---------- 3. Red-flag symptoms ----------
interface RedFlagRule {
  title: string;
  level: TriageLevel;
  else_level?: TriageLevel;
  all: string[][];
  any?: string[];
  history?: { terms: string[]; level: TriageLevel; reason: string };
  action: string;
}

const RULES = (redFlags as { rules: RedFlagRule[] }).rules;

function redFlagFindings(symptoms: string[], history: HistoryItem[]): Finding[] {
  const out: Finding[] = [];
  for (const rule of RULES) {
    const groups = rule.all.map((g) => matched(g, symptoms));
    if (!groups.every((g) => g.length)) continue;
    let hits = groups.flat();
    let level = rule.level;
    if (rule.any) {
      const extra = matched(rule.any, symptoms);
      if (extra.length) hits = [...hits, ...extra];
      else if (rule.else_level) level = rule.else_level;
      else continue;
    }
    const reasons = [`Symptoms: ${unique(hits).join(', ')}`];
    if (rule.history) {
      const found = historyHits(rule.history.terms, history);
      if (found.length) {
        if (rank(rule.history.level) > rank(level)) level = rule.history.level;
        reasons.push(`${rule.history.reason} (${cite(found[0])})`);
      }
    }
    out.push({
      level,
      title: rule.title,
      reasons,
      action: rule.action,
      evidence: [],
      source: 'red_flag'
    });
  }
  return out;
}

// ---------- 4. Sepsis ----------
const INFECTION = [
  'fever',
  'chills',
  'rigor',
  'shiver',
  'infection',
  'pus',
  'burning urination',
  'burning on urination',
  'cough with phlegm',
  'productive cough'
];

/** Infection signs plus qSOFA-style warning signs: breathing 22+, systolic BP 100 or less, altered mind */
function sepsis(symptoms: string[], v: Vitals | null): Finding[] {
  if (!v) return [];
  const infection = matched(INFECTION, symptoms);
  if (v.temperature_c != null && v.temperature_c <= 36.0) {
    infection.push(`low temperature ${temp(v.temperature_c)}`);
  }
  if (!infection.length) return [];
  const signs = [
    [(v.resp_rate ?? 0) >= 22, `breathing rate ${v.resp_rate}/min`],
    [
      v.systolic_bp != null && v.systolic_bp <= 100,
      `systolic blood pressure ${v.systolic_bp} mmHg`
    ],
    [
      v.consciousness != null && v.consciousness !== 'alert',
      CONSCIOUSNESS[v.consciousness ?? ''] ?? ''
    ]
  ]
    .filter(([ok]) => ok)
    .map(([, s]) => s as string);
  if (!signs.length) return [];
  const two = signs.length >= 2;
  return [
    {
      level: two ? 'critical' : 'high',
      source: 'vitals',
      title: two ? 'Possible sepsis' : 'Infection with a sepsis warning sign',
      reasons: [
        `Infection signs: ${unique(infection).join(', ')}`,
        `Warning signs: ${signs.join(', ')}`
      ],
      action: two
        ? 'Emergency: sepsis is time-critical. Arrange hospital transfer now.'
        : 'Urgent: the doctor reviews next; recheck vital signs within 30 minutes.',
      evidence: []
    }
  ];
}

// ---------- 5. Trends across visits ----------
const DAY_MS = 24 * 60 * 60 * 1000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** readings: (recorded_at ISO, vitals), oldest first, today's included */
function trends(readings: [string, Vitals][], history: HistoryItem[]): Finding[] {
  const out: Finding[] = [];
  const byDay = new Map<string, Vitals>();
  for (const [ts, v] of readings) byDay.set(ts.slice(0, 10), v); // the last reading of each day
  const days = [...byDay.keys()].toSorted();

  const bp = days
    .filter((d) => byDay.get(d)!.systolic_bp != null)
    .map((d) => [d, byDay.get(d)!] as const);
  if (bp.length) {
    const reasons: string[] = [];
    const last3 = bp.slice(-3);
    const sys3 = last3.map(([, v]) => v.systolic_bp!);
    if (last3.length === 3 && sys3[0] < sys3[1] && sys3[1] < sys3[2] && sys3[2] >= 140) {
      reasons.push(
        'Blood pressure rising across visits: ' +
          last3.map(([d, v]) => `${v.systolic_bp}/${v.diastolic_bp || '?'} (${d})`).join(' → ')
      );
    }
    const raised = bp.filter(([, v]) => v.systolic_bp! >= 140 || (v.diastolic_bp ?? 0) >= 90);
    if (raised.length >= 2 && !historyHits(HYPERTENSION, history).length) {
      reasons.push(`Raised on ${raised.length} different days, and no hypertension on record`);
    }
    if (reasons.length) {
      out.push({
        level: 'medium',
        source: 'trend',
        title: 'Possible high blood pressure (hypertension)',
        reasons,
        action:
          'Confirm with repeat readings after rest; early treatment prevents stroke and heart and kidney damage.',
        evidence: []
      });
    }
  }

  const weights = days
    .filter((d) => byDay.get(d)!.weight_kg != null)
    .map((d) => [d, byDay.get(d)!.weight_kg!] as const);
  if (weights.length >= 2) {
    const [lastDay, lastW] = weights.at(-1)!;
    const earlier = weights.slice(0, -1).filter(([d]) => {
      const gap = dayMs(lastDay) - dayMs(d);
      return gap >= 30 * DAY_MS && gap <= 365 * DAY_MS;
    });
    if (earlier.length) {
      const [d0, w0] = earlier[0];
      const drop = ((w0 - lastW) / w0) * 100;
      if (drop >= 5) {
        const span = Math.round((dayMs(lastDay) - dayMs(d0)) / DAY_MS);
        out.push({
          level: 'medium',
          source: 'trend',
          title: 'Weight loss',
          reasons: [
            `Weight down ${drop.toFixed(0)}% in ${span} days: ${w0} kg (${d0}) → ${lastW} kg (${lastDay})`
          ],
          action: 'Ask whether it is intended. If not, look for a cause (diabetes, thyroid, TB).',
          evidence: []
        });
      }
    }
  }

  const high = days
    .filter((d) => (byDay.get(d)!.blood_glucose ?? 0) >= 200)
    .map((d) => [d, byDay.get(d)!.blood_glucose!] as const);
  if (high.length >= 2 && !historyHits(DIABETES, history).length) {
    out.push({
      level: 'medium',
      source: 'trend',
      title: 'Repeatedly high blood sugar',
      reasons: [
        'Blood glucose 200+ mg/dL on ' + high.map(([d, g]) => `${d} (${g})`).join(', '),
        'no diabetes on record'
      ],
      action: 'Confirm with fasting glucose and HbA1c.',
      evidence: []
    });
  }
  return out;
}

// ---------- Putting it together ----------
/**
 * Pure: no storage. symptoms are the desk's complaint in English.
 * readings: earlier vitals for trends, oldest first (today's `vitals` is added if missing).
 */
export function assess(
  symptoms: string[],
  vitals: Vitals | null,
  history: HistoryItem[],
  readings: [string, Vitals][] = [],
  now = new Date()
): Omit<TriageAssessment, 'patient_id' | 'visit_id' | 'stage' | 'assessed_at'> {
  const syms = cleanSymptoms(symptoms, vitals);
  const findings: Finding[] = [];
  const gaps: string[] = [];
  let n: News2 | null = null;
  if (vitals) {
    n = news2(vitals);
    if (n) {
      findings.push(...news2Findings(n, vitals));
      if (n.missing.length) {
        gaps.push(`Not measured: ${n.missing.join(', ')}. NEWS2 may be too low.`);
      }
    } else {
      gaps.push('None of the NEWS2 vital signs were measured.');
    }
    findings.push(...vitalFindings(vitals, syms, history));
  } else {
    gaps.push('No vital signs recorded: this level uses symptoms and history only.');
  }
  findings.push(...sepsis(syms, vitals), ...redFlagFindings(syms, history));

  const all = [...readings];
  if (vitals && !all.some(([, v]) => v === vitals)) all.push([now.toISOString(), vitals]);
  findings.push(...trends(all, history));

  // Highest level first; at the same level a named condition leads the bare NEWS2 score,
  // because the first finding is the queue's one-line label
  findings.sort(
    (a, b) =>
      rank(b.level) - rank(a.level) || Number(b.source !== 'news2') - Number(a.source !== 'news2')
  );
  const level = findings[0]?.level ?? 'low';
  return {
    level,
    urgency: URGENCY[level],
    news2: n,
    findings,
    gaps,
    vitals,
    disclaimer: TRIAGE_DISCLAIMER
  };
}
