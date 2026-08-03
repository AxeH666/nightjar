#!/usr/bin/env python
"""Nightjar MCP server: image generation. No Odysseus.

Odysseus removal, PR E. Replaces the odysseus-image tier (Odysseus's
image_gen_server.py driven by DB rows that seed_image_endpoint.py wrote) with a
direct BYOK call to an OpenAI-compatible /images/generations endpoint.

Backend selection is the user's EXPLICIT image-capability choice, delivered via
engine env exactly like research/browser/vision (capabilities.envForOpencode
sets NIGHTJAR_IMAGE_PROVIDER; the BYOK key arrives as NIGHTJAR_BYOK_<PROVIDER>).
A stored key alone never routes to the cloud; Offline mode reports plainly that
image generation needs an Online provider (no local diffusion path since PR G —
a local diffusers backend can return later as an additive provider here).

Runs in the phase2-mcp venv. Rule 3: one hard wall-clock cap over the whole
tool, plus per-request HTTP timeouts.
"""
from __future__ import annotations

import asyncio
import os
from typing import Optional

import httpx
from mcp.server.fastmcp import FastMCP

from imagegen_backend import (
    build_payload,
    looks_like_image,
    output_path,
    parse_image_response,
    resolve_image_backend,
)

mcp = FastMCP("nightjar-image")

# Image generation is slow (dall-e-3 commonly 15-40s). Hard outer cap + grace.
DEFAULT_MAX_TIME = int(os.environ.get("NIGHTJAR_IMAGE_MAX_TIME", "120"))
GRACE = 15
# A generated PNG is single-digit MB; anything past this is not an image answer.
MAX_IMAGE_BYTES = 32 * 1024 * 1024


async def _generate(prompt: str, size: str, max_time: int) -> dict:
    base_url, model, headers, provider = resolve_image_backend()
    if provider == "none":
        return {
            "error": (
                "Image generation is not configured. Pick an Online image provider "
                "(OpenAI or OpenRouter) in Settings → Capabilities and add that "
                "provider's API key. A stored key alone is never used without the "
                "explicit selection."
            ),
            "provider": "none",
        }

    payload = build_payload(prompt, model, size)
    async with httpx.AsyncClient(timeout=max_time, headers=headers) as client:
        resp = await client.post(base_url.rstrip("/") + "/images/generations", json=payload)
        if resp.status_code != 200:
            body = resp.text[:300]
            return {"error": f"image API returned {resp.status_code}: {body}", "provider": provider}
        png, url = parse_image_response(resp.json())
        if png is None and url:
            # dall-e-3 default response shape: a short-lived CDN URL. Fetch it now
            # (the link expires) under the same wall-clock budget.
            r2 = await client.get(url)
            r2.raise_for_status()
            png = r2.content[:MAX_IMAGE_BYTES]

    if not png:
        return {"error": "image API response carried neither b64_json nor a fetchable url", "provider": provider}
    if not looks_like_image(png):
        return {"error": "image API returned a non-image body (error page?) — not saved", "provider": provider}

    out = output_path()
    out.write_bytes(png)
    return {
        "path": str(out),
        "provider": provider,
        "model": model,
        "size": payload["size"],
        "bytes": len(png),
    }


@mcp.tool()
async def generate_image(prompt: str, size: str = "1024x1024") -> dict:
    """Generate an image from a text prompt and save it as a PNG file.

    Uses the user's EXPLICIT Online image provider (Settings → Capabilities) with
    their own API key. Returns {path, provider, model} on success, or {error} —
    including a plain explanation when no image backend is configured. Allowed
    sizes: 1024x1024 (default), 1792x1024, 1024x1792, 512x512, 256x256.
    """
    # rule 3: hard outer wall-clock cap over resolve + POST + (optional) URL fetch + write
    hard_cap = DEFAULT_MAX_TIME + GRACE
    try:
        return await asyncio.wait_for(_generate(prompt, size, DEFAULT_MAX_TIME), timeout=hard_cap)
    except asyncio.TimeoutError:
        return {"error": f"image generation timed out after {hard_cap}s"}
    except httpx.HTTPError as exc:
        return {"error": f"image API request failed: {type(exc).__name__}: {exc}"}


if __name__ == "__main__":
    mcp.run()
