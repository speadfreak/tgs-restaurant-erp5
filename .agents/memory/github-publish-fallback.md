---
name: GitHub publish fallback
description: Safe repository publishing when the local git remote cannot authenticate
---

When the local GitHub remote rejects authentication, use the attached GitHub integration to publish through the Git data API instead of handling a token manually. First verify the target repository and push permission, then ensure remote `main` still equals the local commit's parent. Upload changed files as blobs, create a tree and commit on that parent, update the branch without force, and verify the resulting ref.

**Why:** The workspace may have a valid Replit GitHub connection even when the shell's HTTPS remote has no usable credential helper. The parent check prevents overwriting unrelated remote work.

**How to apply:** Use only for an explicitly requested repository push. Keep credentials inside the connector proxy and do not ask the user to paste a token.