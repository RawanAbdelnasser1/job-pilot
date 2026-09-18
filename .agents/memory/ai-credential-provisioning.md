---
name: AI credential provisioning
description: Environment-specific guidance for JobPilot's OpenAI runtime access.
---

Prefer Replit-managed OpenAI credentials, but retain the secure direct `OPENAI_API_KEY` fallback when the managed approval prompt or provisioning callback is unavailable.

**Why:** Managed credential provisioning is not guaranteed to be available for existing projects, and direct OpenAI access requires a public-provider model name rather than a Replit-specific one.

**How to apply:** Keep managed credentials first in resolution order, use a public OpenAI model for the fallback, and never expose either credential.