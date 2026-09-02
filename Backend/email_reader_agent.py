"""Read-only Gmail inbox agent using the connected user's Google OAuth token."""
import base64
import datetime as dt
import email
import os
from email.header import decode_header
from email.message import Message
from typing import Any, Dict, List

from google import genai
from google.genai import types
from googleapiclient.discovery import build

from google_oauth import get_credentials

try:
    from logger import logger
except ImportError:  # pragma: no cover
    import logging
    logger = logging.getLogger(__name__)


class EmailReaderAgent:
    @staticmethod
    def _decode(value: str | None) -> str:
        if not value:
            return ""
        output = []
        for part, encoding in decode_header(value):
            if isinstance(part, bytes):
                output.append(part.decode(encoding or "utf-8", errors="replace"))
            else:
                output.append(str(part))
        return "".join(output).strip()

    @staticmethod
    def _body_from_payload(payload: dict) -> str:
        parts = payload.get("parts") or []
        if parts:
            texts = []
            for part in parts:
                mime = part.get("mimeType", "")
                if mime == "text/plain":
                    data = (part.get("body") or {}).get("data")
                    if data:
                        texts.append(base64.urlsafe_b64decode(data.encode()).decode("utf-8", errors="replace"))
                elif mime.startswith("multipart/"):
                    nested = EmailReaderAgent._body_from_payload(part)
                    if nested:
                        texts.append(nested)
            if texts:
                return "\n".join(texts).strip()
        data = (payload.get("body") or {}).get("data")
        if data:
            return base64.urlsafe_b64decode(data.encode()).decode("utf-8", errors="replace").strip()
        return ""

    def list_emails(self, user_email: str, limit: int = 10, unread_only: bool = False) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit), 50))
        try:
            service = build("gmail", "v1", credentials=get_credentials(user_email, "gmail"), cache_discovery=False)
            query = "is:unread" if unread_only else None
            result = service.users().messages().list(userId="me", maxResults=limit, q=query).execute()
            messages = []
            for item in result.get("messages", []):
                full = service.users().messages().get(userId="me", id=item["id"], format="full").execute()
                headers = {h.get("name", "").lower(): self._decode(h.get("value")) for h in full.get("payload", {}).get("headers", [])}
                messages.append({
                    "id": item["id"],
                    "from": headers.get("from", ""), "to": headers.get("to", ""),
                    "subject": headers.get("subject", ""), "date": headers.get("date", ""),
                    "body": self._body_from_payload(full.get("payload", {}))[:12000],
                })
            return messages
        except Exception as exc:
            logger.exception("Gmail inbox read failed")
            raise RuntimeError(f"Could not read Gmail: {exc}") from exc

    def answer_question(self, user_email: str, question: str, limit: int = 10, history: List[Dict[str, str]] | None = None) -> Dict[str, Any]:
        question = (question or "").strip()
        if not question:
            raise ValueError("Email question is required.")
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")
        messages = self.list_emails(user_email, limit=limit)
        if not messages:
            return {"answer": "I could not find any emails in the inbox.", "emails": []}
        context = "\n\n---\n\n".join(
            f"EMAIL {i}\nFrom: {m['from']}\nTo: {m['to']}\nDate: {m['date']}\nSubject: {m['subject']}\nBody:\n{m['body']}"
            for i, m in enumerate(messages, 1)
        )
        history = history or []
        history_text = "\n".join(
            f"{item.get('role', 'user').upper()}: {item.get('text', '')}"
            for item in history[-12:]
            if item.get("text")
        )
        conversation_context = (
            f"PREVIOUS CONVERSATION:\n{history_text}\n\n"
            if history_text else ""
        )
        
        now_local = dt.datetime.now().astimezone()
        current_time_str = now_local.strftime("%A, %B %d, %Y %I:%M %p %Z")

        prompt = (
            f"Current Date and Time: {current_time_str}\n\n"
            "INSTRUCTIONS:\n"
            "1. Answer the user's current question using ONLY the email records provided below.\n"
            "2. STRICT SENDER LOGIC: When asked who sent an email (e.g., 'from HR'), evaluate ONLY the 'From:' header. Do NOT infer the sender from signatures in the email body.\n"
            "3. Use the current date and time to accurately interpret relative references like 'today', 'yesterday', or 'recent'.\n"
            "4. Strictly observe any quantity limits specified in the user's request.\n"
            "5. Never invent email facts. If the records do not contain the answer, state that clearly.\n"
            "6. MUST USE MARKDOWN: Format all email lists using numbered lists (`1.`, `2.`) and bullet points (`-` or `*`) for sub-details. Always bold labels like **From:**, **Date:**, and **Subject:**.\n\n"
            f"{conversation_context}"
            f"CURRENT USER QUESTION:\n{question}\n\nEMAIL RECORDS:\n{context}"
        )
        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=os.getenv("EMAIL_READER_MODEL", "gemini-3.5-flash-lite"),
                contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            )
            answer = (response.text or "").strip()
            if not answer:
                raise RuntimeError("The AI returned an empty email answer.")
            return {"answer": answer, "emails": messages}
        except Exception as exc:
            logger.exception("Email question answering failed")
            raise RuntimeError(f"Could not analyze emails: {exc}") from exc