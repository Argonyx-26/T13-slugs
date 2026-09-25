"""Picks mock or real for every service, from the settings.

Imports are lazy, so a laptop without torch, whisperx or presidio still runs
everything on mocks. Teammate code is only ever reached through app/services/real/.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings
from app.contracts import LLMService, PrivacyService, RAGService, ResearchService, STTService
from app.fixtures import load_fixture

SERVICE_KINDS = ("stt", "rag", "llm", "privacy", "research")


@dataclass
class Services:
    stt: STTService
    rag: RAGService
    llm: LLMService
    privacy: PrivacyService
    research: ResearchService | None       # None when RESEARCH_BACKEND=off


def build_services(s: Settings) -> Services:
    scenarios = load_fixture("scenarios.json")
    patients = load_fixture("demo_patients.json")["patients"]
    return Services(**{kind: _build(kind, s, scenarios, patients) for kind in SERVICE_KINDS})


def build_one(kind: str, s: Settings):
    """Build a single service (scripts/probe_module.py tests one module at a time)."""
    return _build(kind, s, load_fixture("scenarios.json"), load_fixture("demo_patients.json")["patients"])


def _build(kind: str, s: Settings, scenarios: dict, patients: list[dict]):
    if kind == "stt":
        if s.stt_backend == "mock":
            from app.services.mocks.stt import MockSTT
            return MockSTT(s, scenarios)
        from app.services.real.stt_adapter import RealSTT
        return RealSTT(s)

    if kind == "rag":
        if s.rag_backend == "mock":
            from app.services.mocks.rag import MockRAG
            return MockRAG(s, patients)
        from app.services.real.rag_adapter import RealRAG
        return RealRAG(s)

    if kind == "llm":
        if s.llm_backend == "mock":
            from app.services.mocks.llm import MockLLM
            return MockLLM(s, scenarios)
        from app.services.real.llm_ollama import OllamaLLM
        return OllamaLLM(s)

    if kind == "privacy":
        if s.privacy_backend == "mock":
            from app.services.mocks.privacy import MockPrivacy
            demo_first_names = [n for p in patients for n in p.get("first_names", [])]
            return MockPrivacy(s, demo_first_names)
        from app.services.real.privacy_presidio import PresidioPrivacy
        return PresidioPrivacy(s)

    if kind == "research":
        if s.research_backend == "off":
            return None
        if s.research_backend == "mock":
            from app.services.mocks.research import MockResearch
            return MockResearch(s)
        from app.services.real.research_tavily import TavilyResearch
        return TavilyResearch(s)

    raise ValueError(f"unknown service kind: {kind}")
