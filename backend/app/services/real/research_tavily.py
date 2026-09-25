"""Real web research through Tavily (ours, not a teammate module).
Queries arrive already privacy-safe (see app/orchestrator/research.py); this adapter
adds a trusted-domain filter so only regulator / reference sources reach the doctor."""
from urllib.parse import urlparse

from app.contracts import ResearchHit


class TavilyResearch:
    name = "tavily"

    def __init__(self, settings):
        self._key = settings.tavily_api_key
        self._domains = [d.lower() for d in settings.research_domains]
        self._timeout = settings.research_timeout_s
        self._client = None

    def load(self) -> None:
        if self._client is None:
            if not self._key:
                raise RuntimeError("TAVILY_API_KEY is not set")
            from tavily import TavilyClient
            self._client = TavilyClient(api_key=self._key)

    def unload(self) -> None:
        self._client = None

    def _trusted(self, host: str) -> bool:
        return any(host == d or host.endswith("." + d) for d in self._domains)

    def search(self, query: str, *, max_results: int = 3) -> list[ResearchHit]:
        response = self._client.search(query, search_depth="basic", max_results=max_results + 2,
                                       include_domains=self._domains, timeout=self._timeout)
        hits: list[ResearchHit] = []
        for r in response.get("results", []):
            host = (urlparse(r.get("url", "")).hostname or "").lower()
            if not self._trusted(host):
                continue
            hits.append(ResearchHit(title=(r.get("title") or host)[:200], url=r["url"], domain=host,
                                    snippet=(r.get("content") or "")[:500],
                                    published_date=r.get("published_date")))
            if len(hits) >= max_results:
                break
        return hits
