"""Tavily web-search agent."""

import os
from typing import Any, Dict, List

from google import genai

from tavily import TavilyClient

try:
    from logger import logger
except ImportError:  # pragma: no cover
    import logging
    logger = logging.getLogger(__name__)


class TavilySearchAgent:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("TAVILY_API_KEY")
        self.client = TavilyClient(api_key=self.api_key) if self.api_key else None

    def search(self, query: str, max_results: int = 5, history: List[Dict[str, str]] | None = None) -> Dict[str, Any]:
        query = (query or "").strip()
        if not query:
            raise ValueError("Search query is required.")
        if not self.client:
            raise RuntimeError("TAVILY_API_KEY is not configured.")

        max_results = max(1, min(int(max_results), 10))
        try:
            response = self.client.search(
                query=query,
                search_depth="basic",
                max_results=max_results,
                include_answer="advanced",
                include_raw_content=False,
            )
            results = [
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "content": item.get("content", ""),
                }
                for item in response.get("results", [])
            ]
            summary = response.get("answer") or "No concise summary was returned."

            # Preserve the existing Tavily behavior for the first message.
            # When conversation history exists, use Gemini only to resolve
            # follow-up references while grounding the answer in the fresh
            # Tavily results.
            history = history or []
            history_text = "\n".join(
                f"{item.get('role', 'user').upper()}: {item.get('text', '')}"
                for item in history[-12:]
                if item.get("text")
            )
            gemini_key = os.getenv("GEMINI_API_KEY")
            if history_text and gemini_key:
                try:
                    client = genai.Client(api_key=gemini_key)
                    source_context = "\n\n".join(
                        f"SOURCE {i}: {item['title']}\n{item['content']}\nURL: {item['url']}"
                        for i, item in enumerate(results, 1)
                    )
                    prompt = (
                        "Answer the user's current web-research question using the fresh search results below. "
                        "Use the previous conversation only to understand context and references. "
                        "Do not invent facts or sources. Keep the answer concise and useful.\n\n"
                        f"PREVIOUS CONVERSATION:\n{history_text}\n\n"
                        f"CURRENT QUESTION:\n{query}\n\n"
                        f"TAVILY SUMMARY:\n{summary}\n\n"
                        f"SEARCH RESULTS:\n{source_context}"
                    )
                    response_ai = client.models.generate_content(
                        model=os.getenv("WEB_SEARCH_MODEL", "gemini-3.5-flash-lite"),
                        contents=prompt,
                    )
                    contextual_summary = (response_ai.text or "").strip()
                    if contextual_summary:
                        summary = contextual_summary
                except Exception:
                    logger.exception("Contextual web-search summarization failed; using Tavily answer")

            return {"query": query, "summary": summary, "results": results}
        except Exception as exc:
            logger.exception("Tavily web search failed")
            raise RuntimeError(f"Web search failed: {exc}") from exc
