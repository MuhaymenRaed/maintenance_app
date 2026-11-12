/**
 * `lib/r2.ts`, without R2.
 *
 * The site's module holds the bucket's keys and signs uploads; nothing of it
 * may reach a desktop install that a stranger could unpack. What the copied
 * code needs from it is one *type* — the folder an upload is for — so that is
 * all this is. The photographs themselves reach storage through the
 * dashboard's own upload route, which holds the keys on the server
 * (`uploadPhoto` in `src/main/sync/push.ts`).
 */
export type UploadPrefix = "repair" | "trade-in" | "avatar" | "product" | "category" | "receipt";
