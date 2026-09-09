"""Firebase Admin setup for CertTrack Firestore and certificate storage."""

import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, storage

BASE_DIR = Path(__file__).resolve().parent


def _credential_path() -> Path | None:
    """Resolve the configured service account, with a local CertTrack fallback."""
    configured = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
    if not configured:
        return BASE_DIR / "__firebase_credentials_not_configured__"
    path = Path(configured)
    return path if path.is_absolute() else BASE_DIR / path


def _is_cloud_run() -> bool:
    """Cloud Run provides Application Default Credentials via its service account."""
    return bool(os.getenv("K_SERVICE") or os.getenv("GOOGLE_CLOUD_PROJECT"))


def init_firebase():
    """Initialize Firebase once and return the Firestore client, or None in demo mode."""
    key_path = _credential_path()
    if not key_path.exists() and not _is_cloud_run():
        return None

    if not firebase_admin._apps:
        options = {}
        bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")
        if bucket_name:
            options["storageBucket"] = bucket_name
        credential = credentials.Certificate(str(key_path)) if key_path.exists() else credentials.ApplicationDefault()
        firebase_admin.initialize_app(credential, options=options)

    # Cloud Firestore uses "(default)" unless a named production database is configured.
    database_id = os.getenv("FIRESTORE_DATABASE_ID", "(default)").strip() or "(default)"
    return firestore.client(database_id=database_id)


def get_firestore_client():
    """Return Firestore when Firebase credentials are configured; otherwise demo mode."""
    return init_firebase()


def get_storage_bucket():
    """Return the configured Firebase Storage bucket, or None when Firebase is unavailable."""
    if not init_firebase():
        return None
    bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")
    if not bucket_name:
        project_id = firebase_admin.get_app().project_id
        bucket_name = f"{project_id}.appspot.com" if project_id else None
    return storage.bucket(bucket_name) if bucket_name else None
