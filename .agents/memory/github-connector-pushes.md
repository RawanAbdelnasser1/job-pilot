---
name: GitHub connector pushes
description: Reliable repository pushes through Replit's GitHub connector when no authenticated local GitHub remote is configured.
---

Use the connected GitHub REST API to create blobs, a tree, a commit, and the branch ref. Throttle requests below the connector's per-repl limit and treat a ref-create 422 saying the reference already exists as a possible successful prior write; verify `refs/heads/main` and its commit before retrying.

**Why:** The connector is API access rather than a local authenticated Git transport, and the proxy enforces a low request rate. Retried writes can finish the commit before the wrapper reaches the ref step.

**How to apply:** Resolve the repository explicitly, upload tracked text/config files in bounded batches, back off on 429 responses, then verify the branch and commit directly. Add larger binary assets separately if the transport truncates them.