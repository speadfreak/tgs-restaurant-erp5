/**
 * Returns the base URL that hand-rolled `fetch()` calls should prepend to
 * relative API paths (e.g. "/api/menu/items").
 *
 * In production the frontend (static site) and API server are deployed as
 * separate services on different origins, so relative paths must be
 * resolved against `VITE_API_URL` (injected at build time). In development,
 * the Vite dev-server proxy forwards `/api/*` to the local API server, so an
 * empty string (same-origin relative fetch) is correct.
 *
 * NOTE: `import.meta.env.BASE_URL` is Vite's *static asset* base path
 * (usually "/") — it has nothing to do with the API's origin. Do not use it
 * here; that mistake previously caused every hand-rolled `apiFetch` in this
 * app to silently call the frontend's own origin in production instead of
 * the API server, breaking every portal that doesn't go through the shared
 * `@workspace/api-client-react` client.
 */
export function getApiBase(): string {
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return apiUrl ? apiUrl.replace(/\/+$/, "") : "";
}
