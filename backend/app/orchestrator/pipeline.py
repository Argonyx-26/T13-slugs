"""The Orchestrator: runs one consultation through every stage, in a fixed order,
and applies the failure rules (fail closed on privacy, fail visible on safety).

    transcribe -> write note -> privacy wall -> (history || web research) -> safety
      -> save (AI scribe) -> update the patient record -> predict likely outcomes

Only LLM pass 1 sees the raw transcript, on our own GPU. Everything after the privacy
wall (history lookup, Tavily, the later LLM passes, storage, the app) sees scrubbed text
only. Notes are saved automatically as "ai_scribe" (not yet reviewed); the doctor can
confirm, correct or discard them, and ai_scribe facts never take precedence over the
doctor's own notes or the clinic's records.
"""
from __future__ import annotations

import asyncio
import re
import sys
import time
import uuid
from datetime import date
from typing import Callable

from fastapi import UploadFile

from app.api_models import (ApproveRequest, ApproveResponse, Checks, ConsultationAccepted,
                            ConsultationResult, Stage)
from app.config import Settings
from app.contracts import (ClinicalNote, DrugResearch, NoteFacts, NoteMeta, PatientContext, PatientSummary,
                           Prediction, PredictionReport, QAAnswer, RecordChange, RecordUpdate, SafetyAlert)
from app.errors import ApiError, StageError
from app.logging_setup import event
from app.orchestrator import intake, predictions, record_update, research
from app.orchestrator.gpu import GpuResidency
from app.orchestrator.jobs import Draft, Job, JobManager, utcnow
from app.orchestrator.registry import Services
from app.orchestrator.safety_rules import DrugRules, merge_alerts

DISCLAIMER = ("AI-generated note, saved automatically and awaiting clinician review. It is not a diagnosis "
              "or a treatment recommendation; the doctor makes every clinical decision.")

# The exact refusal sentence from centralbrain.md ("Opinion Rejection").
REFUSAL = ("I am an analytical assistant and cannot provide medical opinions or diagnoses. "
           "I can only provide data summaries and literature research.")

# Opinion-seeking questions are refused without calling the LLM.
_OPINION_QUESTION = re.compile(
    r"diagnos|what do you think|what(?:'|’)?s wrong|what is wrong"
    r"|should i (?:prescribe|give|start|stop|change)|recommend"
    r"|best (?:drug|medicine|treatment)|treatment plan|your opinion",
    re.IGNORECASE)


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def _name_terms(patient: PatientSummary | None) -> list[str]:
    """The patient's name words, which the scrubber always redacts."""
    if patient is None:
        return []
    return [w for w in re.findall(r"[^\W\d_]+", patient.display_name) if len(w) >= 3]


def _history_query(note: ClinicalNote) -> str:
    """English search text for the history lookup (the embedding model is English-only)."""
    parts = [note.chief_complaint or ""] + [s.name for s in note.symptoms] + [p.drug for p in note.prescriptions]
    return " ".join(p for p in parts if p)


def _text_slots(n: ClinicalNote) -> list[tuple[str, Callable[[str], None]]]:
    """Every free-text field of a note, with a setter to write the scrubbed text back."""
    slots: list[tuple[str, Callable[[str], None]]] = []

    def attr(obj, name: str) -> None:
        value = getattr(obj, name)
        if value:
            slots.append((value, lambda v, o=obj, a=name: setattr(o, a, v)))

    attr(n, "chief_complaint")
    attr(n, "summary")
    attr(n, "doctor_assessment")
    for i, text in enumerate(n.relevant_history):
        slots.append((text, lambda v, i=i: n.relevant_history.__setitem__(i, v)))
    for s in n.symptoms:
        attr(s, "notes")
    for a in n.action_items:
        attr(a, "description")
    return slots


def _gpu_memory() -> list[dict]:
    """GPU memory per device, only if torch is already imported (never imports it on a laptop)."""
    torch = sys.modules.get("torch")
    if torch is None:
        return []
    try:
        if not torch.cuda.is_available():
            return []
        out = []
        for i in range(torch.cuda.device_count()):
            free, total = torch.cuda.mem_get_info(i)
            out.append({"index": i, "name": torch.cuda.get_device_name(i),
                        "free_mb": free // 2**20, "total_mb": total // 2**20})
        return out
    except Exception:
        return []


class Orchestrator:
    def __init__(self, settings: Settings, services: Services):
        self.s = settings
        self.svc = services
        self.rules = DrugRules.load()
        self.gpu = GpuResidency(settings.gpu_policy,
                                [x for x in (services.stt, services.llm) if getattr(x, "uses_gpu", False)])
        self.cache = research.ResearchCache(settings.research_cache_hours * 3600)
        self.jobs = JobManager(runner=self.run, max_concurrent=settings.max_concurrent_jobs,
                               ttl_minutes=settings.job_ttl_minutes)
        self.scratch = intake.pick_scratch_dir(settings.audio_scratch_dir)
        self.research_ready = False
        self.started = False
        self.predictions: dict[uuid.UUID, PredictionReport] = {}   # latest per patient; memory only
        self._background: set[asyncio.Task] = set()   # strong refs: sweeper, prefetch, post-review refresh
        self._busy_notes: set[str] = set()            # note_ids being confirmed/discarded (double-tap guard)

    # ---------------------------------------------------------------- lifecycle

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def startup(self) -> None:
        removed = intake.sweep_scratch(self.scratch)
        if removed:
            event("scratch_swept", count=removed)
        await asyncio.to_thread(self.svc.rag.load)
        await asyncio.to_thread(self.svc.privacy.load)
        if self.svc.research is not None:
            try:
                await asyncio.to_thread(self.svc.research.load)
                self.research_ready = True
            except Exception as e:
                event("research_unavailable", backend=self.svc.research.name, code=type(e).__name__)
        await self.gpu.startup()
        self._spawn(self.jobs.sweep_forever())
        if self.research_ready and self.s.research_prefetch:
            self._spawn(self._prefetch())
        self.started = True
        event("orchestrator_started", policy=self.s.gpu_policy, status="ready")

    async def shutdown(self) -> None:
        for task in list(self._background):
            task.cancel()
        await asyncio.gather(*self._background, return_exceptions=True)
        await self.jobs.shutdown()
        await self.gpu.shutdown()
        cpu_services = [self.svc.rag, self.svc.privacy] + ([self.svc.research] if self.svc.research else [])
        for svc in cpu_services:
            try:
                await asyncio.to_thread(svc.unload)
            except Exception as e:
                event("unload_failed", backend=svc.name, code=type(e).__name__)
        self.started = False

    async def _prefetch(self) -> None:
        """Warm the research cache with the demo drugs (saves credits, survives flaky Wi-Fi).
        Only vocabulary drugs are ever queried, exactly as in a job."""
        seen: set[str] = set()
        queries = []
        for name in self.s.research_prefetch:
            g = self.rules.generic_name(name)
            if g and g not in seen:
                seen.add(g)
                queries.append((g, research.QUERY_TEMPLATE.format(drug=g)))
        t0 = time.perf_counter()
        try:
            found = await research.fetch(queries, self.svc.research, self.cache,
                                         self.s.research_results_per_drug, self.s.research_timeout_s)
            event("research_prefetched", count=len(found), hits=sum(len(r.hits) for r in found), ms=_ms(t0))
        except Exception as e:
            event("research_prefetch_failed", code=type(e).__name__)

    def readiness(self) -> dict:
        s = self.s
        return {
            "ready": self.started,
            "backends": {"stt": s.stt_backend, "rag": s.rag_backend, "llm": s.llm_backend,
                         "privacy": s.privacy_backend, "research": s.research_backend},
            "gpu_policy": s.gpu_policy,
            "gpu_models_loaded": {"stt": self.gpu.is_loaded(self.svc.stt), "llm": self.gpu.is_loaded(self.svc.llm)},
            "research_available": self.research_ready,
            "pending_jobs": len(self.jobs.pending()),
            "gpus": _gpu_memory(),
        }

    # ---------------------------------------------------------------- intake

    async def _lookup_patient(self, patient_uuid: uuid.UUID) -> PatientSummary | None:
        """404 for an unknown patient. None if the registry is down: the upload is then
        accepted (history will show as unavailable on the draft)."""
        try:
            patients = await asyncio.to_thread(self.svc.rag.list_patients)
        except Exception as e:
            event("patient_registry_unavailable", code=type(e).__name__)
            return None
        match = next((p for p in patients if p.patient_uuid == patient_uuid), None)
        if match is None:
            raise ApiError(404, "PATIENT_NOT_FOUND", "Unknown patient_uuid.")
        return match

    async def require_patient(self, patient_uuid: uuid.UUID) -> list[str]:
        """404 for an unknown patient. Returns the patient's name words, for the scrubber."""
        return _name_terms(await self._lookup_patient(patient_uuid))

    async def _check_visit(self, visit_id: str, patient_uuid: uuid.UUID) -> None:
        """The phone sends two IDs and they must agree: the queue entry must be in today's
        queue and belong to this patient. If the queue can't be read the upload is accepted."""
        try:
            visits = await asyncio.to_thread(self.svc.rag.list_visits, self.s.clinic_today())
        except Exception as e:
            event("visit_registry_unavailable", code=type(e).__name__)
            return
        visit = next((v for v in visits if v.visit_id == visit_id), None)
        if visit is None:
            raise ApiError(404, "VISIT_NOT_FOUND", "Unknown visit_id: it is not in today's queue.")
        if visit.patient_uuid != patient_uuid:
            raise ApiError(409, "VISIT_PATIENT_MISMATCH", "This queue entry belongs to a different patient.")

    async def submit(self, upload: UploadFile, patient_uuid: uuid.UUID, language_hint: str,
                     visit_id: str | None = None) -> ConsultationAccepted:
        if len(self.jobs.pending()) >= self.s.max_pending_jobs:
            raise ApiError(429, "BUSY", "The server is busy with other consultations. Try again shortly.")
        patient = await self._lookup_patient(patient_uuid)
        visit_id = visit_id or None                     # an empty form field means a walk-in
        if visit_id:
            await self._check_visit(visit_id, patient_uuid)
        job_id = uuid.uuid4().hex
        audio_path = await intake.save_upload(upload, job_id, self.scratch, self.s.max_upload_bytes)
        job = Job(job_id=job_id, patient_uuid=patient_uuid, audio_path=audio_path, visit_id=visit_id,
                  name_terms=_name_terms(patient), language_hint=None if language_hint == "auto" else language_hint)
        self.jobs.submit(job)
        if visit_id:
            try:                                        # the recording is safe either way
                await asyncio.to_thread(self.svc.rag.mark_visit_seen, visit_id)
            except Exception as e:
                event("visit_update_failed", job=job_id, code=type(e).__name__)
        position = self.jobs.queue_position(job)
        event("job_queued", job=job_id, queue=position, visit=visit_id)
        return ConsultationAccepted(job_id=job_id, stage=job.stage, queue_position=position,
                                    status_url=f"/api/v1/jobs/{job_id}", patient_uuid=patient_uuid,
                                    display_name=patient.display_name if patient else None, visit_id=visit_id)

    # ---------------------------------------------------------------- the pipeline

    async def run(self, job: Job) -> None:
        try:
            await self._pipeline(job)
        except StageError as e:
            job.fail(e.stage, e.code, e.message)
            event("job_failed", job=job.job_id, stage=e.stage, code=e.code)
        except asyncio.CancelledError:
            job.fail(job.stage.value, "CANCELLED", "The server shut down while processing.")
            raise
        except Exception as e:                      # a bug: still end the job cleanly
            job.fail(job.stage.value, "INTERNAL_ERROR", "Unexpected error while processing the consultation.")
            event("job_crashed", job=job.job_id, stage=job.stage.value, code=type(e).__name__)
        finally:
            intake.discard(job.audio_path)          # the recording never outlives the job
            job.audio_path = None

    async def _call(self, job: Job, key: str, code: str, fn, *args, **kwargs):
        """Run a blocking service call in a thread; time it; turn any error into a StageError."""
        t0 = time.perf_counter()
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except Exception as e:
            raise StageError(job.stage.value, code, f"{key} failed ({type(e).__name__}).") from e
        finally:
            job.timings_ms[key] = _ms(t0)

    async def _pipeline(self, job: Job) -> None:
        svc, t = self.svc, job.timings_ms

        # 1. Transcribe (the STT module never learns who the patient is)
        job.set_stage(Stage.transcribing)
        await self.gpu.ensure(svc.stt, t)

        def on_progress(p: float) -> None:
            job.progress = round(min(max(p, 0.0), 1.0), 3)

        transcript = await self._call(job, "stt", "STT_FAILED", svc.stt.transcribe, job.audio_path,
                                      language_hint=job.language_hint, on_progress=on_progress)
        intake.discard(job.audio_path)              # audio is not needed any more
        job.audio_path = None
        if not any(seg.text.strip() for seg in transcript.segments):
            raise StageError("transcribing", "NO_SPEECH", "No speech was detected in the recording.")

        # 2. Write the note (LLM pass 1: translate + structure; it runs on our own GPU)
        job.set_stage(Stage.writing_note)
        await self.gpu.ensure(svc.llm, t)
        extraction = await self._call(job, "llm_extract", "NOTE_GENERATION_FAILED",
                                      svc.llm.extract_note, transcript)

        # 3. Privacy wall: history lookup, web search, AI review and storage only see scrubbed text
        job.set_stage(Stage.scrubbing_pii)
        t0 = time.perf_counter()
        try:
            note, redactions = await self._scrub_note(extraction.note, job.name_terms)
        except Exception as e:
            raise StageError("scrubbing_pii", "PRIVACY_SCRUB_FAILED",
                             "Personal identifiers could not be removed; nothing was stored or sent.") from e
        finally:
            t["scrub"] = _ms(t0)

        # 4. History lookup and web research, in parallel
        job.set_stage(Stage.gathering_context)
        t0 = time.perf_counter()
        (context, history_status), (found, research_status) = await asyncio.gather(
            self._history(job, note), self._research(job, note))
        t["gathering_context"] = _ms(t0)

        # 5. Safety: LLM review + deterministic rules, merged
        job.set_stage(Stage.checking_safety)
        checks = Checks(history=history_status, web_research=research_status)
        llm_alerts, checks.ai_review = await self._ai_review(job, note, context, found)
        rule_alerts, checks.rules = self._rule_check(job, note, context)
        alerts = merge_alerts(llm_alerts, rule_alerts)
        if history_status != "ok":
            alerts.insert(0, SafetyAlert(
                category="data_gap", severity="warning", origin="system",
                message="Patient history could not be loaded. Allergy and interaction "
                        "cross-checks were NOT performed for this note."))

        draft = Draft(note_id=uuid.uuid4().hex, job_id=job.job_id, patient_uuid=job.patient_uuid,
                      note=note, alerts=alerts, stt_engine=transcript.engine, llm_model=extraction.model,
                      visit_at=job.created_at, visit_id=job.visit_id, name_terms=job.name_terms)
        self.jobs.drafts[draft.note_id] = draft
        result = ConsultationResult(
            note_id=draft.note_id, status="draft", note=note, alerts=alerts, checks=checks,
            research=found, privacy=redactions, transcript=transcript,
            speaker_roles=dict(extraction.speaker_roles),
            models={"stt": transcript.engine, "llm": extraction.model}, disclaimer=DISCLAIMER)

        # 6. Save to the patient record automatically, marked "ai_scribe" (not yet reviewed)
        job.set_stage(Stage.saving)
        t0 = time.perf_counter()
        try:
            await self._save_note(draft, note, source="ai_scribe")
        except Exception as e:                      # nothing is lost: the draft waits for a retry
            event("stage_degraded", job=job.job_id, stage="saving", code=type(e).__name__)
            result.alerts = [SafetyAlert(
                category="data_gap", severity="warning", origin="system",
                message="This note could not be saved to the patient record. It is kept as a draft for "
                        f"{self.s.job_ttl_minutes} minutes: review it and tap Save to try again.")] + alerts
            job.result = result
            job.set_stage(Stage.ready_for_review)
            return
        finally:
            t["save"] = _ms(t0)
        draft.status = result.status = "saved"

        # 7. Add what is new to the patient record; ignore what is already there
        job.set_stage(Stage.updating_record)
        result.record_update, checks.record_update = await self._update_record(draft, "ai_scribe", t)

        # 8. Re-read the whole history and estimate likely outcomes
        job.set_stage(Stage.predicting)
        result.predictions, checks.predictions = await self._predict(job.patient_uuid, job.name_terms, t)

        job.result = result
        job.set_stage(Stage.saved)
        event("job_saved", job=job.job_id, count=len(alerts), status=checks.safety_check)

    async def _scrub_note(self, note: ClinicalNote, names: list[str]) -> tuple[ClinicalNote, dict[str, int]]:
        copy = note.model_copy(deep=True)
        slots = _text_slots(copy)
        allow = [p.drug for p in copy.prescriptions] + [s.name for s in copy.symptoms]
        texts, counts = await asyncio.to_thread(self.svc.privacy.scrub_texts, [text for text, _ in slots],
                                                allow_terms=allow, deny_terms=names)
        if len(texts) != len(slots):
            raise ValueError("scrubber returned the wrong number of texts")
        for (_, setter), clean in zip(slots, texts):
            setter(clean)
        return copy, counts

    async def _history(self, job: Job, note: ClinicalNote) -> tuple[PatientContext, str]:
        t0 = time.perf_counter()
        try:
            profile = await asyncio.to_thread(self.svc.rag.get_profile, job.patient_uuid)
            chunks = await asyncio.to_thread(self.svc.rag.retrieve, job.patient_uuid, _history_query(note), 8)
            return PatientContext(profile=profile, chunks=chunks), ("ok" if profile else "unavailable")
        except Exception as e:
            event("stage_degraded", job=job.job_id, stage="history", code=type(e).__name__)
            return PatientContext(), "unavailable"
        finally:
            job.timings_ms["history"] = _ms(t0)

    async def _research(self, job: Job, note: ClinicalNote) -> tuple[list[DrugResearch], str]:
        if self.svc.research is None:
            return [], "skipped"
        queries = research.build_queries(note, self.rules, self.s.research_max_drugs)
        if not queries:
            return [], "skipped"
        if not self.research_ready:
            return [], "unavailable"
        t0 = time.perf_counter()
        try:
            found = await research.fetch(queries, self.svc.research, self.cache,
                                         self.s.research_results_per_drug, self.s.research_timeout_s)
            return found, "ok"
        except Exception as e:                      # includes the overall timeout
            event("stage_degraded", job=job.job_id, stage="web_research", code=type(e).__name__)
            return [], "unavailable"
        finally:
            job.timings_ms["web_research"] = _ms(t0)

    async def _ai_review(self, job: Job, note: ClinicalNote, context: PatientContext,
                         found: list[DrugResearch]) -> tuple[list[SafetyAlert], str]:
        t0 = time.perf_counter()
        try:
            await self.gpu.ensure(self.svc.llm, job.timings_ms)
            raw = await asyncio.to_thread(self.svc.llm.review_safety, note, context, found)
            alerts = [a.model_copy(update={
                "origin": "llm",
                "drug": (self.rules.generic_name(a.drug) or a.drug.strip().lower()) if a.drug else None})
                for a in raw]
            if alerts:
                # The review read clinic records, which may contain names: scrub what it wrote.
                texts = [a.message for a in alerts] + [e.snippet for a in alerts for e in a.evidence]
                allow = [p.drug for p in note.prescriptions] + [s.name for s in note.symptoms]
                clean, _ = await asyncio.to_thread(self.svc.privacy.scrub_texts, texts,
                                                   allow_terms=allow, deny_terms=job.name_terms)
                if len(clean) != len(texts):
                    raise ValueError("scrubber returned the wrong number of texts")
                it = iter(clean)
                alerts = [a.model_copy(update={"message": next(it)}) for a in alerts]
                alerts = [a.model_copy(update={"evidence": [e.model_copy(update={"snippet": next(it)})
                                                            for e in a.evidence]})
                          for a in alerts]
            return alerts, "ok"
        except Exception as e:
            event("stage_degraded", job=job.job_id, stage="ai_review", code=type(e).__name__)
            return [], "unavailable"
        finally:
            job.timings_ms["llm_review"] = _ms(t0)

    def _rule_check(self, job: Job, note: ClinicalNote, context: PatientContext) -> tuple[list[SafetyAlert], str]:
        if context.profile is None:
            return [], "unavailable"
        try:
            return self.rules.check(note, context.profile, date.today()), "ok"
        except Exception as e:
            event("stage_degraded", job=job.job_id, stage="rules", code=type(e).__name__)
            return [], "unavailable"

    # ---------------------------------------------------------------- saving, record update, predictions

    async def _scrub_list(self, texts: list[str], allow: list[str], names: list[str]) -> list[str]:
        if not texts:
            return []
        clean, _ = await asyncio.to_thread(self.svc.privacy.scrub_texts, texts, allow_terms=allow, deny_terms=names)
        if len(clean) != len(texts):
            raise ValueError("scrubber returned the wrong number of texts")
        return clean

    async def _save_note(self, draft: Draft, note: ClinicalNote, *, source: str, verified_at=None,
                         edited: bool = False, acknowledged: list[str] | None = None) -> None:
        """Upsert the note into the patient record (RAG module)."""
        meta = NoteMeta(note_id=draft.note_id, job_id=draft.job_id, visit_id=draft.visit_id,
                        visit_at=draft.visit_at, saved_at=utcnow(),
                        source=source, verified_at=verified_at, edited_by_doctor=edited,
                        acknowledged_alert_ids=acknowledged or [], stt_engine=draft.stt_engine,
                        llm_model=draft.llm_model)
        await asyncio.to_thread(self.svc.rag.save_note, draft.patient_uuid, note, draft.alerts, meta)
        self.predictions.pop(draft.patient_uuid, None)        # the history changed
        event("note_saved", job=draft.job_id, note=draft.note_id, status=source)

    async def _update_record(self, draft: Draft, source: str,
                             timings: dict[str, int]) -> tuple[RecordUpdate | None, str]:
        """The LLM proposes the note's long-term facts; reconcile() keeps only what is new."""
        t0 = time.perf_counter()
        try:
            profile = await asyncio.to_thread(self.svc.rag.get_profile, draft.patient_uuid)
            if profile is None:
                return None, "unavailable"
            profile = record_update.without_note(profile, draft.note_id)   # re-processing replaces its own facts
            await self.gpu.ensure(self.svc.llm, timings)
            proposal = await asyncio.to_thread(self.svc.llm.propose_record_updates, draft.note, profile)
            proposal = await self._scrub_record_update(proposal, draft)
            update = record_update.reconcile(proposal, profile, self.rules)
            facts = record_update.to_note_facts(update.added, source=source, recorded_on=draft.visit_at.date(),
                                                note_id=draft.note_id)
            await asyncio.to_thread(self.svc.rag.set_note_facts, draft.patient_uuid, draft.note_id, facts)
            event("record_updated", job=draft.job_id, count=len(update.added))
            return update, "ok"
        except Exception as e:
            event("stage_degraded", job=draft.job_id, stage="record_update", code=type(e).__name__)
            return None, "unavailable"
        finally:
            timings["record_update"] = _ms(t0)

    async def _scrub_record_update(self, proposal: RecordUpdate, draft: Draft) -> RecordUpdate:
        """The LLM read the stored record, which may contain names: scrub what it wrote before storing it."""
        changes = proposal.added + proposal.already_on_record
        clean = await self._scrub_list([c.value for c in changes] + [c.note or "" for c in changes],
                                       allow=[p.drug for p in draft.note.prescriptions], names=draft.name_terms)
        n = len(changes)
        scrubbed = [RecordChange(category=c.category, value=clean[i], note=clean[n + i] or None)
                    for i, c in enumerate(changes)]
        return RecordUpdate(added=scrubbed[:len(proposal.added)], already_on_record=scrubbed[len(proposal.added):])

    async def _predict(self, patient_uuid: uuid.UUID, name_terms: list[str],
                       timings: dict[str, int]) -> tuple[PredictionReport | None, str]:
        """Likely outcomes from the whole stored history: rule engine + LLM, screened for advice.
        "partial" = the LLM was unavailable and only the rule engine's predictions are shown."""
        t0 = time.perf_counter()
        try:
            profile = await asyncio.to_thread(self.svc.rag.get_profile, patient_uuid)
            if profile is None:
                return None, "unavailable"
            history = await asyncio.to_thread(self.svc.rag.get_history, patient_uuid)
            notes = await asyncio.to_thread(self.svc.rag.list_notes, patient_uuid)
            history = history[: self.s.prediction_max_records]
            found = predictions.rule_predictions(profile, history, notes, self.rules)
            status, withheld = "ok", 0
            try:
                await self.gpu.ensure(self.svc.llm, timings)
                raw = await asyncio.to_thread(self.svc.llm.predict_outcomes, profile, history, found)
                kept, withheld = predictions.screen(raw)
                found += kept
            except Exception as e:
                event("stage_degraded", stage="predictions_ai", code=type(e).__name__)
                status = "partial"
            report = PredictionReport(
                patient_uuid=patient_uuid, generated_at=utcnow(),
                predictions=predictions.rank(await self._scrub_predictions(found, name_terms)),
                records_analysed=len(history), withheld=withheld,
                model=f"{self.svc.llm.name}+rules" if status == "ok" else "rule_engine",
                disclaimer=predictions.DISCLAIMER)
            self.predictions[patient_uuid] = report
            event("predictions_ready", count=len(report.predictions), status=status)
            return report, status
        except Exception as e:                      # includes a failed scrub: nothing unscrubbed is shown
            event("stage_degraded", stage="predictions", code=type(e).__name__)
            return None, "unavailable"
        finally:
            timings["predictions"] = _ms(t0)

    async def _scrub_predictions(self, found: list[Prediction], names: list[str]) -> list[Prediction]:
        texts: list[str] = []
        for p in found:
            texts += [p.outcome, p.reasoning, p.timeframe or ""] + [e.snippet for e in p.evidence]
        clean = iter(await self._scrub_list(texts, allow=[], names=names))
        out = []
        for p in found:
            outcome, reasoning, timeframe = next(clean), next(clean), next(clean)
            evidence = [e.model_copy(update={"snippet": next(clean)}) for e in p.evidence]
            out.append(p.model_copy(update={"outcome": outcome, "reasoning": reasoning,
                                            "timeframe": timeframe or None, "evidence": evidence}))
        return out

    async def get_predictions(self, patient_uuid: uuid.UUID, refresh: bool = False) -> PredictionReport:
        """The latest likely-outcome report for a patient, generated on demand (on the GPU slot)."""
        names = await self.require_patient(patient_uuid)
        if not refresh and patient_uuid in self.predictions:
            return self.predictions[patient_uuid]
        async with self.jobs.gpu_slot:
            if not refresh and patient_uuid in self.predictions:     # made while we waited for the GPU
                return self.predictions[patient_uuid]
            report, _ = await self._predict(patient_uuid, names, {})
        if report is None:
            raise ApiError(503, "HISTORY_UNAVAILABLE", "Patient records are unavailable right now.")
        return report

    # ---------------------------------------------------------------- doctor actions

    def _note_for_action(self, note_id: str) -> Draft:
        draft = self.jobs.drafts.get(note_id)
        if draft is None:
            raise ApiError(404, "NOTE_NOT_FOUND", "Unknown or expired note_id.")
        if draft.status not in ("draft", "saved") or note_id in self._busy_notes:
            raise ApiError(409, "NOTE_ALREADY_FINAL", "This note has already been confirmed or discarded.")
        return draft

    async def approve(self, note_id: str, req: ApproveRequest) -> ApproveResponse:
        """The doctor confirms the note, optionally with edits. It becomes a doctor note, and it and
        its facts then carry full doctor-note precedence. Also the retry path when the automatic
        save failed."""
        draft = self._note_for_action(note_id)
        self._busy_notes.add(note_id)
        try:
            note, edited = draft.note, False
            if req.note is not None:                # the doctor's edits pass the privacy wall again
                try:
                    note, _ = await self._scrub_note(req.note, draft.name_terms)
                except Exception as e:
                    event("approve_scrub_failed", note=note_id, code=type(e).__name__)
                    raise ApiError(503, "PRIVACY_SCRUB_FAILED",
                                   "Personal identifiers could not be removed; the note was not saved.") from e
                edited = note != draft.note
            was_saved = draft.status == "saved"
            now = utcnow()
            try:
                await self._save_note(draft, note, source="doctor_notes", verified_at=now, edited=edited,
                                      acknowledged=req.acknowledged_alert_ids)
            except Exception as e:
                event("save_failed", note=note_id, code=type(e).__name__)
                raise ApiError(503, "SAVE_FAILED", "The note could not be saved. Nothing was lost; "
                                                   "try again.") from e
            draft.note, draft.status, draft.verified_at = note, "verified", now
            job = self.jobs.jobs.get(draft.job_id)
            if job is not None and job.result is not None:
                job.result = job.result.model_copy(update={"status": "verified", "note": note})
                job.set_stage(Stage.verified)
            if was_saved and not edited:
                await self._confirm_note_facts(draft)            # same facts, now doctor-confirmed
            else:
                self._spawn(self._refresh_after_review(draft))   # new content: redo record update + predictions
            return ApproveResponse(note_id=note_id, status="verified", verified_at=now)
        finally:
            self._busy_notes.discard(note_id)

    async def _confirm_note_facts(self, draft: Draft) -> None:
        """The doctor confirmed the note unchanged: the facts it added become doctor-note facts."""
        try:
            profile = await asyncio.to_thread(self.svc.rag.get_profile, draft.patient_uuid)
            if profile is None:
                return
            facts = NoteFacts(**{field: [f.model_copy(update={"source": "doctor_notes"})
                                         for f in getattr(profile, field) if f.origin_note_id == draft.note_id]
                                 for field in ("allergies", "active_medications", "conditions")})
            await asyncio.to_thread(self.svc.rag.set_note_facts, draft.patient_uuid, draft.note_id, facts)
        except Exception as e:                      # the facts stay ai_scribe: the safe side
            event("stage_degraded", job=draft.job_id, stage="record_update", code=type(e).__name__)

    async def _refresh_after_review(self, draft: Draft) -> None:
        """After an edited confirmation (or a retried save), redo the record update and the
        predictions from the doctor's version. Background task, on the GPU slot."""
        timings: dict[str, int] = {}
        async with self.jobs.gpu_slot:
            update, update_status = await self._update_record(draft, "doctor_notes", timings)
            report, predict_status = await self._predict(draft.patient_uuid, draft.name_terms, timings)
        job = self.jobs.jobs.get(draft.job_id)
        if job is not None and job.result is not None:
            job.result.record_update, job.result.predictions = update, report
            job.result.checks.record_update, job.result.checks.predictions = update_status, predict_status
            job.updated_at = utcnow()

    async def discard_draft(self, note_id: str) -> dict:
        """Discard the note. An automatically saved note is removed from the record with its facts."""
        draft = self._note_for_action(note_id)
        self._busy_notes.add(note_id)
        try:
            if draft.status == "saved":
                try:
                    await asyncio.to_thread(self.svc.rag.delete_note, draft.patient_uuid, note_id)
                except Exception as e:
                    event("discard_failed", note=note_id, code=type(e).__name__)
                    raise ApiError(503, "HISTORY_UNAVAILABLE",
                                   "The note could not be removed from the patient record; try again.") from e
                self.predictions.pop(draft.patient_uuid, None)
            draft.status = "discarded"
            job = self.jobs.jobs.get(draft.job_id)
            if job is not None and job.result is not None:
                job.result = job.result.model_copy(update={"status": "discarded", "record_update": None,
                                                           "predictions": None})
                job.set_stage(Stage.discarded)
            event("note_discarded", job=draft.job_id, note=note_id)
            return {"note_id": note_id, "status": "discarded"}
        finally:
            self._busy_notes.discard(note_id)

    async def ask(self, patient_uuid: uuid.UUID, question: str) -> QAAnswer:
        if _OPINION_QUESTION.search(question):
            event("question_refused")
            return QAAnswer(answer=REFUSAL, refused=True)
        await self.require_patient(patient_uuid)
        try:
            profile = await asyncio.to_thread(self.svc.rag.get_profile, patient_uuid)
            chunks = await asyncio.to_thread(self.svc.rag.retrieve, patient_uuid, question, 8)
        except Exception as e:
            event("question_failed", stage="history", code=type(e).__name__)
            raise ApiError(503, "HISTORY_UNAVAILABLE", "Patient records are unavailable right now.") from e
        context = PatientContext(profile=profile, chunks=chunks)
        try:
            async with self.jobs.gpu_slot:
                await self.gpu.ensure(self.svc.llm, {})
                return await asyncio.to_thread(self.svc.llm.answer_question, question, context)
        except Exception as e:
            event("question_failed", stage="assistant", code=type(e).__name__)
            raise ApiError(503, "ASSISTANT_UNAVAILABLE", "The assistant is unavailable right now.") from e

    async def delete_patient(self, patient_uuid: uuid.UUID) -> dict:
        """Cascading deletion: stored records first, then every in-memory copy."""
        try:
            deleted = await asyncio.to_thread(self.svc.rag.delete_patient, patient_uuid)
        except Exception as e:
            event("delete_failed", code=type(e).__name__)
            raise ApiError(503, "HISTORY_UNAVAILABLE", "Patient records are unavailable right now.") from e
        self.predictions.pop(patient_uuid, None)
        for note_id in [k for k, d in self.jobs.drafts.items() if d.patient_uuid == patient_uuid]:
            del self.jobs.drafts[note_id]
        for job in self.jobs.jobs.values():
            if job.patient_uuid == patient_uuid:
                job.result = None
                job.name_terms = []
        event("patient_deleted", count=deleted)
        return {"patient_uuid": str(patient_uuid), "deleted_records": deleted}
