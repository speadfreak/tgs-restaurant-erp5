---
name: Monorepo dependency restore
description: Dependency restoration in this multi-package workspace
---

The package-install helper targets the workspace root and can refuse to add packages in a pnpm monorepo; when manifests and the lockfile already contain the dependencies, a frozen-lockfile install is the reliable restoration path.

**Why:** The helper attempted a root dependency add and stopped before restoring packages required by existing app packages.

**How to apply:** Prefer the frozen lockfile install for restoring an existing checked-out monorepo; only add packages when the code change actually introduces a new dependency.