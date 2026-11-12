/**
 * `server-only` is a package whose whole job is to fail the build when a
 * module that imports it ends up in a browser bundle. Nothing the desk copies
 * imports it — the walk in `scripts/sync-site.mjs` stops at every server
 * module — and this exists so that if one ever does, the build says so by
 * failing to resolve something rather than quietly shipping it.
 *
 * ⚠️ Deliberately empty and deliberately not deleted. It is listed in
 * `tsconfig.json` and the Vite config so the *name* resolves; the day a sync
 * drags in a module that needs it, `tsc` will point at the import.
 */
export {};
