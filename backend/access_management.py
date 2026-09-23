"""Firestore API routes for access-management users."""
 
import base64
import json
import logging
import os
import secrets
import time
from datetime import date, datetime, timedelta
from hashlib import sha256
from html import escape
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
 
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import RedirectResponse, StreamingResponse
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.worksheet.datavalidation import DataValidation
from google.cloud.firestore_v1 import Query as FirestoreQuery
from pydantic import BaseModel, Field, field_validator
 
try:
    from .firebase_service import get_firestore_client
    from .email_alerts import send_email
    from .realtime import realtime_connections
except ImportError:
    from firebase_service import get_firestore_client
    from email_alerts import send_email
    from realtime import realtime_connections
 
 
 
router = APIRouter(prefix="/api/users", tags=["access-management"])
options_router = APIRouter(prefix="/api/access-options", tags=["access-management"])
auth_router = APIRouter(prefix="/api/auth", tags=["authentication"])
callback_router = APIRouter(tags=["authentication"])
logger = logging.getLogger(__name__)
INDIA_TIMEZONE = ZoneInfo("Asia/Kolkata")
 
 
def current_timestamp() -> str:
    """Return the current application time in India Standard Time."""
    return datetime.now(INDIA_TIMEZONE).isoformat()


def mark_settings_updated(section: Literal["categories", "oems"]) -> None:
    """Store the latest successful CRUD time for settings cards."""
    try:
        db = get_firestore_client()
        if db:
            db.collection("app_settings").document("settings_last_updated").set(
                {section: current_timestamp()}, merge=True
            )
    except Exception as error:
        logger.warning("Unable to save %s settings timestamp: %s", section, error)

def aggregate_count(source) -> int | None:
    """Return a Firestore aggregation count without reading every document."""
    try:
        return int(source.count().get()[0][0].value)
    except Exception:
        return None
 
 
 
 
class AccessUserFields(BaseModel):
    firstName: str = Field(min_length=1, max_length=80)
    lastName: str = Field(min_length=1, max_length=80)
    dateOfJoining: date = Field(le=date.today())
    employeeId: str = Field(min_length=1, max_length=20, pattern=r"^\d+$")
    employeeEmail: str = Field(min_length=3, max_length=254)
    location: str = Field(min_length=1, max_length=100)
    department: str = Field(min_length=1, max_length=100)
    reportingManager: str = Field(min_length=1, max_length=160)
    role: Literal["user", "admin", "project_manager"]

    @field_validator("role", mode="before")
    @classmethod
    def normalize_role(cls, value):
        """Store role values in the canonical form required by the API."""
        normalized = str(value or "").strip().casefold().replace(" ", "_")
        return normalized
 
 
class AccessUserCreate(AccessUserFields):
    pass


class BulkRowNumbers(BaseModel):
    row_numbers: list[int] = Field(min_length=1)
 
 
class AccessUserUpdate(AccessUserFields):
    # Older administrator accounts may not have a joining date.  Allow their
    # other profile fields to be updated without replacing that missing value.
    dateOfJoining: date | None = Field(default=None, le=date.today())
 
 
class AccessOptionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
 
 
class AccessOptionUpdate(AccessOptionCreate):
    pass
 
 
class AccessHistoryCreate(BaseModel):
    icon: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    detail: str = Field(min_length=1, max_length=500)
 
 
class AzureStartRequest(BaseModel):
    setup: bool = False
    email: str | None = Field(default=None, min_length=3, max_length=254)
    firstName: str | None = Field(default=None, max_length=80)
    lastName: str | None = Field(default=None, max_length=80)
    employeeId: str | None = Field(default=None, max_length=20, pattern=r"^\d+$")
 
 
class AzureSessionExchange(BaseModel):
    code: str = Field(min_length=20, max_length=100)


class PresenceHeartbeat(BaseModel):
    user_id: str = Field(min_length=1, max_length=200)
    session_id: str = Field(min_length=8, max_length=200)
 
 
def users_collection():
    """Return the Firestore access-management collection or an actionable error."""
    db = get_firestore_client()
    if not db:
        raise HTTPException(
            status_code=503,
            detail="Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env.",
        )
    return db.collection("users")


def bulk_uploads_collection():
    db = get_firestore_client()
    if not db:
        raise HTTPException(status_code=503, detail="Firebase is not configured.")
    return db.collection("bulk_user_uploads")


def managed_option_names(option_type: str) -> set[str]:
    return {str(item.to_dict().get("name", "")).strip().lower() for item in option_collection(option_type).stream()}
 
 
def auth_collection(name: str):
    """Return a Firestore collection used by the Microsoft sign-in flow."""
    db = get_firestore_client()
    if not db:
        raise HTTPException(
            status_code=503,
            detail="Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env.",
        )
    return db.collection(name)
 
 
def frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
 
 
def frontend_login_redirect(**parameters: str) -> str:
    return f"{frontend_url()}/login?{urlencode(parameters)}"


# def invitation_email_html(user: dict) -> str:
#     """Build the branded Microsoft SSO invitation sent to a newly onboarded user."""
#     name = escape(f"{user['firstName']} {user['lastName']}".strip())
#     role = "Administrator" if user["role"] == "admin" else "User"
#     sign_in_url = frontend_login_redirect(email=user["employeeEmail"])
#     return f"""
#     <!doctype html><html><body style="margin:0;background:#f7f1f2;font-family:Arial,sans-serif;color:#4b2730">
#       <div style="max-width:620px;margin:28px auto;padding:0 16px">
#         <div style="overflow:hidden;border:1px solid #efd7dc;border-radius:18px;background:#fff;box-shadow:0 14px 38px rgba(91,32,44,.10)">
#           <div style="padding:24px 28px;background:linear-gradient(115deg,#fbe9ec,#f6cbd1)">
#             <img src="cid:o2k-logo" alt="O2K" style="display:block;width:72px;height:auto;margin-bottom:14px">
#             <div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#bd2942">OTEC CERTIFICATE MANAGEMENT</div>
#             <h1 style="margin:9px 0 0;font-size:25px;color:#45252c">You are invited</h1>
#           </div>
#           <div style="padding:26px 28px">
#             <p style="margin:0 0 14px">Hello {name},</p>
#             <p style="margin:0 0 18px;line-height:1.6">You have been invited to OTEC Certificate Management as a <strong>{role}</strong>. Use your approved Microsoft work account to sign in securely.</p>
#             <table style="width:100%;margin:0 0 22px;border-collapse:collapse;background:#fff8f9;border-radius:10px">
#               <tr><td style="padding:10px 12px;color:#8b6670">Employee ID</td><td style="padding:10px 12px;font-weight:700">{escape(user['employeeId'])}</td></tr>
#               <tr><td style="padding:10px 12px;color:#8b6670">Email</td><td style="padding:10px 12px;font-weight:700">{escape(user['employeeEmail'])}</td></tr>
#               <tr><td style="padding:10px 12px;color:#8b6670">Role</td><td style="padding:10px 12px;font-weight:700">{role}</td></tr>

#             </table>
#             <a href="{escape(sign_in_url, quote=True)}" style="display:inline-block;padding:12px 20px;border-radius:9px;background:#bd2942;color:#fff;text-decoration:none;font-weight:700">Sign in with Microsoft</a>
#             <p style="margin:22px 0 0;color:#80656b;font-size:12px;line-height:1.5">If you were not expecting this invitation, please contact your OTEC administrator.</p>
#           </div>
#         </div>
#       </div>
#     </body></html>
#     """
def invitation_email_html(user: dict) -> str:
    """Build the branded Microsoft SSO invitation sent to a newly onboarded user."""
    name = escape(f"{user['firstName']} {user['lastName']}".strip())
    role = "Administrator" if user["role"] == "admin" else "Project Manager" if user["role"] == "project_manager" else "User"
    sign_in_url = frontend_login_redirect(email=user["employeeEmail"])

    return f"""
    <!doctype html>
    <html>
    <body style="margin:0;background:#f7f1f2;font-family:Arial,sans-serif;color:#4b2730">

      <div style="max-width:620px;margin:28px auto;padding:0 16px">

        <div style="overflow:hidden;border:1px solid #efd7dc;border-radius:18px;background:#fff;box-shadow:0 14px 38px rgba(91,32,44,.10)">

          <div style="padding:22px 28px 18px;background:linear-gradient(115deg,#fbe9ec,#f6cbd1);text-align:center">
            <img src="cid:o2k-logo"
                 alt="O2K"
                 style="display:block;width:72px;height:auto;margin:0 auto 12px">

            <div style="font-size:15px;font-weight:700;letter-spacing:.08em;color:#bd2942;line-height:1.25">
              OTEC CERTIFICATE MANAGEMENT
            </div>

            <h1 style="margin:6px 0 0;font-size:25px;line-height:1.2;color:#45252c;text-align:left">
              You&rsquo;re Invited!
            </h1>
          </div>

          <div style="padding:18px 28px 26px">

            <p style="margin:0 0 14px">
              Hello <strong>{name}</strong>,
            </p>

            <p style="margin:0 0 18px;line-height:1.6">
              You have been invited to access the <strong>OTEC Certificate Management Application</strong>
              as a <strong>{role}</strong>.
              Please sign in securely using your <strong>Microsoft account</strong> to access the application.
            </p>

            <table style="width:100%;margin:0 0 22px;border-collapse:collapse;background:#fff8f9;border-radius:10px">

              <tr>
                <td style="padding:10px 12px;color:#8b6670">
                  Employee ID
                </td>
                <td style="padding:10px 12px;font-weight:700">
                  {escape(user['employeeId'])}
                </td>
              </tr>

              <tr>
                <td style="padding:10px 12px;color:#8b6670">
                  Email
                </td>
                <td style="padding:10px 12px;font-weight:700">
                  {escape(user['employeeEmail'])}
                </td>
              </tr>

              <tr>
                <td style="padding:10px 12px;color:#8b6670">
                  Department
                </td>
                <td style="padding:10px 12px;font-weight:700">
                  {escape(user['department'])}
                </td>
              </tr>

              <tr>
                <td style="padding:10px 12px;color:#8b6670">
                  Location
                </td>
                <td style="padding:10px 12px;font-weight:700">
                  {escape(user['location'])}
                </td>
              </tr>

              <tr>
                <td style="padding:10px 12px;color:#8b6670">
                  Role
                </td>
                <td style="padding:10px 12px;font-weight:700">
                  {role}
                </td>
              </tr>

            </table>

            <div style="text-align:center">
              <a href="{escape(sign_in_url, quote=True)}"
                 style="display:inline-block;padding:12px 20px;border-radius:9px;background:#bd2942;color:#fff;text-decoration:none;font-weight:700">
                Sign in with Microsoft
              </a>
            </div>

            <p style="margin:22px 0 0;color:#80656b;font-size:12px;line-height:1.5">
              If you were not expecting this invitation, please contact your OTEC administrator.
            </p>

          </div>
        </div>
      </div>

    </body>
    </html>
    """

def send_user_invitation(user: dict) -> bool:
    logo_path = Path(__file__).resolve().parent / "Images" / "o2k-logo.png"
    return send_email(
        [user["employeeEmail"]],
        "You're invited to OTEC Certificate Management",
        invitation_email_html(user),
        logo_path,
    )
 
 
def azure_settings() -> tuple[str, str, str, str]:
    """Read the dedicated SSO app registration, never the email-sending app."""
    tenant_id = os.getenv("AZURE_SSO_TENANT_ID", "").strip()
    client_id = os.getenv("AZURE_SSO_CLIENT_ID", "").strip()
    client_secret = os.getenv("AZURE_SSO_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv(
        "AZURE_SSO_REDIRECT_URI", "http://localhost:5000/auth/callback"
    ).strip()
    if not tenant_id or not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=(
                "Microsoft SSO is not configured. Set AZURE_SSO_TENANT_ID, "
                "AZURE_SSO_CLIENT_ID, and AZURE_SSO_CLIENT_SECRET in backend/.env."
            ),
        )
    return tenant_id, client_id, client_secret, redirect_uri
 
 
def fetch_json(
    url: str, *, data: dict | None = None, headers: dict | None = None
) -> dict:
    encoded = urlencode(data).encode("utf-8") if data is not None else None
    request = Request(
        url,
        data=encoded,
        headers=headers or {},
        method="POST" if data is not None else "GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:
        logger.exception("Microsoft sign-in request failed: %s", error)
        raise HTTPException(
            status_code=502, detail="Unable to reach Microsoft sign-in service"
        ) from error
 
 
def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[1].lower() if "@" in email else ""
 
 
def azure_profile_emails(profile: dict) -> set[str]:
    """Return all usable mailbox and sign-in aliases for the Microsoft account."""
    values = [profile.get("mail"), profile.get("userPrincipalName")]
    other_mails = profile.get("otherMails") or []
    if isinstance(other_mails, (list, tuple, set)):
        values.extend(other_mails)
    return {
        str(value).strip().lower()
        for value in values
        if value and "@" in str(value)
    }
 
 
def preferred_azure_email(profile: dict, candidates: set[str]) -> str:
    for value in (profile.get("mail"), profile.get("userPrincipalName")):
        address = str(value or "").strip().lower()
        if address in candidates:
            return address
    return next(iter(candidates), "")
 
 
def allowed_azure_domains() -> set[str]:
    configured = {
        item.strip().lower().lstrip("@")
        for item in os.getenv("AZURE_ALLOWED_DOMAINS", "").split(",")
        if item.strip()
    }
    try:
        saved = auth_collection("auth_settings").document("azure").get()
        if saved.exists:
            configured.update(
                str(item).lower().lstrip("@")
                for item in saved.to_dict().get("allowed_domains", [])
                if item
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unable to read saved Azure domain restrictions")
    return configured
 
 
def pkce_challenge(verifier: str) -> str:
    digest = sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
 
 
def public_user(user_id: str, data: dict) -> dict:
    """Prevent password hashes from ever being returned by the API."""
    return {"id": user_id, **{key: value for key, value in data.items() if key != "password_hash"}}
 
 
def clean_oem_name(value: object) -> str:
    """Clean spacing while preserving the administrator-entered OEM name."""
    return " ".join(str(value or "").split()).strip()
 
 
def is_placeholder_oem(value: object) -> bool:
    """Exclude blank and placeholder vendor values from the OEM directory."""
    alias = "".join(
        character for character in clean_oem_name(value).casefold() if character.isalnum()
    )
    return alias in {"", "na", "none", "notapplicable", "notrecorded", "unknown", "other"}
 
 
def option_collection(option_type: Literal["locations", "departments", "oems", "categories"]):
    collection_name = {
        "locations": "access_locations",
        "departments": "access_departments",
        "oems": "certification_oems",
        "categories": "certification_categories",
    }[option_type]
    db = get_firestore_client()
    if not db:
        raise HTTPException(
            status_code=503,
            detail="Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env.",
        )
    return db.collection(collection_name)


def oem_deletion_collection():
    db = get_firestore_client()
    if not db:
        raise HTTPException(status_code=503, detail="Firebase is not configured")
    return db.collection("deleted_certification_oems")


def oem_deletion_id(name: object) -> str:
    normalized = clean_oem_name(name).casefold().encode("utf-8")
    return sha256(normalized).hexdigest()
 
 
 
def history_collection():
    db = get_firestore_client()
    if not db:
        raise HTTPException(
            status_code=503,
            detail="Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env.",
        )
    return db.collection("access_history")


def departed_employees_collection():
    db = get_firestore_client()
    if not db:
        raise HTTPException(status_code=503, detail="Firebase is not configured")
    return db.collection("departed_employees")


def purge_expired_departed_employee_data() -> int:
    """Delete offboarded employee snapshots once their 30-day retention ends."""
    collection = departed_employees_collection()
    now = datetime.now(INDIA_TIMEZONE)
    removed = 0
    for snapshot in collection.stream():
        item = snapshot.to_dict()
        try:
            retain_until = datetime.fromisoformat(str(item.get("left_at", ""))) + timedelta(days=30)
        except (TypeError, ValueError):
            try:
                retain_until = datetime.fromisoformat(str(item.get("retain_until", "")))
            except (TypeError, ValueError):
                retain_until = now
        if retain_until > now:
            if item.get("retain_until") != retain_until.isoformat():
                snapshot.reference.update({"retain_until": retain_until.isoformat()})
            continue
        db = get_firestore_client()
        for certificate in item.get("certificates", []):
            certificate_id = certificate.get("id")
            if certificate_id:
                db.collection("certificates").document(str(certificate_id)).delete()
        snapshot.reference.delete()
        removed += 1
    return removed
 
 
def record_history(icon: str, title: str, detail: str) -> None:
    """Write an audit entry together with server-side access changes."""
    history_collection().document().set(
        {
            "icon": icon,
            "title": title,
            "detail": detail,
            "time": current_timestamp(),
        }
    )
 
 
def firestore_unavailable(error: Exception) -> HTTPException:
    """Translate Firebase connectivity and permission failures into an API response."""
    logger.exception("Firestore access failed: %s", error)
    return HTTPException(
        status_code=503,
        detail=f"Firestore access failed ({type(error).__name__}): {error}",
    )
 
 
def all_user_snapshots():
    """Read user records once for login and first-admin setup checks."""
    try:
        return list(users_collection().stream())
    except Exception as error:
        raise firestore_unavailable(error) from error
 
 
@auth_router.get("/setup-status")
def setup_status():
    """Expose whether the system needs its one-time first administrator."""
    return {"needs_setup": not bool(all_user_snapshots())}
 
 
@auth_router.post("/azure/start")
def azure_start(payload: AzureStartRequest):
    """Validate onboarding and create a short-lived Microsoft authorization request."""
    tenant_id, client_id, _, redirect_uri = azure_settings()
    email = (payload.email or "").strip().lower()
 
    if payload.setup:
        if all_user_snapshots():
            raise HTTPException(status_code=409, detail="An administrator already exists")
        if not all([payload.firstName, payload.lastName, payload.employeeId]):
            raise HTTPException(
                status_code=422, detail="Enter the first administrator details"
            )
    else:
        if not email:
            raise HTTPException(status_code=422, detail="Enter your work email address")
        user_snapshot = next(
            (
                item
                for item in all_user_snapshots()
                if str(item.to_dict().get("employeeEmail", "")).strip().lower()
                == email
            ),
            None,
        )
        if not user_snapshot:
            raise HTTPException(
                status_code=403,
                detail="This work email is not onboarded. Please contact your administrator.",
            )
 
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    auth_collection("oauth_states").document(state).set(
        {
            "expires_at": time.time() + 600,
            "setup": payload.setup,
            "firstName": (payload.firstName or "").strip(),
            "lastName": (payload.lastName or "").strip(),
            "employeeId": payload.employeeId or "",
            "email": email,
            "code_verifier": code_verifier,
        }
    )
    parameters = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": "openid profile email User.Read",
        "state": state,
        "code_challenge": pkce_challenge(code_verifier),
        "code_challenge_method": "S256",
    }
    if email:
        parameters["login_hint"] = email
        # The CertTrack session is tab-scoped, while Microsoft cookies are shared
        # by the browser profile. Force Microsoft to authenticate the email that
        # was entered instead of silently reusing another tab's work account.
        parameters["prompt"] = "login"
    else:
        # First-admin setup has no pre-approved email, so Microsoft must ask
        # which work account should create the initial administrator.
        parameters["prompt"] = "select_account"
    authorization_url = (
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize?"
        f"{urlencode(parameters)}"
    )
    return {"authorization_url": authorization_url}
 
 
@callback_router.get("/auth/callback")
@auth_router.get("/azure/callback")
def azure_callback(code: str = "", state: str = ""):
    """Validate Microsoft identity and issue a short-lived, single-use app code."""
    if not code or not state:
        return RedirectResponse(
            frontend_login_redirect(error="Microsoft sign-in was cancelled")
        )
 
    reference = auth_collection("oauth_states").document(state)
    snapshot = reference.get()
    reference.delete()
    if not snapshot.exists or float(snapshot.to_dict().get("expires_at", 0)) < time.time():
        return RedirectResponse(
            frontend_login_redirect(error="Invalid or expired sign-in request")
        )
 
    pending = snapshot.to_dict()
    tenant_id, client_id, client_secret, redirect_uri = azure_settings()
    try:
        token = fetch_json(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "scope": "openid profile email User.Read",
                "code_verifier": pending.get("code_verifier", ""),
            },
        )
        access_token = token.get("access_token")
        if not access_token:
            raise HTTPException(status_code=502, detail="Microsoft token exchange failed")
        profile = fetch_json(
            "https://graph.microsoft.com/v1.0/me?"
            "$select=mail,userPrincipalName,otherMails,givenName,surname",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    except HTTPException as error:
        return RedirectResponse(frontend_login_redirect(error=str(error.detail)))
 
    profile_emails = azure_profile_emails(profile)
    email = preferred_azure_email(profile, profile_emails)
    if not email:
        return RedirectResponse(
            frontend_login_redirect(error="Microsoft account does not have a work email")
        )
 
    allowed_domains = allowed_azure_domains()
    if allowed_domains and not any(
        email_domain(address) in allowed_domains for address in profile_emails
    ):
        return RedirectResponse(
            frontend_login_redirect(error="Use your approved work account")
        )
 
    snapshots = all_user_snapshots()
    user_snapshot = next(
        (
            item
            for item in snapshots
            if str(item.to_dict().get("employeeEmail", "")).strip().lower()
            in profile_emails
        ),
        None,
    )
    if not user_snapshot and pending.get("setup") and not snapshots:
        user = {
            "firstName": pending.get("firstName")
            or str(profile.get("givenName") or "Administrator"),
            "lastName": pending.get("lastName") or str(profile.get("surname") or ""),
            "employeeId": pending.get("employeeId", ""),
            "employeeEmail": email,
            "dateOfJoining": date.today().isoformat(),
            "location": "Not assigned",
            "department": "Administration",
            "reportingManager": "Self",
            "role": "admin",
            "auth_provider": "azure",
            "created_at": current_timestamp(),
        }
        user_reference = users_collection().document()
        user_reference.set(user)
        user_snapshot = user_reference.get()
        auth_collection("auth_settings").document("azure").set(
            {
                "allowed_domains": sorted(allowed_domains | {email_domain(email)}),
                "tenant_id": tenant_id,
                "updated_at": current_timestamp(),
            }
        )
        record_history(
            "bi-microsoft",
            f"Created SSO administrator {user['firstName']} {user['lastName']}".strip(),
            email,
        )
 
    if not user_snapshot:
        return RedirectResponse(
            frontend_login_redirect(error="This work account is not onboarded")
        )
 
    user = user_snapshot.to_dict()
    session_code = secrets.token_urlsafe(32)
    auth_collection("auth_sessions").document(session_code).set(
        {
            "expires_at": time.time() + 120,
            "user_id": user_snapshot.id,
            "user": public_user(user_snapshot.id, user),
        }
    )
    return RedirectResponse(frontend_login_redirect(azure_code=session_code))
 
 
@auth_router.post("/azure/exchange")
def exchange_azure_session(payload: AzureSessionExchange):
    """Exchange a single-use callback code for the onboarded CertTrack user."""
    reference = auth_collection("auth_sessions").document(payload.code)
    snapshot = reference.get()
    reference.delete()
    if not snapshot.exists or float(snapshot.to_dict().get("expires_at", 0)) < time.time():
        raise HTTPException(
            status_code=401,
            detail="Your Microsoft sign-in session has expired. Please try again.",
        )
    session = snapshot.to_dict()
    user_reference = users_collection().document(session["user_id"])
    last_seen_at = current_timestamp()
    user_reference.update({"last_seen_at": last_seen_at})
    return {"user": {**session["user"], "last_seen_at": last_seen_at}}


@auth_router.post("/presence", status_code=204)
def record_presence(payload: PresenceHeartbeat):
    """Save a tab-scoped session heartbeat without requiring admin polling."""
    reference = users_collection().document(payload.user_id)
    try:
        reference.update({
            "last_seen_at": current_timestamp(),
            "last_session_id": payload.session_id,
        })
    except Exception as error:
        raise HTTPException(status_code=404, detail="User session is no longer active") from error
 
 
@router.get("")
def list_users(
    search: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(5, ge=1, le=100),
):
    """Return users stored in the Firestore `users` collection."""
    users = [
        public_user(snapshot.id, snapshot.to_dict())
        for snapshot in users_collection().stream()
    ]
    term = search.lower().strip()
    if term:
        users = [
            user
            for user in users
            if term in " ".join(str(value) for value in user.values()).lower()
        ]
    users = sorted(users, key=lambda user: (user.get("firstName", ""), user.get("lastName", "")))
    total = aggregate_count(users_collection()) if not term else None
    if total is None:
        total = len(users)
    start = (page - 1) * page_size
    return {"items": users[start : start + page_size], "total": total, "page": page, "page_size": page_size}
 
 
@router.post("", status_code=201)
def create_user(payload: AccessUserCreate):
    """Create a Microsoft SSO access-management user in Firestore."""
    user = {
        **payload.model_dump(mode="json"),
        "auth_provider": "azure",
        "created_at": current_timestamp(),
    }
    reference = users_collection().document()
    reference.set(user)
    invitation_sent = send_user_invitation(user)
    record_history(
        "bi-person-plus",
        f"Created {user['firstName']} {user['lastName']}",
        f"{user['employeeId']} · {user['role']} · {user['department']}",
    )
    realtime_connections.publish({"type": "access.updated"})
    return {**public_user(reference.id, user), "invitation_sent": invitation_sent}


@router.get("/bulk/template")
def download_bulk_user_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Users"
    columns = ["First name", "Last name", "Date of joining", "Employee ID", "Employee email", "Location", "Department", "Reporting manager", "Role"]
    sheet.append(columns)
    sheet.freeze_panes = "A2"
    for column, width in zip("ABCDEFGHI", [18, 18, 16, 16, 32, 22, 22, 24, 12]): sheet.column_dimensions[column].width = width
    locations = sorted(
        [str(item.to_dict().get("name", "")).strip() for item in option_collection("locations").stream() if str(item.to_dict().get("name", "")).strip()],
        key=str.casefold,
    )
    departments = sorted(
        [str(item.to_dict().get("name", "")).strip() for item in option_collection("departments").stream() if str(item.to_dict().get("name", "")).strip()],
        key=str.casefold,
    )
    lists = workbook.create_sheet("Managed options")
    lists.append(["Locations", "Departments"])
    for row, (location, department) in enumerate(zip(locations + [""] * max(0, len(departments)-len(locations)), departments + [""] * max(0, len(locations)-len(departments))), 2):
        lists.cell(row, 1, location); lists.cell(row, 2, department)
    for formula, column in [(f"'Managed options'!$A$2:$A${max(2, len(locations)+1)}", "F"), (f"'Managed options'!$B$2:$B${max(2, len(departments)+1)}", "G"), ('"user,admin"', "I")]:
        validation = DataValidation(type="list", formula1=formula, allow_blank=False)
        sheet.add_data_validation(validation); validation.add(f"{column}2:{column}500")
    date_validation = DataValidation(type="date", operator="between", formula1="DATE(1900,1,1)", formula2="TODAY()", allow_blank=False)
    date_validation.error = "Enter a valid joining date, not later than today."
    date_validation.errorTitle = "Invalid joining date"
    date_validation.prompt = "Enter a date, for example 03/31/2025."
    date_validation.promptTitle = "Date of joining"
    sheet.add_data_validation(date_validation); date_validation.add("C2:C500")
    for row in range(2, 501): sheet.cell(row, 3).number_format = "MM/DD/YYYY"
    lists.sheet_state = "hidden"
    output = BytesIO(); workbook.save(output); output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=OTEC_User_Bulk_Template.xlsx"})


@router.post("/bulk/upload")
def upload_bulk_users(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload an .xlsx template file")
    try: workbook = load_workbook(BytesIO(file.file.read()), data_only=True)
    except Exception as error: raise HTTPException(status_code=400, detail="Unable to read Excel file") from error
    sheet = workbook.active
    headers = [str(cell.value or "").strip() for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
    expected = ["First name", "Last name", "Date of joining", "Employee ID", "Employee email", "Location", "Department", "Reporting manager", "Role"]
    if headers[:len(expected)] != expected: raise HTTPException(status_code=400, detail="Use the downloaded OTEC bulk-user template")
    location_options = {str(item.to_dict().get("name", "")).strip().lower(): str(item.to_dict().get("name", "")).strip() for item in option_collection("locations").stream()}
    department_options = {str(item.to_dict().get("name", "")).strip().lower(): str(item.to_dict().get("name", "")).strip() for item in option_collection("departments").stream()}
    locations, departments = set(location_options), set(department_options)
    existing = [snapshot.to_dict() for snapshot in users_collection().stream()]
    existing_emails = {str(item.get("employeeEmail", "")).strip().lower() for item in existing}
    existing_ids = {str(item.get("employeeId", "")).strip() for item in existing}
    seen_emails, seen_ids = set(), set()
    rows = []
    for number, values in enumerate(sheet.iter_rows(min_row=2, values_only=True), 2):
        if not any(values): continue
        row = dict(zip(["firstName","lastName","dateOfJoining","employeeId","employeeEmail","location","department","reportingManager","role"], values))
        joining_date = row.get("dateOfJoining")
        row = {key: str(value).strip() if value is not None else "" for key, value in row.items()}
        if isinstance(joining_date, datetime):
            row["dateOfJoining"] = joining_date.date().isoformat()
        elif isinstance(joining_date, date):
            row["dateOfJoining"] = joining_date.isoformat()
        if row["dateOfJoining"]:
            for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
                try:
                    row["dateOfJoining"] = datetime.strptime(row["dateOfJoining"], pattern).date().isoformat(); break
                except ValueError: continue
        errors = []
        if row["location"].lower() not in locations: errors.append("Location is not in Manage options")
        if row["department"].lower() not in departments: errors.append("Department is not in Manage options")
        if row["location"].lower() in location_options: row["location"] = location_options[row["location"].lower()]
        if row["department"].lower() in department_options: row["department"] = department_options[row["department"].lower()]
        row["role"] = row["role"].casefold().replace(" ", "_")
        if row["role"].lower() not in {"user", "admin", "project_manager"}: errors.append("Role must be user, project_manager, or admin")
        if not row["dateOfJoining"] or len(row["dateOfJoining"]) != 10: errors.append("Date of joining must be MM/DD/YYYY or YYYY-MM-DD")
        email, employee_id = row["employeeEmail"].lower(), row["employeeId"]
        if email in existing_emails: errors.append("Employee email already exists")
        if employee_id in existing_ids: errors.append("Employee ID already exists")
        if email in seen_emails: errors.append("Duplicate employee email in this file")
        if employee_id in seen_ids: errors.append("Duplicate employee ID in this file")
        seen_emails.add(email); seen_ids.add(employee_id)
        errors.extend(row_field_errors(row))
        rows.append({"row": number, "data": row, "errors": errors})
    reference = bulk_uploads_collection().document(); reference.set({"rows": rows, "status": "pending", "created_at": current_timestamp()})
    realtime_connections.publish({"type": "access.updated"})
    return {"id": reference.id, "rows": rows}

@router.get("/bulk/pending")
def list_bulk_users():
    return [{"id": item.id, **item.to_dict()} for item in bulk_uploads_collection().where("status", "==", "pending").stream()]

@router.post("/bulk/{upload_id}/approve")
def approve_bulk_users(upload_id: str):
    reference = bulk_uploads_collection().document(upload_id); snapshot = reference.get()
    if not snapshot.exists: raise HTTPException(status_code=404, detail="Bulk upload not found")
    upload = snapshot.to_dict(); rows = upload.get("rows", [])
    valid_rows = [row for row in rows if not row.get("errors")]
    if not valid_rows: raise HTTPException(status_code=400, detail="There are no valid rows to approve")
    created = 0
    for item in valid_rows:
        try: payload = AccessUserCreate(**item["data"])
        except Exception as error: raise HTTPException(status_code=400, detail=f"Row {item.get('row')}: {error}") from error
        user = {**payload.model_dump(mode="json"), "auth_provider": "azure", "created_at": current_timestamp()}
        user_reference = users_collection().document(); user_reference.set(user); send_user_invitation(user); created += 1
    invalid_rows = [row for row in rows if row.get("errors")]
    if invalid_rows:
        reference.update({"rows": invalid_rows, "status": "pending", "approved_at": current_timestamp(), "created_count": created})
    else:
        reference.update({"status": "approved", "approved_at": current_timestamp(), "created_count": created})
    record_history("bi-people", "Approved bulk user upload", f"Created {created} access users")
    realtime_connections.publish({"type": "access.updated"})
    return {"created": created}

@router.delete("/bulk/{upload_id}", status_code=204)
def delete_bulk_upload(upload_id: str):
    reference = bulk_uploads_collection().document(upload_id)
    if not reference.get().exists: raise HTTPException(status_code=404, detail="Bulk upload not found")
    reference.delete()
    realtime_connections.publish({"type": "access.updated"})
 


def find_bulk_upload(upload_id: str):
    """Return the (reference, snapshot, document) for a bulk upload or raise 404."""
    reference = bulk_uploads_collection().document(upload_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Bulk upload not found")
    return reference, snapshot, snapshot.to_dict()


def row_field_errors(row):
    """Return schema-level field errors so a row is flagged before approval."""
    errors = []
    if not str(row.get("firstName", "")).strip():
        errors.append("First name is required")
    if not str(row.get("lastName", "")).strip():
        errors.append("Last name is required")
    employee_id = str(row.get("employeeId", "")).strip()
    if not employee_id:
        errors.append("Employee ID is required")
    elif not employee_id.isdigit():
        errors.append("Employee ID must contain digits only")
    if not str(row.get("reportingManager", "")).strip():
        errors.append("Reporting manager is required")
    if not str(row.get("employeeEmail", "")).strip():
        errors.append("Employee email is required")
    joining_date = row.get("dateOfJoining")
    if joining_date:
        try:
            date.fromisoformat(joining_date)
        except (TypeError, ValueError):
            errors.append("Date of joining must be a valid date")
    return errors


def validate_bulk_row(row_data):
    """Normalize and validate a single bulk user row against options and existing users.

    Returns (normalized_data, errors). Existing users and options are read from Firestore
    so a corrected row is checked against the current state at edit time.
    """
    row = {key: str(value).strip() if value is not None else "" for key, value in row_data.items()}
    joining_date = row.get("dateOfJoining")
    if isinstance(joining_date, datetime):
        row["dateOfJoining"] = joining_date.date().isoformat()
    elif isinstance(joining_date, date):
        row["dateOfJoining"] = joining_date.isoformat()
    if row["dateOfJoining"]:
        for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
            try:
                row["dateOfJoining"] = datetime.strptime(row["dateOfJoining"], pattern).date().isoformat(); break
            except ValueError: continue
    location_options = {str(item.to_dict().get("name", "")).strip().lower(): str(item.to_dict().get("name", "")).strip() for item in option_collection("locations").stream()}
    department_options = {str(item.to_dict().get("name", "")).strip().lower(): str(item.to_dict().get("name", "")).strip() for item in option_collection("departments").stream()}
    locations, departments = set(location_options), set(department_options)
    existing = [snapshot.to_dict() for snapshot in users_collection().stream()]
    existing_emails = {str(item.get("employeeEmail", "")).strip().lower() for item in existing}
    existing_ids = {str(item.get("employeeId", "")).strip() for item in existing}
    errors = []
    if row["location"].lower() not in locations: errors.append("Location is not in Manage options")
    if row["department"].lower() not in departments: errors.append("Department is not in Manage options")
    if row["location"].lower() in location_options: row["location"] = location_options[row["location"].lower()]
    if row["department"].lower() in department_options: row["department"] = department_options[row["department"].lower()]
    row["role"] = row["role"].casefold().replace(" ", "_")
    if row["role"].lower() not in {"user", "admin", "project_manager"}: errors.append("Role must be user, project_manager, or admin")
    if not row["dateOfJoining"] or len(row["dateOfJoining"]) != 10: errors.append("Date of joining must be MM/DD/YYYY or YYYY-MM-DD")
    email, employee_id = row["employeeEmail"].lower(), row["employeeId"]
    if email in existing_emails: errors.append("Employee email already exists")
    if employee_id in existing_ids: errors.append("Employee ID already exists")
    errors.extend(row_field_errors(row))
    return row, errors


@router.get("/bulk/{upload_id}/rows")
def list_bulk_rows(upload_id: str):
    """Return all pending rows of a bulk upload without side effects."""
    _, _, upload = find_bulk_upload(upload_id)
    return {"id": upload_id, "rows": upload.get("rows", [])}


@router.post("/bulk/{upload_id}/rows/{row_number}/approve")
def approve_bulk_row(upload_id: str, row_number: int):
    """Approve a single valid bulk row and create the access user."""
    reference, snapshot, upload = find_bulk_upload(upload_id)
    rows = upload.get("rows", [])
    target = next((row for row in rows if row.get("row") == row_number), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Row not found in bulk upload")
    if target.get("errors"):
        raise HTTPException(status_code=400, detail="Cannot approve a row that needs correction")
    try:
        payload = AccessUserCreate(**target["data"])
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Row {target.get('row')}: {error}") from error
    user = {**payload.model_dump(mode="json"), "auth_provider": "azure", "created_at": current_timestamp()}
    user_ref = users_collection().document()
    user_ref.set(user)
    send_user_invitation(user)
    remaining = [row for row in rows if row.get("row") != row_number]
    created_count = upload.get("created_count", 0) + 1
    if remaining:
        reference.update({"rows": remaining, "status": "pending", "created_count": created_count})
    else:
        reference.update({"status": "approved", "approved_at": current_timestamp(), "created_count": created_count})
    record_history("bi-people", "Approved bulk user", f"Created {target['data'].get('firstName', '')} {target['data'].get('lastName', '')} ({target['data'].get('employeeId', '')})")
    return {"created": 1, "user_id": user_ref.id}


@router.put("/bulk/{upload_id}/rows/{row_number}")
def edit_bulk_row(upload_id: str, row_number: int, payload: AccessUserCreate):
    """Edit a pending bulk row, re-validating it against current options and users."""
    reference, snapshot, upload = find_bulk_upload(upload_id)
    rows = upload.get("rows", [])
    if not any(row.get("row") == row_number for row in rows):
        raise HTTPException(status_code=404, detail="Row not found in bulk upload")
    normalized, errors = validate_bulk_row(payload.model_dump(mode="json"))
    updated_rows = [
        {**row, "data": normalized, "errors": errors} if row.get("row") == row_number else row
        for row in rows
    ]
    reference.update({"rows": updated_rows, "status": "pending"})
    record_history(
        "bi-pencil-square",
        f"Edited bulk user row {row_number}",
        f"{normalized.get('firstName', '')} {normalized.get('lastName', '')} ({normalized.get('employeeId', '')})",
    )
    return {"id": upload_id, "row": row_number, "data": normalized, "errors": errors}


@router.delete("/bulk/{upload_id}/rows/{row_number}", status_code=204)
def delete_bulk_row(upload_id: str, row_number: int):
    """Remove a single pending row from a bulk upload."""
    reference, snapshot, upload = find_bulk_upload(upload_id)
    rows = upload.get("rows", [])
    target = next((row for row in rows if row.get("row") == row_number), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Row not found in bulk upload")
    remaining = [row for row in rows if row.get("row") != row_number]
    if remaining:
        reference.update({"rows": remaining, "status": "pending"})
    else:
        reference.update({"status": "approved", "approved_at": current_timestamp()})
    record_history(
        "bi-trash3",
        f"Removed bulk user row {row_number}",
        f"{target['data'].get('firstName', '')} {target['data'].get('lastName', '')} ({target['data'].get('employeeId', '')})",
    )


@router.post("/bulk/{upload_id}/rows/delete")
def delete_bulk_rows(upload_id: str, payload: BulkRowNumbers):
    """Remove several pending rows from a bulk upload at once."""
    reference, snapshot, upload = find_bulk_upload(upload_id)
    rows = upload.get("rows", [])
    numbers = set(payload.row_numbers)
    target_rows = [row for row in rows if row.get("row") in numbers]
    if not target_rows:
        raise HTTPException(status_code=404, detail="No matching rows found in bulk upload")
    remaining = [row for row in rows if row.get("row") not in numbers]
    if remaining:
        reference.update({"rows": remaining, "status": "pending"})
    else:
        reference.update({"status": "approved", "approved_at": current_timestamp()})
    names = ", ".join(
        (f"{row.get('data', {}).get('firstName', '')} {row.get('data', {}).get('lastName', '')}".strip() or f"row {row.get('row')}")
        for row in target_rows
    )
    record_history(
        "bi-trash3",
        f"Removed {len(target_rows)} bulk user row(s)",
        names,
    )
    realtime_connections.publish({"type": "access.updated"})
    return {"deleted": len(target_rows)}


@router.put("/{user_id}")
def update_user(user_id: str, payload: AccessUserUpdate):
    """Replace an existing user while preserving its creation time."""
    reference = users_collection().document(user_id)
    existing = reference.get()
    if not existing.exists:
        raise HTTPException(status_code=404, detail="User not found")
 
    existing_data = existing.to_dict()
    user_data = payload.model_dump(mode="json", exclude_none=True)
    is_demoting_last_admin = (
        str(existing_data.get("role") or "").casefold() == "admin"
        and str(user_data.get("role") or "").casefold() != "admin"
    )
    if is_demoting_last_admin:
        has_another_admin = any(
            snapshot.id != user_id and str(snapshot.to_dict().get("role") or "").casefold() == "admin"
            for snapshot in all_user_snapshots()
        )
        if not has_another_admin:
            raise HTTPException(
                status_code=409,
                detail="Assign another user as Admin before changing the final administrator's role.",
            )
    user = {
        **user_data,
        "dateOfJoining": user_data.get("dateOfJoining", existing_data.get("dateOfJoining")),
        "auth_provider": "azure",
        "created_at": existing_data.get("created_at"),
        "updated_at": current_timestamp(),
    }
    reference.set(user, merge=True)
    record_history(
        "bi-pencil-square",
        f"Updated {user['firstName']} {user['lastName']}",
        f"{user['employeeId']} · {user['role']} · {user['department']}",
    )
    realtime_connections.publish({"type": "access.updated"})
    return public_user(user_id, user)
 
 
@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: str):
    """Offboard a user while retaining their audit snapshot for 30 days."""
    reference = users_collection().document(user_id)
    existing = reference.get()
    if not existing.exists:
        raise HTTPException(status_code=404, detail="User not found")
    user = existing.to_dict()
    if str(user.get("role") or "").casefold() == "admin":
        has_another_admin = any(
            snapshot.id != user_id and str(snapshot.to_dict().get("role") or "").casefold() == "admin"
            for snapshot in all_user_snapshots()
        )
        if not has_another_admin:
            raise HTTPException(
                status_code=409,
                detail="Assign another user as Admin before deleting the final administrator.",
            )
    left_at = datetime.now(INDIA_TIMEZONE)
    email = str(user.get("employeeEmail", "")).strip().lower()
    db = get_firestore_client()
    certificates = []
    try:
        for snapshot in db.collection("certificates").stream():
            certificate = snapshot.to_dict()
            if str(certificate.get("email", "")).strip().lower() != email:
                continue
            certificates.append({"id": snapshot.id, **certificate})
            snapshot.reference.update({"employee_left_at": left_at.isoformat()})
        departed_employees_collection().document(user_id).set({
            **user,
            "original_user_id": user_id,
            "left_at": left_at.isoformat(),
            "retain_until": (left_at + timedelta(days=30)).isoformat(),
            "certificate_count": len(certificates),
            "active_certificate_count": sum(item.get("status") == "issued" for item in certificates),
            "certificates": certificates,
        })
        reference.delete()
    except Exception as error:
        raise firestore_unavailable(error) from error
    record_history(
        "bi-person-dash",
        f"Employee left: {user.get('firstName', '')} {user.get('lastName', '')}".strip(),
        f"{user.get('employeeId', 'Employee')} ({user.get('employeeEmail', '')}) offboarded; {len(certificates)} certificate record(s) retained for 30 days.",
    )
    realtime_connections.publish({"type": "access.updated"})
 
 
 
@options_router.get("/history/logs")
def list_access_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """Return one retained access-history page, newest first."""
    try:
        collection = history_collection()
        logs = []
        for snapshot in collection.stream():
            item = snapshot.to_dict()
            icon = str(item.get("icon", "")).strip().casefold()
            title = str(item.get("title", "")).strip().casefold()
            is_employee_created = icon == "bi-person-plus" or title.startswith("created ")
            is_employee_departed = icon == "bi-person-dash" or title.startswith("employee left:")
            if is_employee_created or is_employee_departed:
                continue
            logs.append({"id": snapshot.id, **item})
        logs.sort(key=lambda item: str(item.get("time", "")), reverse=True)
        total = len(logs)
        start = (page - 1) * page_size
        logs = logs[start:start + page_size]
    except Exception as error:
        raise firestore_unavailable(error) from error
    return {"items": logs, "total": total, "page": page, "page_size": page_size}


@options_router.post("/history/logs", status_code=201)
def create_access_history(payload: AccessHistoryCreate):
    """Persist an access-management activity log without automatic deletion."""
    log = {**payload.model_dump(), "time": current_timestamp()}
    try:
        reference = history_collection().document()
        reference.set(log)
    except Exception as error:
        raise firestore_unavailable(error) from error
    return {"id": reference.id, **log}


@options_router.get("/history/new-employees")
def list_new_employees(
    days: int = Query(30, ge=1, le=30),
    search: str = Query("", max_length=160),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """Return active employees whose joining date is within the selected period."""
    try:
        now = datetime.now(INDIA_TIMEZONE)
        today = now.date()
        cutoff_date = today - timedelta(days=days)
        term = search.strip().casefold()
        recent = []
        for snapshot in users_collection().stream():
            user = snapshot.to_dict()
            try:
                joining_value = user.get("dateOfJoining")
                if isinstance(joining_value, datetime):
                    joining_date = joining_value.date()
                elif isinstance(joining_value, date):
                    joining_date = joining_value
                else:
                    joining_date = date.fromisoformat(str(joining_value)[:10])
            except (TypeError, ValueError):
                continue
            if joining_date < cutoff_date or joining_date > today:
                continue
            name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
            searchable = " ".join(str(user.get(field, "")) for field in (
                "firstName", "lastName", "employeeId", "employeeEmail", "department",
                "location", "reportingManager", "role",
            )).casefold()
            if term and term not in searchable:
                continue
            recent.append({
                "id": snapshot.id,
                "icon": "bi-person-plus",
                "title": name or "New employee",
                "detail": (
                    f"{user.get('employeeId', 'No employee ID')} · {user.get('employeeEmail', '')} · "
                    f"{user.get('department', 'No department')} · {user.get('location', 'No location')}"
                ),
                "time": datetime.combine(joining_date, datetime.min.time(), tzinfo=INDIA_TIMEZONE).isoformat(),
                "employeeId": user.get("employeeId", ""),
                "email": user.get("employeeEmail", ""),
                "department": user.get("department", "Not assigned"),
                "location": user.get("location", "Not assigned"),
                "role": user.get("role", "user"),
                "dateOfJoining": joining_date.isoformat(),
            })
        recent.sort(key=lambda item: item["time"], reverse=True)
        total = len(recent)
        start = (page - 1) * page_size
        return {"items": recent[start:start + page_size], "total": total, "page": page, "page_size": page_size, "days": days}
    except Exception as error:
        raise firestore_unavailable(error) from error


@options_router.get("/departed-employees")
def list_departed_employees(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    """Return offboarded employees whose 30-day retention has not expired."""
    try:
        purge_expired_departed_employee_data()
        collection = departed_employees_collection()
        now = datetime.now(INDIA_TIMEZONE)
        retained = []
        for snapshot in collection.stream():
            item = snapshot.to_dict()
            try:
                retain_until = datetime.fromisoformat(str(item.get("retain_until", "")))
            except (TypeError, ValueError):
                retain_until = now + timedelta(days=30)
            name = f"{item.get('firstName', '')} {item.get('lastName', '')}".strip()
            retained.append({
                "id": snapshot.id,
                "icon": "bi-person-dash",
                "title": f"{name or 'Employee'} Resign the company",
                "detail": (
                    f"{item.get('employeeId', 'No employee ID')} · {item.get('employeeEmail', '')} · "
                    f"{item.get('department', 'No department')} · "
                    f"{item.get('certificate_count', 0)} certificate record(s) retained until "
                    f"{retain_until.date().isoformat()}"
                ),
                "time": item.get("left_at", ""),
            })
        retained.sort(key=lambda item: item.get("time", ""), reverse=True)
        total = len(retained)
        start = (page - 1) * page_size
        return {"items": retained[start:start + page_size], "total": total, "page": page, "page_size": page_size}
    except Exception as error:
        raise firestore_unavailable(error) from error


@options_router.get("/departed-employees/{employee_id}")
def departed_employee_profile(employee_id: str):
    """Return the retained offboarding profile without restoring active access."""
    try:
        snapshot = departed_employees_collection().document(employee_id).get()
        if not snapshot.exists:
            raise HTTPException(status_code=404, detail="Departed employee record not found")
        item = snapshot.to_dict()
        try:
            retain_until = datetime.fromisoformat(str(item.get("left_at", ""))) + timedelta(days=30)
        except (TypeError, ValueError):
            retain_until = datetime.fromisoformat(str(item.get("retain_until", "")))
        if retain_until <= datetime.now(INDIA_TIMEZONE):
            raise HTTPException(status_code=404, detail="Departed employee retention period has expired")
        return {
            "id": snapshot.id,
            "name": f"{item.get('firstName', '')} {item.get('lastName', '')}".strip(),
            "firstName": item.get("firstName", ""),
            "lastName": item.get("lastName", ""),
            "employeeId": item.get("employeeId", ""),
            "email": item.get("employeeEmail", ""),
            "department": item.get("department", "Not assigned"),
            "location": item.get("location", "Not assigned"),
            "reportingManager": item.get("reportingManager", "Not assigned"),
            "dateOfJoining": item.get("dateOfJoining"),
            "left_at": item.get("left_at"),
            "retain_until": retain_until.isoformat(),
            "certificate_count": item.get("certificate_count", 0),
            "active_certificate_count": item.get("active_certificate_count", 0),
            "certificates": item.get("certificates", []),
        }
    except HTTPException:
        raise
    except Exception as error:
        raise firestore_unavailable(error) from error


 
@options_router.get("/{option_type}")
def list_access_options(option_type: Literal["locations", "departments", "oems", "categories"]):
    """List the saved location or department names."""
    try:
        if option_type == "categories":
            db = get_firestore_client()
            initialization = db.collection("app_settings").document("category_directory")
            if not initialization.get().exists:
                defaults = [
                    ("Audio", "#f59e0b"), ("Video", "#a855f7"),
                    ("Control", "#06b6d4"), ("Sales", "#10b981"),
                    ("Networking", "#3b82f6"), ("Other", "#94a3b8"),
                ]
                for name, color in defaults:
                    option_collection("categories").document().set({"name": name, "color": color, "created_at": current_timestamp()})
                initialization.set({"initialized": True, "created_at": current_timestamp()})
        options = [
            {"id": snapshot.id, **snapshot.to_dict()}
            for snapshot in option_collection(option_type).stream()
        ]
        if option_type == "oems":
            db = get_firestore_client()
            deleted_names = {
                str(snapshot.to_dict().get("name_key", "")).casefold()
                for snapshot in oem_deletion_collection().stream()
            }
            by_name = {
                clean_oem_name(option.get("name")).casefold(): option
                for option in options
                if clean_oem_name(option.get("name")).casefold() not in deleted_names
            }
            for snapshot in db.collection("certificates").stream():
                name = clean_oem_name(snapshot.to_dict().get("vendor_name"))
                key = name.casefold()
                if not is_placeholder_oem(name) and key not in deleted_names and key not in by_name:
                    by_name[key] = {"id": f"certificate:{key}", "name": name, "source": "certificate"}
            options = list(by_name.values())
    except Exception as error:
        raise firestore_unavailable(error) from error
    return sorted(options, key=lambda option: option["name"].lower())
 
 
@options_router.post("/{option_type}", status_code=201)
def create_access_option(
    option_type: Literal["locations", "departments", "oems", "categories"], payload: AccessOptionCreate
):
    """Create a location or department option."""
    option = {
        "name": payload.name.strip(),
        "created_at": current_timestamp(),
        "updated_at": current_timestamp(),
    }
    try:
        if option_type == "categories":
            option["color"] = "#d84457"
            if any(str(snapshot.to_dict().get("name", "")).casefold() == option["name"].casefold() for snapshot in option_collection(option_type).stream()):
                raise HTTPException(status_code=409, detail="That category already exists")
        if option_type in {"locations", "departments"}:
            label = "location" if option_type == "locations" else "department"
            if any(str(snapshot.to_dict().get("name", "")).casefold() == option["name"].casefold() for snapshot in option_collection(option_type).stream()):
                raise HTTPException(status_code=409, detail=f"That {label} already exists")
        if option_type == "oems":
            option["name"] = clean_oem_name(option["name"])
            normalized = option["name"].casefold()
            if is_placeholder_oem(option["name"]):
                raise HTTPException(status_code=422, detail="Enter a valid OEM name")
            existing = next(
                (
                    snapshot
                    for snapshot in option_collection(option_type).stream()
                    if clean_oem_name(snapshot.to_dict().get("name")).casefold() == normalized
                ),
                None,
            )
            deletion_reference = oem_deletion_collection().document(oem_deletion_id(option["name"]))
            was_deleted = deletion_reference.get().exists
            if was_deleted:
                deletion_reference.delete()
            if existing:
                restored = existing.to_dict()
                mark_settings_updated("oems")
                realtime_connections.publish({"type": "access.updated"})
                return {"id": existing.id, **restored}
        reference = option_collection(option_type).document()
        reference.set(option)
    except HTTPException:
        raise
    except Exception as error:
        raise firestore_unavailable(error) from error
    if option_type in {"categories", "oems"}:
        mark_settings_updated(option_type)
    realtime_connections.publish({"type": "access.updated"})
    return {"id": reference.id, **option}
 
@options_router.put("/{option_type}/{option_id}")
def update_access_option(
    option_type: Literal["locations", "departments", "oems", "categories"],
    option_id: str,
    payload: AccessOptionUpdate,
):
    """Rename a location or department option."""
    try:
        reference = option_collection(option_type).document(option_id)
        if not reference.get().exists:
            raise HTTPException(status_code=404, detail="Option not found")
        clean_name = payload.name.strip()
        if option_type == "categories" and any(snapshot.id != option_id and str(snapshot.to_dict().get("name", "")).casefold() == clean_name.casefold() for snapshot in option_collection(option_type).stream()):
            raise HTTPException(status_code=409, detail="That category already exists")
        if option_type in {"locations", "departments"}:
            label = "location" if option_type == "locations" else "department"
            if any(snapshot.id != option_id and str(snapshot.to_dict().get("name", "")).casefold() == clean_name.casefold() for snapshot in option_collection(option_type).stream()):
                raise HTTPException(status_code=409, detail=f"That {label} already exists")
        if option_type == "oems":
            if is_placeholder_oem(clean_name):
                raise HTTPException(status_code=422, detail="Enter a valid OEM name")
            if any(snapshot.id != option_id and clean_oem_name(snapshot.to_dict().get("name")).lower() == clean_name.lower() for snapshot in option_collection(option_type).stream()):
                raise HTTPException(status_code=409, detail="That OEM already exists")
        option = {
        "name": clean_name,
        "updated_at": current_timestamp(),
        }
        reference.update(option)
    except HTTPException:
        raise
    except Exception as error:
        raise firestore_unavailable(error) from error
    if option_type in {"categories", "oems"}:
        mark_settings_updated(option_type)
    realtime_connections.publish({"type": "access.updated"})
    return {"id": option_id, **option}
 
 
@options_router.delete("/{option_type}/{option_id}", status_code=204)
def delete_access_option(
    option_type: Literal["locations", "departments", "oems", "categories"], option_id: str
):
    """Delete a location or department option."""
    try:
        reference = option_collection(option_type).document(option_id)
        snapshot = reference.get()
        if option_type == "oems":
            name = (
                str(snapshot.to_dict().get("name", ""))
                if snapshot.exists
                else option_id.removeprefix("certificate:")
            )
            name = clean_oem_name(name)
            if not name:
                raise HTTPException(status_code=404, detail="OEM not found")
            oem_deletion_collection().document(oem_deletion_id(name)).set({
                "name": name,
                "name_key": name.casefold(),
                "deleted_at": current_timestamp(),
            })
            if snapshot.exists:
                reference.delete()
            mark_settings_updated("oems")
            realtime_connections.publish({"type": "access.updated"})
            return
        if not snapshot.exists:
            raise HTTPException(status_code=404, detail="Option not found")
        reference.delete()
    except HTTPException:
        raise
    except Exception as error:
        raise firestore_unavailable(error) from error
    if option_type in {"categories", "oems"}:
        mark_settings_updated(option_type)
    realtime_connections.publish({"type": "access.updated"})
 
