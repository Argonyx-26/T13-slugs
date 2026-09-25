"""PHI-safe logging. Use event() everywhere; never log transcripts, notes or names.

Kaggle stores notebook output with every saved version, so anything printed is
effectively persisted. event() only writes allow-listed keys with short scalar
values; anything else is replaced with <dropped>.
"""
import logging

log = logging.getLogger("scribe")

_ALLOWED_KEYS = {"job", "stage", "ms", "code", "status", "count", "backend",
                 "queue", "patient", "note", "drugs", "hits", "policy", "path_kind", "visit"}


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    log.setLevel(level)


def event(name: str, **fields) -> None:
    parts = [name]
    for key, value in fields.items():
        safe = key in _ALLOWED_KEYS and (
            value is None or isinstance(value, (bool, int, float))
            or (isinstance(value, str) and len(value) <= 64 and "\n" not in value))
        parts.append(f"{key}={value if safe else '<dropped>'}")
    log.info(" ".join(parts))
