# Spring Atlas — Java + Spring Boot knowledge map

Spring Atlas is a static HTML/CSS/vanilla-JavaScript learning map. The repository syllabus JSON remains the source of truth for topic hierarchy, prerequisite edges, section membership, importance, and shared canonical concepts. It contains 1,001 topic nodes representing 997 unique concepts; progress is calculated per unique `concept_key`, not per occurrence in the tree.

The cloud-enabled version adds rich topic notes, revision-aware synchronization, JSON backup/restore, and a print-to-PDF view. Vercel serves the static files and `api/` Node.js Functions. MongoDB Atlas stores only mutable progress, notes, and minimal sync metadata; it does not store a second copy of the syllabus.

## Requirements

- Node.js 22 or newer (the MongoDB Node driver is pinned to `7.7.0`).
- A Vercel project and CLI for local function development/deployment.
- A MongoDB Atlas database and a least-privilege database user.
- A browser with JavaScript enabled. Quill `2.0.3` is loaded from a pinned CDN; if that script does not load, notes fall back to plain text until the editor is available.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and `MONGODB_DB_NAME` for a **development/test** Atlas database. Never commit `.env`.
3. Run `npm run dev`, then open the URL printed in the terminal (normally `http://127.0.0.1:3000`). This project uses a small local Node server that serves the static frontend and dispatches the same `api/` handlers used by Vercel. It binds to loopback only and loads `.env` without adding a dotenv dependency. Opening `index.html` directly from disk will not work because the browser must fetch the syllabus JSON and API routes.
4. Run `npm run check` and `npm test` before committing. If you change the reference syllabus JSON, run `npm run manifest` to rebuild the server-side ID/status validation manifest, then rerun both checks.

The `dev` script intentionally does **not** invoke `vercel dev`. Doing so makes Vercel infer `npm run dev` as the application's development command and recursively start `vercel dev` again (`DEV_RECURSIVE_INVOCATION`). Use `npm run dev` for local application development; use the Vercel CLI for deployment (for example, `npx vercel` and `npx vercel --prod`) after linking/configuring the project. The local server is only for localhost development; production must still be protected by Vercel Deployment Protection as described below.

`GET /api/health` returns only a safe readiness state. It does not provide application authentication. The production safety boundary is the Vercel access gate described below.

## MongoDB Atlas setup

1. Create a dedicated Atlas database user for Spring Atlas. Grant only `readWrite` on the single database used by this application. Do not use an Atlas organization/project owner credential.
2. Keep TLS enabled (Atlas defaults to it) and use a strong generated password in the connection string.
3. Configure Atlas network access as narrowly as your deployment supports. If Vercel's function egress does not fit a stable IP allowlist for your plan, a broad Atlas network rule may be necessary. That increases exposure: compensate with the least-privilege DB user, a strong rotated secret, TLS, Vercel access protection, and monitoring; never allow unauthenticated database access.
4. Set these **server-side** environment variables in Vercel Project Settings → Environment Variables, selecting the intended Production/Preview/Development scope:
   - `MONGODB_URI` — Atlas connection string; never put it in the frontend.
   - `MONGODB_DB_NAME` — the database name, for example `spring_atlas`.
5. Redeploy after changing project environment variables. The application creates/uses the `progress`, `notes`, and `syncMetadata` collections as needed. Atlas transactions are used for the controlled migration endpoint, so use an Atlas replica-set deployment (Atlas clusters provide this).

## Protect the app before using personal data

**Do not put personal notes/progress in a public production deployment.** The API intentionally has no homemade password or hardcoded bypass; it relies on Vercel's access protection.

1. In the Vercel Dashboard, open the Spring Atlas project and go to **Settings → Security → Deployment Protection** (the exact label may vary with the current dashboard). Enable Vercel Authentication / Deployment Protection for the Production deployment. Permit only your own Vercel account and any additional accounts you intentionally approve.
2. Ensure the protection policy applies to the production frontend **and every `/api/*` function**, including the health route. Do not add a rewrite that sends `/api/*` to `index.html`; the supplied `vercel.json` does not do that.
3. Check the deployed production URL in a private/incognito window where you are not signed in. Both `/` and `/api/bootstrap` must be blocked by the Vercel gate (for example by redirecting to authentication or returning 401/403). A hidden frontend with a publicly readable API is **not secure**. Also verify `/api/health` is blocked at the unauthenticated boundary.
4. Test again using the custom domain, if one is configured. If any API route bypasses Vercel protection, **do not use that deployment for real data** until the platform protection is fixed or a suitable application-level session authentication layer is added.
5. On your phone/other device, sign in through the same approved Vercel account before opening the app. Protection is an access gate, not a replacement for good account security.

References: [Vercel Node.js Functions](https://vercel.com/docs/functions/configuring-functions/runtime), [Vercel Environment Variables](https://vercel.com/docs/environment-variables), [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication), [MongoDB connection pools](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/).

## API overview

All routes are expected to be protected externally by the production Vercel gate.

| Route | Purpose |
|---|---|
| `GET /api/health` | Safe readiness check only |
| `GET /api/bootstrap` | Initial progress and sync metadata |
| `GET /api/progress` | Read progress records |
| `GET /api/progress/:conceptKey` | Read one concept's status and revision |
| `PUT /api/progress/:conceptKey` | Write one status with revision/idempotency checks |
| `GET /api/notes` | Read compact note metadata (content hashes/revisions); `?includeContent=1&limit=10&cursor=...` fetches paginated rich-text for exports |
| `GET /api/notes/:conceptKey` | Read one concept's note |
| `PUT /api/notes/:conceptKey` | Save a Quill Delta with optimistic revision checking |
| `POST /api/migrate` | Validated merge or confirmed replace from a backup/migration |

The official MongoDB Node.js driver is reused across warm function invocations. Routine polling retrieves compact note metadata, while full note Deltas are fetched only for an opened topic or paginated export. API responses avoid secrets and stack traces. Note payloads are bounded and validate formats and link schemes. Progress mutations are per canonical concept; note mutations use revision checks and keep the local draft when a conflict is detected.

## First migration from an older browser-only version

**Important origin detail:** browser local storage belongs to a specific origin (scheme + hostname + port). A Vercel URL cannot directly read local storage from a different GitHub Pages URL, even in the same browser.

If the existing app is on a different domain:

1. Open the old app on the original browser/device that contains your checkmarks/notes.
2. Choose **Data → Export JSON backup** and save the file.
3. Open the protected Vercel app on that device and sign in.
4. Choose **Data → Import JSON backup**, inspect the preview/counts, and select **Merge backup** or **Replace current data**. Replace requires explicit confirmation and triggers a backup first.

If this update is deployed at the *same origin* as the old app, it also detects legacy local storage and presents a migration dialog when appropriate. That dialog shows local/cloud counts, offers a backup first, and requires an explicit import/merge/replace decision. The original browser data is not deleted automatically.

- **Merge** adds local concepts that are absent in cloud; existing cloud values win conflicts, which are counted. This avoids overwriting newer cloud data silently.
- **Replace** replaces cloud progress/notes with the selected browser snapshot after confirmation. Download a backup first.
- **Keep local for now** pauses cloud writes and leaves browser state in place. Reopen/reload the app later to resolve the migration before resuming cloud synchronization.

A fresh phone browser cannot see data held in another browser's local storage. Do the initial export from the browser/device that actually has the old state.

## Sync and notes behavior

- MongoDB is authoritative once initial migration is resolved. The browser keeps a versioned note cache and a durable queue of individual progress changes for offline/retry behavior.
- Progress status clicks update the UI quickly and sync as per-concept mutations. Revalidation runs on focus/visibility and approximately once per minute while active; that is polling, not push-based real-time sync.
- Each canonical concept key has one note. Aliases that share a `concept_key` share progress and notes.
- Notes are stored as structured Quill Delta data, not arbitrary persisted HTML. Link schemes are validated and export rendering is sanitized.
- A concurrent note edit produces a conflict dialog. You can use the cloud version, explicitly overwrite cloud with the local draft, or download a conflict copy. Dismissing the dialog preserves the draft on that browser.
- If the cloud is unreachable, local changes remain in the browser and the UI reports a local/offline/sync status. Do not clear browser data until cloud sync has been confirmed.

## Backup and PDF export

**Export JSON backup** writes a versioned file containing progress, non-empty rich notes, and relevant metadata—not credentials, cookies, or secrets. Import validates known canonical concept keys, status values, note shape, and schema version. It previews adds/replacements/skips/conflicts and does not silently overwrite cloud data.

**Export notes to PDF** opens a print-only document ordered by the current syllabus order with a cover, export date, table of contents, full topic path, headings, formatting, lists, links, code blocks, and callouts. It opens the browser print dialog; choose **Save as PDF** in the browser. It is not an automatic PDF download. If cloud sync cannot be confirmed, the app warns that the export may use local cache/drafts.

## Two-device acceptance checklist

After Vercel protection and Atlas environment variables are configured:

1. Open the protected app on device A and device B with the approved account.
2. On A, change a topic status; after revalidation, verify B shows the same status. Change it on B and verify A updates after revalidation.
3. On A, save a formatted note with a heading, colored text/highlight, list, code block, and callout. Verify it renders after opening the same canonical topic on B.
4. Change the same note on both devices while one device has a stale revision. Confirm the stale device presents a conflict, preserves its draft, and does not silently overwrite cloud.
5. Put a device offline, change statuses/edit a note, reload if appropriate, reconnect, and confirm queued status changes replay and note drafts remain recoverable.
6. Export JSON and import it into a clean test environment; inspect the preview before applying. Open print-to-PDF and verify formatting.
7. In a private unauthenticated browser, verify both `/` and `/api/bootstrap` are blocked. Repeat against the custom domain, if any.

## Current limitations / deployment state

This repository contains the implementation but has not been connected to your Vercel project or Atlas cluster in this workspace. Live database writes, Vercel authentication enforcement, and cross-device behavior still require the setup and acceptance checks above. Do not treat the cloud version as production-safe until unauthenticated API protection has been explicitly verified.
