"""Small helpers for turning row-level validation failures into API responses."""

from fastapi import HTTPException


def row_error(row_number: int | None, error: Exception) -> HTTPException:
    """Return a client-safe validation error that identifies the affected row."""
    prefix = f"Row {row_number}: " if row_number is not None else ""
    return HTTPException(status_code=422, detail=f"{prefix}{error}")
