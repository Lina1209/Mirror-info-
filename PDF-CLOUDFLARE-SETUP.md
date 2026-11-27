# Cloudflare setup for large PDF jobs

This is an infrastructure preparation guide. It does not enable uploads, create a bucket, change production bindings, or expose credentials. Complete the setup on a staging environment first.

## Target architecture

- Pages Functions provide the job API.
- D1 stores job and batch metadata only.
- A private R2 bucket stores PDF batch objects and final output.
- Cloudflare Turnstile protects anonymous job creation from automated abuse.
- The server issues short-lived, job-scoped capabilities. The browser never receives an R2 access key or Cloudflare API token.
- A scheduled cleanup task removes expired jobs and their R2 objects.

Recommended names:

| Resource | Name / binding |
| --- | --- |
| R2 bucket | `mirror-info-pdf-temp` |
| Pages R2 binding | `PDF_BUCKET` |
| Existing D1 binding | `DB` |
| Turnstile secret | `TURNSTILE_SECRET` |
| Capability signing secret | `PDF_JOB_SIGNING_SECRET` |
| Allowed origin | exact production/staging site origin, configured server-side |

## 1. Create the private R2 bucket

1. Open Cloudflare Dashboard → R2 Object Storage.
2. Create bucket `mirror-info-pdf-temp`.
3. Keep public access disabled. Do not enable r2.dev public access or a public custom domain.
4. Do not create browser-facing access keys.
5. In the Pages project settings, add an R2 binding named `PDF_BUCKET` pointing to this bucket.
6. Add the binding to the staging environment first. Production binding is a separate deliberate release step.

Use unpredictable server-generated object keys such as `jobs/{jobId}/batches/{batchId}.pdf`; never accept an object key from a request.

## 2. Prepare abuse protection and secrets

1. Create a Cloudflare Turnstile widget for the staging site hostname.
2. Add its public site key to the client configuration; it is not a secret.
3. Add the Turnstile secret as a Pages secret named `TURNSTILE_SECRET`.
4. Generate a cryptographically random signing secret of at least 32 bytes and store it as `PDF_JOB_SIGNING_SECRET`.
5. Never commit either secret to GitHub, JavaScript, `wrangler.toml`, or a public build artifact.
6. Verify Turnstile tokens server-side, including hostname and action. Reject missing, expired, reused, or invalid tokens.
7. Apply per-IP and per-job quotas at the server/edge. Do not trust client-provided limits.

The current project has no verified user authentication for ordinary visitors. Until Turnstile, quotas, and short-lived job capabilities are implemented and tested, the PDF job endpoints must remain disabled.

## 3. D1 metadata schema

The canonical schema is the versioned migration `migrations/0002_pdf_jobs.sql`. It creates only `pdf_jobs`, `pdf_job_batches`, and their indexes. Timestamp columns use ISO-8601 UTC text values with SQLite defaults, matching the migration. D1 stores no PDF bytes.

Apply the migration only to a dedicated staging database after the protected API and private R2 bucket are ready:

```sh
npx wrangler d1 execute YOUR_STAGING_DATABASE --remote --file=./migrations/0002_pdf_jobs.sql
```

Do not copy an alternate schema from this guide: the migration file is the single source of truth. Verify foreign-key enforcement and cascade behavior in staging before enabling job deletion. The migration must not be applied to the existing production orders database during preparation.

## 4. API contract

All routes must reject requests from unexpected origins, validate content type and body size, and return `Cache-Control: no-store`.

- `POST /api/pdf-jobs`: validate Turnstile; enforce source-size/page/job quotas; create a random job ID and a high-entropy capability; store only its hash; return the capability once.
- `POST /api/pdf-jobs/:jobId/batches`: require the capability; register a page interval and expected size; reject overlaps and out-of-range pages.
- Upload: accept only a server-generated object key and a short-lived scoped authorization, or proxy the upload through the Worker with strict byte limits.
- `POST /api/pdf-jobs/:jobId/batches/:batchId/complete`: verify R2 object existence, byte size, SHA-256, and page range; make retries idempotent.
- `POST /api/pdf-jobs/:jobId/finalize`: require verified batches to cover every page exactly once; then start merge and verification.
- `GET /api/pdf-jobs/:jobId`: return minimal status/progress only; never return storage keys or secrets.
- `DELETE /api/pdf-jobs/:jobId`: revoke the capability and schedule deletion of every batch and output object.

A capability must be bound to one job, expire quickly, be compared in constant time where practical, and be rate-limited. Never use a predictable job ID as authorization.

## 5. Cleanup and limits

- Start with conservative staging limits: 50 MB source, 10–20 pages per batch, 100 MB total temporary output per job, one active job per capability, and a short job lifetime.
- Enforce all limits in server code; client-side checks are only usability hints.
- Add a scheduled cleanup process that marks expired jobs and deletes their R2 objects in bounded batches.
- Configure an R2 lifecycle rule as a backstop if the bucket's lifecycle controls support the desired prefix/age policy. Do not rely on lifecycle rules as the only cleanup mechanism.
- Set quotas for concurrent jobs, per-IP creation attempts, total daily bytes, and maximum stored bytes.
- Do not begin a merge until a measured runtime/library compatibility test demonstrates bounded memory.

## 6. Staging acceptance checklist

- [ ] R2 bucket is private; no public object URL works.
- [ ] D1 staging migration applies and foreign-key behavior is verified.
- [ ] Turnstile invalid, expired, and replayed tokens are rejected.
- [ ] Missing/incorrect capability cannot read, upload, finalize, or delete another job.
- [ ] Oversized upload and forged content length are rejected.
- [ ] Duplicate, overlapping, missing, and out-of-order page ranges cannot finalize.
- [ ] Digest mismatch and truncated uploads cannot be marked verified.
- [ ] Retried completion/finalize calls are idempotent.
- [ ] Cancellation and expiry remove every temporary object.
- [ ] No secret or signed URL appears in browser bundles, logs, or status responses.
- [ ] Two-batch PDF merge preserves the required geometry and links and passes output reopening checks.
- [ ] Desktop and Android tests record peak memory, duration, output size, and recovery behavior.

## Current status

The repository currently has a D1 binding for orders only. No PDF R2 binding, Turnstile secret, PDF job API, scheduled cleanup, or PDF merger is enabled by this document. Do not raise the existing 150-page browser translation limit until the staging checklist passes with representative files.

## Repository migration file

The proposed schema is now kept as the versioned migration `migrations/0002_pdf_jobs.sql`. This file creates only `pdf_jobs`, `pdf_job_batches`, and their indexes; it does not alter or delete the existing order tables.

Apply it to a **staging D1 database only after** the private R2 bucket and protected API are configured:

```sh
npx wrangler d1 execute mirror-info-orders-staging --remote --file=./migrations/0002_pdf_jobs.sql
```

Replace the example database name with the actual staging database. Do not apply this migration to production as part of the current preparation. The SQL was syntax-tested against SQLite, including page-range CHECK constraints and cascading deletion of batch metadata. This local test does not replace a remote D1 staging test.
