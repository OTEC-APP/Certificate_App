import os
import asyncio
import json
from io import BytesIO
from collections import Counter
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4
import hashlib
from difflib import SequenceMatcher
from html import escape
from pathlib import Path
from threading import Lock
from pathlib import Path
from threading import Lock
from zoneinfo import ZoneInfo

import fitz
from PIL import Image, ImageOps
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, Request, UploadFile, Response, WebSocket, WebSocketDisconnect
 

from fastapi.middleware.cors import CORSMiddleware
from google.cloud.firestore_v1 import Query as FirestoreQuery
from pydantic import BaseModel, Field

if __package__:
    # Package import: `from backend import app` or `uvicorn backend.main:app`
    from .firebase_service import get_firestore_client, get_storage_bucket
    from .access_management import auth_router,callback_router, options_router, purge_expired_departed_employee_data, router as access_management_router
    from .email_alerts import send_email
    from .realtime import realtime_connections
    from .employee_activity import latest_certificate_at
else:
    # Direct execution: `python main.py`
    from firebase_service import get_firestore_client, get_storage_bucket
    from access_management import auth_router,callback_router, options_router, purge_expired_departed_employee_data, router as access_management_router
    from email_alerts import send_email
    from realtime import realtime_connections
    from employee_activity import latest_certificate_at

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


configured_origins = {
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
}
allowed_origins = sorted(
    configured_origins | {"http://localhost:3000", "http://127.0.0.1:3000"}
)



@asynccontextmanager
async def lifespan(_: FastAPI):
    async def maintenance_scheduler():
        # Run automated certificate and leaderboard emails at 10:00 AM IST,
        # regardless of the cloud server's own time zone.
        schedule_timezone = ZoneInfo(os.getenv("SCHEDULE_TIMEZONE", "Asia/Kolkata"))
        while True:
            now = datetime.now(schedule_timezone)
            next_run = now.replace(hour=10, minute=0, second=0, microsecond=0)
            if now >= next_run:
                next_run += timedelta(days=1)
            await asyncio.sleep((next_run - now).total_seconds())
            await asyncio.to_thread(run_renewal_alerts)
            await asyncio.to_thread(send_monthly_top_five_greeting)
            await asyncio.to_thread(purge_expired_certificates)
            await asyncio.to_thread(purge_expired_departed_employee_data)
 
    scheduler_task = asyncio.create_task(maintenance_scheduler())
    try:
        yield
    finally:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task


app = FastAPI(title="CertTrack API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(access_management_router)
app.include_router(options_router)
app.include_router(auth_router)
app.include_router(callback_router)

@app.websocket("/ws/updates")
async def realtime_updates(websocket: WebSocket):
    await realtime_connections.connect(websocket)
    try:
        await websocket.send_json({"type": "realtime.connected"})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        realtime_connections.disconnect(websocket)
    except Exception:
        realtime_connections.disconnect(websocket)

db = get_firestore_client()
BRAND_LOGO_PATH = Path(__file__).resolve().parent / "Images" / "o2k-logo.png"
demo_certificates: list[dict] = []
demo_notification_reads: dict[str, set[str]] = {}
demo_monthly_top_five_periods: set[str] = set()
NOTIFICATION_READS_PATH = Path(__file__).resolve().parent / ".notification_reads.json"
notification_reads_lock = Lock()


class CertificationTaskCreate(BaseModel):
    certification_name: str = Field(min_length=2, max_length=200)
    vendor_name: str = Field(min_length=2, max_length=200)
    category: str = Field(min_length=2, max_length=120)
    certification_link: str = Field(min_length=8, max_length=1000, pattern=r"^https?://")
    departments: list[str] = Field(min_length=1)
    due_date: date | None = None
    created_by: str = Field(default="Administrator", max_length=200)


class CertificationTaskCompletion(BaseModel):
    employee_email: str = Field(min_length=3, max_length=254)
    completed: bool = True


def task_database():
    client = db or get_firestore_client()
    if not client:
        raise HTTPException(status_code=503, detail="Firebase is not configured")
    return client


def task_completion_id(task_id: str, email: str) -> str:
    return hashlib.sha256(f"{task_id}:{email.strip().casefold()}".encode("utf-8")).hexdigest()


@app.post("/api/certification-tasks", status_code=201)
async def create_certification_task(payload: CertificationTaskCreate, background_tasks: BackgroundTasks):
    client = task_database()
    now = datetime.now(timezone.utc).isoformat()
    task_identity = tuple(
        " ".join(str(value or "").split()).casefold()
        for value in (payload.certification_name, payload.vendor_name, payload.category)
    )
    for snapshot in client.collection("certification_tasks").stream():
        existing = snapshot.to_dict()
        if not existing.get("active", True):
            continue
        existing_identity = tuple(
            " ".join(str(existing.get(key) or "").split()).casefold()
            for key in ("certification_name", "vendor_name", "category")
        )
        if existing_identity == task_identity:
            raise HTTPException(
                status_code=409,
                detail="This active course task has already been assigned. Update or remove the existing task before assigning it again.",
            )
    task = {
        **payload.model_dump(mode="json"),
        "departments": sorted({item.strip() for item in payload.departments if item.strip()}, key=str.casefold),
        "created_at": now,
        "active": True,
    }
    if not task["departments"]:
        raise HTTPException(status_code=422, detail="Select at least one department")
    reference = client.collection("certification_tasks").document()
    reference.set(task)
    recipients = []
    for user_snapshot in client.collection("users").stream():
        user_record = user_snapshot.to_dict() or {}
        recipient = str(user_record.get("employeeEmail") or user_record.get("email") or "").strip().lower()
        if recipient:
            recipients.append(recipient)
    background_tasks.add_task(send_task_assignment_email, task, recipients)
    realtime_connections.publish({"type": "certification-task.created"})
    return {"id": reference.id, **task}


@app.put("/api/certification-tasks/{task_id}")
def update_certification_task(task_id: str, payload: CertificationTaskCreate):
    client = task_database()
    reference = client.collection("certification_tasks").document(task_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Certification task not found")
    task_identity = tuple(
        " ".join(str(value or "").split()).casefold()
        for value in (payload.certification_name, payload.vendor_name, payload.category)
    )
    current = snapshot.to_dict() or {}
    current_identity = tuple(
        " ".join(str(current.get(key) or "").split()).casefold()
        for key in ("certification_name", "vendor_name", "category")
    )
    # Existing duplicate records from before validation can still be corrected.
    # Only reject an edit when it changes a task into another task's identity.
    if task_identity != current_identity:
        for existing_snapshot in client.collection("certification_tasks").stream():
            if existing_snapshot.id == task_id:
                continue
            existing = existing_snapshot.to_dict() or {}
            if not existing.get("active", True):
                continue
            existing_identity = tuple(
                " ".join(str(existing.get(key) or "").split()).casefold()
                for key in ("certification_name", "vendor_name", "category")
            )
            if existing_identity == task_identity:
                raise HTTPException(status_code=409, detail="This active course task has already been assigned.")
    updates = {
        **payload.model_dump(mode="json"),
        "departments": sorted({item.strip() for item in payload.departments if item.strip()}, key=str.casefold),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if not updates["departments"]:
        raise HTTPException(status_code=422, detail="Select at least one mandatory department")
    reference.update(updates)
    realtime_connections.publish({"type": "certification-task.updated"})
    return {"id": task_id, **snapshot.to_dict(), **updates}


@app.get("/api/certification-tasks")
def list_certification_tasks(
    employee_email: str = Query("", max_length=254),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=100),
):
    client = task_database()
    tasks = [{"id": item.id, **item.to_dict()} for item in client.collection("certification_tasks").stream() if item.to_dict().get("active", True)]
    email = employee_email.strip().casefold()
    users = [item.to_dict() for item in client.collection("users").stream()]
    users_by_email = {str(item.get("employeeEmail", "")).strip().casefold(): item for item in users}
    employee = users_by_email.get(email) if email else None
    department = str((employee or {}).get("department", "")).strip()
    certificates = [item.to_dict() for item in client.collection("certificates").stream()]
    normalized_name = lambda value: "".join(character for character in str(value or "").casefold() if character.isalnum())
    for task in tasks:
        task["mandatory"] = bool(department and department.casefold() in {str(item).casefold() for item in task.get("departments", [])})
        task_name = normalized_name(task.get("certification_name"))
        task_vendor = normalized_name(task.get("vendor_name"))
        task_category = normalized_name(task.get("category"))
        matching_certificates = [item for item in certificates if normalized_name(item.get("course_name")) == task_name and (not task_vendor or normalized_name(item.get("vendor_name")) == task_vendor) and (not task_category or normalized_name(item.get("category")) == task_category)]
        approved_by_email = {}
        for certificate in matching_certificates:
            if certificate.get("status") != "issued" or not certificate_is_current(certificate):
                continue
            certificate_email = str(certificate.get("email", "")).strip().casefold()
            if not certificate_email:
                continue
            completion_user = users_by_email.get(certificate_email, {})
            completion_department = str(completion_user.get("department", "")).strip()
            mandatory_departments = {
                str(item).strip().casefold()
                for item in task.get("departments", [])
                if str(item).strip()
            }
            approved_by_email[certificate_email] = {
                "email": certificate_email,
                "name": f"{completion_user.get('firstName', '')} {completion_user.get('lastName', '')}".strip() or certificate.get("recipient_name") or certificate_email,
                "department": completion_user.get("department", "Not assigned"),
                "mandatory": completion_department.casefold() in mandatory_departments,
                "completed_at": certificate.get("reviewed_at") or certificate.get("issued_date"),
            }
        completed_by = sorted(
            approved_by_email.values(),
            key=lambda item: str(item.get("completed_at") or ""),
            reverse=True,
        )
        task["completed_by"] = completed_by
        task["completed_count"] = len(completed_by)
        task["assigned_count"] = len(users)
        employee_completion = next((item for item in completed_by if item["email"] == email), None) if email else None
        task["completed"] = employee_completion is not None
        task["completed_at"] = employee_completion.get("completed_at") if employee_completion else None
        task["submitted"] = bool(email and not task["completed"] and any(
            str(item.get("email", "")).strip().casefold() == email and item.get("status") == "pending"
            for item in matching_certificates
        ))
    tasks.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    total = len(tasks)
    start = (page - 1) * page_size
    return {
        "items": tasks[start : start + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
        "employee_department": department,
    }


@app.put("/api/certification-tasks/{task_id}/completion")
def update_certification_task_completion(task_id: str, payload: CertificationTaskCompletion):
    client = task_database()
    if not client.collection("certification_tasks").document(task_id).get().exists:
        raise HTTPException(status_code=404, detail="Certification task not found")
    email = payload.employee_email.strip().casefold()
    completion = {
        "task_id": task_id,
        "employee_email": email,
        "completed": payload.completed,
        "completed_at": datetime.now(timezone.utc).isoformat() if payload.completed else None,
    }
    client.collection("certification_task_completions").document(task_completion_id(task_id, email)).set(completion)
    realtime_connections.publish({"type": "certification-task.updated"})
    return completion


@app.delete("/api/certification-tasks/{task_id}", status_code=204)
def delete_certification_task(task_id: str):
    reference = task_database().collection("certification_tasks").document(task_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Certification task not found")
    reference.delete()
    realtime_connections.publish({"type": "certification-task.deleted"})

def aggregate_count(source) -> int | None:
    """Return a Firestore aggregation count without loading every document."""
    try:
        return int(source.count().get()[0][0].value)
    except Exception:
        return None
    

def positive_int_setting(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


MAX_VERIFICATION_UPLOAD_MB = positive_int_setting("MAX_VERIFICATION_UPLOAD_MB", 25)
MAX_VERIFICATION_UPLOAD_BYTES = MAX_VERIFICATION_UPLOAD_MB * 1024 * 1024
OPTIMIZABLE_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
IMAGE_CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


def optimize_verification_upload(data: bytes, filename: str, content_type: str | None) -> dict:
    """Return browser-previewable upload bytes, using an optimized copy only when smaller."""
    safe_name = Path(filename or "verification-file.bin").name
    extension = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else "bin"
    original_content_type = content_type or "application/octet-stream"
    if extension in IMAGE_CONTENT_TYPES:
        original_content_type = IMAGE_CONTENT_TYPES[extension]
    elif extension == "pdf":
        original_content_type = "application/pdf"
    result = {
        "data": data,
        "filename": safe_name,
        "extension": extension,
        "content_type": original_content_type,
        "optimized": False,
    }

    try:
        if extension in OPTIMIZABLE_IMAGE_EXTENSIONS:
            with Image.open(BytesIO(data)) as source:
                image = ImageOps.exif_transpose(source)
                if image.width > 2560 or image.height > 2560:
                    image.thumbnail((2560, 2560), Image.Resampling.LANCZOS)
                has_alpha = image.mode in {"RGBA", "LA"} or "transparency" in image.info
                image = image.convert("RGBA" if has_alpha else "RGB")
                output = BytesIO()
                image.save(output, format="WEBP", quality=82, method=6)
                optimized_data = output.getvalue()
            if len(optimized_data) < len(data):
                stem = safe_name.rsplit(".", 1)[0] if "." in safe_name else safe_name
                result.update({
                    "data": optimized_data,
                    "filename": f"{stem}.webp",
                    "extension": "webp",
                    "content_type": "image/webp",
                    "optimized": True,
                })
        elif extension == "pdf" or original_content_type == "application/pdf":
            output = BytesIO()
            document = fitz.open(stream=data, filetype="pdf")
            try:
                document.save(output, garbage=4, deflate=True, clean=True)
            finally:
                document.close()
            optimized_data = output.getvalue()
            if len(optimized_data) < len(data):
                result.update({
                    "data": optimized_data,
                    "extension": "pdf",
                    "content_type": "application/pdf",
                    "optimized": True,
                })
    except Exception:
        # A readable original is preferable to rejecting a valid file because an
        # optimizer cannot process an unusual image/PDF variant.
        pass

    return result

# Seed catalog for automatic AVIXA/CTS recognition. Add or edit rows here as the
# approved provider course list changes; saved certificates retain their review snapshot.
AVIXA_RU_COURSES = [
    {"id": "avixa-cts", "name": "Certified Technology Specialist (CTS)", "aliases": ["cts", "avixa cts", "certified technology specialist"], "cts_type": "CTS", "ru_points": 24.0},
    {"id": "avixa-cts-d", "name": "Certified Technology Specialist - Design (CTS-D)", "aliases": ["cts-d", "cts d", "avixa cts-d", "certified technology specialist design"], "cts_type": "CTS-D", "ru_points": 24.0},
    {"id": "avixa-cts-i", "name": "Certified Technology Specialist - Installation (CTS-I)", "aliases": ["cts-i", "cts i", "avixa cts-i", "certified technology specialist installation"], "cts_type": "CTS-I", "ru_points": 24.0},
]


def normalized_course_name(value: str) -> str:
    return " ".join("".join(character.lower() if character.isalnum() else " " for character in str(value or "")).split())


def avixa_course_suggestion(course_name: str, vendor_name: str, submitted_ru: float | None = None) -> dict:
    course_key = normalized_course_name(course_name)
    vendor_key = normalized_course_name(vendor_name)
    looks_avixa = "avixa" in vendor_key or "avixa" in course_key or any(token in course_key.split() for token in ("cts", "ctsd", "ctsi"))
    if not looks_avixa:
        return {"course_match_status": "not_applicable", "course_match_confidence": 0}
    best_course = None
    best_score = 0.0
    for course in AVIXA_RU_COURSES:
        candidates = [course["name"], *course["aliases"]]
        score = max(SequenceMatcher(None, course_key, normalized_course_name(candidate)).ratio() for candidate in candidates)
        if score > best_score:
            best_course, best_score = course, score
    if not best_course or best_score < 0.55:
        return {"course_match_status": "unmatched", "course_match_confidence": round(best_score, 2)}
    return {
        "course_match_status": "suggested",
        "course_match_confidence": round(best_score, 2),
        "matched_course_id": best_course["id"],
        "matched_course_name": best_course["name"],
        "suggested_cts_type": best_course["cts_type"],
        "suggested_ru_points": submitted_ru if submitted_ru is not None else best_course["ru_points"],
    }


class CertificateCreate(BaseModel):
    recipient_name: str = Field(min_length=2, max_length=100)
    email: str
    course_name: str = Field(min_length=2, max_length=160)
    vendor_name: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=60)
    certificate_number: str = Field(default="", max_length=100)
    total_ru_points: float | None = Field(default=None, ge=0, le=9999)
    validity_years: int | None = Field(default=None, ge=1, le=3)
    expires_on: date | None = None
    reminder_days_before: int = Field(default=90, ge=1, le=90)
    issued_date: date
    submission_source: Literal["user", "admin"] = "user"

class StatusUpdate(BaseModel):
    status: Literal["issued", "revoked"]
    reviewed_by: str = Field(min_length=2, max_length=100)
    remarks: str = Field(default="", max_length=1000)
    matched_course_id: str | None = Field(default=None, max_length=100)
    matched_course_name: str | None = Field(default=None, max_length=160)
    verified_cts_type: Literal["CTS", "CTS-D", "CTS-I"] | None = None
    verified_ru_points: float | None = Field(default=None, ge=0, le=9999)


class CertificateUpdate(CertificateCreate):
    pass

class NotificationReadUpdate(BaseModel):
    user_key: str = Field(min_length=1, max_length=254)
    notification_keys: list[str] = Field(default_factory=list, max_length=500)


class ComplianceRequirementUpdate(BaseModel):
    vendor: str = Field(min_length=1, max_length=100)
    certification: str = Field(min_length=1, max_length=160)
    required: int = Field(ge=0, le=999)





class ProjectRequirementCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    requirements: list[str] = Field(min_length=1, max_length=20)
    team_size: int = Field(default=1, ge=1, le=50)
    backup_count: int = Field(default=1, ge=0, le=20)
    start_date: date = Field(default_factory=date.today)
    end_date: date = Field(default_factory=date.today)
    location: str | None = Field(default=None, max_length=100)



def normalized_requirement(value: str) -> str:
    normalized = "".join(character for character in value.lower() if character.isalnum())
    for suffix in ("certification", "certified", "certificate", "skills", "skill"):
        normalized = normalized.replace(suffix, "")
    return normalized



def project_recommendations(project: dict) -> list[dict]:
    """Rank employees by issued credentials matching a project's requirements."""
    if not db:
        return []

    users = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("users").stream()]
    certificates_by_email: dict[str, list[dict]] = {}
    for certificate in get_all():
        if not certificate_is_current(certificate):
         continue

        email = str(certificate.get("email", "")).strip().lower()
        certificates_by_email.setdefault(email, []).append(certificate)
    requirements = [str(item).strip() for item in project.get("requirements", []) if str(item).strip()]
    normalized = [(item, normalized_requirement(item)) for item in requirements]
    project_end = date.fromisoformat(str(project["end_date"])[:10])
    recommendations = []
    for user in users:
        if project.get("location") and project["location"] != "Any location" and user.get("location") != project["location"]:
            continue
        email = str(user.get("employeeEmail", "")).strip().lower()
        certificates = certificates_by_email.get(email, [])
        descriptors = [
            (
                certificate,
                normalized_requirement(" ".join(str(certificate.get(field, "")) for field in ("course_name", "vendor_name", "category"))),
            )
            for certificate in certificates
        ]
        matched, missing, expiring, evidence = [], [], [], []
        for label, token in normalized:
            matches = [certificate for certificate, descriptor in descriptors if token and (token in descriptor or descriptor in token)]
            if not matches:
                missing.append(label)
                continue
            matched.append(label)
            for certificate in matches:
                credential = certificate.get("course_name") or certificate.get("vendor_name") or label
                if credential not in evidence:
                    evidence.append(credential)
                try:
                    expiry = certificate_expiry(certificate)
                    if expiry and expiry <= project_end:
                        expiring.append({"requirement": label, "course": certificate.get("course_name"), "expiry_date": expiry.isoformat()})
                except (TypeError, ValueError):
                    pass
        score = round(len(matched) / len(requirements) * 100) if requirements else 0
        recommendations.append({
            "employee_id": user["id"],
            "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip(),
            "email": user.get("employeeEmail", ""),
            "department": user.get("department") or "Not assigned",
            "location": user.get("location") or "Not assigned",
            "score": score,
            "matched": matched,
            "missing": missing,
            "expiring": expiring,
            "evidence": evidence,
            "evidence_count": len(evidence),
        })
    recommendations.sort(key=lambda item: (-item["score"], len(item["expiring"]), -item["evidence_count"], item["name"].lower()))
    return recommendations



def get_all():
    if not db:
        return [item for item in demo_certificates if not item.get("employee_left_at")]
    # Live dashboards and reports represent the current workforce. Certificates
    # remain stored for audit, but records belonging to deleted/offboarded users
    # must not continue inflating certification, renewal, CTS, or OEM counts.
    active_emails = {
        str(snapshot.to_dict().get("employeeEmail", "")).strip().lower()
        for snapshot in db.collection("users").stream()
        if snapshot.to_dict().get("employeeEmail")
    }
    certificates = []
    for snapshot in db.collection("certificates").stream():
        certificate = snapshot.to_dict()
        certificate_email = str(certificate.get("email", "")).strip().lower()
        if not certificate.get("employee_left_at") and certificate_email in active_emails:
            certificates.append({"id": snapshot.id, **certificate})
    return certificates


def record_certificate_activity(icon: str, title: str, detail: str) -> None:
    """Write certificate activity separately from Access Management history."""
    try:
        if db:
            db.collection("certificate_activity").document().set(
                {"icon": icon, "title": title, "detail": detail, "time": datetime.now(timezone.utc).isoformat()}
            )
    except Exception:
        # The certificate operation remains successful if an optional audit write is unavailable.
        pass


 
def certificate_validity_years(certificate: dict) -> int | None:
    """Read a custom validity value while supporting certificates saved before it existed."""
    # New records always contain validity_years. An explicit null means Lifetime;
    # only records that predate this field should use the legacy fallback.
    if "validity_years" in certificate:
        years = certificate.get("validity_years")
        return int(years) if years not in (None, "", 0, "0") else None
 
    legacy_validity = certificate.get("validity", "3_years")
    if legacy_validity == "lifetime":
        return None
    return {"1_year": 1, "2_years": 2, "3_years": 3}.get(legacy_validity, 3)
 
 
def certificate_expiry(certificate: dict) -> date | None:
    """Return a renewal date using the saved validity rule."""
    explicit_expiry = certificate.get("expires_on")
    if explicit_expiry:
        return date.fromisoformat(str(explicit_expiry)[:10])
    years = certificate_validity_years(certificate)
    if not years:
        return None
    issued = date.fromisoformat(str(certificate.get("issued_date")))
    try:
        return issued.replace(year=issued.year + years)
    except ValueError:  # 29 February in a non-leap expiry year
        return issued.replace(year=issued.year + years, day=28)
 
 

def certificate_is_current(certificate: dict, today: date | None = None) -> bool:
    """Whether an issued certificate still counts as an active credential."""
    if certificate.get("status") != "issued":
        return False
    try:
        expiry = certificate_expiry(certificate)
    except (TypeError, ValueError):
        return False
    return expiry is None or expiry >= (today or date.today())


def cts_credential_type(certificate: dict) -> str | None:
    """Classify an active AVIXA CTS credential from its full or abbreviated name."""
    credential_name = f"{certificate.get('course_name', '')} {certificate.get('vendor_name', '')}".upper()
    normalized_name = " ".join("".join(character if character.isalnum() else " " for character in credential_name).split())
    if "CTS-D" in credential_name or "CTS D" in normalized_name or "CERTIFIED TECHNOLOGY SPECIALIST DESIGN" in normalized_name or "CERTIFIED TECHNOLOGY SPECIALIST D" in normalized_name:
        return "CTS-D"
    if "CTS-I" in credential_name or "CTS I" in normalized_name or "CERTIFIED TECHNOLOGY SPECIALIST INSTALL" in normalized_name or "CERTIFIED TECHNOLOGY SPECIALIST I" in normalized_name:
        return "CTS-I"
    if "CTS" in credential_name or "CERTIFIED TECHNOLOGY SPECIALIST" in normalized_name:
        return "CTS"
    return None


def cts_holder_ru_rows(email: str, certificates: list[dict]) -> list[tuple[str, str]]:
    """Return RU details only when the employee currently holds a CTS credential."""
    employee_certificates = [
        certificate
        for certificate in certificates
        if str(certificate.get("email") or "").strip().casefold() == str(email or "").strip().casefold()
        and certificate_is_current(certificate)
    ]
    cts_types = sorted({
        credential_type
        for certificate in employee_certificates
        if (credential_type := cts_credential_type(certificate))
    })
    if not cts_types:
        return []
    ru_points = sum(
        float(certificate.get("verified_ru_points") if certificate.get("verified_ru_points") is not None else certificate.get("total_ru_points") or 0)
        for certificate in employee_certificates
    )
    return [
        ("CTS credential", ", ".join(cts_types)),
        ("Current CTS RU points", f"{ru_points:g} RU"),
    ]


def purge_expired_certificates() -> int:
    """Permanently remove expired or rejected certificate records after 30 days."""
    delete_on_or_before = date.today() - timedelta(days=30)
    certificates = (
        [{"id": item.get("id"), **item} for item in demo_certificates]
        if not db
        else [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("certificates").stream()]
    )
    removed = 0
    for certificate in certificates:
        status = str(certificate.get("status") or "").lower()
        if status == "issued":
            try:
                expiry = certificate_expiry(certificate)
            except (TypeError, ValueError):
                continue
            if not expiry or expiry > delete_on_or_before:
                continue
        elif status in {"revoked", "rejected"}:
            try:
                rejected_on = date.fromisoformat(str(certificate.get("reviewed_at") or "")[:10])
            except ValueError:
                # Keep legacy records when their decision date is unknown.
                continue
            if rejected_on > delete_on_or_before:
                continue
        else:
            continue
        certificate_id = certificate.get("id")
        if db:
            db.collection("certificates").document(str(certificate_id)).delete()
        else:
            demo_certificates.remove(certificate)
        image_path = certificate.get("verification_image_path")
        if image_path:
            try:
                bucket = get_storage_bucket()
                if bucket:
                    bucket.blob(image_path).delete()
            except Exception:
                pass
        removed += 1
    return removed
 


def admin_email_addresses() -> list[str]:
    def clean_email(value: object) -> str:
        email = str(value or "").strip().lower()
        # Do not let blank or malformed Firestore values reach Graph's
        # toRecipients payload, where they cause the entire alert to fail.
        return email if email.count("@") == 1 and all(part.strip() for part in email.split("@")) else ""
 
    configured_admins = [
        email for value in os.getenv("ADMIN_ALERT_EMAILS", "").split(",")
        if (email := clean_email(value))
    ]
    if not db:
        return sorted(set(configured_admins))
    try:
        firestore_admins = [
            email
            for snapshot in db.collection("users").stream()
            if str(snapshot.to_dict().get("role", "")).strip().lower() == "admin"
            if (email := clean_email(snapshot.to_dict().get("employeeEmail")))
        ]
        return sorted(set(configured_admins + firestore_admins))
    except Exception:
        return configured_admins
 
 
 
def employee_email_details(certificate: dict) -> dict:
    """Return the employee information to show in certificate notification emails."""
    details = {
        "name": certificate.get("recipient_name") or "Not recorded",
        "email": certificate.get("email") or "Not recorded",
        "employee_id": "Not assigned",
        "department": "Not assigned",
        "location": "Not assigned",
    }
    if not db:
        return details
    try:
        certificate_email = str(certificate.get("email", "")).strip().lower()
        for snapshot in db.collection("users").stream():
            user = snapshot.to_dict()
            if str(user.get("employeeEmail", "")).strip().lower() != certificate_email:
                continue
            details.update({
                "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or details["name"],
                "employee_id": user.get("employeeId") or "Not assigned",
                "department": user.get("department") or "Not assigned",
                "location": user.get("location") or "Not assigned",
            })
            break
    except Exception:
        pass
    return details


def certtrack_url(path: str) -> str:
    base_url = os.getenv("CERTTRACK_APP_URL") or "http://localhost:3000"
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def certificate_email_html(title: str, summary: str, certificate: dict, extra_rows: list[tuple[str, str]] | None = None, action_path: str = "/dashboard", *, include_employee_details: bool = False) -> str:
    """Build the shared TeamPresence/O2K email card without trusting submitted values as HTML."""
    approval_status = {
        "pending": "Under Review",
        "issued": "Validated",
        "revoked": "Revoked",
    }.get(str(certificate.get("status") or "pending").lower(), str(certificate.get("status") or "Under Review").title())
    rows = []
    if include_employee_details:
        employee = employee_email_details(certificate)
        rows.extend([
            ("Employee name", employee["name"]),
            ("Employee ID", employee["employee_id"]),
            ("Department", employee["department"]),
            ("Location", employee["location"]),
        ])
    rows += [
        ("Certification Category", certificate.get("category") or "Not recorded"),
        ("Certification OEM", certificate.get("vendor_name") or "Not recorded"),
        ("Certification Name", certificate.get("course_name") or "Not recorded"),
        ("Certification No", certificate.get("certificate_number") or "Not recorded"),
        ("Admin Approval Status", approval_status),
    ] + (extra_rows or [])
    table_rows = "".join(
        f"<tr class='detail-row'><td class='detail-label' width='42%' valign='top' style='width:42%;padding:11px 14px;border-bottom:1px solid #e9edf2;font-weight:700;color:#444;overflow-wrap:anywhere'>{escape(str(label))}</td>"
        f"<td class='detail-value' width='58%' valign='top' style='width:58%;padding:11px 14px;border-bottom:1px solid #e9edf2;color:#333;word-break:break-word;overflow-wrap:anywhere'>{escape(str(value))}</td></tr>"
        for label, value in rows
    )
    return f"""<!doctype html>
    <html><head><meta name='viewport' content='width=device-width,initial-scale=1'>
    <style>
      @media only screen and (max-width: 600px) {{
        .email-shell {{ padding:20px 10px !important; }}
        .email-card {{ padding:22px 14px !important; border-radius:8px !important; }}
        .email-title {{ font-size:23px !important; }}
        .details-box {{ padding:14px 10px !important; }}
        .detail-row, .detail-label, .detail-value {{ display:block !important; width:100% !important; box-sizing:border-box !important; }}
        .detail-label {{ padding:12px 8px 3px !important; border-bottom:0 !important; }}
        .detail-value {{ padding:0 8px 12px !important; }}
      }}
    </style></head><body style='margin:0;padding:0'>
    <div class='email-shell' style='margin:0;padding:32px 16px;background:#f1f3f6;font-family:Arial,sans-serif;color:#333'>
      <div style='max-width:680px;margin:0 auto;text-align:center;padding:0 0 22px'>
        <img src='cid:o2k-logo' alt='O2K' style='max-width:210px;max-height:72px;display:inline-block'>
      </div>
      <div class='email-card' style='max-width:620px;margin:0 auto;background:#fff;border-radius:14px;padding:36px;box-shadow:0 2px 12px rgba(0,0,0,.08)'>
        <h1 class='email-title' style='margin:0 0 14px;color:#df2c35;font-size:27px'>{escape(title)}</h1>
        <p style='margin:0 0 22px;font-size:16px;line-height:1.5'>{escape(summary)}</p>
        <div class='details-box' style='border-left:5px solid #df2c35;background:#f8f9fb;padding:16px 18px'>
          <h2 style='margin:0 0 12px;font-size:18px;color:#222'>Certificate details</h2>
          <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px'>{table_rows}</table>
        </div>
        <div style='text-align:center;padding:28px 0 8px'><a href='{escape(certtrack_url(action_path), quote=True)}' style='display:inline-block;background:#df2c35;color:#fff;text-decoration:none;border-radius:6px;padding:14px 28px;font-weight:700'>View CertTrack</a></div>
      </div>
      <p style='max-width:620px;margin:18px auto 0;text-align:center;color:#6b7280;font-size:12px'>This is an automated CertTrack notification.</p>
    </div></body></html>"""


def send_certificate_email(recipients: list[str], subject: str, title: str, summary: str, certificate: dict, extra_rows: list[tuple[str, str]] | None = None, action_path: str = "/dashboard", *, include_employee_details: bool = False) -> None:
    send_email(recipients, subject, certificate_email_html(title, summary, certificate, extra_rows, action_path, include_employee_details=include_employee_details), BRAND_LOGO_PATH)


def send_task_assignment_email(task: dict, recipients: list[str]) -> None:
    """Notify every employee when an administrator publishes a learning task."""
    clean_recipients = sorted({str(email).strip().lower() for email in recipients if str(email).strip()})
    if not clean_recipients:
        return
    due_date = task.get("due_date") or "No due date"
    task_name = escape(str(task.get("certification_name") or "Certification task"))
    vendor = escape(str(task.get("vendor_name") or "Not specified"))
    category = escape(str(task.get("category") or "Other"))
    link = escape(str(task.get("certification_link") or certtrack_url("/task-assignments")), quote=True)
    html = f"""<!doctype html><html><body style='margin:0;padding:32px 16px;background:#f1f3f6;font-family:Arial,sans-serif;color:#3c2730'>
      <div style='max-width:620px;margin:auto'>
        <div style='text-align:center;padding-bottom:20px'><img src='cid:o2k-logo' alt='O2K' style='max-width:210px;max-height:72px'></div>
        <div style='background:#fff;border-radius:14px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.08)'>
          <h1 style='margin:0 0 14px;color:#df2c35;font-size:25px'>New learning course assigned</h1>
          <p style='margin:0 0 20px;font-size:15px;line-height:1.55'>A new certification learning course is available for you in OTEC Certificate Management.</p>
          <table width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;background:#fff8f9;border-left:4px solid #df2c35;font-size:14px'>
            <tr><td style='padding:10px;font-weight:700'>Course</td><td style='padding:10px'>{task_name}</td></tr>
            <tr><td style='padding:10px;font-weight:700'>OEM</td><td style='padding:10px'>{vendor}</td></tr>
            <tr><td style='padding:10px;font-weight:700'>Category</td><td style='padding:10px'>{category}</td></tr>
            <tr><td style='padding:10px;font-weight:700'>Due date</td><td style='padding:10px'>{escape(str(due_date))}</td></tr>
          </table>
          <div style='padding-top:24px;text-align:center'><a href='{link}' style='display:inline-block;padding:13px 22px;border-radius:7px;background:#df2c35;color:#fff;text-decoration:none;font-weight:700'>Open course</a></div>
        </div><p style='text-align:center;color:#6b7280;font-size:12px'>This is an automated OTEC Certificate Management notification.</p>
      </div></body></html>"""
    subject = f"New learning task: {task.get('certification_name', 'Certification')}"
    for recipient in clean_recipients:
        delivered = send_email([recipient], subject, html, BRAND_LOGO_PATH)
        if not delivered:
            print(f"Course assignment email could not be delivered to {recipient}")


def send_submission_alert(certificate: dict) -> None:
    send_certificate_email(
        admin_email_addresses(),
        f"Certificate approval requested: {certificate['course_name']}",
        "Certificate approval requested",
        f"{certificate.get('recipient_name', 'An employee')} submitted a certificate for your review.",
        certificate,
        cts_holder_ru_rows(certificate.get("email", ""), get_all()),
        action_path="/dashboard",
        include_employee_details=True,
    )


def send_review_alert(certificate: dict, status: str, reviewed_by: str) -> None:
    """Tell the submitting employee whether their certificate was approved or rejected."""
    approved = status == "issued"
    decision = "validated" if approved else "revoked"
    remarks = str(certificate.get("review_remarks") or "").strip()
    review_rows = [("Reviewed by", reviewed_by)]
    if approved:
        approved_ru = certificate.get("verified_ru_points")
        if approved_ru is None:
            approved_ru = certificate.get("total_ru_points")
        try:
            approved_ru_value = float(approved_ru)
        except (TypeError, ValueError):
            approved_ru_value = 0
        if approved_ru_value:
            review_rows.append(("RU points added by this certificate", f"{approved_ru_value:g} RU"))
        review_rows.extend(cts_holder_ru_rows(certificate.get("email", ""), get_all()))
    else:
        review_rows.append(("Rejection remarks", remarks))
    summary = (
        f"Your certificate has been validated by {reviewed_by}. It is now active in your CertTrack certification profile."
        if approved
        else f"Your certificate submission was reviewed by {reviewed_by} and has been revoked. Please contact an administrator if you need more information."
    )
    send_certificate_email(
        [certificate.get("email", "")],
        f"Certificate {decision.title()}: {certificate.get('course_name', 'Certificate')}",
        f"Certificate {decision.title()}",
        summary,
        certificate,
        review_rows,
        "/my-certificates",
    )

 
def monthly_top_five_recipients() -> list[str]:
    """Return active employee email addresses for the monthly greeting."""
    if not db:
        return sorted({str(item.get("email") or "").strip().lower() for item in get_all() if item.get("email")})
    try:
        return sorted({
            str(snapshot.to_dict().get("employeeEmail") or "").strip().lower()
            for snapshot in db.collection("users").stream()
            if str(snapshot.to_dict().get("employeeEmail") or "").strip()
            and str(snapshot.to_dict().get("role") or "").lower() in {"admin", "project_manager", "user"}
        })
    except Exception:
        return []
 
 
def monthly_top_five_email_html(month: date, monthly_leaders: list[dict], overall_leaders: list[dict]) -> str:
    month_label = month.strftime("%B %Y")
    star_name = monthly_leaders[0]["name"]
    rank_colours = {
        1: ("#f6c453", "#5a3b00"),
        2: ("#dbe1ea", "#344054"),
        3: ("#e9b98d", "#6a3513"),
    }
    rank_icons = {1: "&#129351;", 2: "&#129352;", 3: "&#129353;"}
    def ranking_rows(leaders: list[dict]) -> str:
        return "".join(
        f"<tr style='background:{'#fffaf0' if rank == 1 else '#ffffff'}'>"
        f"<td style='padding:12px;border-bottom:1px solid #edf0f3;text-align:center'><span style='display:inline-block;min-width:34px;padding:5px 4px;border-radius:14px;background:{rank_colours.get(rank, ('#f7e8eb', '#a82b40'))[0]};color:{rank_colours.get(rank, ('#f7e8eb', '#a82b40'))[1]};font-weight:700'>{rank_icons.get(rank, '')} {rank}</span></td>"
        f"<td style='padding:12px;border-bottom:1px solid #edf0f3;font-weight:700'>{escape(leader['name'])}</td>"
        f"<td style='padding:12px;border-bottom:1px solid #edf0f3'>{escape(leader['employee_id'])}</td>"
        f"<td style='padding:12px;border-bottom:1px solid #edf0f3'>{escape(leader['department'])}</td>"
        f"<td style='padding:12px;border-bottom:1px solid #edf0f3'>{escape(leader['location'])}</td></tr>"
        for rank, leader in enumerate(leaders, start=1)
        )
 
    def ranking_table(title: str, leaders: list[dict]) -> str:
        return f"""<h2 style='margin:26px 0 10px;color:#3c2730;font-size:18px'>{escape(title)}</h2>
          <table class='leaderboard-table' role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:separate;border-spacing:0;font-size:13px;border:1px solid #edf0f3;border-radius:10px;overflow:hidden'>
            <thead><tr style='background:#f9fafb'><th style='padding:11px 12px;text-align:center'>Rank</th><th style='padding:11px 12px;text-align:left'>Employee</th><th style='padding:11px 12px;text-align:left'>Employee ID</th><th style='padding:11px 12px;text-align:left'>Department</th><th style='padding:11px 12px;text-align:left'>Location</th></tr></thead>
            <tbody>{ranking_rows(leaders)}</tbody>
          </table>"""
    return f"""<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><style>
      @media only screen and (max-width:620px) {{
        .leaderboard-shell {{ padding:20px 12px !important; }}
        .leaderboard-card {{ padding:24px 18px !important; }}
        .leaderboard-card h1 {{ font-size:23px !important; }}
        .leaderboard-table {{ font-size:11px !important; }}
        .leaderboard-table th,.leaderboard-table td {{ padding:8px 5px !important; }}
      }}
    </style></head>
    <body style='margin:0;padding:0;background:#f1f3f6;font-family:Arial,sans-serif;color:#333'>
      <div class='leaderboard-shell' style='max-width:620px;margin:0 auto;padding:32px 16px'>
        <div style='text-align:center;padding-bottom:22px'><img src='cid:o2k-logo' alt='O2K' style='max-width:210px;max-height:72px'></div>
        <div class='leaderboard-card' style='background:#fff;border-radius:14px;padding:36px;box-shadow:0 2px 12px rgba(0,0,0,.08)'>
          <h1 style='margin:0 0 18px;color:#df2c35;font-size:27px'>Certification Star of the Month &ndash; {escape(month_label)}</h1>
          <p style='margin:0 0 18px;font-size:15px;line-height:1.6'><strong>Hello Team,</strong></p>
          <p style='margin:0 0 18px;font-size:16px;line-height:1.6'><strong>&#9728;&#65039; Congratulations to our Certification Star of the Month &ndash; {escape(month_label)}!</strong></p>
          <p style='margin:0 0 20px;font-size:15px;line-height:1.6'>We are pleased to recognize <strong>{escape(star_name)}</strong> for achieving the <strong>top position in this month&rsquo;s Certification Leaderboard.</strong></p>
          {ranking_table(f'{month_label} Certification Leaderboard', monthly_leaders)}
          {ranking_table('Overall Certification Leaderboard', overall_leaders)}
          <p style='margin:24px 0 0;font-size:15px;line-height:1.6'>Thank you to everyone for your continued commitment to <strong>learning, certification, and professional development.</strong></p>
          <div style='text-align:center;padding-top:26px'><a href='{escape(certtrack_url('/my-certificates'), quote=True)}' style='display:inline-block;background:#df2c35;color:#fff;text-decoration:none;border-radius:7px;padding:14px 28px;font-weight:700'>View My Certificates</a></div>
        </div>
        <p style='margin:18px 0 0;text-align:center;color:#6b7280;font-size:12px'>This is an automated CertTrack notification.</p>
      </div>
    </body></html>"""
 
 
def send_monthly_top_five_greeting() -> None:
    """Email all active employees the current month's top five on month-end."""
    today = date.today()
    # The following date moves to a new month only on the final calendar day.
    is_month_end = (today + timedelta(days=1)).month != today.month
    if not is_month_end:
        return
    period_key = today.strftime("%Y-%m")
    history_key = f"monthly-top-five-{period_key}"
    history_ref = db.collection("scheduled_email_history").document(history_key) if db else None
    if (history_ref and history_ref.get().exists) or (not db and history_key in demo_monthly_top_five_periods):
        return
    month_prefix = period_key
    monthly_counts: Counter[str] = Counter()
    overall_counts: Counter[str] = Counter()
    names: dict[str, str] = {}
    for certificate in get_all():
        if certificate.get("status") != "issued":
            continue
        key = str(certificate.get("email") or certificate.get("recipient_name") or "").strip().casefold()
        if not key:
            continue
        overall_counts[key] += 1
        if str(certificate.get("issued_date") or "").startswith(month_prefix):
            monthly_counts[key] += 1
        names[key] = str(certificate.get("recipient_name") or "Employee").strip() or "Employee"
    profiles_by_email: dict[str, dict] = {}
    if db:
        try:
            profiles_by_email = {
                str(snapshot.to_dict().get("employeeEmail") or "").strip().casefold(): snapshot.to_dict()
                for snapshot in db.collection("users").stream()
            }
        except Exception:
            profiles_by_email = {}
    def build_leaders(counts: Counter[str]) -> list[dict]:
        ranked_leaders = sorted(
            ((employee_email, names[employee_email], count) for employee_email, count in counts.items()),
            key=lambda item: (-item[2], item[1].casefold()),
        )[:5]
        return [
            {
                "name": name,
                "employee_id": str(profiles_by_email.get(employee_email, {}).get("employeeId") or "Not assigned"),
                "department": str(profiles_by_email.get(employee_email, {}).get("department") or "Not assigned"),
                "location": str(profiles_by_email.get(employee_email, {}).get("location") or "Not assigned"),
            }
            for employee_email, name, _ in ranked_leaders
        ]
 
    monthly_leaders = build_leaders(monthly_counts)
    overall_leaders = build_leaders(overall_counts)
    recipients = monthly_top_five_recipients()
    if not monthly_leaders or not recipients:
        return
    subject = f"Certification Star of the Month - {today.strftime('%B %Y')}"
    html = monthly_top_five_email_html(today, monthly_leaders, overall_leaders)
    delivered = all(send_email([recipient], subject, html, BRAND_LOGO_PATH) for recipient in recipients)
    if not delivered:
        return
    if history_ref:
        history_ref.set({"period": period_key, "sent_at": datetime.now(timezone.utc).isoformat(), "recipient_count": len(recipients)})
    else:
        demo_monthly_top_five_periods.add(history_key)
 
 
 

def run_renewal_alerts(certificate_ids: set[str] | None = None) -> None:
    """Send each configured renewal reminder once, including expiry and post-expiry alerts."""
    today = date.today()
    for certificate in get_all():
        if certificate_ids is not None and certificate.get("id") not in certificate_ids:
            continue
        if certificate.get("status") != "issued":
            continue
        try:
            expiry = certificate_expiry(certificate)
            if not expiry:
                continue
            days_remaining = (expiry - today).days
        except (TypeError, ValueError):
            continue
        reminder_days = int(certificate.get("reminder_days_before") or 90)
        sent = certificate.get("renewal_alerts_sent") or {}
        reminders = [("first_reminder", reminder_days, f"expires in {reminder_days} days")]
        for alert_type, alert_days, timing in (
            ("one_week", 7, "expires in one week"),
            ("three_days", 3, "expires in three days"),
            ("two_days", 2, "expires in two days"),
            ("one_day", 1, "expires tomorrow"),
            ("expiry_day", 0, "expires today"),
            ("post_expiry", -1, "expired yesterday"),
        ):
            # A selected first reminder already covers that day.
            if alert_days != reminder_days:
                reminders.append((alert_type, alert_days, timing))
        matching_reminder = next((reminder for reminder in reminders if reminder[1] == days_remaining), None)
        if not matching_reminder:
            continue
        alert_type, _, timing = matching_reminder
        if sent.get(alert_type):
            continue
        subject = f"Certificate renewal alert: {certificate.get('course_name', 'Certificate')}"
        delivered = send_email(
            [certificate.get("email", "")], subject,
            certificate_email_html(
                "Certificate renewal alert",
                f"Your certificate {timing}. Please complete your renewal as soon as possible.",
                certificate,
                [("Expiry date", expiry.isoformat()), ("Alert", alert_type.replace("_", " ").title())],
                "/upcoming-renewals",
            ),
            BRAND_LOGO_PATH,
        )
        if delivered:
            sent[alert_type] = datetime.now(timezone.utc).isoformat()
            if db:
                db.collection("certificates").document(certificate["id"]).update({"renewal_alerts_sent": sent})
            else:
                certificate["renewal_alerts_sent"] = sent

def compliance_requirement_id(vendor: str, certification: str) -> str:
    value = f"{vendor.strip().lower()}\n{certification.strip().lower()}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
def compliance_vendor_name(value: str | None) -> str:
    """Preserve the saved OEM display name, cleaning whitespace only."""
    vendor = " ".join(str(value or "").split()).strip()
    alias = "".join(character for character in vendor.lower() if character.isalnum())
    if not alias or alias in {"na", "none", "notrecorded", "unknown"}:
        return "Not recorded"
    return vendor

@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "firebase" if db else "demo"}


def notification_read_document_id(user_key: str) -> str:
    return hashlib.sha256(user_key.strip().casefold().encode("utf-8")).hexdigest()


def load_notification_reads() -> dict[str, list[str]]:
    try:
        saved = json.loads(NOTIFICATION_READS_PATH.read_text(encoding="utf-8"))
        return saved if isinstance(saved, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save_notification_reads(saved: dict[str, list[str]]) -> None:
    temporary_path = NOTIFICATION_READS_PATH.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
    temporary_path.replace(NOTIFICATION_READS_PATH)


@app.get("/api/notification-reads")
def get_notification_reads(user_key: str = Query(min_length=1, max_length=254)):
    normalized_key = user_key.strip().casefold()
    with notification_reads_lock:
        saved = load_notification_reads()
        keys = saved.get(notification_read_document_id(normalized_key), [])
    return {"notification_keys": sorted(set(keys))[-500:]}


@app.post("/api/notification-reads")
def mark_notifications_read(payload: NotificationReadUpdate):
    normalized_key = payload.user_key.strip().casefold()
    clean_keys = {str(key).strip() for key in payload.notification_keys if str(key).strip()}
    document_id = notification_read_document_id(normalized_key)
    with notification_reads_lock:
        saved = load_notification_reads()
        saved_keys = sorted(set(saved.get(document_id, [])) | clean_keys)[-500:]
        saved[document_id] = saved_keys
        save_notification_reads(saved)
    return {"notification_keys": saved_keys}


@app.get("/api/dashboard")
# def dashboard():
#     """Build the admin overview from saved certificate records only."""
#     certificates = get_all()
#     issued = [item for item in certificates if item.get("status") == "issued"]
#     categories = Counter(item.get("category") or "Other" for item in issued)
#     vendors = Counter(item.get("vendor_name") or "Other" for item in issued)
#     employees = Counter(item.get("recipient_name") or "Unknown" for item in issued)
#     years = Counter(str(item.get("issued_date", ""))[:4] for item in issued if item.get("issued_date"))
#     today = date.today()
#     upcoming = []
#     for item in issued:
#         try:
#             expiry = certificate_expiry(item)
#             if not expiry:
#                 continue
#             days = (expiry - today).days
#             if 0 <= days <= 90:
#                 upcoming.append({**item, "days_remaining": days, "expiry_date": expiry.isoformat()})
#         except (TypeError, ValueError):
#             continue

#     return {
#         "total": len(certificates),
#         "issued": len(issued),
#         "pending": sum(item.get("status") == "pending" for item in certificates),
#         "revoked": sum(item.get("status") == "revoked" for item in certificates),
#         "employees": len({item.get("email") for item in issued if item.get("email")}),
#         "categories": [{"name": name, "count": count} for name, count in categories.most_common()],
#         "vendors": [{"name": name, "count": count} for name, count in vendors.most_common()],
#         "top_employees": [{"name": name, "count": count} for name, count in employees.most_common(5)],
#         "years": [{"year": year, "count": count} for year, count in sorted(years.items())],
#         "upcoming": sorted(upcoming, key=lambda item: item["days_remaining"])[:5],
#         "recent": sorted(certificates, key=lambda item: item.get("issued_date", ""), reverse=True)[:5],
#         "storage_mode": "firebase" if db else "local",
#     }

def dashboard(response: Response, year: str = Query("")):
    """Build the admin overview from saved certificate records only."""
    response.headers["Cache-Control"] = "no-store"
    certificates = get_all()
    issued = [item for item in certificates if certificate_is_current(item)]
    # Current-month ranking uses only certificates whose entered completion
    # date falls in this calendar month and were validated by an administrator.
    current_month_key = date.today().strftime("%Y-%m")
 
    # Group the leaderboard by the certificate's stable email identity rather
    # than by recipient_name. Renaming an employee in Access Management no
    # longer splits them into two rows, and the current name / employee ID /
    # department are always resolved from the live user directory.
    try:
        access_users = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("users").stream()] if db else []
    except Exception:
        access_users = []
    users_by_email = {
        str(user.get("employeeEmail", "")).strip().casefold(): user
        for user in access_users
        if str(user.get("employeeEmail", "")).strip()
    }
 
    def leaderboard_identity(certificate: dict) -> str:
        email = str(certificate.get("email") or "").strip().casefold()
        if email:
            return f"email:{email}"
        name = str(certificate.get("recipient_name") or "").strip().casefold()
        return f"name:{name}"
 
    monthly_counts: Counter[str] = Counter()
    overall_counts: Counter[str] = Counter()
    identities: dict[str, dict] = {}
 
    for item in certificates:
        if item.get("status") != "issued":
            continue
        key = leaderboard_identity(item)
        if key not in identities:
            email = str(item.get("email") or "").strip().casefold()
            user = users_by_email.get(email, {})
            identities[key] = {
                "name": (
                    f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                    or item.get("recipient_name")
                    or "Unknown"
                ),
                "email": item.get("email") or "",
                "profile_id": user.get("id"),
                "employee_id": str(user.get("employeeId") or "Not assigned"),
                "department": str(user.get("department") or "Not assigned"),
            }
        overall_counts[key] += 1
        if str(item.get("issued_date") or "").startswith(current_month_key):
            monthly_counts[key] += 1
 
    def ranked_entries(counts: Counter[str]) -> list[tuple[str, int]]:
        return sorted(
            counts.items(),
            key=lambda item: (
                -item[1],
                identities.get(item[0], {}).get("name", "").casefold(),
            ),
        )
 
    monthly_ranked_employees = [
        (identities[key]["name"], count) for key, count in ranked_entries(monthly_counts)
    ]
    overall_ranked_employees = [
        (identities[key]["name"], count) for key, count in ranked_entries(overall_counts)
    ]
    monthly_top_employees = monthly_ranked_employees[:5]
    overall_top_employees = overall_ranked_employees[:5]
 
    categories = Counter(item.get("category") or "Other" for item in issued)
    vendors = Counter(item.get("vendor_name") or "Other" for item in issued)
    employees = Counter(item.get("recipient_name") or "Unknown" for item in issued)
    years = Counter(str(item.get("issued_date", ""))[:4] for item in issued if item.get("issued_date"))
    current_year = str(date.today().year)
    selected_year = year.strip() if year.strip().isdigit() and len(year.strip()) == 4 else current_year
    months = Counter(
        str(item.get("issued_date", ""))[5:7]
        for item in issued
        if str(item.get("issued_date", "")).startswith(f"{selected_year}-")
    )
    today = date.today()
    current_quarter = (today.month - 1) // 3 + 1
    added_this_quarter = sum(
        str(item.get("issued_date", "")).startswith(f"{today.year}-")
        and ((int(str(item.get("issued_date"))[5:7]) - 1) // 3 + 1 == current_quarter)
        for item in issued
        if len(str(item.get("issued_date", ""))) >= 7 and str(item.get("issued_date", ""))[5:7].isdigit()
    )
    cts_certificates = [item for item in issued if cts_credential_type(item)]
    cts_holders = len({
        str(item.get("email") or item.get("recipient_name") or item.get("id", "")).strip().lower()
        for item in cts_certificates
    })
    cts_people = {}
    cts_breakdown = {"CTS": set(), "CTS-D": set(), "CTS-I": set()}
    for item in cts_certificates:
        holder_key = str(item.get("email") or item.get("recipient_name") or item.get("id", "")).strip().lower()
        holder_name = item.get("recipient_name") or "Unknown employee"
        cts_people[holder_key] = holder_name
        credential_type = cts_credential_type(item)
        cts_breakdown[credential_type].add(holder_key)
    joining_years = []
    for user in access_users:
        joining_date = user.get("dateOfJoining")
        if not joining_date:
            continue
        try:
            joined = joining_date if isinstance(joining_date, (date, datetime)) else datetime.fromisoformat(str(joining_date).replace("Z", "+00:00"))
            joining_years.append((joined.date() if isinstance(joined, datetime) else joined).year)
        except (TypeError, ValueError):
            continue
    earliest_employee_joining_year = min(joining_years) if joining_years else None
    stored_workforce = aggregate_count(db.collection("users")) if db else None
    workforce = stored_workforce if stored_workforce is not None else (len(access_users) if access_users else len({item.get("email") for item in issued if item.get("email")}))
    employee_ids = {
        str(user.get("employeeEmail", "")).strip().lower(): user["id"]
        for user in access_users
        if user.get("employeeEmail")
    }
    employee_ids_by_name = {
        f"{user.get('firstName', '')} {user.get('lastName', '')}".strip().casefold(): user["id"]
        for user in access_users
        if f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
    }
    employee_details_by_name = {
        f"{user.get('firstName', '')} {user.get('lastName', '')}".strip().casefold(): {
            "profile_id": user["id"],
            "employee_id": str(user.get("employeeId") or "Not assigned"),
            "department": str(user.get("department") or "Not assigned"),
        }
        for user in access_users
        if f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
    }
 
    def leaderboard_entry(name: str, count: int) -> dict:
        details = employee_details_by_name.get(name.casefold(), {})
        return {
            "name": name,
            "count": count,
            "profile_id": details.get("profile_id") or employee_ids_by_name.get(name.casefold()),
            "employee_id": details.get("employee_id") or "Not assigned",
            "department": details.get("department") or "Not assigned",
        }
    certified_emails = {
        str(item.get("email") or "").strip().lower()
        for item in issued
        if str(item.get("email") or "").strip()
    }
 
    location_people = Counter()
    tenure_people = Counter()
    tenure_labels = ("Under 2 yrs", "2–4 years", "4–6 years", "6-10 years", "10-15 years", "15-20 years", "20+ years")
 
    for user in access_users:
        email = str(user.get("employeeEmail", "")).strip().lower()
        # Location and tenure both measure certified employees, not all users.
        if email not in certified_emails:
            continue
 
        location = str(user.get("location") or "Not assigned").strip()
        canonical_location = next((name for name in location_people if name.casefold() == location.casefold()), location)
        location_people[canonical_location] += 1
 
        joining_date = user.get("dateOfJoining") or user.get("created_at")
        try:
            joined = joining_date if isinstance(joining_date, (date, datetime)) else datetime.fromisoformat(str(joining_date).replace("Z", "+00:00"))
            joined_date = joined.date() if isinstance(joined, datetime) else joined
            tenure_years = (today - joined_date).days / 365.2425
            tenure = tenure_labels[0] if tenure_years < 2 else tenure_labels[1] if tenure_years < 4 else tenure_labels[2] if tenure_years < 6 else tenure_labels[3]
            tenure_people[tenure] += 1
        except (TypeError, ValueError):
            continue
    upcoming = []
    for item in issued:
        try:
            expiry = certificate_expiry(item)
            if not expiry:
                continue
            days = (expiry - today).days
            if 0 <= days <= 90:
                email = str(item.get("email", "")).strip().lower()
                upcoming.append({**item, "days_remaining": days, "expiry_date": expiry.isoformat(), "employee_id": employee_ids.get(email)})
        except (TypeError, ValueError):
            continue
 
    return {
        "total": len(issued),
        "issued": len(issued),
        "pending": sum(item.get("status") == "pending" for item in certificates),
        "revoked": sum(item.get("status") == "revoked" for item in certificates),
        "employees": len({item.get("email") for item in issued if item.get("email")}),
        "workforce": workforce,
        "cts_holders": cts_holders,
        "cts_summary": {
            "total": cts_holders,
            "types": [{"name": name, "count": len(holders)} for name, holders in cts_breakdown.items()],
            "holders": [{"name": name} for name in sorted(cts_people.values(), key=str.lower)],
        },
        "added_this_quarter": added_this_quarter,
        "expiring_90_days": sum(0 <= item["days_remaining"] <= 90 for item in upcoming),
        "expiring_30_days": sum(0 <= item["days_remaining"] <= 30 for item in upcoming),
        "categories": [{"name": name, "count": count} for name, count in categories.most_common()],
        "vendors": [{"name": name, "count": count} for name, count in vendors.most_common()],
        "top_employees": [{"name": name, "count": count} for name, count in employees.most_common(5)],
        "monthly_top_employees": [
            leaderboard_entry(name, count)
            for name, count in monthly_top_employees
        ],
        "overall_top_employees": [
            leaderboard_entry(name, count)
            for name, count in overall_top_employees
        ],
        "monthly_ranked_employees": [leaderboard_entry(name, count) for name, count in monthly_ranked_employees],
        "overall_ranked_employees": [leaderboard_entry(name, count) for name, count in overall_ranked_employees],
        "monthly_top_period": current_month_key,
        "years": [{"year": year, "count": count} for year, count in sorted(years.items())],
        "earliest_employee_joining_year": earliest_employee_joining_year,
        "selected_year": selected_year,
        "months": [{"month": month, "count": months.get(f"{month:02d}", 0)} for month in range(1, 13)],
        "locations": [
            {"name": name, "count": people, "people": people}
            for name, people in location_people.most_common()
        ],
        "tenure": [
            {"name": name, "count": tenure_people[name], "people": tenure_people[name]}
            for name in tenure_labels
        ],
        "upcoming": sorted(upcoming, key=lambda item: item["days_remaining"]),
        "recent": sorted(issued, key=lambda item: item.get("issued_date", ""), reverse=True)[:5],
        "storage_mode": "firebase" if db else "local",
    }
 
 
 

@app.get("/api/dashboard/counts")
def dashboard_counts(year: str = Query("")):
    """Return only dashboard KPI values for real-time updates."""
    data = dashboard(Response(), year)
    count_fields = (
        "total", "issued", "pending", "revoked", "employees", "workforce",
        "cts_holders", "added_this_quarter", "expiring_90_days", "expiring_30_days",
    )
    return {field: data[field] for field in count_fields}


@app.get("/api/monthly-rankings")
def monthly_rankings(email: str = Query(""), include_all: bool = Query(False)):
    """Return the current month's validated-certificate ranking for active users."""
    month_key = date.today().strftime("%Y-%m")
    counts: Counter[str] = Counter()
    names: dict[str, str] = {}
    employee_ids: dict[str, str] = {}
    for certificate in get_all():
        if certificate.get("status") != "issued" or not str(certificate.get("issued_date") or "").startswith(month_key):
            continue
        employee_email = str(certificate.get("email") or "").strip().casefold()
        if not employee_email:
            continue
        counts[employee_email] += 1
        names[employee_email] = str(certificate.get("recipient_name") or "Employee").strip() or "Employee"
    if db:
        try:
            for snapshot in db.collection("users").stream():
                user = snapshot.to_dict()
                if str(user.get("role") or "user").casefold() not in {"admin", "project_manager", "user"}:
                    continue
                employee_email = str(user.get("employeeEmail") or "").strip().casefold()
                if not employee_email:
                    continue
                # names.setdefault(employee_email, f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or employee_email)
                # employee_ids[employee_email] = snapshot.id
                names[employee_email] = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or employee_email
                employee_ids[employee_email] = snapshot.id
        except Exception:
            pass
    ranked = sorted(
        ((employee_email, name, counts.get(employee_email, 0)) for employee_email, name in names.items()),
        key=lambda item: (-item[2], item[1].casefold()),
    )
    requested_email = email.strip().casefold()
    return {
        "month": month_key,
        "rank": next((index for index, (employee_email, _, _) in enumerate(ranked, 1) if employee_email == requested_email), None),
        "certificate_count": counts.get(requested_email, 0),
        "leaders": [
            {"rank": index, "name": name, "certificate_count": count}
            for index, (_, name, count) in enumerate((item for item in ranked if item[2] > 0), 1)
        ][:5],
        "rankings": [
            {"rank": index, "name": name, "certificate_count": count, "employee_id": employee_ids.get(employee_email)}
            for index, (employee_email, name, count) in enumerate(ranked, 1)
        ] if include_all else [],
    }
 
 


@app.get("/api/certificates")
def list_certificates(
    search: str = Query(""),
    status: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    # Expired certificates are retained for audit in the employee profile, but
    # must not appear in general certificate pages or active reporting.
    results = [item for item in get_all() if item.get("status") != "issued" or certificate_is_current(item)]
    term = search.lower().strip()
    if term:
        results = [item for item in results if term in " ".join(str(item.get(field, "")) for field in ["recipient_name", "course_name", "certificate_number", "vendor_name", "email"]).lower()]
    if status != "all":
        results = [item for item in results if item.get("status") == status]
    results = sorted(
        results,
        key=lambda item: item.get("created_at") or f"{item.get('issued_date', '1970-01-01')}T00:00:00",
        reverse=True,
    )
    total = len(results)
    start = (page - 1) * page_size
    return {"items": results[start : start + page_size], "total": total, "page": page, "page_size": page_size}


@app.get("/api/certification-catalog")
def certification_catalog(
    search: str = Query(""),
    vendor: str = Query(""),
    category: str = Query(""),
    validity_years: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """Return catalog rows derived from certificates entered by users."""
    grouped: dict[tuple[str, str, str, int | None, bool], dict] = {}
    for certificate in get_all():
        if not certificate_is_current(certificate):
            continue
        key = (
            certificate.get("course_name") or "Untitled certificate",
            certificate.get("vendor_name") or "Not recorded",
            certificate.get("category") or "Other",
            certificate_validity_years(certificate),
            bool(certificate.get("expires_on")),
        )
        group = grouped.setdefault(key, {"holders": set(), "expiry_dates": []})
        group["holders"].add(certificate.get("email") or certificate.get("id", ""))
        expiry = certificate_expiry(certificate)
        if expiry:
            group["expiry_dates"].append(expiry.isoformat())
    rows = [
        {
            "name": name,
            "vendor": vendor,
            "category": category,
            "validity_years": validity_years,
            "uses_expiry_date": uses_expiry_date,
            "next_expiry_date": min(group["expiry_dates"]) if group["expiry_dates"] else None,
            "holders": len(group["holders"]),
        }
        for (name, vendor, category, validity_years, uses_expiry_date), group in grouped.items()
    ]
    search_term = search.strip().casefold()
    vendor_term = vendor.strip().casefold()
    category_term = category.strip().casefold()
    if search_term:
        rows = [
            row
            for row in rows
            if search_term in f"{row['name']} {row['vendor']} {row['category']}".casefold()
        ]
    if vendor_term:
        rows = [row for row in rows if row["vendor"].casefold() == vendor_term]
    if category_term:
        rows = [row for row in rows if row["category"].casefold() == category_term]
    if validity_years:
        if validity_years == "lifetime":
            rows = [row for row in rows if row["validity_years"] is None and not row["uses_expiry_date"]]
        elif validity_years == "expiry_date":
            rows = [row for row in rows if row["uses_expiry_date"]]
        else:
            try:
                selected_validity = int(validity_years)
            except ValueError as error:
                raise HTTPException(status_code=422, detail="Validity must be lifetime, expiry_date, 1, 2, or 3") from error
            rows = [row for row in rows if row["validity_years"] == selected_validity]
    rows.sort(key=lambda row: (row["name"].lower(), row["vendor"].lower()))
    total = len(rows)
    start = (page - 1) * page_size
    return {"items": rows[start : start + page_size], "total": total, "page": page, "page_size": page_size}
 
 

@app.get("/api/certification-catalog/filters")
def certification_catalog_filters():
    """Return the selectable catalog filter values from approved certificates."""
    approved = [item for item in get_all() if certificate_is_current(item)]
    vendors = sorted({str(item.get("vendor_name") or "Other").strip() for item in approved}, key=str.casefold)
    validity_periods = set()
    for certificate in approved:
        if certificate.get("expires_on"):
            validity_periods.add("expiry_date")
            continue
        years = certificate_validity_years(certificate)
        validity_periods.add("lifetime" if not years else str(years))
    return {
        "vendors": vendors,
        "validity_periods": sorted(
            validity_periods,
            key=lambda value: (0, 0) if value == "lifetime" else (1, 0) if value == "expiry_date" else (2, int(value)),
        ),
    }


@app.get("/api/certification-catalog/holders")
def certification_catalog_holders(name: str = Query(min_length=1), vendor: str = Query(min_length=1)):
    """Return employee-level details for a certification selected from the catalog."""
    name_key = name.strip().casefold()
    vendor_key = vendor.strip().casefold()
    users_by_email: dict[str, dict] = {}
    if db:
        try:
            users_by_email = {
                str(snapshot.to_dict().get("employeeEmail", "")).casefold(): {"id": snapshot.id, **snapshot.to_dict()}
                for snapshot in db.collection("users").stream()
            }
        except Exception:
            users_by_email = {}
    records = []
    for certificate in get_all():
        if (
            not certificate_is_current(certificate)
            or
            str(certificate.get("course_name", "")).strip().casefold() != name_key
            or str(certificate.get("vendor_name", "")).strip().casefold() != vendor_key
        ):
            continue
        email = str(certificate.get("email", "")).casefold()
        access_user = users_by_email.get(email, {})
        records.append({
            "id": certificate.get("id"),
            "employee_name": certificate.get("recipient_name") or "Unknown employee",
            "email": certificate.get("email", ""),
            "employee_id": access_user.get("employeeId", "Not assigned"),
            "profile_id": access_user.get("id"),
            "department": access_user.get("department", "Not assigned"),
            "location": access_user.get("location", "Not assigned"),
            "certificate_number": certificate.get("certificate_number", ""),
            "issued_date": certificate.get("issued_date", ""),
            "validity_years": certificate_validity_years(certificate),
            "expiry_date": certificate_expiry(certificate).isoformat() if certificate_expiry(certificate) else None,
            "uses_expiry_date": bool(certificate.get("expires_on")),
            "status": certificate.get("status", "pending"),
            "submitted_at": certificate.get("created_at"),
            "reviewed_at": certificate.get("reviewed_at"),
            "reviewed_by": certificate.get("reviewed_by"),
            "verification_file_uploaded": bool(certificate.get("verification_image_path")),
        })
    records.sort(key=lambda record: record.get("issued_date", ""), reverse=True)
    return {"name": name.strip(), "vendor": vendor.strip(), "items": records, "total": len(records)}


@app.get("/api/certificate-activity")
def certificate_activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """Return certificate upload, edit, and delete events for administrators."""
    if not db:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}
    try:
        collection = db.collection("certificate_activity")
        start = (page - 1) * page_size
        snapshots = (
            collection.order_by("time", direction=FirestoreQuery.DESCENDING)
            .offset(start)
            .limit(page_size)
            .stream()
        )
        logs = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in snapshots]
        total = aggregate_count(collection)
        if total is None:
            total = len(logs)
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Unable to load certificate activity: {error}") from error
    return {"items": logs, "total": total, "page": page, "page_size": page_size}


@app.get("/api/employees")
# def list_employees(
#     search: str = Query(""),
#     page: int = Query(1, ge=1),
#     page_size: int = Query(10, ge=1, le=100),
# ):
#     """Return Access Management users enriched with their saved certificates."""
#     try:
#         access_users = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("users").stream()] if db else []
#     except Exception as error:
#         raise HTTPException(status_code=503, detail=f"Unable to load access users: {error}") from error

#     certificates_by_email: dict[str, list[dict]] = {}
#     for certificate in get_all():
#         email = str(certificate.get("email", "")).lower()
#         certificates_by_email.setdefault(email, []).append(certificate)

#     employees = []
#     for access_user in access_users:
#         email = str(access_user.get("employeeEmail", "")).lower()
#         certificates = certificates_by_email.get(email, [])
#         issued = [item for item in certificates if item.get("status") == "issued"]
#         categories = sorted({item.get("category") or "Other" for item in issued})
#         employees.append({
#             "id": access_user["id"],
#             "firstName": access_user.get("firstName", ""),
#             "lastName": access_user.get("lastName", ""),
#             "name": f"{access_user.get('firstName', '')} {access_user.get('lastName', '')}".strip(),
#             "email": access_user.get("employeeEmail", ""),
#             "employeeId": access_user.get("employeeId", ""),
#             "role": access_user.get("role", "user"),
#             "location": access_user.get("location") or "Not assigned",
#             "department": access_user.get("department") or "Not assigned",
#             "categories": categories,
#             "certificateCount": len(certificates),
#             "activeCertificateCount": len(issued),
#             "status": "Active" if access_user.get("role") in {"admin", "user"} else "Inactive",
#         })

#     term = search.strip().lower()
#     if term:
#         employees = [
#             employee for employee in employees
#             if term in " ".join(str(value) for value in employee.values()).lower()
#         ]
#     employees.sort(key=lambda employee: (employee["firstName"].lower(), employee["lastName"].lower()))
#     total = len(employees)
#     start = (page - 1) * page_size
#     return {"items": employees[start : start + page_size], "total": total, "page": page, "page_size": page_size}
# def list_employees(
#     search: str = Query(""),
#     tenure: str | None = Query(None),
#     location: str | None = Query(None),
#     page: int = Query(1, ge=1),
#     page_size: int = Query(10, ge=1, le=100),
# ):
#     """Return Access Management users enriched with their saved certificates."""
#     try:
#         access_users = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("users").stream()] if db else []
#     except Exception as error:
#         raise HTTPException(status_code=503, detail=f"Unable to load access users: {error}") from error
 
#     certificates_by_email: dict[str, list[dict]] = {}
#     for certificate in get_all():
#         email = str(certificate.get("email", "")).lower()
#         certificates_by_email.setdefault(email, []).append(certificate)
 
#     employees = []
#     for access_user in access_users:
#         email = str(access_user.get("employeeEmail", "")).lower()
#         certificates = certificates_by_email.get(email, [])
#         issued = [item for item in certificates if certificate_is_current(item)]
#         categories = sorted({item.get("category") or "Other" for item in issued})
#         employees.append({
#             "id": access_user["id"],
#             "firstName": access_user.get("firstName", ""),
#             "lastName": access_user.get("lastName", ""),
#             "name": f"{access_user.get('firstName', '')} {access_user.get('lastName', '')}".strip(),
#             "email": access_user.get("employeeEmail", ""),
#             "employeeId": access_user.get("employeeId", ""),
#             "role": access_user.get("role", "user"),
#             "location": access_user.get("location") or "Not assigned",
#             "department": access_user.get("department") or "Not assigned",
#             "dateOfJoining": access_user.get("dateOfJoining") or access_user.get("created_at"),
#             "categories": categories,
#             "certificateCount": len(issued),
#             "activeCertificateCount": len(issued),
#             "status": "Active" if access_user.get("role") in {"admin", "user"} else "Inactive",
#         })
 
#     term = search.strip().lower()
#     if term:
#         employees = [
#             employee for employee in employees
#             if term in " ".join(str(value) for value in employee.values()).lower()
#         ]
#     if location:
#         employees = [employee for employee in employees if employee["location"] == location]
#     if tenure:
#         today = date.today()
#         filtered = []
#         for employee in employees:
#             try:
#                 joined = employee.get("dateOfJoining")
#                 joined_date = joined.date() if isinstance(joined, datetime) else joined if isinstance(joined, date) else date.fromisoformat(str(joined))
#                 tenure_years = (today - joined_date).days / 365.2425
#                 employee_tenure = "Under 2 yrs" if tenure_years < 2 else "2–4 years" if tenure_years < 4 else "4–6 years" if tenure_years < 6 else "6+ years"
#                 if employee_tenure == tenure:
#                     filtered.append(employee)
#             except (TypeError, ValueError):
#                 continue
#         employees = filtered
#     employees.sort(key=lambda employee: (employee["firstName"].lower(), employee["lastName"].lower()))
#     total = len(employees)
#     start = (page - 1) * page_size
#     return {"items": employees[start : start + page_size], "total": total, "page": page, "page_size": page_size}

def list_employees(
    search: str = Query(""),
    tenure: str | None = Query(None),
    location: str | None = Query(None),
    employee_ids: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """Return Access Management users enriched with their saved certificates."""
    try:
        access_users = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("users").stream()] if db else []
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Unable to load access users: {error}") from error
 
    certificates_by_email: dict[str, list[dict]] = {}
    for certificate in get_all():
        email = str(certificate.get("email", "")).strip().lower()
        certificates_by_email.setdefault(email, []).append(certificate)
 
    employees = []
    for access_user in access_users:
        email = str(access_user.get("employeeEmail", "")).strip().lower()
        certificates = certificates_by_email.get(email, [])
        issued = [item for item in certificates if certificate_is_current(item)]
        categories = sorted({item.get("category") or "Other" for item in issued})
        employees.append({
            "id": access_user["id"],
            "firstName": access_user.get("firstName", ""),
            "lastName": access_user.get("lastName", ""),
            "name": f"{access_user.get('firstName', '')} {access_user.get('lastName', '')}".strip(),
            "email": access_user.get("employeeEmail", ""),
            "employeeId": access_user.get("employeeId", ""),
            "role": access_user.get("role", "user"),
            "location": access_user.get("location") or "Not assigned",
            "department": access_user.get("department") or "Not assigned",
            "dateOfJoining": access_user.get("dateOfJoining") or access_user.get("created_at"),
            "categories": categories,
            "certificateCount": len(issued),
            "activeCertificateCount": len(issued),
            "last_seen_at": access_user.get("last_seen_at"),
            "last_certificate_at": latest_certificate_at(certificates),
            "status": "Active" if access_user.get("role") in {"admin", "project_manager", "user"} else "Inactive",
        })
 
    term = search.strip().lower()
    if term:
        employees = [
            employee for employee in employees
            if term in " ".join(str(value) for value in employee.values()).lower()
        ]
    if location:
        employees = [employee for employee in employees if employee["location"] == location]
    requested_employee_ids = [value.strip() for value in employee_ids.split(",") if value.strip()]
    if requested_employee_ids:
        requested_set = set(requested_employee_ids)
        employees = [employee for employee in employees if employee["id"] in requested_set]
    if tenure:
        today = date.today()
        filtered = []
        for employee in employees:
            # The dashboard tenure chart counts certified employees only, so
            # its drill-down must use the same population.
            if employee["activeCertificateCount"] == 0:
                continue
            try:
                joined = employee.get("dateOfJoining")
                joined_date = joined.date() if isinstance(joined, datetime) else joined if isinstance(joined, date) else date.fromisoformat(str(joined))
                tenure_years = (today - joined_date).days / 365.2425
                employee_tenure = (
                    "Under 2 yrs" if tenure_years < 2 else
                    "2–4 years" if tenure_years < 4 else
                    "4–6 years" if tenure_years < 6 else
                    "6-10 years" if tenure_years < 10 else
                    "10-15 years" if tenure_years < 15 else
                    "15-20 years" if tenure_years < 20 else
                    "20+ years"
                )
                if employee_tenure == tenure:
                    filtered.append(employee)
            except (TypeError, ValueError):
                continue
        employees = filtered
    if requested_employee_ids:
        employee_rank = {employee_id: index for index, employee_id in enumerate(requested_employee_ids)}
        employees.sort(key=lambda employee: employee_rank.get(employee["id"], len(employee_rank)))
    else:
        employees.sort(key=lambda employee: (employee["firstName"].lower(), employee["lastName"].lower()))
    total = len(employees)
    start = (page - 1) * page_size
    return {"items": employees[start : start + page_size], "total": total, "page": page, "page_size": page_size}
 
 

@app.get("/api/employees/{employee_id}")
def employee_profile(employee_id: str):
    """Return one Access Management user and the certificates saved under their email."""
    if not db:
        raise HTTPException(status_code=503, detail="Firebase is not configured for employee profiles")
    snapshot = db.collection("users").document(employee_id).get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Employee not found")
    access_user = snapshot.to_dict()
    email = str(access_user.get("employeeEmail", "")).strip().lower()
    all_certificates = [
        certificate
        for certificate in get_all()
        if str(certificate.get("email", "")).strip().lower() == email
    ]
    certificates = [certificate for certificate in all_certificates if certificate.get("status") == "issued"]
    certificates.sort(key=lambda certificate: certificate.get("issued_date", ""), reverse=True)
    return {
        "id": snapshot.id,
        "name": f"{access_user.get('firstName', '')} {access_user.get('lastName', '')}".strip(),
        "firstName": access_user.get("firstName", ""),
        "lastName": access_user.get("lastName", ""),
        "employeeId": access_user.get("employeeId", ""),
        "email": access_user.get("employeeEmail", ""),
        "role": access_user.get("role", "user"),
        "location": access_user.get("location") or "Not assigned",
        "department": access_user.get("department") or "Not assigned",
        "last_seen_at": access_user.get("last_seen_at"),
        "last_certificate_at": latest_certificate_at(all_certificates),
        "dateOfJoining": access_user.get("dateOfJoining") or access_user.get("created_at"),
        "reportingManager": access_user.get("reportingManager") or "Not assigned",
        "certificates": certificates,
    }

 
@app.get("/api/partner-compliance")
def partner_compliance(
    response: Response,
    search: str = Query(""),
    vendor_filter_value: str = Query("", alias="vendor"),
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
):
    """Group active certificate holders by OEM and certification."""
    response.headers["Cache-Control"] = "no-store"
    requirements = {}
    employee_ids = {}
    configured_oems = []
    if db:
        try:
            requirements = {
                snapshot.id: snapshot.to_dict().get("required", 1)
                for snapshot in db.collection("compliance_requirements").stream()
            }
            employee_ids = {
                str(snapshot.to_dict().get("employeeEmail", "")).lower(): snapshot.id
                for snapshot in db.collection("users").stream()
            }
            configured_oems = [
                snapshot.to_dict().get("name", "").strip()
                for snapshot in db.collection("certification_oems").stream()
                if snapshot.to_dict().get("name", "").strip()
            ]
        except Exception as error:
            raise HTTPException(status_code=503, detail=f"Unable to load compliance data: {error}") from error
 
    grouped = {compliance_vendor_name(name): {} for name in configured_oems}
    for certificate in get_all():
        if not certificate_is_current(certificate):
            continue
        vendor = compliance_vendor_name(certificate.get("vendor_name"))
        course = (certificate.get("course_name") or "Untitled certificate").strip()
        email = str(certificate.get("email", "")).strip().lower()
        holder_key = email or certificate.get("id", "")
        course_group = grouped.setdefault(vendor, {}).setdefault(course, {})
        course_group[holder_key] = {
            "certificate_id": certificate.get("id"),
            "employee_id": employee_ids.get(email),
            "name": certificate.get("recipient_name") or "Unknown employee",
            "email": certificate.get("email") or "",
            "issued_date": certificate.get("issued_date"),
            "certificate_number": certificate.get("certificate_number") or "",
        }
 
    vendors = []
    for vendor_name, courses in sorted(grouped.items(), key=lambda item: str(item[0] or "Not recorded").lower()):
        certifications = []
        vendor_holders = set()
        for course, holders_by_key in sorted(courses.items(), key=lambda item: item[0].lower()):
            holders = sorted(holders_by_key.values(), key=lambda holder: holder["name"].lower())
            vendor_holders.update(holders_by_key)
            requirement_key = compliance_requirement_id(vendor_name, course)
            certifications.append({
                "name": course,
                "holders": holders,
                "completed": len(holders),
                "required": int(requirements.get(requirement_key, 1)),
            })
        vendors.append({
            "name": vendor_name,
            "completed": len(vendor_holders),
            "required": int(requirements.get(compliance_requirement_id(vendor_name, "__vendor__"), 1)),
            "certifications": certifications,
        })
    vendor_filter = vendor_filter_value.strip().casefold()
    if vendor_filter:
        vendors = [item for item in vendors if item["name"].casefold() == vendor_filter]

    term = search.strip().casefold()
    if term:
        vendors = [
            vendor
            for vendor in vendors
            if term in " ".join(
                [vendor["name"]]
                + [
                    " ".join(
                        [certification["name"]]
                        + [
                            " ".join(str(holder.get(field, "")) for field in ("name", "email", "certificate_number"))
                            for holder in certification["holders"]
                        ]
                    )
                    for certification in vendor["certifications"]
                ]
            ).casefold()
        ]

    total = len(vendors)
    start = (page - 1) * page_size
    page_vendors = vendors[start : start + page_size]
    achieved = sum(vendor["completed"] >= vendor["required"] for vendor in vendors)
    total_completed = sum(vendor["completed"] for vendor in vendors)
    total_required = sum(vendor["required"] for vendor in vendors)
    return {
        "vendors": page_vendors,
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "achieved": achieved,
            "total_completed": total_completed,
            "total_required": total_required,
        },
    }
 
 
 
@app.put("/api/partner-compliance/requirement")
def update_compliance_requirement(payload: ComplianceRequirementUpdate):
    if not db:
        raise HTTPException(status_code=503, detail="Firebase is required to save compliance limits")
    requirement_id = compliance_requirement_id(payload.vendor, payload.certification)
    db.collection("compliance_requirements").document(requirement_id).set({
        "vendor": payload.vendor.strip(),
        "certification": payload.certification.strip(),
        "required": payload.required,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"required": payload.required}
 
 
@app.get("/api/projects")
def list_projects():
    """Return saved staffing requirements with fresh recommendations."""
    if not db:
        return {"items": []}
    projects = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("project_requirements").stream()]
    projects.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    for project in projects:
        ranked = project_recommendations(project)
        team_size = int(project.get("team_size", 1))
        backup_count = int(project.get("backup_count", 1))
        qualified = [item for item in ranked if item["score"] == 100]
        project["primary"] = qualified[:team_size]
        project["backups"] = qualified[team_size:team_size + backup_count]
        assigned_ids = {item["employee_id"] for item in project["primary"] + project["backups"]}
        project["alternatives"] = [item for item in ranked if item["employee_id"] not in assigned_ids]
    return {"items": projects}
 
 
@app.post("/api/projects", status_code=201)
def create_project(payload: ProjectRequirementCreate):
    """Save project requirements and return ranked primary/backup coverage."""
    if not db:
        raise HTTPException(status_code=503, detail="Firebase is required to save project staffing requirements")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after the start date")
    project = {
        **payload.model_dump(mode="json"),
        "requirements": list(dict.fromkeys(item.strip() for item in payload.requirements if item.strip())),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if not project["requirements"]:
        raise HTTPException(status_code=422, detail="Enter at least one project requirement")
    reference = db.collection("project_requirements").document()
    reference.set(project)
    ranked = project_recommendations(project)
    qualified = [item for item in ranked if item["score"] == 100]
    primary = qualified[:payload.team_size]
    backups = qualified[payload.team_size:payload.team_size + payload.backup_count]
    assigned_ids = {item["employee_id"] for item in primary + backups}
    return {
        "id": reference.id,
        **project,
        "primary": primary,
        "backups": backups,
        "alternatives": [item for item in ranked if item["employee_id"] not in assigned_ids],
    }
 
 
@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str):
    if not db:
        raise HTTPException(status_code=503, detail="Firebase is required to delete projects")
    reference = db.collection("project_requirements").document(project_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Project not found")
    reference.delete()
 
 

@app.get("/api/renewals")
def list_renewals(
    email: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """Return issued certificates within their configured reminder window.

    Supplying an email limits the result to that employee's certificates, which is
    used by the personal dashboard so its dates and alerts match the server.
    """
    today = date.today()
    renewals = []
    normalized_email = email.strip().lower()
    try:
        access_users = [{"id": snapshot.id, **snapshot.to_dict()} for snapshot in db.collection("users").stream()] if db else []
    except Exception:
        access_users = []
    departments_by_email = {
        str(user.get("employeeEmail") or "").strip().lower(): str(user.get("department") or "Not assigned")
        for user in access_users
        if user.get("employeeEmail")
    }
    for certificate in get_all():
        if certificate.get("status") != "issued":
            continue
        if normalized_email and str(certificate.get("email", "")).strip().lower() != normalized_email:
            continue
        try:
            expiry = certificate_expiry(certificate)
            if not expiry:
                continue
            days_remaining = (expiry - today).days
            reminder_days = int(certificate.get("reminder_days_before") or 90)
            if 0 <= days_remaining <= reminder_days:
                renewals.append({
                    **certificate,
                    "expiry_date": expiry.isoformat(),
                    "days_remaining": days_remaining,
                    "reminder_days_before": reminder_days,
                    "department": departments_by_email.get(str(certificate.get("email") or "").strip().lower(), "Not assigned"),
                })
        except (TypeError, ValueError):
            continue
    renewals.sort(key=lambda certificate: certificate["days_remaining"])
    total = len(renewals)
    start = (page - 1) * page_size
    return {"items": renewals[start : start + page_size], "total": total, "page": page, "page_size": page_size}


 
@app.post("/api/certificates", status_code=201)
async def create_certificate(payload: CertificateCreate, background_tasks: BackgroundTasks):
    if payload.expires_on and payload.expires_on < payload.issued_date:
        raise HTTPException(status_code=422, detail="Expiry date must be on or after the completion date")
    certificate_number = payload.certificate_number.strip()
    if certificate_number and any(
        str(item.get("certificate_number") or "").strip().casefold() == certificate_number.casefold()
        for item in get_all()
    ):
        raise HTTPException(status_code=409, detail="A certificate with this certificate number already exists")
    submitted_by_user = payload.submission_source == "user"
    certificate = {
        **payload.model_dump(mode="json"),
        "certificate_number": certificate_number,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    certificate.update(avixa_course_suggestion(payload.course_name, payload.vendor_name, payload.total_ru_points))
    if db:
        reference = db.collection("certificates").document()
        reference.set(certificate)
        certificate["id"] = reference.id
    else:
        certificate["id"] = f"demo-{uuid4().hex[:8]}"
        demo_certificates.append(certificate)
    record_certificate_activity(
        "bi-cloud-arrow-up",
        f"Certificate submitted by {certificate['recipient_name']}" if submitted_by_user else f"Certificate submitted by administrator for {certificate['recipient_name']}",
        f"{certificate['course_name']}  -  {certificate['certificate_number']}",
    )
    background_tasks.add_task(send_submission_alert, certificate)
    await realtime_connections.broadcast({"type": "certificate.updated", "certificate_id": certificate["id"]})
    return certificate
 
 
 
@app.put("/api/certificates/{certificate_id}")
async def update_certificate(certificate_id: str, payload: CertificateUpdate, background_tasks: BackgroundTasks):
    if payload.expires_on and payload.expires_on < payload.issued_date:
        raise HTTPException(status_code=422, detail="Expiry date must be on or after the completion date")
    certificate_number = payload.certificate_number.strip()
    if certificate_number and any(
        item.get("id") != certificate_id
        and str(item.get("certificate_number") or "").strip().casefold() == certificate_number.casefold()
        for item in get_all()
    ):
        raise HTTPException(status_code=409, detail="A certificate with this certificate number already exists")
    existing = next((item for item in get_all() if item.get("id") == certificate_id), None)
    if not existing:
        raise HTTPException(status_code=404, detail="Certificate not found")
    submitted_by_user = payload.submission_source == "user"
    updates = {
        **payload.model_dump(mode="json"),
        "certificate_number": certificate_number,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    updates.update(avixa_course_suggestion(payload.course_name, payload.vendor_name, payload.total_ru_points))
    expiry_fields = ("issued_date", "expires_on", "validity_years", "reminder_days_before")
    if any(str(existing.get(field) or "") != str(updates.get(field) or "") for field in expiry_fields):
        # A revised expiry calculation starts a fresh renewal reminder sequence.
        updates["renewal_alerts_sent"] = {}
    if submitted_by_user:
        updates.update({"status": "pending", "reviewed_at": None, "reviewed_by": None})
    if db:
        reference = db.collection("certificates").document(certificate_id)
        reference.update(updates)
    else:
        certificate = next((item for item in demo_certificates if item["id"] == certificate_id), None)
        if not certificate:
            raise HTTPException(status_code=404, detail="Certificate not found")
        certificate.update(updates)
    record_certificate_activity(
        "bi-pencil-square",
        f"Certificate resubmitted by {updates['recipient_name']} for review" if submitted_by_user else f"Certificate updated by {updates['recipient_name']}",
        f"{updates['course_name']}  -  {updates['certificate_number']}",
    )
    if submitted_by_user:
        background_tasks.add_task(send_submission_alert, {**existing, **updates, "id": certificate_id})
    await realtime_connections.broadcast({"type": "certificate.updated", "certificate_id": certificate_id})
    return {"id": certificate_id, **updates}
 
 
 

@app.delete("/api/certificates/{certificate_id}", status_code=204)
async def delete_certificate(certificate_id: str):
    certificate = next((item for item in get_all() if item.get("id") == certificate_id), None)
    if not certificate:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if db:
        db.collection("certificates").document(certificate_id).delete()
    else:
        demo_certificates.remove(certificate)
    image_path = certificate.get("verification_image_path")
    if image_path:
        try:
            bucket = get_storage_bucket()
            if bucket:
                bucket.blob(image_path).delete()
        except Exception:
            pass
    record_certificate_activity(
        "bi-trash3",
        f"Certificate deleted by {certificate.get('recipient_name', 'user')}",
        f"{certificate.get('course_name', 'Certificate')} · {certificate.get('certificate_number', '')}",
    )

    await realtime_connections.broadcast({"type": "certificate.updated", "certificate_id": certificate_id})

@app.post("/api/certificates/{certificate_id}/verification-image")
async def upload_verification_image(certificate_id: str, image: UploadFile = File(...)):
    original_data = image.file.read(MAX_VERIFICATION_UPLOAD_BYTES + 1)
    original_size = len(original_data)
    if original_size > MAX_VERIFICATION_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Certificate file must be {MAX_VERIFICATION_UPLOAD_MB} MB or smaller",
        )
    if not original_data:
        raise HTTPException(status_code=400, detail="Certificate file cannot be empty")
    certificate = next((item for item in get_all() if item.get("id") == certificate_id), None)
    if not certificate:
        raise HTTPException(status_code=404, detail="Certificate not found")
    bucket = get_storage_bucket()
    if not bucket:
        raise HTTPException(status_code=503, detail="Firebase Storage is not configured for certificate verification uploads")
    upload = optimize_verification_upload(original_data, image.filename or "verification-file.bin", image.content_type)
    stored_data = upload["data"]
    path = f"certificate-verifications/{certificate_id}/{uuid4().hex}.{upload['extension']}"
    old_path = certificate.get("verification_image_path")
    metadata = {
        "verification_file_name": upload["filename"],
        "verification_file_content_type": upload["content_type"],
        "verification_file_original_bytes": original_size,
        "verification_file_stored_bytes": len(stored_data),
        "verification_file_optimized": upload["optimized"],
        "verification_image_path": path,
    }
    blob = bucket.blob(path)
    try:
        blob.upload_from_string(stored_data, content_type=upload["content_type"])
        blob.metadata = {
            "original-filename": Path(image.filename or "verification-file.bin").name,
            "optimized": str(upload["optimized"]).lower(),
            "original-bytes": str(original_size),
            "stored-bytes": str(len(stored_data)),
        }
        blob.patch()
        if db:
            db.collection("certificates").document(certificate_id).update(metadata)
        else:
            certificate.update(metadata)
    except Exception as error:
        try:
            blob.delete()
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=f"Unable to upload certificate file: {error}") from error
    if old_path and old_path != path:
        try:
            bucket.blob(old_path).delete()
        except Exception:
            pass
    record_certificate_activity(
        "bi-image",
        f"Verification file uploaded by {certificate.get('recipient_name', 'user')}",
        f"{certificate.get('course_name', 'Certificate')} · {certificate.get('certificate_number', '')}",
    )
    await realtime_connections.broadcast({"type": "certificate.updated", "certificate_id": certificate_id})
    return {
        **metadata,
        "original_size": original_size,
        "stored_size": len(stored_data),
        "optimization_applied": upload["optimized"],
    }
 
 

@app.get("/api/certificates/{certificate_id}/verification-image")
def get_verification_image(certificate_id: str):
    """Return the uploaded evidence without exposing the storage object path."""
    certificate = next((item for item in get_all() if item.get("id") == certificate_id), None)
    if not certificate:
        raise HTTPException(status_code=404, detail="Certificate not found")
    image_path = certificate.get("verification_image_path")
    if not image_path:
        raise HTTPException(status_code=404, detail="No verification image was uploaded")
    bucket = get_storage_bucket()
    if not bucket:
        raise HTTPException(status_code=503, detail="Firebase Storage is not configured")
    try:
        blob = bucket.blob(image_path)
        blob.reload()
        return Response(
            content=blob.download_as_bytes(),
            media_type=blob.content_type or "application/octet-stream",
            headers={"Cache-Control": "private, max-age=300"},
        )
    except Exception as error:
        raise HTTPException(status_code=404, detail="Verification image is unavailable") from error
 
 

@app.get("/api/certificates/{certificate_id}/verification-file")
def get_verification_file(certificate_id: str, request: Request):
    """Return an API preview link without requiring a Storage signed URL."""
    certificate = next((item for item in get_all() if item.get("id") == certificate_id), None)
    if not certificate:
        raise HTTPException(status_code=404, detail="Certificate not found")
    file_path = certificate.get("verification_image_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="No verification file was uploaded for this certificate")
    bucket = get_storage_bucket()
    if not bucket:
        raise HTTPException(status_code=503, detail="Firebase Storage is not configured")
    try:
        blob = bucket.blob(file_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="The uploaded verification file no longer exists")
        # Cloud Run's default credentials contain an access token but no private
        # key, so they cannot generate a Cloud Storage signed URL.  Stream the
        # private object through the already-authorized API endpoint instead.
        preview_url = request.url_for(
            "get_verification_image", certificate_id=certificate_id
        )
        # Retain the previous response shape for clients that display this field.
        # The API URL itself is not time-limited; access is controlled by the API.
        return {"url": str(preview_url), "expires_in_minutes": 15}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail="Verification file is unavailable") from error


@app.patch("/api/certificates/{certificate_id}/status")
async def update_status(certificate_id: str, payload: StatusUpdate, background_tasks: BackgroundTasks):
    certificate = next((item for item in get_all() if item.get("id") == certificate_id), None)
    if not certificate:
        raise HTTPException(status_code=404, detail="Certificate not found")
    if certificate.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Only under-review certificates can be reviewed")
    remarks = payload.remarks.strip()
    if payload.status == "revoked" and not remarks:
        raise HTTPException(status_code=422, detail="Rejection remarks are required")
    updates = {
        "status": payload.status,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_by": payload.reviewed_by.strip(),
        "review_remarks": remarks if payload.status == "revoked" else None,
    }
    updates.update({"ru_verified": False})
    if db:
        reference = db.collection("certificates").document(certificate_id)
        reference.update(updates)
    else:
        certificate.update(updates)
    action = "validated" if payload.status == "issued" else "revoked"
    record_certificate_activity(
        "bi-patch-check" if payload.status == "issued" else "bi-x-octagon",
        f"Certificate {action} by {updates['reviewed_by']}",
        f"{certificate.get('course_name', 'Certificate')} - {certificate.get('recipient_name', 'user')}",
    )
    background_tasks.add_task(send_review_alert, {**certificate, **updates}, payload.status, updates["reviewed_by"])
    await realtime_connections.broadcast({"type": "certificate.updated", "certificate_id": certificate_id})
    return {"id": certificate_id, **updates}
 
 
 
@app.get("/api/verify/{certificate_number}")
def verify(certificate_number: str):
    for item in get_all():
        if str(item.get("certificate_number") or "").lower() == certificate_number.lower():
            return {"valid": item.get("status") == "issued", "certificate": item}
    raise HTTPException(status_code=404, detail="Certificate not found")
 
 

if __name__ == "__main__":
    from urllib.error import URLError
    from urllib.request import urlopen

    import uvicorn

    api_host = os.getenv("API_HOST", "0.0.0.0").strip() or "0.0.0.0"
    api_port = int(os.getenv("API_PORT", "5000"))

    # Avoid Uvicorn's WinError 10048 when this API is already running. This is
    # common during local development when a terminal or IDE task owns port 5000.
    try:
        with urlopen(f"http://127.0.0.1:{api_port}/api/auth/setup-status", timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if response.status == 200 and "needs_setup" in payload:
                print(f"CertTrack API is already running at http://127.0.0.1:{api_port}.")
                raise SystemExit(0)
    except (OSError, URLError, ValueError, json.JSONDecodeError):
        # No healthy CertTrack response was found; let Uvicorn attempt startup
        # and report a genuine configuration or bind problem if one remains.
        pass

    # Passing the app object avoids a second Windows process re-importing this
    # file when the backend is launched directly with `python main.py`.
    uvicorn.run(app, host=api_host, port=api_port)
