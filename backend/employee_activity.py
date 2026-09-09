"""Consistent employee activity timestamps for list and profile responses."""

from datetime import datetime, timezone


def latest_certificate_at(certificates):
    """Use submission time, falling back to issue date for legacy records."""
    timestamps = []
    for certificate in certificates:
        for field in ("created_at", "issued_date"):
            value = certificate.get(field)
            if not value:
                continue
            try:
                timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            timestamps.append(timestamp.astimezone(timezone.utc))
            break
    return max(timestamps).isoformat() if timestamps else None
