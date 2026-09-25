"""Mock web research. Results are titled [MOCK] and point at example.org, so they can
never be mistaken for real drug information."""
import time

from app.contracts import ResearchHit


class MockResearch:
    name = "mock-research"

    def __init__(self, settings):
        self._scale = settings.mock_latency_scale

    def load(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def search(self, query: str, *, max_results: int = 3) -> list[ResearchHit]:
        time.sleep(0.5 * self._scale)
        drug = query.split(" drug safety", 1)[0]
        return [ResearchHit(
            title=f"[MOCK] {drug.capitalize()}: prescribing information summary",
            url=f"https://example.org/mock/{drug.replace(' ', '-')}",
            domain="example.org",
            snippet="[MOCK] Placeholder research result for offline development. Not real drug information.",
        )][:max_results]
