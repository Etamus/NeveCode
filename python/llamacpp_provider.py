"""
llamacpp_provider.py
--------------------
Adds native llama.cpp (llama-server) support to openclaude.
Routes requests to a locally-running llama-server instance that exposes
an OpenAI-compatible API at http://localhost:8080.

The llama-server is started automatically by start.bat using the first
.gguf model found in the models/ directory.

Configured defaults:
    - Flash attention: enabled
    - KV cache quantization: q8_0
    - Context size (n_ctx): 32768
    - max_tokens: -1 (unlimited, model decides)

Usage (.env):
    CLAUDE_CODE_USE_OPENAI=1
    OPENAI_BASE_URL=http://localhost:8080/v1
    OPENAI_MODEL=<model-name-from-gguf-filename>
"""

import httpx
import json
import logging
import os
from typing import AsyncIterator

logger = logging.getLogger(__name__)

LLAMACPP_BASE_URL = os.getenv("LLAMACPP_BASE_URL", "http://localhost:8080")
LLAMACPP_PORT = int(os.getenv("LLAMACPP_PORT", "8080"))


def _api_url(path: str) -> str:
    return f"{LLAMACPP_BASE_URL}/v1{path}"


async def check_llamacpp_running() -> bool:
    """Check if llama-server is available at the configured endpoint."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(_api_url("/models"))
            return resp.status_code == 200
    except Exception:
        return False


async def list_llamacpp_models() -> list[str]:
    """Return the list of models currently loaded in llama-server."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(_api_url("/models"))
            resp.raise_for_status()
            data = resp.json()
            return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        logger.warning(f"Could not list llama.cpp models: {e}")
        return []


def anthropic_to_openai_messages(messages: list[dict]) -> list[dict]:
    """Convert Anthropic-style messages to OpenAI-compatible format."""
    result = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, str):
            result.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "image":
                        # llama-server supports base64 images in vision models
                        source = block.get("source", {})
                        if source.get("type") == "base64":
                            result.append({
                                "role": role,
                                "content": [
                                    {"type": "text", "text": "\n".join(text_parts)} if text_parts else None,
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{source.get('media_type', 'image/png')};base64,{source.get('data', '')}"
                                        }
                                    }
                                ]
                            })
                            text_parts = []
                            continue
                        else:
                            text_parts.append("[image]")
                elif isinstance(block, str):
                    text_parts.append(block)
            if text_parts:
                result.append({"role": role, "content": "\n".join(text_parts)})
        else:
            result.append({"role": role, "content": str(content)})
    return result


async def llamacpp_chat(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = -1,
    temperature: float = 1.0,
) -> dict:
    """Send a chat request to llama-server and return an Anthropic-compatible response."""
    openai_messages = anthropic_to_openai_messages(messages)
    if system:
        openai_messages.insert(0, {"role": "system", "content": system})

    payload: dict = {
        "model": model,
        "messages": openai_messages,
        "temperature": temperature,
        "stream": False,
    }
    # max_tokens=-1 means unlimited in llama-server; omit or pass null
    if max_tokens != -1:
        payload["max_tokens"] = max_tokens

    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(_api_url("/chat/completions"), json=payload)
        resp.raise_for_status()
        data = resp.json()

    choice = data.get("choices", [{}])[0]
    assistant_text = choice.get("message", {}).get("content", "")
    usage = data.get("usage", {})

    return {
        "id": data.get("id", "msg_llamacpp"),
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": assistant_text}],
        "model": model,
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


async def llamacpp_chat_stream(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = -1,
    temperature: float = 1.0,
) -> AsyncIterator[str]:
    """Stream a chat response from llama-server in Anthropic SSE format."""
    openai_messages = anthropic_to_openai_messages(messages)
    if system:
        openai_messages.insert(0, {"role": "system", "content": system})

    payload: dict = {
        "model": model,
        "messages": openai_messages,
        "temperature": temperature,
        "stream": True,
    }
    if max_tokens != -1:
        payload["max_tokens"] = max_tokens

    yield "event: message_start\n"
    yield f'data: {json.dumps({"type": "message_start", "message": {"id": "msg_llamacpp_stream", "type": "message", "role": "assistant", "content": [], "model": model, "stop_reason": None, "usage": {"input_tokens": 0, "output_tokens": 0}}})}\n\n'
    yield "event: content_block_start\n"
    yield f'data: {json.dumps({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})}\n\n'

    output_tokens = 0
    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("POST", _api_url("/chat/completions"), json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                raw = line[len("data: "):]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    choice = chunk.get("choices", [{}])[0]
                    delta_text = choice.get("delta", {}).get("content", "")
                    if delta_text:
                        output_tokens += 1
                        yield "event: content_block_delta\n"
                        yield f'data: {json.dumps({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": delta_text}})}\n\n'

                    finish_reason = choice.get("finish_reason")
                    if finish_reason:
                        usage = chunk.get("usage", {})
                        final_tokens = usage.get("completion_tokens", output_tokens)
                        yield "event: content_block_stop\n"
                        yield f'data: {json.dumps({"type": "content_block_stop", "index": 0})}\n\n'
                        yield "event: message_delta\n"
                        yield f'data: {json.dumps({"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": final_tokens}})}\n\n'
                        yield "event: message_stop\n"
                        yield f'data: {json.dumps({"type": "message_stop"})}\n\n'
                        break
                except json.JSONDecodeError:
                    continue
