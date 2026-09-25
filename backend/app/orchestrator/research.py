"""Web research (Tavily) with a hard privacy rule: a query is always
"<generic drug name from our own vocabulary> drug safety warnings interactions".
No transcript text, symptom, name or ID can ever be part of what leaves the server."""
from __future__ import annotations

import asyncio
import time

from app.contracts import ClinicalNote, DrugResearch, ResearchHit, ResearchService
from app.orchestrator.safety_rules import DrugRules

QUERY_TEMPLATE = "{drug} drug safety warnings interactions"


def build_queries(note: ClinicalNote, rules: DrugRules, max_drugs: int) -> list[tuple[str, str]]:
    """(generic_name, query) pairs. Drugs missing from the vocabulary are skipped."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for p in note.prescriptions:
        g = rules.generic_name(p.drug)
        if g and g not in seen:
            seen.add(g)
            out.append((g, QUERY_TEMPLATE.format(drug=g)))
    return out[:max_drugs]


class ResearchCache:
    """Tiny TTL cache: saves Tavily credits (1,000/month free) and survives venue Wi-Fi hiccups."""

    def __init__(self, ttl_s: float):
        self._ttl = ttl_s
        self._data: dict[str, tuple[float, list[ResearchHit]]] = {}

    def get(self, query: str) -> list[ResearchHit] | None:
        item = self._data.get(query)
        if item and time.monotonic() - item[0] < self._ttl:
            return item[1]
        return None

    def put(self, query: str, hits: list[ResearchHit]) -> None:
        self._data[query] = (time.monotonic(), hits)


async def fetch(queries: list[tuple[str, str]], service: ResearchService, cache: ResearchCache,
                per_drug: int, timeout_s: float) -> list[DrugResearch]:
    """Run all queries in parallel (threads), with one overall timeout."""

    async def one(drug: str, query: str) -> DrugResearch:
        hits = cache.get(query)
        if hits is None:
            hits = await asyncio.to_thread(service.search, query, max_results=per_drug)
            cache.put(query, hits)
        return DrugResearch(drug=drug, query=query, hits=hits)

    return list(await asyncio.wait_for(
        asyncio.gather(*(one(d, q) for d, q in queries)), timeout=timeout_s))
