"""Shared retry helper for Gemini API calls.

Google's Gemini API occasionally returns transient errors when the model
is under heavy load (HTTP 503 "UNAVAILABLE") or when a rate limit is hit
(HTTP 429 "RESOURCE_EXHAUSTED"). These are almost always resolved by
retrying a moment later -- they are not bugs in this app. Previously, the
raw error (including Google's internal JSON error body) was shown directly
to the user as the AI's "response", which looked broken and confusing.

This wraps every agent's `client.models.generate_content(...)` call with a
short retry-with-backoff, and only surfaces a clean, user-friendly message
if every retry still fails.
"""
import time
from logger import logger

_RETRYABLE_SIGNALS = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "overloaded")
_MAX_ATTEMPTS = 3
_BASE_DELAY_SECONDS = 1.5


def _is_retryable(exc: Exception) -> bool:
    text = str(exc)
    return any(signal in text for signal in _RETRYABLE_SIGNALS)


def generate_content_with_retry(client, **kwargs):
    """Drop-in replacement for client.models.generate_content(**kwargs)
    that retries transient overload/rate-limit errors with exponential
    backoff, and raises a clean RuntimeError if every attempt fails."""
    last_error = None

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            return client.models.generate_content(**kwargs)
        except Exception as exc:
            last_error = exc
            if not _is_retryable(exc) or attempt == _MAX_ATTEMPTS:
                break
            delay = _BASE_DELAY_SECONDS * (2 ** (attempt - 1))
            logger.warning(
                "Gemini call failed (attempt %d/%d), retrying in %.1fs: %s",
                attempt, _MAX_ATTEMPTS, delay, exc,
            )
            time.sleep(delay)

    if _is_retryable(last_error):
        logger.exception("Gemini call failed after all retries")
        raise RuntimeError(
            "Our AI assistant is temporarily experiencing high demand. "
            "Please try again in a moment."
        )

    # Not a retryable/overload error -- surface it as-is so real bugs
    # aren't hidden behind a generic message.
    raise last_error