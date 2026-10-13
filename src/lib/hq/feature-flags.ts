/**
 * Feature switches for parts of the CRM that are built but turned off.
 * Flip a flag to true (and redeploy) to bring the feature back.
 */

/**
 * Client portals: the public /client/[token] report pages and the internal
 * /client-portals management screen.
 *
 * Off since 2026-10-13: call data now lives in a separate CRM, so there's
 * nothing for the portals to report on. While false, the public pages
 * return 404 for every token (including links already sent to clients),
 * the management screen 404s, and the sidebar item is hidden.
 *
 * Heads up if you re-enable: the stats in src/lib/hq/client-portal.ts read
 * the `calls` table, which is no longer fed or ingested here.
 */
export const CLIENT_PORTALS_ENABLED = false;
