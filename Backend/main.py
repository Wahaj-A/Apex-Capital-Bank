import os
import time
import urllib.parse
from datetime import datetime
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.requests import Request
from starlette.responses import RedirectResponse

from logger import logger

# Import existing banking and AI logic
import agent_logic
import bank_logic
import calendar_agent
import crypto
import crypto_agent
import email_agent
import email_reader_agent
import google_oauth
import image_agent
import rag_agent
import tavily_agent
import weather
import weather_agent
from bank_logic import Auth, Bank
from google.oauth2 import id_token
from google.auth.transport import requests

# ==========================================
# 🚀 INITIALIZATION
# ==========================================
# Load the Gemini API key from the .env file
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

# Initialize the FastAPI application
app = FastAPI(title="AI Banking CRM API")


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """Log API method/path/status/duration without request bodies."""
    started = time.perf_counter()
    try:
        response = await call_next(request)
        duration_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "HTTP %s %s -> %s (%.1f ms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000
        logger.exception(
            "Unhandled exception during %s %s (%.1f ms)",
            request.method,
            request.url.path,
            duration_ms,
        )
        raise


# Configure CORS so the React frontend can talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://wham-charity-reborn.ngrok-free.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the Bank and Auth classes
bank = Bank()
auth = Auth()

# Modular AI agents
tavily_search_agent = tavily_agent.TavilySearchAgent()
image_generation_agent = image_agent.ImageGenerationAgent()
email_reader = email_reader_agent.EmailReaderAgent()
calendar_agent_instance = calendar_agent.CalendarAgent()

# ==========================================
# 📦 PYDANTIC MODELS (Data Validation)
# ==========================================
class UserCredentials(BaseModel):
    email: str
    password: str


# Place this inside your PYDANTIC MODELS section
class GoogleAuthRequest(BaseModel):
    token: str

class AccountCreate(BaseModel):
    name: str
    email: str
    starting_balance: float = 0.0


class Transaction(BaseModel):
    account_id: int
    amount: float
    email: str


class Transfer(BaseModel):
    from_account_id: int
    to_account_id: int
    amount: float
    email: str


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    text: str


CHAT_MEMORY_LIMIT = 15


def _recent_history(messages: List[ChatMessage]) -> List[ChatMessage]:
    """Return only the most recent CHAT_MEMORY_LIMIT messages."""
    return list(messages or [])[-CHAT_MEMORY_LIMIT:]


class ChatHistoryUpdate(BaseModel):
    user_email: str
    agent_key: str
    messages: List[ChatMessage] = []


class RAGQuery(BaseModel):
    question: str
    history: List[ChatMessage] = []


class WeatherAgentMessage(BaseModel):
    user_text: str
    history: List[ChatMessage] = []


class CryptoAgentMessage(BaseModel):
    user_text: str
    history: List[ChatMessage] = []


class AgentChat(BaseModel):
    user_text: str
    history: List[ChatMessage] = []
    email: str


class EmailDraftRequest(BaseModel):
    prompt: str
    user_email: str
    history: List[ChatMessage] = []


class EmailSendRequest(BaseModel):
    recipient: str
    subject: str
    body: str
    user_email: str


class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 5
    history: List[ChatMessage] = []


class ImageGenerationRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "1:1"
    image_size: str = "1K"


class EmailReaderRequest(BaseModel):
    question: str
    limit: int = 10
    user_email: str
    history: List[ChatMessage] = []


class CalendarEventRequest(BaseModel):
    summary: str
    start: str
    end: str
    timezone: str = "Asia/Karachi"
    description: str = ""
    location: str = ""
    user_email: str


class CalendarAgentMessage(BaseModel):
    user_text: str
    history: List[ChatMessage] = []
    user_email: str


# ==========================================
# 🔐 AUTHENTICATION ENDPOINTS
# ==========================================
@app.post("/api/signup")
def signup(req: UserCredentials):
    try:
        auth.signup(req.email, req.password)
        logger.info("AUTH signup successful")
        return {"message": "Account created"}
    except ValueError as e:
        logger.warning("AUTH signup failed")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/login")
def login(req: UserCredentials):
    try:
        email = auth.login(req.email, req.password)
        logger.info("AUTH login successful")
        return {"email": email}
    except ValueError as e:
        logger.warning("AUTH login failed")
        raise HTTPException(status_code=401, detail=str(e))

@app.post("/api/auth/google")
def google_identity_login(req: GoogleAuthRequest):
    try:
        # 1. Verify token with Google
        idinfo = id_token.verify_oauth2_token(
            req.token, 
            requests.Request(), 
            os.getenv("GOOGLE_CLIENT_ID")
        )
        
        email = idinfo['email']

        # 2. Authenticate or create user session
        try:
            conn = bank_logic.get_connection()
            user = conn.execute(
                "SELECT user_id, email FROM users WHERE LOWER(email) = LOWER(?)",
                (email,),
            ).fetchone()
            conn.close()

            if not user:
                # Create account automatically if user doesn't exist
                auth.signup(email, "oauth_google_user_pwd")
        except Exception:
            pass

        # Google Sign-In verifies the Apex identity. If Gmail/Calendar are not
        # both connected yet, immediately continue into one combined OAuth
        # consent flow so those services become available without requiring
        # the user to visit separate Connect buttons.
        gmail = google_oauth.get_connection_status(email, "gmail")
        calendar = google_oauth.get_connection_status(email, "calendar")
        google_authorization_url = None
        if not (gmail["connected"] and calendar["connected"]):
            google_authorization_url = google_oauth.create_google_services_authorization_url(email)

        return {
            "email": email,
            "message": "Google Authentication Successful",
            "google_services_connected": gmail["connected"] and calendar["connected"],
            "google_authorization_url": google_authorization_url,
        }

    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google token")


@app.get("/api/me")
def get_current_user(user_email: str):
    """Return the logged-in Apex user's profile and Google connection status."""
    email = (user_email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="User is not authenticated.")

    try:
        conn = bank_logic.get_connection()
        user = conn.execute(
            "SELECT user_id, email, created_at FROM users WHERE LOWER(email) = LOWER(?)",
            (email,),
        ).fetchone()
        conn.close()

        if not user:
            raise HTTPException(status_code=401, detail="User session is invalid.")

        gmail = google_oauth.get_connection_status(email, "gmail")
        calendar = google_oauth.get_connection_status(email, "calendar")

        return {
            "user_id": user["user_id"],
            "email": user["email"],
            "created_at": user["created_at"],
            "google": {"gmail": gmail, "calendar": calendar},
            "is_google_connected": gmail["connected"] or calendar["connected"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("AUTH current-user lookup failed")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🏦 BANKING ENDPOINTS
# ==========================================
@app.get("/api/accounts")
def get_accounts():
    accounts = bank.list_accounts()
    return [
        {
            "account_id": a.account_id,
            "account_number": a.account_number,
            "name": a.name,
            "balance": a.balance,
        }
        for a in accounts
    ]


@app.get("/api/accounts/{account_id}")
def get_account(account_id: int, email: str):
    acc = bank.find_account(account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    if (acc.email or "").strip().lower() != (email or "").strip().lower():
        raise HTTPException(
            status_code=403,
            detail="Permission Denied: You can only view your own account balance.",
        )

    return {
        "account_id": acc.account_id,
        "account_number": acc.account_number,
        "name": acc.name,
        "balance": acc.balance,
    }


@app.get("/api/accounts/{account_id}/transactions")
def get_transactions(account_id: str, email: str):
    acc = bank.find_account(account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    if (acc.email or "").strip().lower() != (email or "").strip().lower():
        raise HTTPException(
            status_code=403,
            detail="Permission Denied: You can only view your own transaction history.",
        )

    history = bank.get_transaction_history(account_id)
    return history


@app.post("/api/accounts")
def create_account(req: AccountCreate):
    try:
        acc = bank.create_account(req.name, req.starting_balance, req.email)
        logger.info("BANK account created successfully")
        return {
            "message": "Success",
            "account_id": acc.account_id,
            "balance": acc.balance,
            "account_number": acc.account_number,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/deposit")
def deposit(req: Transaction):
    try:
        acc = bank.find_account(req.account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Account not found")

        if (acc.email or "").strip().lower() != (req.email or "").strip().lower():
            raise HTTPException(
                status_code=403,
                detail="Permission Denied: You can only deposit into your own account.",
            )

        acc = bank.deposit(req.account_id, req.amount)
        logger.info("BANK deposit completed successfully")
        return {"message": "Success", "new_balance": acc.balance, "name": acc.name}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/withdraw")
def withdraw(req: Transaction):
    try:
        acc = bank.find_account(req.account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Account not found")

        if (acc.email or "").strip().lower() != (req.email or "").strip().lower():
            raise HTTPException(
                status_code=403,
                detail="Permission Denied: You can only withdraw from your own account.",
            )

        acc = bank.withdraw(req.account_id, req.amount)
        logger.info("BANK withdrawal completed successfully")
        return {"message": "Success", "new_balance": acc.balance, "name": acc.name}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/transfer")
def transfer(req: Transfer):
    try:
        sender = bank.find_account(req.from_account_id)
        if not sender:
            raise HTTPException(status_code=404, detail="Sender account not found")

        if (sender.email or "").strip().lower() != (req.email or "").strip().lower():
            raise HTTPException(
                status_code=403,
                detail="Permission Denied: You can only transfer funds out of your own account.",
            )

        sender, receiver = bank.transfer(
            req.from_account_id, req.to_account_id, req.amount
        )
        logger.info("BANK transfer completed successfully")
        return {
            "message": "Success",
            "from_account": {"name": sender.name, "balance": sender.balance},
            "to_account": {"name": receiver.name, "balance": receiver.balance},
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ==========================================
# 💬 DATABASE-BACKED AI CONVERSATIONS
# ==========================================
_ALLOWED_CHAT_AGENTS = {
    "banking-agent",
    "rag-agent",
    "email-agent",
    "weather-agent",
    "crypto-agent",
    "web-search-agent",
    "image-generation-agent",
    "email-reader-agent",
    "calendar-agent",
}

_AGENT_LABELS = {
    "banking-agent": "Banking AI",
    "rag-agent": "RAG Intelligence",
    "email-agent": "Email Agent",
    "weather-agent": "Weather AI",
    "crypto-agent": "Crypto AI",
    "web-search-agent": "Web Search",
    "image-generation-agent": "Image Generator",
    "email-reader-agent": "Email Reader",
    "calendar-agent": "Calendar Agent",
}


def _chat_user_id(user_email: str) -> int:
    email = (user_email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="User is not authenticated.")

    conn = bank_logic.get_connection()
    try:
        row = conn.execute(
            "SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)",
            (email,),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="User session is invalid.")
    return int(row["user_id"])


def _validate_chat_agent(agent_key: str) -> str:
    key = (agent_key or "").strip().lower()
    if key not in _ALLOWED_CHAT_AGENTS:
        raise HTTPException(status_code=400, detail="Unsupported AI chat agent.")
    return key


def _clean_chat_messages(messages: List[ChatMessage]):
    cleaned = []
    for message in messages or []:
        role = (message.role or "").strip().lower()
        text = str(message.text or "").strip()
        if role not in {"user", "assistant"} or not text:
            continue
        cleaned.append((role, text))
    return cleaned


def _conversation_title(agent_key: str, messages: List[tuple]) -> str:
    first_user = next((text for role, text in messages if role == "user"), "")
    if not first_user:
        return "New conversation"

    text = " ".join(first_user.split())
    # Deterministic title: no extra AI/API call just for a conversation title.
    prefixes = {
        "weather-agent": "Weather",
        "crypto-agent": "Crypto",
        "calendar-agent": "Calendar",
        "email-reader-agent": "Email Reader",
        "web-search-agent": "Web Search",
        "email-agent": "Email",
        "image-generation-agent": "Image",
        "rag-agent": "RAG",
        "banking-agent": "Banking",
    }
    prefix = prefixes.get(agent_key, _AGENT_LABELS.get(agent_key, "AI"))
    # Keep the original first question readable in the sidebar.
    title = text[:52].rstrip()
    if len(text) > 52:
        title += "…"
    if title.lower().startswith(prefix.lower()):
        return title
    return title


def _get_owned_conversation(conn, user_id: int, conversation_id: int):
    row = conn.execute(
        """
        SELECT conversation_id, user_id, agent_key, title, created_at, updated_at
        FROM conversations
        WHERE conversation_id = ? AND user_id = ?
        """,
        (conversation_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return row


class ConversationCreate(BaseModel):
    user_email: str
    agent_key: str
    title: str = "New conversation"


class ConversationUpdate(BaseModel):
    user_email: str
    title: str = ""


class ConversationMessagesUpdate(BaseModel):
    user_email: str
    messages: List[ChatMessage] = []


@app.get("/api/conversations")
def list_conversations(agent_key: str, user_email: str, limit: int = 50):
    user_id = _chat_user_id(user_email)
    agent_key = _validate_chat_agent(agent_key)
    limit = max(1, min(int(limit), 100))

    conn = bank_logic.get_connection()
    try:
        rows = conn.execute(
            """
            SELECT conversation_id, agent_key, title, created_at, updated_at
            FROM conversations
            WHERE user_id = ? AND agent_key = ?
            ORDER BY updated_at DESC, conversation_id DESC
            LIMIT ?
            """,
            (user_id, agent_key, limit),
        ).fetchall()
    finally:
        conn.close()

    return {
        "agent_key": agent_key,
        "agent_label": _AGENT_LABELS.get(agent_key, agent_key),
        "conversations": [dict(row) for row in rows],
    }


@app.post("/api/conversations")
def create_conversation(req: ConversationCreate):
    agent_key = _validate_chat_agent(req.agent_key)
    user_id = _chat_user_id(req.user_email)
    title = " ".join((req.title or "New conversation").split())[:80] or "New conversation"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = bank_logic.get_connection()
    try:
        insert_cursor = conn.execute(
            """
            INSERT INTO conversations
                (user_id, agent_key, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, agent_key, title, now, now),
        )
        conversation_id = insert_cursor.lastrowid
        conn.commit()
    finally:
        conn.close()

    return {
        "conversation_id": int(conversation_id),
        "agent_key": agent_key,
        "title": title,
        "created_at": now,
        "updated_at": now,
    }


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: int, user_email: str):
    user_id = _chat_user_id(user_email)
    conn = bank_logic.get_connection()
    try:
        conversation = _get_owned_conversation(conn, user_id, conversation_id)
        rows = conn.execute(
            """
            SELECT message_id, role, message_text AS text, created_at
            FROM chat_history
            WHERE conversation_id = ? AND user_id = ?
            ORDER BY message_id ASC
            """,
            (conversation_id, user_id),
        ).fetchall()
    finally:
        conn.close()

    return {
        "conversation": dict(conversation),
        "messages": [dict(row) for row in rows],
    }


@app.put("/api/conversations/{conversation_id}/messages")
def replace_conversation_messages(conversation_id: int, req: ConversationMessagesUpdate):
    user_id = _chat_user_id(req.user_email)
    cleaned = _clean_chat_messages(req.messages)
    # Keep the latest messages at a safe application-level cap.
    if len(cleaned) > 500:
        cleaned = cleaned[-500:]

    conn = bank_logic.get_connection()
    try:
        conversation = _get_owned_conversation(conn, user_id, conversation_id)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Replace only this conversation's messages; other conversations stay intact.
        conn.execute(
            "DELETE FROM chat_history WHERE conversation_id = ? AND user_id = ?",
            (conversation_id, user_id),
        )
        conn.executemany(
            """
            INSERT INTO chat_history
                (conversation_id, user_id, agent_key, role, message_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (conversation_id, user_id, conversation["agent_key"], role, text, now)
                for role, text in cleaned
            ],
        )

        title = conversation["title"]
        generated_title = _conversation_title(conversation["agent_key"], cleaned)
        if title == "New conversation" and generated_title != "New conversation":
            title = generated_title

        conn.execute(
            """
            UPDATE conversations
            SET title = ?, updated_at = ?
            WHERE conversation_id = ? AND user_id = ?
            """,
            (title, now, conversation_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "conversation_id": conversation_id,
        "title": title,
        "count": len(cleaned),
        "updated_at": now,
    }


@app.put("/api/conversations/{conversation_id}")
def update_conversation(conversation_id: int, req: ConversationUpdate):
    user_id = _chat_user_id(req.user_email)
    title = " ".join((req.title or "New conversation").split())[:80] or "New conversation"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = bank_logic.get_connection()
    try:
        _get_owned_conversation(conn, user_id, conversation_id)
        conn.execute(
            """
            UPDATE conversations
            SET title = ?, updated_at = ?
            WHERE conversation_id = ? AND user_id = ?
            """,
            (title, now, conversation_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()

    return {"conversation_id": conversation_id, "title": title, "updated_at": now}


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, user_email: str):
    user_id = _chat_user_id(user_email)
    conn = bank_logic.get_connection()
    try:
        _get_owned_conversation(conn, user_id, conversation_id)
        conn.execute(
            "DELETE FROM chat_history WHERE conversation_id = ? AND user_id = ?",
            (conversation_id, user_id),
        )
        conn.execute(
            "DELETE FROM conversations WHERE conversation_id = ? AND user_id = ?",
            (conversation_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()
    return {"message": "Conversation deleted."}


# Backward-compatible legacy endpoints used by older clients.
@app.get("/api/chat-history/{agent_key}")
def get_chat_history(agent_key: str, user_email: str):
    user_id = _chat_user_id(user_email)
    agent_key = _validate_chat_agent(agent_key)
    conn = bank_logic.get_connection()
    try:
        conversation = conn.execute(
            """
            SELECT conversation_id FROM conversations
            WHERE user_id = ? AND agent_key = ?
            ORDER BY updated_at DESC, conversation_id DESC
            LIMIT 1
            """,
            (user_id, agent_key),
        ).fetchone()
        if not conversation:
            return {"agent_key": agent_key, "messages": []}
        rows = conn.execute(
            """
            SELECT role, message_text AS text, created_at
            FROM chat_history
            WHERE conversation_id = ? AND user_id = ?
            ORDER BY message_id ASC
            """,
            (conversation["conversation_id"], user_id),
        ).fetchall()
    finally:
        conn.close()
    return {
        "agent_key": agent_key,
        "messages": [dict(row) for row in rows],
    }


@app.delete("/api/chat-history/{agent_key}")
def clear_chat_history(agent_key: str, user_email: str):
    user_id = _chat_user_id(user_email)
    agent_key = _validate_chat_agent(agent_key)
    conn = bank_logic.get_connection()
    try:
        conn.execute("DELETE FROM chat_history WHERE user_id = ? AND agent_key = ?", (user_id, agent_key))
        conn.execute("DELETE FROM conversations WHERE user_id = ? AND agent_key = ?", (user_id, agent_key))
        conn.commit()
    finally:
        conn.close()
    return {"message": "Chat history cleared."}


# ==========================================
# 🤖 AI AGENT ENDPOINTS
# ==========================================
@app.post("/api/rag/ask")
def ask_policy(req: RAGQuery):
    try:
        logger.info("AI policy assistant request received")
        history = [
            {"role": message.role, "text": message.text}
            for message in _recent_history(req.history)
        ]
        answer = rag_agent.ask_bank_policy(req.question, history=history)
        logger.info("AI policy assistant response generated")
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agent/chat")
def chat_with_agent(req: AgentChat):
    try:
        formatted_history = [
            (msg.role, msg.text) for msg in _recent_history(req.history)
        ]

        current_user_account_number = None
        for acc in bank.list_accounts():
            if (acc.email or "").strip().lower() == (req.email or "").strip().lower():
                current_user_account_number = acc.account_number
                break

        logger.info("AI banking assistant request received")
        response = agent_logic.send_message(
            bank=bank,
            api_key=API_KEY,
            history=formatted_history,
            user_text=req.user_text,
            user_account_id=current_user_account_number,
        )
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# ✉️ AI EMAIL AGENT ENDPOINTS
# ==========================================
@app.post("/api/email/draft")
def create_email_draft(req: EmailDraftRequest):
    try:
        logger.info("AI email draft request received")
        history = [
            {"role": message.role, "text": message.text}
            for message in _recent_history(req.history)
        ]
        draft = email_agent.create_draft(req.prompt, API_KEY, history=history)
        logger.info("AI email draft generated")
        return draft
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("AI email draft failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/email/send")
def send_email(req: EmailSendRequest):
    try:
        email_agent.send_email(req.user_email, req.recipient, req.subject, req.body)
        logger.info("EMAIL sent successfully")
        return {"message": "Email sent successfully."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("EMAIL send failed")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🔐 GOOGLE CONNECTIONS
# ==========================================
@app.get("/api/google/connect")
def google_connect(provider: str, user_email: str):
    try:
        return {
            "authorization_url": google_oauth.create_authorization_url(
                user_email, provider
            )
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("GOOGLE connect URL creation failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/google/callback")
def google_callback(code: str, state: str):
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    try:
        result = google_oauth.finish_authorization(code, state)
        provider = result["provider"]
        user_email = result["user_email"]
        return RedirectResponse(
            url=(
                f"{frontend_url}/dashboard"
                f"?google_connected=true"
                f"&provider={urllib.parse.quote(provider)}"
                f"&user_email={urllib.parse.quote(user_email)}"
            )
        )
    except Exception as e:
        logger.exception("GOOGLE OAuth callback failed")
        return RedirectResponse(
            url=(f"{frontend_url}/dashboard?google_error={urllib.parse.quote(str(e))}")
        )


@app.get("/api/google/status")
def google_status(provider: str, user_email: str):
    try:
        return google_oauth.get_connection_status(user_email, provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/google/status")
def google_disconnect(provider: str, user_email: str):
    try:
        google_oauth.disconnect(user_email, provider)
        return {"message": "Google connection removed."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🧩 MODULAR AI AGENTS
# ==========================================
@app.post("/api/agent/web-search")
def web_search_agent(req: WebSearchRequest):
    try:
        history = [
            {"role": msg.role, "text": msg.text}
            for msg in _recent_history(req.history)
        ]
        return tavily_search_agent.search(req.query, req.max_results, history=history)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("WEB SEARCH agent failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/agent/image")
def image_generation(req: ImageGenerationRequest):
    try:
        return image_generation_agent.generate(
            prompt=req.prompt,
            aspect_ratio=req.aspect_ratio,
            image_size=req.image_size,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("IMAGE generation agent failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/email/read")
def read_emails(req: EmailReaderRequest):
    try:
        history = [
            {"role": msg.role, "text": msg.text}
            for msg in _recent_history(req.history)
        ]
        return email_reader.answer_question(
            req.user_email, req.question, req.limit, history=history
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("EMAIL reader agent failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/calendar/events")
def get_calendar_events(limit: int = 10, user_email: str = ""):
    try:
        return {"events": calendar_agent_instance.upcoming_events(user_email, limit)}
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("CALENDAR read failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/calendar/events")
def create_calendar_event(req: CalendarEventRequest):
    try:
        return calendar_agent_instance.create_event(
            req.user_email,
            req.summary,
            req.start,
            req.end,
            req.timezone,
            req.description,
            req.location,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("CALENDAR create failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/calendar/ask")
def ask_calendar_agent(req: CalendarAgentMessage):
    try:
        history = [
            {"role": message.role, "text": message.text}
            for message in _recent_history(req.history)
        ]
        response = calendar_agent_instance.ask(
            user_email=req.user_email,
            user_text=req.user_text,
            history=history,
            api_key=API_KEY,
        )
        return {"response": response}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("CALENDAR AI agent failed")
        raise HTTPException(status_code=502, detail=str(e))


# ==========================================
# 🌤️ WEATHER ENDPOINTS
# ==========================================
@app.get("/api/weather/cities")
def get_weather_cities():
    """Return live weather for the five supported cities."""
    try:
        logger.info("WEATHER live data request for all supported cities")
        return {"cities": weather.get_all_weather()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/weather/{city}")
def get_weather_city(city: str):
    """Return live weather and a five-day forecast for one supported city."""
    try:
        logger.info("WEATHER live data request for one city")
        return weather.get_weather(city)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/weather/ask")
def ask_weather_agent(req: WeatherAgentMessage):
    """Answer a weather question using live data through the Gemini weather agent."""
    try:
        history = [
            {"role": msg.role, "text": msg.text}
            for msg in _recent_history(req.history)
        ]
        logger.info("AI weather assistant request received")
        response = weather_agent.ask_weather(
            user_text=req.user_text,
            history=history,
            api_key=API_KEY,
        )
        return {"response": response}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# ₿ CRYPTO ENDPOINTS
# ==========================================
@app.get("/api/crypto/currencies")
def get_crypto_currencies():
    """Return live market data for the five supported cryptocurrencies."""
    try:
        logger.info("CRYPTO live market data request for all supported assets")
        return {"currencies": crypto.get_all_crypto()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/crypto/{asset}")
def get_crypto_asset(asset: str):
    """Return live 24-hour market data for one supported cryptocurrency."""
    try:
        logger.info("CRYPTO live market data request for one asset")
        return crypto.get_crypto(asset)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/crypto/ask")
def ask_crypto_agent(req: CryptoAgentMessage):
    """Answer a crypto question using live market data through the Gemini agent."""
    try:
        history = [
            {"role": msg.role, "text": msg.text}
            for msg in _recent_history(req.history)
        ]
        logger.info("AI crypto assistant request received")
        response = crypto_agent.ask_crypto(
            user_text=req.user_text,
            history=history,
            api_key=API_KEY,
        )
        return {"response": response}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🌐 FRONTEND CATCH-ALL (MUST BE VERY LAST)
# ==========================================
frontend_dist = os.path.join(os.path.dirname(__file__), "../Frontend/dist")

if os.path.exists(frontend_dist):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(frontend_dist, "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Let API routes pass through normally if matched above
        if full_path.startswith("api") or full_path.startswith("auth"):
            return {"detail": "Not Found"}
        return FileResponse(os.path.join(frontend_dist, "index.html"))


# ==========================================
# 🏃‍♂️ SERVER RUNNER
# ==========================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)