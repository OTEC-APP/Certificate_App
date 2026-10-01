"""Translate internal failures into API responses that never leak raw exception text."""

from __future__ import annotations

import logging

from fastapi import HTTPException
from pydantic import ValidationError

logger = logging.getLogger("certtrack.errors")


def _validation_summary(error: ValidationError) -> str:
    """Render Pydantic field errors as a short, client-safe sentence."""
    parts: list[str] = []
    for item in error.errors():
        field = ".".join(str(part) for part in item.get("loc", ()) if part not in {"body", "query", "path"})
        message = str(item.get("msg") or "is invalid")
        parts.append(f"{field} {message}".strip() if field else message)
    return "; ".join(parts) or "is invalid"


def row_error(row_number, error: Exception) -> HTTPException:
    """Describe an invalid bulk-upload row without exposing internals."""
    summary = _validation_summary(error) if isinstance(error, ValidationError) else "is invalid"
    return HTTPException(status_code=400, detail=f"Row {row_number}: {summary}")


def service_error(message: str, error: Exception, status_code: int = 503) -> HTTPException:
    """Log the real failure server-side and return a fixed public message."""
    logger.error("%s (%s): %s", message, type(error).__name__, error, exc_info=error)
    return HTTPException(status_code=status_code, detail=message)
