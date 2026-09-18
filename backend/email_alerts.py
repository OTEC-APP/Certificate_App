"""Azure Microsoft Graph mail delivery for certificate alerts."""
 
import json
import os
from base64 import b64encode
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
 
 
def is_configured() -> bool:
    return all(
        os.getenv(name)
        for name in ("AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_SENDER_EMAIL")
    )
 
 
def _request_json(url: str, data: bytes, headers: dict[str, str]) -> dict:
    request = Request(url, data=data, headers=headers, method="POST")
    with urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else {}
 
 
def send_email(recipients: list[str], subject: str, html: str, inline_logo_path: str | Path | None = None) -> bool:
    """Send an HTML mail through Graph. Returns False when mail is unavailable."""
    clean_recipients = sorted({email.strip().lower() for email in recipients if email and email.strip()})
    if not clean_recipients or not is_configured():
        reason = "no valid recipients" if not clean_recipients else "Azure mail configuration is incomplete"
        print(f"Certificate email alert skipped: {reason}")
        return False
    try:
        print(f"Certificate email alert: sending to {len(clean_recipients)} recipient(s); subject={subject!r}")
        tenant_id = os.environ["AZURE_TENANT_ID"]
        token = _request_json(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            urlencode({
                "client_id": os.environ["AZURE_CLIENT_ID"],
                "client_secret": os.environ["AZURE_CLIENT_SECRET"],
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            }).encode("utf-8"),
            {"Content-Type": "application/x-www-form-urlencoded"},
        )["access_token"]
        payload = {
            "message": {
                "subject": subject,
                "body": {"contentType": "HTML", "content": html},
                "toRecipients": [{"emailAddress": {"address": email}} for email in clean_recipients],
            },
            "saveToSentItems": True,
        }
        if inline_logo_path and Path(inline_logo_path).is_file():
            payload["message"]["attachments"] = [{
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": "o2k-logo.png",
                "contentType": "image/png",
                "isInline": True,
                "contentId": "o2k-logo",
                "contentBytes": b64encode(Path(inline_logo_path).read_bytes()).decode("ascii"),
            }]
        _request_json(
            f"https://graph.microsoft.com/v1.0/users/{quote(os.environ['AZURE_SENDER_EMAIL'], safe='')}/sendMail",
            json.dumps(payload).encode("utf-8"),
            {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        print("Certificate email alert: Graph accepted the message")
        return True
    except HTTPError as error:
        # Graph returns the useful reason (for example, missing Mail.Send consent)
        # in its JSON response body. Never log the access token or client secret.
        try:
            details = error.read().decode("utf-8", errors="replace")
        except OSError:
            details = "Unable to read response body"
        print(f"Certificate email alert could not be sent: HTTP {error.code}: {details}")
        return False
    except Exception as error:
        print(f"Certificate email alert could not be sent: {error}")
        return False
 