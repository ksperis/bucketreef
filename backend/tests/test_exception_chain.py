# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.exception_chain import iter_exception_chain


def test_iter_exception_chain_prefers_explicit_cause():
    context = ValueError("context")
    cause = KeyError("cause")
    outer = RuntimeError("outer")
    outer.__context__ = context
    outer.__cause__ = cause

    assert list(iter_exception_chain(outer)) == [outer, cause]


def test_iter_exception_chain_stops_at_suppressed_context():
    hidden = ValueError("hidden")
    outer = RuntimeError("outer")
    outer.__context__ = hidden
    outer.__suppress_context__ = True

    assert list(iter_exception_chain(outer)) == [outer]


def test_iter_exception_chain_breaks_cycles():
    first = RuntimeError("first")
    second = RuntimeError("second")
    first.__cause__ = second
    second.__cause__ = first

    assert list(iter_exception_chain(first)) == [first, second]
