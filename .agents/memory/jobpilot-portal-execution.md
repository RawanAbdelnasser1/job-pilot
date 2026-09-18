---
name: JobPilot portal execution
description: Runtime requirement for the supported Greenhouse and Lever application executor.
---

The API artifact's supported-portal executor depends on both the Playwright package and a provisioned Chromium runtime; a package-only install is insufficient for browser execution.

**Why:** The workspace package manager treats root installs differently from artifact installs, and Playwright does not automatically make a browser binary available in every environment.

**How to apply:** When changing or deploying the executor, verify the API artifact dependency and provision Chromium in the runtime before testing an application flow.