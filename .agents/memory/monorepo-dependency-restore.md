---
name: Monorepo dependency restore
description: Dependency restoration in this multi-package workspace
---

The package-install helper targets the workspace root and can refuse to add packages in a pnpm monorepo; when manifests and the lockfile already contain the dependencies, a frozen-lockfile install is the reliable restoration path.

When a full workspace install is blocked by an unrelated tooling package in the internal registry, use a frozen-lockfile install filtered to the needed workspaces and their dependencies. Include all workspaces needed by the validation command.

**Why:** The helper attempted a root dependency add and stopped before restoring packages required by existing app packages. In this environment, full installation also tried to fetch an unrelated API-generation package that the registry rejected, while filtered installs worked from cache.

**How to apply:** Prefer frozen-lockfile installs for an existing checkout; filter by workspace when an unrelated package blocks restoration. Only add packages when the code change actually introduces a new dependency.