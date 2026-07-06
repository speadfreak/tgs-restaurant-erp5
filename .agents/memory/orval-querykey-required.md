---
name: Orval queryKey required
description: Generated Orval hooks require queryKey in options when adding enabled or refetchInterval
---

When using generated query hooks with options like `enabled` or `refetchInterval`, TypeScript requires `queryKey` to also be present:

```ts
// WRONG — TS2741 error: queryKey missing
useGetFoo(id, { query: { enabled: !!id } });

// CORRECT
useGetFoo(id, { query: { enabled: !!id, queryKey: getGetFooQueryKey(id) } });
```

**Why:** The generated hooks use `UseQueryOptions` which has `queryKey` as required when passing partial options.

**How to apply:** Whenever you write `{ query: { enabled: ... } }` or `{ query: { refetchInterval: ... } }`, always also include `queryKey: getXxxQueryKey(...)` using the matching generated key helper.
