"""Early health-risk detection: vital signs + symptoms + the patient's history -> a risk level with reasons.

Fixed rules only. The LLM may explain a risk level but never sets or lowers one.
  1. NEWS2 (Royal College of Physicians, 2017): the standard early-warning score from seven vital signs.
  2. Vital-sign thresholds NEWS2 leaves out: very high blood pressure, low or high blood sugar.
  3. Red-flag symptom patterns (data/red_flags.json), some raised by the patient's history
     (black stools on warfarin, chest pain in a diabetic).
  4. Combined patterns: possible sepsis (infection signs + qSOFA-style vitals), possible diabetic ketoacidosis.
  5. Trends across visits: rising blood pressure, weight loss, repeatedly high blood sugar.

Two moments, same rules:
  - triage, at check-in: the desk enters vitals and the complaint, and the queue puts the riskiest patient first.
  - consult: the Brain's first-pass symptoms are added, and the result goes to the doctor and the Brain.

Levels: low -> routine queue, medium -> see soon, high -> see next, critical -> emergency now.
Demo coverage for a hackathon, not a validated clinical tool.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from math import inf
from pathlib import Path

from .models import NEWS2, Fact, Match, PatientContext, RiskAssessment, RiskFinding, Vitals

LEVELS = ("low", "medium", "high", "critical")
URGENCY = {
    "critical": "Emergency: the doctor sees the patient now. Be ready to transfer to a hospital emergency department.",
    "high": "Urgent: the patient goes to the front of the queue.",
    "medium": "Priority: see soon, and recheck vital signs every 30 minutes while waiting.",
    "low": "Routine: normal queue order.",
}
DISCLAIMER = ("Rule-based decision support for prioritising patients. It flags risk and cites its reasons; "
              "it does not diagnose, and the doctor makes every clinical decision.")

# ---------- 1. NEWS2 ----------
# (upper bound inclusive, points), checked in order
_BANDS = {
    "resp_rate":   [(8, 3), (11, 1), (20, 0), (24, 2), (inf, 3)],
    "spo2":        [(91, 3), (93, 2), (95, 1), (inf, 0)],
    "systolic_bp": [(90, 3), (100, 2), (110, 1), (219, 0), (inf, 3)],
    "heart_rate":  [(40, 3), (50, 1), (90, 0), (110, 1), (130, 2), (inf, 3)],
    "temperature": [(35.0, 3), (36.0, 1), (38.0, 0), (39.0, 1), (inf, 2)],
}
_NEWS2_NAMES = {"resp_rate": "breathing rate", "spo2": "oxygen saturation", "systolic_bp": "blood pressure",
                "heart_rate": "pulse", "temperature": "temperature", "oxygen": "supplemental oxygen",
                "consciousness": "consciousness"}
_CONSCIOUSNESS = {"new_confusion": "new confusion", "voice": "responds only to voice", "pain": "responds only to pain",
                  "unresponsive": "unresponsive", "alert": "alert"}


def _points(value: float, bands: list[tuple[float, int]]) -> int:
    return next(p for upper, p in bands if value <= upper)


def _values(v: Vitals) -> dict[str, float | None]:
    return {"resp_rate": v.resp_rate, "spo2": v.spo2, "systolic_bp": v.systolic_bp,
            "heart_rate": v.heart_rate, "temperature": v.temperature_c}


def _reading(name: str, v: Vitals) -> str:
    """A parameter in plain words: 'pulse 118/min'."""
    return {"resp_rate": f"breathing rate {v.resp_rate}/min", "spo2": f"oxygen saturation {v.spo2}%",
            "systolic_bp": f"blood pressure {v.systolic_bp}/{v.diastolic_bp or '?'} mmHg",
            "heart_rate": f"pulse {v.heart_rate}/min", "temperature": f"temperature {v.temperature_c} °C",
            "oxygen": "on supplemental oxygen",
            "consciousness": _CONSCIOUSNESS.get(v.consciousness or "", "consciousness not recorded")}[name]


def news2(v: Vitals) -> NEWS2 | None:
    """None when nothing NEWS2 uses was measured."""
    points, missing = {}, []
    for name, value in _values(v).items():
        if value is None:
            missing.append(_NEWS2_NAMES[name])
        else:
            points[name] = _points(value, _BANDS[name])
    if v.consciousness is None:
        missing.append("consciousness")
    else:
        points["consciousness"] = 0 if v.consciousness == "alert" else 3
    if not points:
        return None
    points["oxygen"] = 2 if v.on_oxygen else 0
    score = sum(points.values())
    band = ("high" if score >= 7 else "medium" if score >= 5
            else "low-medium" if 3 in points.values() else "low")
    return NEWS2(score=score, band=band, points=points, missing=missing)


def _news2_findings(n: NEWS2, v: Vitals) -> list[RiskFinding]:
    scored = [f"{_reading(k, v)} (+{p})" for k, p in n.points.items() if p]
    if n.score >= 5:
        return [RiskFinding(
            level="critical" if n.score >= 7 else "high", source="news2",
            title=f"NEWS2 {n.score}: {n.band} clinical risk",
            reasons=scored,
            action=("Emergency assessment now; NEWS2 7+ in hospital triggers the emergency team." if n.score >= 7
                    else "Urgent assessment by the doctor; recheck all vital signs within 30 minutes."))]
    if n.band == "low-medium":
        red = [f"{_reading(k, v)} (+3)" for k, p in n.points.items() if p == 3]
        return [RiskFinding(level="medium", source="news2", title="A vital sign in the danger range",
                            reasons=red + [f"NEWS2 total {n.score}"],
                            action="Doctor to review soon; recheck vital signs within 30 minutes.")]
    return []


# ---------- 2. Thresholds NEWS2 leaves out ----------
_HTN_EMERGENCY = ["chest pain", "breathless", "shortness of breath", "severe headache", "confus", "blurred vision",
                  "weakness", "slurred speech", "fits", "seizure"]
_DKA = ["vomit", "abdominal pain", "stomach pain", "belly pain", "deep breathing", "rapid breathing", "fruity",
        "drows", "confus"]
_DIABETES = ["diabet", "insulin", "metformin", "glimepiride", "gliclazide", "sitagliptin", "vildagliptin"]
_HYPERTENSION = ["hypertension", "high blood pressure", "amlodipine", "telmisartan", "losartan", "ramipril",
                 "enalapril", "hydrochlorothiazide", "chlorthalidone"]


def _vital_findings(v: Vitals, symptoms: list[str], history: list["_Item"]) -> list[RiskFinding]:
    out = []
    if (v.systolic_bp or 0) >= 180 or (v.diastolic_bp or 0) >= 120:
        bp = f"blood pressure {v.systolic_bp or '?'}/{v.diastolic_bp or '?'} mmHg"
        with_symptoms = _matched(_HTN_EMERGENCY, symptoms)
        out.append(RiskFinding(
            level="critical" if with_symptoms else "high", source="vitals",
            title="Possible hypertensive emergency" if with_symptoms else "Severely raised blood pressure",
            reasons=[bp] + ([f"with {', '.join(with_symptoms)}"] if with_symptoms else []),
            action=("Emergency: organ damage is possible at this pressure with these symptoms; arrange transfer."
                    if with_symptoms else "Urgent: recheck after 5 minutes' rest; the doctor reviews today.")))

    g = v.blood_glucose
    if g is not None:
        diabetic = _history_hits(_DIABETES, history)
        dka_symptoms = _matched(_DKA, symptoms)
        if g < 54:
            out.append(RiskFinding(level="critical", source="vitals", title="Severe low blood sugar",
                                   reasons=[f"blood glucose {g} mg/dL"],
                                   action="Emergency: treat low blood sugar now per protocol, then recheck in 15 minutes."))
        elif g < 70:
            out.append(RiskFinding(level="high", source="vitals", title="Low blood sugar",
                                   reasons=[f"blood glucose {g} mg/dL"],
                                   action="Urgent: give fast-acting sugar if the patient can swallow; recheck in 15 minutes."))
        elif g >= 250 and dka_symptoms and (diabetic or g >= 300):
            out.append(RiskFinding(
                level="critical", source="vitals", title="Possible diabetic ketoacidosis",
                reasons=[f"blood glucose {g} mg/dL", f"with {', '.join(dka_symptoms)}"]
                        + ([f"Diabetes on record: {diabetic[0].text}"] if diabetic else []),
                action="Emergency: check ketones if available and arrange hospital transfer.",
                evidence=[h.chunk_id for h in diabetic[:2]]))
        elif g >= 300:
            out.append(RiskFinding(level="high", source="vitals", title="Very high blood sugar",
                                   reasons=[f"blood glucose {g} mg/dL"],
                                   action="Urgent: check ketones if available; the doctor reviews today."))
        elif g >= 200:
            out.append(RiskFinding(
                level="medium", source="vitals", title="High blood sugar",
                reasons=[f"random blood glucose {g} mg/dL (diabetic range is 200+)"]
                        + ([] if diabetic else ["no diabetes on record"]),
                action="Confirm with fasting glucose and HbA1c." if not diabetic
                       else "Diabetes control is poor today; review medicines and HbA1c.",
                evidence=[h.chunk_id for h in diabetic[:1]]))
    return out


# ---------- 3. Red-flag symptoms ----------
_NEGATED = re.compile(r"^\s*(no|denies|denied|without|not|absence of)\b", re.I)


class _Item:
    """A history record the rules can cite: a safety fact or a retrieved record."""
    def __init__(self, chunk_id: int, text: str, recorded_at: str):
        self.chunk_id, self.text, self.recorded_at = chunk_id, text, recorded_at


def _history(ctx: PatientContext | None) -> list[_Item]:
    if ctx is None:
        return []
    items: list[Fact | Match] = [*ctx.safety_facts, *ctx.relevant]
    return [_Item(i.chunk_id, i.text, i.recorded_at) for i in items]


def _term(term: str) -> re.Pattern:
    return re.compile(r"\b" + re.escape(term.lower()))


def _matched(terms: list[str], symptoms: list[str]) -> list[str]:
    """The symptoms (in the patient's words) that any of the terms match, in order, once each."""
    pats = [_term(t) for t in terms]
    return [s for s in symptoms if any(p.search(s) for p in pats)]


def _history_hits(terms: list[str], history: list[_Item]) -> list[_Item]:
    pats = [_term(t) for t in terms]
    return [h for h in history if any(p.search(h.text.lower()) for p in pats)]


def _symptoms(symptoms: list[str], v: Vitals | None) -> list[str]:
    """Lower-cased, negations dropped ('no chest pain'), and a measured fever added as a symptom."""
    out = [s.strip().lower() for s in symptoms if s.strip() and not _NEGATED.match(s)]
    if v and v.temperature_c is not None and v.temperature_c >= 38.0:
        out.append(f"fever ({v.temperature_c} °C measured)")
    return list(dict.fromkeys(out))


@lru_cache
def _rules() -> list[dict]:
    return json.loads((Path(__file__).parent / "data" / "red_flags.json").read_text(encoding="utf-8"))["rules"]


def _cite(h: _Item) -> str:
    return f"{h.recorded_at[:10]}: {h.text}"


def _red_flags(symptoms: list[str], history: list[_Item]) -> list[RiskFinding]:
    out = []
    for rule in _rules():
        groups = [_matched(g, symptoms) for g in rule["all"]]
        if not all(groups):
            continue
        matched = [s for g in groups for s in g]
        level = rule["level"]
        if "any" in rule:
            extra = _matched(rule["any"], symptoms)
            if extra:
                matched += extra
            elif "else_level" in rule:
                level = rule["else_level"]
            else:
                continue
        reasons, evidence = [f"Symptoms: {', '.join(dict.fromkeys(matched))}"], []
        if esc := rule.get("history"):
            hits = _history_hits(esc["terms"], history)
            if hits:
                level = max(level, esc["level"], key=LEVELS.index)
                reasons.append(f"{esc['reason']} ({_cite(hits[0])})")
                evidence = [h.chunk_id for h in hits[:3]]
        out.append(RiskFinding(level=level, title=rule["title"], reasons=reasons, action=rule["action"],
                               evidence=evidence, source="red_flag"))
    return out


# ---------- 4. Sepsis ----------
_INFECTION = ["fever", "chills", "rigor", "shiver", "infection", "pus", "burning urination", "burning on urination",
              "cough with phlegm", "productive cough"]


def _sepsis(symptoms: list[str], v: Vitals | None) -> list[RiskFinding]:
    """Infection signs plus qSOFA-style warning signs: breathing 22+, systolic BP 100 or less, altered mind."""
    if v is None:
        return []
    infection = _matched(_INFECTION, symptoms)
    if v.temperature_c is not None and v.temperature_c <= 36.0:
        infection.append(f"low temperature {v.temperature_c} °C")
    if not infection:
        return []
    signs = [s for ok, s in [
        ((v.resp_rate or 0) >= 22, f"breathing rate {v.resp_rate}/min"),
        (v.systolic_bp is not None and v.systolic_bp <= 100, f"systolic blood pressure {v.systolic_bp} mmHg"),
        (v.consciousness not in (None, "alert"), _CONSCIOUSNESS.get(v.consciousness or "", "")),
    ] if ok]
    if not signs:
        return []
    two = len(signs) >= 2
    return [RiskFinding(
        level="critical" if two else "high", source="vitals",
        title="Possible sepsis" if two else "Infection with a sepsis warning sign",
        reasons=[f"Infection signs: {', '.join(dict.fromkeys(infection))}", f"Warning signs: {', '.join(signs)}"],
        action=("Emergency: sepsis is time-critical. Arrange hospital transfer now." if two
                else "Urgent: the doctor reviews next; recheck vital signs within 30 minutes."))]


# ---------- 5. Trends across visits ----------
def _day(ts: str) -> str:
    return ts[:10]


def _trends(readings: list[tuple[str, Vitals]], history: list[_Item]) -> list[RiskFinding]:
    """readings: (recorded_at ISO, vitals), oldest first, today's included."""
    out = []
    by_day: dict[str, Vitals] = {}
    for ts, v in readings:                      # the last reading of each day
        by_day[_day(ts)] = v
    days = sorted(by_day)

    bp = [(d, by_day[d]) for d in days if by_day[d].systolic_bp is not None]
    if bp:
        reasons = []
        last3 = bp[-3:]
        sys3 = [v.systolic_bp for _, v in last3]
        if len(last3) == 3 and sys3[0] < sys3[1] < sys3[2] and sys3[2] >= 140:
            reasons.append("Blood pressure rising across visits: "
                           + " → ".join(f"{v.systolic_bp}/{v.diastolic_bp or '?'} ({d})" for d, v in last3))
        raised = [(d, v) for d, v in bp if v.systolic_bp >= 140 or (v.diastolic_bp or 0) >= 90]
        treated = _history_hits(_HYPERTENSION, history)
        if len(raised) >= 2 and not treated:
            reasons.append(f"Raised on {len(raised)} different days, and no hypertension on record")
        if reasons:
            out.append(RiskFinding(level="medium", source="trend", title="Possible high blood pressure (hypertension)",
                                   reasons=reasons,
                                   action="Confirm with repeat readings after rest; early treatment prevents stroke and "
                                          "heart and kidney damage."))

    weights = [(d, by_day[d].weight_kg) for d in days if by_day[d].weight_kg is not None]
    if len(weights) >= 2:
        last_day, last_w = weights[-1]
        last_dt = datetime.fromisoformat(last_day)
        earlier = [(d, w) for d, w in weights[:-1]
                   if timedelta(days=30) <= last_dt - datetime.fromisoformat(d) <= timedelta(days=365)]
        if earlier:
            d0, w0 = earlier[0]
            drop = (w0 - last_w) / w0 * 100
            if drop >= 5:
                span = (last_dt - datetime.fromisoformat(d0)).days
                out.append(RiskFinding(
                    level="medium", source="trend", title="Weight loss",
                    reasons=[f"Weight down {drop:.0f}% in {span} days: {w0:g} kg ({d0}) → {last_w:g} kg ({last_day})"],
                    action="Ask whether it is intended. If not, look for a cause (diabetes, thyroid, TB)."))

    high = [(d, by_day[d].blood_glucose) for d in days if (by_day[d].blood_glucose or 0) >= 200]
    if len(high) >= 2 and not _history_hits(_DIABETES, history):
        out.append(RiskFinding(level="medium", source="trend", title="Repeatedly high blood sugar",
                               reasons=["Blood glucose 200+ mg/dL on " + ", ".join(f"{d} ({g})" for d, g in high),
                                        "no diabetes on record"],
                               action="Confirm with fasting glucose and HbA1c."))
    return out


# ---------- Putting it together ----------
def assess(symptoms: list[str], vitals: Vitals | None, ctx: PatientContext | None = None,
           readings: list[tuple[str, Vitals]] = ()) -> RiskAssessment:
    """Pure: no database. symptoms are English (the desk's complaint, or the Brain's first pass).
    readings: earlier vitals for trends, oldest first (today's `vitals` is added if missing)."""
    history = _history(ctx)
    syms = _symptoms(symptoms, vitals)
    findings, gaps, n = [], [], None
    if vitals is not None:
        n = news2(vitals)
        if n:
            findings += _news2_findings(n, vitals)
            if n.missing:
                gaps.append(f"Not measured: {', '.join(n.missing)}. NEWS2 may be too low.")
        else:
            gaps.append("None of the NEWS2 vital signs were measured.")
        findings += _vital_findings(vitals, syms, history)
    else:
        gaps.append("No vital signs recorded: this level uses symptoms and history only.")
    findings += _sepsis(syms, vitals) + _red_flags(syms, history)

    readings = list(readings)
    if vitals is not None and not any(v is vitals for _, v in readings):
        readings.append((datetime.now(timezone.utc).isoformat(), vitals))
    findings += _trends(readings, history)

    findings.sort(key=lambda f: LEVELS.index(f.level), reverse=True)
    level = findings[0].level if findings else "low"
    return RiskAssessment(level=level, urgency=URGENCY[level], news2=n, findings=findings, gaps=gaps,
                          vitals=vitals, disclaimer=DISCLAIMER)


def format_for_llm(a: RiskAssessment) -> str:
    """Prompt block for the Brain: it reports the level as given and explains it, never lowers it."""
    lines = [f"RISK ASSESSMENT (fixed rules; report the level as given, never lower it): {a.level.upper()}",
             f"  {a.urgency}"]
    if a.news2:
        lines.append(f"  NEWS2 {a.news2.score} ({a.news2.band} clinical risk)")
    for f in a.findings:
        cite = f" [{', '.join(f'H{i}' for i in f.evidence)}]" if f.evidence else ""
        lines.append(f"  - [{f.level}] {f.title}: {'; '.join(f.reasons)}{cite}. Action: {f.action}")
    lines += [f"  Gap: {g}" for g in a.gaps]
    return "\n".join(lines)


# ---------- Database side ----------
CURRENT_VITALS_HOURS = 12   # a reading older than this is history, not today's vital signs


def assess_patient(patient_id: str, symptoms: list[str], stage: str, visit_id: str | None = None,
                   vitals: Vitals | None = None, vital_signs_id: str | None = None,
                   medications: list[str] = (), extra_queries: list[str] = (),
                   ctx: PatientContext | None = None, save: bool = True) -> RiskAssessment:
    """Assess with the patient's history and earlier vitals, and store the result (the queue shows the latest).
    vitals: None -> the patient's latest stored reading, if it is from the last CURRENT_VITALS_HOURS."""
    from .context import get_context
    from .db import service as sb

    rows = sb.table("vital_signs").select("*").eq("patient_id", patient_id).order("recorded_at").execute().data
    readings = [(r["recorded_at"], Vitals.model_validate(r)) for r in rows]
    if vitals is None and rows:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(rows[-1]["recorded_at"])
        if age <= timedelta(hours=CURRENT_VITALS_HOURS):
            vitals, vital_signs_id = readings[-1][1], rows[-1]["id"]
    if ctx is None:
        ctx = get_context(patient_id, symptoms, list(medications), extra_queries=list(extra_queries))
    a = assess(symptoms, vitals, ctx, readings)
    a.patient_id, a.visit_id, a.stage = patient_id, visit_id, stage
    a.assessed_at = datetime.now(timezone.utc).isoformat()
    if save:
        sb.table("risk_assessments").insert({
            "patient_id": patient_id, "visit_id": visit_id, "stage": stage, "level": a.level,
            "news2": a.news2.score if a.news2 else None, "vital_signs_id": vital_signs_id,
            "findings": [f.model_dump() for f in a.findings], "assessment": a.model_dump(mode="json"),
        }).execute()
    return a
