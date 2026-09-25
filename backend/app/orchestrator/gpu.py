"""Decides which GPU models are in memory.

resident: load every GPU service once at startup (Kaggle T4 x2: STT on GPU 0,
          LLM served by Ollama pinned to GPU 1). Fastest; the default.
swap:     keep only one GPU service loaded at a time (single 16 GB GPU).
          Slower: every job pays the model load time, recorded in timings_ms.
Only one job runs at a time (JobManager semaphore), so there are no races here.
"""
from __future__ import annotations

import asyncio
import time


class GpuResidency:
    def __init__(self, policy: str, gpu_services: list):
        self.policy = policy
        self.gpu_services = gpu_services
        self._loaded: set[int] = set()

    def is_loaded(self, svc) -> bool:
        return id(svc) in self._loaded

    async def startup(self) -> None:
        targets = self.gpu_services if self.policy == "resident" else self.gpu_services[:1]
        for svc in targets:
            await asyncio.to_thread(svc.load)
            self._loaded.add(id(svc))

    async def ensure(self, svc, timings: dict[str, int]) -> None:
        if self.policy == "resident" or id(svc) in self._loaded:
            return
        t0 = time.perf_counter()
        for other in self.gpu_services:
            if other is not svc and id(other) in self._loaded:
                await asyncio.to_thread(other.unload)
                self._loaded.discard(id(other))
        await asyncio.to_thread(svc.load)
        self._loaded.add(id(svc))
        timings[f"load_{svc.name}"] = int((time.perf_counter() - t0) * 1000)

    async def shutdown(self) -> None:
        for svc in self.gpu_services:
            if id(svc) in self._loaded:
                await asyncio.to_thread(svc.unload)
        self._loaded.clear()
