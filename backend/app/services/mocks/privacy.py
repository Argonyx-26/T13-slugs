"""Mock privacy scrubber: replaces the demo first names and any deny_terms with <PERSON>."""
import re
import time


class MockPrivacy:
    name = "mock-privacy"

    def __init__(self, settings, known_names: list[str]):
        self._scale = settings.mock_latency_scale
        self._known_names = known_names

    def load(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def scrub_texts(self, texts: list[str], *, allow_terms: list[str],
                    deny_terms: list[str]) -> tuple[list[str], dict[str, int]]:
        time.sleep(0.05 * self._scale)
        allowed = {t.lower() for t in allow_terms}
        names = {n for n in [*self._known_names, *deny_terms] if n and n.lower() not in allowed}
        if not names:
            return list(texts), {}
        pattern = re.compile(r"\b(?:" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")\b",
                             re.IGNORECASE)
        out, count = [], 0
        for text in texts:
            clean, n = pattern.subn("<PERSON>", text)
            out.append(clean)
            count += n
        return out, ({"PERSON": count} if count else {})
