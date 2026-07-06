---
name: Drizzle numeric inserts
description: numeric() columns in Drizzle ORM require string values, never JS numbers
---

Drizzle ORM's `numeric(precision, scale)` column type maps to Postgres `NUMERIC`. When inserting or updating, the TypeScript type is `string | SQL | Placeholder`, NOT `number`. Passing a raw `number` causes a TS2769 overload error at compile time.

**Why:** Drizzle preserves arbitrary precision by using string representation internally. Numbers would lose precision for large decimals.

**How to apply:** Always wrap numeric fields before insert/update:
- `priceAed: String(parsed.data.priceAed)`
- `amountAed: String(parsed.data.amountAed)`
- `quantityOnHand: String(parsed.data.quantityOnHand)`
- `baseSalary: rest.baseSalary !== undefined ? String(rest.baseSalary) : undefined`

For updates where the field is optional, check for undefined first:
```ts
const updateData: Record<string, unknown> = { ...parsed.data };
if (parsed.data.priceAed !== undefined) updateData.priceAed = String(parsed.data.priceAed);
await db.update(table).set(updateData as any).where(...);
```
