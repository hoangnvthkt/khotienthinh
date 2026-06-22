# PWA QA Checklist

Use this checklist before deploying PWA-related changes.

## Build Artifacts

- Run `npm run lint`.
- Run `npm run build`.
- Confirm `dist/manifest.json` exists and contains `id`, `start_url`, `scope`, `display`, icons, and shortcuts.
- Confirm `dist/sw.js`, `dist/offline.html`, and `dist/icons/` exist.
- Confirm shortcuts use HashRouter URLs such as `/#/inventory`, `/#/hrm/employees`, `/#/da`, `/#/rq`.

## Desktop Chrome/Edge

- Open the production URL over HTTPS.
- Confirm install icon or Open in app appears in the address bar when eligible.
- Install the app and confirm it opens in a standalone window.
- Confirm Settings shows standalone/browser mode and service worker status.
- Deploy a changed service worker and confirm the update banner appears.

## Android Chrome

- Add to Home Screen.
- Open from the app icon and confirm standalone mode.
- Confirm Web Push can be enabled from Settings.
- Confirm notification click focuses an existing app window or opens the target route.

## iOS/iPadOS

- Open Safari and add Vioo to Home Screen.
- Open from the Home Screen icon.
- Confirm Settings detects standalone mode before allowing Web Push.
- Confirm browser mode shows guidance to Add to Home Screen.

## Regression Guardrails

- Do not cache Supabase API responses or business data in the service worker.
- Do not add offline mutation queue behavior unless a dedicated offline-first phase is approved.
- Confirm in-app notifications and Web Push delivery logs still work.
