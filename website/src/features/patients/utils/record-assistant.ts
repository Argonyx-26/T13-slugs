// ============================================================
// Demo-mode assistant: answers a question from one patient's stored record.
// ============================================================
// No model is involved. It retrieves and lists what the record says, with the
// source and date of each item, so the demo works offline and never invents
// anything. With LUMEN_API_URL set, questions go to the orchestrator's
// /patients/{id}/ask (local LLM) instead, which follows the same refusal rule.
// ============================================================

import type { Evidence, PatientRecord, QAAnswer, RiskItem } from '../api/types';
import { NO_ALLERGY, formatDate, sourceLabel } from './record';

/** The exact refusal sentence and rule the orchestrator uses (backend/app/orchestrator/pipeline.py). */
export const REFUSAL =
  'I am an analytical assistant and cannot provide medical opinions or diagnoses. ' +
  'I can only provide data summaries and literature research.';

export const OPINION_QUESTION = new RegExp(
  "diagnos|what do you think|what(?:'|’)?s wrong|what is wrong" +
    '|should i (?:prescribe|give|start|stop|change)|recommend' +
    '|best (?:drug|medicine|treatment)|treatment plan|your opinion',
  'i'
);

const TOPICS = {
  allergy: /allerg|reaction|rash|anaphyla|nkda/i,
  medication: /medic|medicine|drug|tablet|taking|dose|dosage|prescri|pill|inhaler/i,
  lab: /\blabs?\b|test|result|level|hba1c|a1c|\binr\b|egfr|kidney|renal|glucose|sugar|cholesterol|ldl|tsh|thyroid|haemoglobin|hemoglobin|\bhb\b|urine|trend/i,
  condition: /condition|chronic|long[- ]term|problem|illness|comorbid/i,
  risk: /risk|concern|worr|watch|flag|alert|danger|safe|interact|contraindicat|careful|avoid|caution|bleed/i,
  summary: /summar|overview|brief|tell me about|background|recap|who is|history|timeline|last visit|recent|previous/i,
  today: /today|reason|complaint|presenting|came in|here for/i
};

const STOPWORDS = new Set(
  'the and for with that this what when which who has have had does did are was were any her his she him they them their about from into over than then there these those can could would should will your you our patient record records tell show give list me please how much many is it of on in to a an be by or at as do'.split(
    ' '
  )
);

function tokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function overlap(q: Set<string>, text: string): number {
  const d = tokens(text);
  let n = 0;
  for (const w of q) if (d.has(w) || [...d].some((x) => x.startsWith(w) || w.startsWith(x))) n++;
  return n;
}

const cite = (source: Evidence['source'], snippet: string, recorded_on?: string | null): Evidence => ({
  source,
  snippet,
  recorded_on: recorded_on ?? null
});

const when = (source: Evidence['source'], date?: string | null) =>
  `${sourceLabel(source).toLowerCase()}, ${formatDate(date)}`;

interface Section {
  text: string;
  citations: Evidence[];
}

function allergySection(p: PatientRecord): Section {
  const { allergies } = p.profile;
  if (!allergies.length) {
    return {
      text: `**Allergies:** nothing is recorded, so ${p.displayName}'s allergy status is **unknown**. That is not the same as having no allergies.`,
      citations: []
    };
  }
  const lines = allergies.map(
    (a) => `- **${a.value}**${a.note ? `: ${a.note}` : ''} (${when(a.source, a.recorded_on)})`
  );
  const disagree =
    allergies.some((a) => NO_ALLERGY.test(a.value)) && allergies.some((a) => !NO_ALLERGY.test(a.value));
  return {
    text:
      `**Allergies on record**\n${lines.join('\n')}` +
      (disagree
        ? '\n\nThese records **disagree**: one says there are no known allergies while another records an allergy. Treat the allergy as present until the records are reconciled.'
        : ''),
    citations: allergies.map((a) => cite(a.source, `Allergy: ${a.value}${a.note ? ` - ${a.note}` : ''}`, a.recorded_on))
  };
}

function medicationSection(p: PatientRecord): Section {
  const meds = p.profile.active_medications;
  if (!meds.length) return { text: '**Current medicines:** none are on record.', citations: [] };
  return {
    text: `**Current medicines**\n${meds
      .map((m) => `- **${m.value}**${m.note ? `, ${m.note}` : ''} (${when(m.source, m.recorded_on)})`)
      .join('\n')}`,
    citations: meds.map((m) => cite(m.source, m.value, m.recorded_on))
  };
}

function labSection(p: PatientRecord, q: Set<string>): Section {
  const labs = p.profile.labs;
  if (!labs.length) return { text: '**Lab results:** none are on record.', citations: [] };
  const byName = new Map<string, typeof labs>();
  for (const l of labs.toSorted((a, b) => a.taken_on.localeCompare(b.taken_on))) {
    byName.set(l.name, [...(byName.get(l.name) ?? []), l]);
  }
  // If the question names a specific test, answer about that one
  const named = [...byName.keys()].filter((name) => overlap(q, name) > 0);
  const names = named.length ? named : [...byName.keys()];
  const lines = names.map((name) => {
    const series = byName.get(name)!;
    return `- **${name}:** ${series.map((l) => `${l.value} (${formatDate(l.taken_on)})`).join(' → ')}`;
  });
  return {
    text: `**Lab results**, oldest to newest\n${lines.join('\n')}`,
    citations: names.flatMap((n) => byName.get(n)!.map((l) => cite(l.source, `${l.name} ${l.value}`, l.taken_on)))
  };
}

function conditionSection(p: PatientRecord): Section {
  const conditions = p.profile.conditions;
  if (!conditions.length) return { text: '**Long-term conditions:** none are on record.', citations: [] };
  return {
    text: `**Long-term conditions**\n${conditions
      .map((c) => `- **${c.value}**${c.note ? ` (${c.note})` : ''}, recorded ${formatDate(c.recorded_on)}`)
      .join('\n')}`,
    citations: conditions.map((c) => cite(c.source, c.value, c.recorded_on))
  };
}

const describeRisk = (r: RiskItem) =>
  `- **${r.label}** (${r.likelihood} likelihood${r.timeframe ? `, ${r.timeframe.toLowerCase()}` : ''}): ${r.outcome} ${r.reasoning}`;

function riskSection(p: PatientRecord, q: Set<string>): Section {
  if (!p.risks.length) {
    return {
      text: p.isNew
        ? `**Flagged risks:** none. ${p.displayName} has no previous records, so there is nothing to check against yet.`
        : `**Flagged risks:** none have been flagged from ${p.displayName}'s record.`,
      citations: []
    };
  }
  // Risks that mention something in the question (a drug, a test) come first
  const scored = p.risks
    .map((r) => ({ r, score: overlap(q, `${r.label} ${r.outcome} ${r.reasoning}`) }))
    .toSorted((a, b) => b.score - a.score);
  const relevant = scored.some((s) => s.score > 0) ? scored.filter((s) => s.score > 0) : scored;
  return {
    text: `**Flagged from the record**\n${relevant.map((s) => describeRisk(s.r)).join('\n')}`,
    citations: relevant.flatMap((s) => s.r.evidence)
  };
}

function summarySection(p: PatientRecord): Section {
  const recent = p.history.slice(0, 3);
  return {
    text:
      `${p.overview.slice(0, 2).join('\n\n')}` +
      (recent.length
        ? `\n\n**Most recent records**\n${recent.map((h) => `- ${formatDate(h.recorded_on)}: ${h.text}`).join('\n')}`
        : ''),
    citations: recent.map((h) => cite(h.source, h.text, h.recorded_on))
  };
}

function todaySection(p: PatientRecord): Section {
  return {
    text: p.reasonForVisit
      ? `**Today's visit:** ${p.reasonForVisit}${p.token != null ? ` (token ${p.token}, ${p.visitStatus ?? 'in the queue'})` : ''}.`
      : `No reason for today's visit is recorded for ${p.displayName}.`,
    citations: []
  };
}

function searchHistory(p: PatientRecord, q: Set<string>): Section | null {
  const hits = p.history
    .map((h) => ({ h, score: overlap(q, h.text) }))
    .filter((x) => x.score > 0)
    .toSorted((a, b) => b.score - a.score || (b.h.recorded_on ?? '').localeCompare(a.h.recorded_on ?? ''))
    .slice(0, 3);
  if (!hits.length) return null;
  return {
    text: `**Records that match**\n${hits
      .map(({ h }) => `- ${formatDate(h.recorded_on)} (${sourceLabel(h.source).toLowerCase()}): ${h.text}`)
      .join('\n')}`,
    citations: hits.map(({ h }) => cite(h.source, h.text, h.recorded_on))
  };
}

export function answerFromRecord(patient: PatientRecord, question: string): QAAnswer {
  if (OPINION_QUESTION.test(question)) return { answer: REFUSAL, refused: true, citations: [] };

  const q = tokens(question);
  const wanted = (Object.keys(TOPICS) as (keyof typeof TOPICS)[]).filter((t) => TOPICS[t].test(question));
  const sections: Section[] = [];

  for (const topic of wanted) {
    if (topic === 'allergy') sections.push(allergySection(patient));
    if (topic === 'medication') sections.push(medicationSection(patient));
    if (topic === 'lab') sections.push(labSection(patient, q));
    if (topic === 'condition') sections.push(conditionSection(patient));
    if (topic === 'risk') sections.push(riskSection(patient, q));
    if (topic === 'summary') sections.push(summarySection(patient));
    if (topic === 'today') sections.push(todaySection(patient));
  }

  if (!sections.length) {
    const found = searchHistory(patient, q);
    if (found) sections.push(found);
  }

  if (!sections.length) {
    return {
      answer:
        `I couldn't find anything in ${patient.displayName}'s record that matches this question. ` +
        'I can only answer from the stored record: allergies, medicines, conditions, lab results, past visits and the risks flagged from them.',
      refused: false,
      citations: []
    };
  }

  const seen = new Set<string>();
  const citations = sections
    .flatMap((s) => s.citations)
    .filter((c) => (seen.has(c.snippet) ? false : (seen.add(c.snippet), true)))
    .slice(0, 8);

  return { answer: sections.map((s) => s.text).join('\n\n'), refused: false, citations };
}
