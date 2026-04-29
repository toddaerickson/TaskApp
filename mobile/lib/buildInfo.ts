/**
 * Bundled build identifiers. Populated at build time by
 * `scripts/build-web.sh` via the `EXPO_PUBLIC_BUILD_SHA` /
 * `EXPO_PUBLIC_BUILD_TIME` env vars (Metro inlines `EXPO_PUBLIC_*`
 * literally during `expo export`).
 *
 * Surfaced in the Settings footer so "am I on the post-merge build?"
 * is a one-tap check instead of requiring devtools.
 *
 * Local dev:
 *   - `expo start` doesn't run `build-web.sh`, so SHA falls back to
 *     'dev'. Settings shows "dev" and that's the right answer.
 *
 * Why these aren't optional-chained or `typeof process` guarded:
 *   Metro's static replace ONLY fires on `process.env.EXPO_PUBLIC_*`
 *   literal dot access. Optional chaining short-circuits the
 *   transform — the value would never land in the bundle. See the
 *   comment block in lib/api.ts for the same gotcha on
 *   EXPO_PUBLIC_API_URL.
 */

export const BUILD_SHA: string = process.env.EXPO_PUBLIC_BUILD_SHA || 'dev';
export const BUILD_TIME: string = process.env.EXPO_PUBLIC_BUILD_TIME || '';
