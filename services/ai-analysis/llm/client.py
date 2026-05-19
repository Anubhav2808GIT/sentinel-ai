"""
Ollama LLM Client — hardened for production.

Improvements vs original:
  - Reduced timeout from 90s to 60s (outer guard in ai-analysis adds 120s)
  - Enriched fallback response (explicit reason field for observability)
  - Better JSON extraction: handles Ollama sometimes wrapping response in code fences
  - Structured logging of latency per call
"""

import httpx
import json
import re
import time

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from shared.config.settings import settings
from shared.logging.logger import get_logger
from shared.metrics.prometheus import AI_RESPONSE_LATENCY

logger = get_logger("llm-client")

# ─── Regex to extract JSON from code-fence or plain output ───────────────────
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def _extract_json(text: str) -> dict:
    """Try to extract a JSON dict from a raw LLM response string."""
    # 1. Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Try extracting from code fence
    match = _JSON_FENCE_RE.search(text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 3. Try finding first {...} block
    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start != -1 and brace_end > brace_start:
        try:
            return json.loads(text[brace_start : brace_end + 1])
        except json.JSONDecodeError:
            pass

    raise json.JSONDecodeError("No valid JSON found", text, 0)


class OllamaClient:
    def __init__(self) -> None:
        self.base_url = settings.ollama_base_url
        self.model = settings.ollama_model

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type(httpx.RequestError),
        reraise=False,
    )
    async def generate_json(self, prompt: str) -> dict:
        """Call Ollama and return a parsed JSON dict. Falls back on error."""
        url = f"{self.base_url}/api/generate"
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }

        logger.info("[llm] Sending prompt to model '%s'", self.model)
        start = time.monotonic()

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()

                latency = time.monotonic() - start
                AI_RESPONSE_LATENCY.observe(latency)
                logger.info("[llm] Response received in %.2fs", latency)

                result = response.json()
                response_text = result.get("response", "{}")

                try:
                    return _extract_json(response_text)
                except json.JSONDecodeError:
                    logger.error("[llm] Could not extract JSON from Ollama response: %.200s", response_text)
                    return self._fallback_response("json_parse_error")

        except httpx.HTTPStatusError as exc:
            logger.error("[llm] HTTP error %d from Ollama: %s", exc.response.status_code, exc)
            return self._fallback_response("http_error")
        except httpx.RequestError as exc:
            logger.error("[llm] Network error reaching Ollama: %s", exc)
            return self._fallback_response("network_error")
        except Exception as exc:
            logger.error("[llm] Unexpected error: %s", exc)
            return self._fallback_response("unknown_error")

    def _fallback_response(self, reason: str = "error") -> dict:
        logger.warning("[llm] Using fallback response (reason=%s)", reason)
        return {
            "summary": f"AI analysis unavailable ({reason}). Manual investigation required.",
            "root_cause": "Could not determine root cause automatically.",
            "remediation": [
                "Review service logs in Grafana.",
                "Check upstream dependencies for failures.",
                "Escalate to on-call engineer if issue persists.",
            ],
            "confidence": 0.0,
        }
