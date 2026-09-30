---
name: Loyalty challenge snapshots
description: Rules for preserving delivered-order challenge behavior when prize catalogue settings change
---

Each customer challenge must snapshot its required order count when the challenge starts. Editing a prize configuration may affect future challenges, but must not silently change an active or historical challenge.

**Why:** Prize rows are editable catalogue records, while customer challenges are historical business records. Reading the current prize target for an old challenge can change the outcome after an admin edit.

**How to apply:** Keep challenge progress and target values on the challenge record, use the stored cycle dates for historical cycle length, and use the prize row only for reward details and future challenge defaults.