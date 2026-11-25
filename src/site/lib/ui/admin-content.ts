/**
 * The id `admin/layout.tsx` puts on the box the dashboard's navigation veil is
 * scoped to (`AdminContentVeil` in `components/ui/link-pending.tsx`).
 *
 * A plain shared string rather than a context: the layout only needs it once,
 * to set the `id`, and the veil only needs it once, to look the node up.
 *
 * ⚠️ It is in its own module, not beside the veil, because the layout is a
 * Server Component: exported from a `"use client"` file, the string was a
 * client reference there and the box was drawn with no usable `id`.
 */
export const ADMIN_CONTENT_ID = "admin-content-veil-target";
