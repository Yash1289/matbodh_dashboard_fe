"""Reshape engine results into uniform rows. Never computes numbers."""

from .rows import NormalRow, from_analysis, from_benchmark

__all__ = ["NormalRow", "from_analysis", "from_benchmark"]
