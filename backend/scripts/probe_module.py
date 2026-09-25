"""Merge-day probe: build ONE service from the current settings, call its methods outside
the pipeline, re-validate the output through our models, and print shapes, counts,
timings and GPU memory (only if torch is loaded).

    python -m scripts.probe_module stt|rag|llm|privacy|research [audio]

    RAG_BACKEND=real python -m scripts.probe_module rag
    STT_BACKEND=real python -m scripts.probe_module stt samples/audio/penicillin.m4a
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid
from datetime import date
from pathlib import Path

from app.config import get_settings
from app.contracts import (ContextChunk, NoteExtraction, PatientContext, PatientProfile, PatientSummary,
                           Prediction, QAAnswer, RecordUpdate, ResearchHit, SafetyAlert, SavedNote, Segment,
                           SimilarCase, Transcript, Visit)
from app.fixtures import load_fixture
from app.orchestrator.pipeline import _gpu_memory
from app.orchestrator.predictions import screen
from app.orchestrator.registry import SERVICE_KINDS, build_one
from app.orchestrator.research import QUERY_TEMPLATE

PRIVACY_SAMPLE = "Ravi reports a headache for 3 days; Amoxicillin 500 mg prescribed. Call 9845012345."


def _timed(label: str, fn, *args, **kwargs):
    t0 = time.perf_counter()
    out = fn(*args, **kwargs)
    print(f"  {label}: {int((time.perf_counter() - t0) * 1000)} ms")
    return out


def _scenario_transcript(scenario: str) -> Transcript:
    """A synthetic transcript built from a scripted consultation (no audio needed)."""
    data = load_fixture("scenarios.json")[scenario]
    segments, t = [], 0.0
    for speaker, text in data["segments"]:
        duration = max(2.0, len(text.split()) * 0.45)
        segments.append(Segment(start=round(t, 2), end=round(t + duration, 2), speaker=speaker, text=text))
        t += duration + 0.3
    return Transcript(segments=segments, language=data["language"], duration_s=round(t, 2), engine="probe")


def _demo_patient(scenario: str) -> dict:
    patients = load_fixture("demo_patients.json")["patients"]
    return next((p for p in patients if p["scenario"] == scenario), patients[0])


def probe_stt(svc, audio: Path | None) -> None:
    if audio is None:
        sys.exit("stt probe needs an audio file: python -m scripts.probe_module stt <audio>")
    _timed("load", svc.load)
    transcript = _timed("transcribe", svc.transcribe, audio,
                        on_progress=lambda p: print(f"    progress {p:.2f}"))
    transcript = Transcript.model_validate(transcript.model_dump())
    speakers = sorted({s.speaker for s in transcript.segments})
    print(f"  segments={len(transcript.segments)} speakers={speakers} language={transcript.language} "
          f"duration_s={transcript.duration_s} aligned={transcript.aligned} engine={transcript.engine}")


def probe_rag(svc) -> None:
    _timed("load", svc.load)
    patients = [PatientSummary.model_validate(p.model_dump()) for p in _timed("list_patients", svc.list_patients)]
    print(f"  {len(patients)} patients: {[p.display_name for p in patients]}")
    today = get_settings().clinic_today()
    visits = [Visit.model_validate(v.model_dump()) for v in _timed("list_visits", svc.list_visits, today)]
    print(f"  today's queue ({today}): {[(v.token, v.display_name, v.status) for v in visits]}, "
          f"token order={[v.token for v in visits] == sorted(v.token for v in visits)}")
    if not patients:
        return
    pid = patients[0].patient_uuid
    profile = _timed("get_profile", svc.get_profile, pid)
    if profile is not None:
        profile = PatientProfile.model_validate(profile.model_dump())
        print(f"  profile: allergies={len(profile.allergies)} medications={len(profile.active_medications)} "
              f"conditions={len(profile.conditions)} labs={len(profile.labs)}")
    chunks = [ContextChunk.model_validate(c.model_dump())
              for c in _timed("retrieve", svc.retrieve, pid, "penicillin allergy rash", 8)]
    print(f"  retrieve: {len(chunks)} chunks, sources={sorted({c.source for c in chunks})}")
    history = [ContextChunk.model_validate(c.model_dump()) for c in _timed("get_history", svc.get_history, pid)]
    print(f"  get_history: {len(history)} records, sources={sorted({c.source for c in history})}, "
          f"newest first={all((a.recorded_on or date.min) >= (b.recorded_on or date.min) for a, b in zip(history, history[1:]))}")
    notes = [SavedNote.model_validate(n.model_dump()) for n in _timed("list_notes", svc.list_notes, pid)]
    print(f"  list_notes: {len(notes)} notes")
    similar = [SimilarCase.model_validate(c.model_dump()) for c in _timed("search_similar", svc.search_similar,
                                                                           "knee pain", 5)]
    print(f"  search_similar('knee pain'): {[c.display_name for c in similar]}")
    unknown = _timed("get_profile(unknown)", svc.get_profile, uuid.uuid4())
    print(f"  unknown patient -> {unknown!r} (expected None)")


def probe_llm(svc, scenario: str) -> None:
    from app.services.mocks.rag import MockRAG

    _timed("load", svc.load)
    extraction = _timed("extract_note", svc.extract_note, _scenario_transcript(scenario))
    extraction = NoteExtraction.model_validate(extraction.model_dump())
    for p in extraction.note.prescriptions:
        print(f"    prescription: {p.drug} | {p.dose} | {p.frequency} | {p.duration} | {p.route}")
    print(f"  speaker_roles={extraction.speaker_roles} symptoms={len(extraction.note.symptoms)} "
          f"action_items={len(extraction.note.action_items)} model={extraction.model}")

    patient = _demo_patient(scenario)
    rag = MockRAG(get_settings().model_copy(update={"mock_latency_scale": 0}), [patient])
    pid = uuid.UUID(patient["patient_uuid"])
    context = PatientContext(profile=rag.get_profile(pid), chunks=rag.retrieve(pid, extraction.note.summary))
    alerts = [SafetyAlert.model_validate(a.model_dump())
              for a in _timed("review_safety", svc.review_safety, extraction.note, context, [])]
    print(f"  review_safety: {len(alerts)} alerts {[(a.severity, a.category, a.drug) for a in alerts]}")
    update = RecordUpdate.model_validate(_timed("propose_record_updates", svc.propose_record_updates,
                                                extraction.note, context.profile).model_dump())
    print(f"  propose_record_updates: added={[(c.category, c.value) for c in update.added]} "
          f"already_on_record={[(c.category, c.value) for c in update.already_on_record]}")
    found = [Prediction.model_validate(p.model_dump())
             for p in _timed("predict_outcomes", svc.predict_outcomes, context.profile, context.chunks, [])]
    kept, withheld = screen(found)
    print(f"  predict_outcomes: {len(found)} predictions, {withheld} would be withheld (advice or no evidence)")
    for p in kept:
        print(f"    [{p.likelihood}] {p.outcome}")
    answer = QAAnswer.model_validate(_timed("answer_question", svc.answer_question,
                                            "When was the last visit recorded?", context).model_dump())
    print(f"  answer_question: {len(answer.answer)} chars, {len(answer.citations)} citations")


def probe_privacy(svc) -> None:
    _timed("load", svc.load)
    texts, counts = _timed("scrub_texts", svc.scrub_texts, [PRIVACY_SAMPLE],
                           allow_terms=["Amoxicillin"], deny_terms=["Ravi"])
    print(f"  in : {PRIVACY_SAMPLE}")
    print(f"  out: {texts[0]}")
    print(f"  counts: {counts}")


def probe_research(svc) -> None:
    if svc is None:
        sys.exit("RESEARCH_BACKEND=off: nothing to probe.")
    _timed("load", svc.load)
    query = QUERY_TEMPLATE.format(drug="amoxicillin")
    hits = [ResearchHit.model_validate(h.model_dump()) for h in _timed("search", svc.search, query, max_results=3)]
    print(f"  query: {query!r} -> {len(hits)} hits")
    for h in hits:
        print(f"    {h.domain} | {h.title[:80]} | {h.published_date}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Probe one service outside the pipeline.")
    ap.add_argument("service", choices=SERVICE_KINDS)
    ap.add_argument("audio", nargs="?", type=Path, help="audio file (stt only)")
    args = ap.parse_args()

    settings = get_settings()
    backend = getattr(settings, f"{args.service}_backend")
    print(f"probing {args.service} (backend={backend})")
    svc = build_one(args.service, settings)
    if args.service == "stt":
        probe_stt(svc, args.audio)
    elif args.service == "rag":
        probe_rag(svc)
    elif args.service == "llm":
        probe_llm(svc, settings.mock_default_scenario)
    elif args.service == "privacy":
        probe_privacy(svc)
    else:
        probe_research(svc)
    gpus = _gpu_memory()
    if gpus:
        print(f"  gpus: {gpus}")
    if svc is not None:
        svc.unload()


if __name__ == "__main__":
    main()
