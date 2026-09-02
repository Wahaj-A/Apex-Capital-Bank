import json
import os
import re
import smtplib
from email.message import EmailMessage

from google import genai
from google.genai import types


SYSTEM_INSTRUCTION = """You are a professional business email writing assistant for Apex Capital Bank.

Your job is to turn a user's instruction into a polished, professional email.

Rules:
- Never invent names, dates, amounts, commitments, attachments, or facts.
- Use a concise, professional business tone.
- Do not include Markdown in the email body.

Decision Logic:
1. If the user's request is missing a valid recipient email OR the topic/purpose of the email, DO NOT generate a draft. Set "status" to "incomplete" and provide a "message" asking the user for the missing details.
2. If the user provides BOTH a valid recipient and a clear topic, set "status" to "complete" and generate the draft.

Return ONLY valid JSON matching one of these structures:
- If missing info: {"status": "incomplete", "message": "Ask the user for recipient or topic"}
- If ready to draft: {"status": "complete", "recipient": "valid@email.com", "subject": "...", "body": "..."}
"""

def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("The AI returned an invalid email draft.") from exc
    if not isinstance(value, dict):
        raise ValueError("The AI returned an invalid email draft.")
        
    # Intercept incomplete requests and pass the model's question to the frontend
    if value.get("status") == "incomplete":
        raise ValueError(value.get("message", "Please provide a valid recipient and topic."))

    for key in ("recipient", "subject", "body"):
        if not str(value.get(key, "")).strip():
            raise ValueError(f"Email draft is missing {key}.")
            
    recipient = str(value["recipient"]).strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
        raise ValueError("Please provide a valid recipient email address.")
        
    return {
        "recipient": recipient,
        "subject": str(value["subject"]).strip(),
        "body": str(value["body"]).strip(),
    }

def create_draft(user_text: str, api_key: str, history=None) -> dict:
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    client = genai.Client(api_key=api_key)
    contents = []
    for message in (history or []):
        role = "model" if message.get("role") == "assistant" else "user"
        text = str(message.get("text", "")).strip()
        if text:
            contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
    contents.append(types.Content(role="user", parts=[types.Part(text=user_text)]))

    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.4,
            response_mime_type="application/json",
        ),
    )
    return _extract_json(response.text)


def send_email(user_email: str, recipient: str, subject: str, body: str) -> None:
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
        raise ValueError("Invalid recipient email address.")
    if not subject.strip() or not body.strip():
        raise ValueError("Subject and body are required.")

    try:
        from google_oauth import get_credentials
        from googleapiclient.discovery import build
        import base64

        message = EmailMessage()
        message["To"] = recipient
        message["Subject"] = subject.strip()
        message.set_content(body.strip())
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        build("gmail", "v1", credentials=get_credentials(user_email, "gmail"), cache_discovery=False).users().messages().send(
            userId="me", body={"raw": raw}
        ).execute()
        logger.info("EMAIL sent through connected Gmail account")
    except Exception as exc:
        logger.exception("Gmail send failed")
        raise RuntimeError(f"Could not send Gmail message: {exc}") from exc

try:
    from logger import logger
except ImportError:
    import logging
    logger = logging.getLogger(__name__)
