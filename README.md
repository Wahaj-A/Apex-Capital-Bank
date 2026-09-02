<div align="center">

# 🏦 Apex Capital Bank — AI Banking CRM

**An agentic banking platform where a Gemini-powered AI handles deposits, transfers, email, calendar, live market data, and web research — all through natural conversation.**

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React%2018-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Bundler-Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Gemini](https://img.shields.io/badge/AI-Google%20Gemini-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![TailwindCSS](https://img.shields.io/badge/Styling-TailwindCSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](#license)

</div>

---

## 📖 Overview

Apex Capital Bank is a full-stack, AI-first banking CRM. Instead of clicking through forms to manage money, users **talk** to specialized AI agents that securely call real backend tools on their behalf — depositing money, transferring funds, drafting and sending emails, reading Gmail, managing a Google Calendar, checking live crypto/weather data, and searching the web — all while enforcing strict per-user account authorization.

It's built as a portfolio-grade demonstration of **LLM tool-calling / function-calling architecture** wired into a real, stateful backend (SQLite + FastAPI) and a polished React chat UI.

---

## ✨ Key Features

| Agent | What it does |
|---|---|
| 🏦 **Banking Agent** | Deposit, withdraw, transfer, and check balances/history via natural language — restricted to the caller's own account |
| ✉️ **Email Agent** | Drafts professional emails, lets you review before sending |
| 📥 **Email Reader Agent** | Answers questions about your recent Gmail inbox |
| 📅 **Calendar Agent** | Reads and creates Google Calendar events from plain-English instructions |
| ⌕ **Web Search Agent** | Live web research via Tavily, held as a continuous conversation |
| ✦ **Image Generation Agent** | Generates images from natural-language prompts (Cloudflare Workers AI) |
| ₿ **Crypto Agent** | Live BTC/ETH/BNB/SOL/XRP pricing (Binance public API) plus a conversational Q&A agent |
| ☀️ **Weather Agent** | Live weather lookups with a conversational agent on top |
| 📚 **RAG Agent** | Retrieval-augmented answers over bank policy documents (`hbl_terms.txt`) |
| 🔐 **Auth** | Email/password login **and** Google Sign-In (OAuth), with encrypted token storage |

Every "action" agent (banking, email, calendar) is implemented as an LLM **function-calling** loop: Gemini decides which tool to invoke, the backend executes it against the real database/API, and the result is turned back into a natural-language confirmation — never exposing raw tool internals to the user.

---

## 🏗️ Architecture

```
┌─────────────────────────┐         REST / JSON          ┌──────────────────────────┐
│   React 18 + Vite SPA    │ ───────────────────────────▶ │        FastAPI            │
│   (Frontend/)             │ ◀─────────────────────────── │        (Backend/)          │
│  • Tailwind CSS 4         │                               │                            │
│  • Google OAuth widget    │                               │  ┌──────────────────────┐  │
│  • Recharts (balances)    │                               │  │  Gemini Agents        │  │
│  • Custom Markdown        │                               │  │  (function calling)   │  │
│    message renderer       │                               │  │  agent_logic.py       │  │
└─────────────────────────┘                               │  │  bank/email/calendar/ │  │
                                                             │  │  crypto/weather/rag   │  │
                                                             │  └──────────────────────┘  │
                                                             │  SQLite (banking.db)       │
                                                             │  Google OAuth (Gmail +      │
                                                             │  Calendar), Tavily,          │
                                                             │  Cloudflare Workers AI       │
                                                             └──────────────────────────┘
```

**Backend** (`Backend/`) — FastAPI app (`main.py`, 35+ REST endpoints) with modular agent files, each wiring a Gemini model to a set of Python functions ("tools") scoped to one domain:

- `bank_logic.py` — SQLite-backed accounts/transactions engine
- `agent_logic.py` — banking chat agent + tool definitions, with a strict system prompt that enforces domain and account-ownership restrictions
- `google_oauth.py` — Google OAuth flow, encrypted token storage
- `email_agent.py` / `email_reader_agent.py` — Gmail drafting/sending/reading
- `calendar_agent.py` — Google Calendar read/write
- `crypto.py` / `crypto_agent.py` — Binance live pricing + chat agent
- `weather.py` / `weather_agent.py` — live weather + chat agent
- `tavily_agent.py` — live web search agent
- `image_agent.py` — image generation via Cloudflare Workers AI
- `rag_agent.py` — retrieval-augmented Q&A over bank documents
- `logger.py` — structured request/response logging middleware

**Frontend** (`Frontend/`) — Single-page React app (`App.jsx`) with a custom-built Markdown-to-JSX chat renderer, per-agent conversational UI, account dashboards with charts, and Google Sign-In.

---

## 🛠️ Tech Stack

- **Backend:** Python, FastAPI, Uvicorn, SQLite, Google GenAI SDK (Gemini), `google-auth`/`google-api-python-client`, `cryptography`, `scikit-learn` (RAG), Tavily
- **Frontend:** React 18, Vite, Tailwind CSS 4, Recharts, `@react-oauth/google`
- **AI/Agents:** Gemini function calling for tool use, per-domain system prompts, RAG over local documents
- **Auth:** Email/password + Google OAuth 2.0 (Gmail + Calendar scopes), encrypted token storage

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- API keys: Google Gemini, Tavily, Google OAuth client (Gmail + Calendar), Cloudflare Workers AI (optional, for image generation)

### 1. Clone

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### 2. Backend setup

```bash
cd Backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # then fill in your own keys — see below
uvicorn main:app --reload
```

Backend runs at `http://127.0.0.1:8000`.

### 3. Frontend setup

```bash
cd Frontend
npm install
cp .env.example .env          # if present, fill in values (e.g. Google client ID)
npm run dev
```

Frontend runs at `http://localhost:5173`.

### 4. Environment variables (`Backend/.env`)

```env
GEMINI_API_KEY=
TAVILY_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:8000/api/google/callback
GOOGLE_TOKEN_ENCRYPTION_KEY=       # optional locally
FRONTEND_URL=http://localhost:5173
CLOUDFLARE_ACCOUNT_ID=             # optional, for image generation
CLOUDFLARE_API_TOKEN=              # optional, for image generation
```

See `GOOGLE_OAUTH_SETUP.md`, `CALENDAR_AGENT_SETUP.md`, `Frontend/WEATHER_FEATURE.md`, and `Frontend/CRYPTO_FEATURE.md` for feature-specific setup notes.

> ⚠️ **Never commit `.env`.** It's already git-ignored — keep it that way, and rotate any key that has ever been shared or exposed.

---

## 📂 Project Structure

```
Final Project/
├── Backend/
│   ├── main.py                 # FastAPI app & all REST routes
│   ├── agent_logic.py          # Banking AI agent + tool definitions
│   ├── bank_logic.py           # Accounts/transactions (SQLite)
│   ├── google_oauth.py         # OAuth flow + token encryption
│   ├── email_agent.py / email_reader_agent.py
│   ├── calendar_agent.py
│   ├── crypto.py / crypto_agent.py
│   ├── weather.py / weather_agent.py
│   ├── tavily_agent.py
│   ├── image_agent.py
│   ├── rag_agent.py
│   ├── logger.py
│   └── requirements.txt
├── Frontend/
│   ├── src/
│   │   ├── App.jsx             # Main SPA: auth, dashboard, all agent UIs
│   │   ├── api.js              # Backend API client
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── GOOGLE_OAUTH_SETUP.md
├── CALENDAR_AGENT_SETUP.md
└── README.md
```

---

## 🔐 Security Notes

- Account-scoped tool calls: the banking agent's tools reject any operation on an account that doesn't belong to the authenticated caller.
- OAuth tokens are encrypted at rest.
- Secrets live only in `.env` files, which are git-ignored by default.
- The AI system prompts explicitly forbid leaking internal tool calls, raw output, or authorization logic to end users.

---

## 🗺️ Roadmap Ideas

- [ ] Multi-currency account support
- [ ] Streaming AI responses (SSE/WebSockets)
- [ ] Role-based admin dashboard
- [ ] Automated test suite (pytest + React Testing Library)
- [ ] Dockerized deployment

---

## 📄 License

This project is available under the MIT License — see [LICENSE](LICENSE) for details, or update to reflect your preferred license.

---

<div align="center">
Built with FastAPI, React, and Google Gemini.
</div>
