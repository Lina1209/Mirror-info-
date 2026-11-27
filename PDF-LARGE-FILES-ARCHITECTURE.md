# Large PDF processing architecture (planning note)

## Current implementation verified on this branch

- The browser loads PDF.js 3.11.174 and jsPDF 2.5.2 from CDN.
- PDF translation reconstructs every page as a JPEG-backed page in one jsPDF document. The page canvas is released after each page, but jsPDF retains the accumulated output pages until the final Blob is created.
- Translation currently enforces: 50 MB input, 150 pages, 140 million total raster pixels, and 16 million pixels per rendered page.
- The read-only PDF text/OCR pass supports up to 1,000 pages, 100 MB input, and 15 million extracted characters.
- The Pages configuration currently declares a D1 binding only. D1 is used for order records; it is not a suitable place to store large PDF binaries.
- Existing Pages Functions cover orders, admin order access, and health checks. No PDF processing, object-storage, chunk-upload, or merge endpoint was found in the repository tree.
- No pdf-lib or other PDF merge dependency is bundled in the repository. The current PDF writer is jsPDF 2.5.2.

## Why simply raising the page limit is unsafe

The 150-page limit is not the only constraint. A translation run holds the source PDF, PDF.js state, the current render canvas, OCR/translation intermediates, and a growing jsPDF output. Raising only the page count could cause mobile browser memory exhaustion or a tab crash. The 140-million-pixel budget also limits total raster work independently of page count.

The current output is raster-first: original vector/text streams, tagged accessibility structure, form behavior, attachments, signatures, and some annotation behavior cannot be preserved by this reconstruction approach. These limitations must remain visible to users.

## Recommended staged design for 300–500+ page books

### Stage 1 — bounded page batches

1. Process a bounded number of pages per batch, with both page-count and pixel-budget limits.
2. Persist each completed batch as a Blob before starting the next batch.
3. Keep only the current page canvas and current batch's working buffers alive; release PDF.js page resources after each page.
4. Add cancellation and cleanup paths for every batch, including object URLs and temporary storage.
5. Resume only from verified batch records; never present a partial file as complete.

This reduces peak page-rendering memory but does not, by itself, solve final PDF assembly.

### Stage 2 — durable temporary storage

Use Cloudflare R2 (or another object store) for temporary batch artifacts, with:
- short-lived, scoped upload/download authorization;
- per-job random identifiers and ownership checks;
- maximum file, batch, and total-job byte limits;
- expiration/cleanup lifecycle rules;
- no PDF binary data in D1 (D1 should hold only job metadata and status).

The repository currently has no R2 binding or upload/merge route. These must be configured before implementation. Do not add secrets or credentials to browser code.

### Stage 3 — merge and verify

Select and pin a maintained PDF merge library only after a compatibility spike against the actual output format and Cloudflare Workers runtime. Merge batches in a bounded-memory strategy, verify page count and geometry, then verify links, metadata, outline, and text layer where supported. Preserve explicit warnings for features the raster workflow cannot carry across.

A single in-memory merge of all chunks may recreate the same memory problem. If the chosen runtime/library cannot stream or incrementally merge safely, use a dedicated processing runtime with adequate memory rather than pretending that R2 alone solves it.

### Stage 4 — gradual capacity rollout

- First validate representative 20-, 50-, 100-, 300-, and 500-page files on desktop and Android.
- Measure peak memory, output size, elapsed time, cancellation behavior, and recovery after network interruption.
- Raise limits only from measured results. Keep page count and raster-pixel limits separate.
- Retain the existing conservative browser-only path as fallback until the batch pipeline is proven.

## Critical runtime constraint: batch merge is not automatically memory-bounded

Splitting OCR/translation into page batches and storing those batches in R2 reduces the browser's working set, but a final merge with `pdf-lib` is still an in-memory operation: the source documents are parsed into object graphs and the destination document is serialized as a complete byte array. R2 is object storage, not a streaming PDF object merger. Do not claim that this design supports 300–500 pages merely because the translation stage is batched.

Cloudflare Workers currently document a 128 MB memory limit per isolate on both Free and Paid plans. The documented CPU allowance differs sharply: Free is 10 ms per request; Paid defaults to 30 seconds and can be raised to 5 minutes. PDF parsing/rasterization/merging is CPU- and memory-intensive, so a Pages Function is not an appropriate place for a long, monolithic merge job. Confirm the actual account plan and runtime limits before selecting any Cloudflare execution path. See the official [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Before production design is approved, compare these options with measured peak memory:
1. A genuinely incremental PDF writer that writes page objects and cross-reference data without holding the entire final document in memory (must be validated against PDF readers and all required metadata/link features).
2. A separate container/server job with explicit memory, CPU, timeout, and disk quotas, while Cloudflare handles authorization, job state, and private object storage.
3. A documented product cap based on tested device/server resources if neither path is economically viable.

The `pdf-lib` browser spike is only a feature-compatibility experiment. It is not a production merger, a streaming writer, or evidence of Cloudflare Workers suitability. Never raise the current 150-page translation cap until the chosen finalization architecture passes representative memory, time, cancellation, retry, and document-integrity tests.

## PDF merge compatibility spike (test harness added)

An isolated browser harness is available at `tests/pdf-merge-compatibility.html`. It pins the repository's current jsPDF 2.5.2 and PDF.js 3.11.174 versions plus pdf-lib 1.17.1, creates two small independent PDF batches, merges their pages with `PDFDocument.copyPages`, then reopens the result with PDF.js.

The harness checks:
- four-page output from two two-page inputs;
- portrait and landscape geometry for both source batches;
- extractable text on all four pages;
- external URI targets from both batches;
- internal link destination resolution and exact expected target page after concatenation (batch A page 2 and batch B page 4);
- merged title metadata and successful PDF.js reopening.

This is an isolated compatibility experiment, not a production merger. GitHub Actions run `45975966177` completed successfully in Chromium on 2026-11-27. It verified four merged pages, portrait/landscape dimensions, extractable text, two external URI links, exact internal targets (source page 1 → merged page 2 and source page 3 → merged page 4), metadata, and PDF.js reopening. A follow-up Chromium run `45976274252` also passed: `/Rotate` values of 90° and 270° survived copying and merging, and the test separately verified page boxes independent of rotation. Cross-batch links, bookmarks/outlines, forms, signatures, attachments, tagged structure, large-file memory, and Cloudflare Workers compatibility remain unverified. The test page is not loaded by the production app and does not change the PDF translation path.

## Immediate decision

Do not raise the current 150-page translation limit yet. The safe next implementation step is a prototype of one small page batch plus temporary object storage and a verified merge path. The current repository configuration does not yet provide that infrastructure.

## Implementation contract before enabling batch mode

The browser must never receive Cloudflare account credentials or a long-lived R2 key. A trusted Pages Function/Worker creates a job and issues narrowly scoped, short-lived upload authorization for one expected batch object. D1 stores job metadata only; R2 stores binary batch objects.

Suggested job lifecycle:

1. `POST /api/pdf-jobs` — validate authorization, source size, requested page range, and quota; create a random job ID and expiry.
2. `POST /api/pdf-jobs/:jobId/batches` — register a batch with its page interval, expected byte limit, and content digest before upload.
3. Upload the batch to a private R2 key through short-lived authorization or a Worker proxy with strict byte limits. Never accept a caller-supplied R2 key.
4. `POST /api/pdf-jobs/:jobId/batches/:batchId/complete` — verify object existence, byte size, digest, page interval, and idempotency before marking the batch complete.
5. `POST /api/pdf-jobs/:jobId/finalize` — accept only a complete, non-overlapping, gap-free set of batches; start merge/verification in a runtime with a measured memory budget.
6. `GET /api/pdf-jobs/:jobId` — return status and progress, not storage credentials. A final download URL must be short-lived and scoped to the completed output.
7. `DELETE /api/pdf-jobs/:jobId` — cancel and schedule deletion of every batch and output object.

Required safeguards:

- Bind every job to an authenticated owner or an unguessable, revocable capability; enforce ownership on every endpoint.
- Enforce maximum source bytes, per-batch bytes, batch count, total stored bytes, concurrent jobs, and job lifetime on the server.
- Validate page ranges as positive integers; reject overlap, gaps, duplicate completion, and batches from another job.
- Verify SHA-256 and byte size after upload. Treat browser-provided filenames and MIME types as untrusted.
- Make completion/finalization idempotent so retrying after a network interruption cannot duplicate pages.
- Expire abandoned jobs automatically and clean up partial uploads and failed outputs.
- Do not expose R2 object keys, signed URLs, or capability tokens in logs, D1 errors, or public status responses.
- Do not mark a job complete until the merged PDF has been reopened and its page count and page geometry have been checked.
- Keep the browser-only 150-page path unchanged until this server pipeline passes real-file tests.

## Compatibility spike acceptance criteria

Before selecting a merger, build an isolated test with the exact PDF.js/jsPDF versions already used here. Demonstrate that a two-batch document can be merged without losing page dimensions, rotation, external links, internal destinations, and promised metadata. Measure peak memory in the intended Cloudflare runtime. If the merger requires loading all source and output bytes into one large buffer, reject it for the 300–500+ page target and use a dedicated processing runtime instead.

No R2 binding, endpoint, or merge dependency is enabled by this planning note.

## Automated browser check

The isolated merge spike now has a Playwright runner at `tests/run-pdf-merge-compatibility.mjs` and a GitHub Actions workflow at `.github/workflows/pdf-merge-compatibility.yml`.

The workflow launches Chromium, serves the repository over localhost, loads the pinned jsPDF/pdf-lib/PDF.js browser harness, runs the assertions, and fails the job if the harness reports `RESULT: FAIL` or a browser page error occurs. It runs for relevant pull-request and feature-branch changes and can also be started manually from the GitHub Actions interface.

This automation validates only the small synthetic merge fixture. It does not test production translation, large-file memory use, Cloudflare Workers, OCR fidelity, forms, signatures, bookmarks, or real customer documents. A green result must not be interpreted as approval to raise the 150-page production cap.


## Verified compatibility evidence

- Run `45975966177` — **success** (Chromium; commit `0742ff3`). Internal link destinations were verified at zero-based page indexes 1 and 3, with no broken internal links.
- Run `45976274252` — **success** (commit `5bdd764`). Explicit 90°/270° page rotations survived the merge; the test measured unrotated page boxes separately from rotation.
- Bookmark/outline preservation is still an open requirement. The current `copyPages` spike does not copy catalog-level outline trees; do not imply that it does. Add a dedicated fixture and test before claiming bookmark support.


## Remaining PDF feature gaps after the passing small-file tests

The current test proves only the listed page-level properties for synthetic files. It does not establish preservation of PDF outlines/bookmarks or named destinations, form fields, digital signatures, embedded files, tagged accessibility structure, or arbitrary annotations. These features must be tested separately against representative source PDFs. Until then, the application must not promise that PDF bookmarks or interactive form features survive translation or merge. The successful Cloudflare Pages result for this branch is a **preview deployment**, not a production deployment; it does not change the production `main` site.


## PDF outline/bookmark compatibility fixture (in progress)

The browser harness now creates a simple two-level outline tree in each source PDF, reads the source outline titles and hierarchy, reconstructs the combined outline tree in the merged document, and remaps each outline destination to the corresponding copied page. The expected result is four outline entries: one chapter and one nested section for each batch, targeting merged page indexes 0, 1, 2, and 3. This is a deliberately narrow synthetic fixture.

This test does **not** yet prove preservation of arbitrary real-world PDF outlines. It does not cover named destinations, non-page actions, open/closed state, outline color/style flags, Unicode edge cases, malformed trees, or deeply nested structures. The prototype rebuilds a simple outline hierarchy; it is not a byte-for-byte copy of all outline dictionary properties. Wait for the automated Chromium run before recording it as verified.


## Verified synthetic PDF outline transfer

GitHub Actions run `45976879708` completed successfully in Chromium on 2026-11-27 (commit `596ddf1`). The fixture creates a two-level outline in each of two source PDFs, reconstructs the combined outline hierarchy in the merged PDF, and remaps chapter/section destinations to the copied page references. PDF.js reopened the result and verified four entries:
- Batch A chapter → merged page 1; nested Batch A section → merged page 2.
- Batch B chapter → merged page 3; nested Batch B section → merged page 4.

The same run also passed the existing four-page, geometry, rotation, text extraction, external URI, internal link, and metadata assertions.

**Scope warning:** this verifies only the synthetic outline shape created by the harness and the tested page-destination mapping. It does not establish preservation of arbitrary source outline dictionaries or all real-world PDF bookmark variants. Named destinations, remote/URI actions, open-state flags, styles/colors, malformed outline trees, unusual Unicode titles, forms, signatures, attachments, and tagged structure remain unverified. The test reconstructs a simple outline hierarchy; it is not evidence of full PDF feature preservation or production merge readiness.


## Verified named-destination merge fixture

The next browser fixture adds a PDF catalog name tree containing a named page destination to each source batch. The same key is intentionally used in both inputs to exercise collision handling: the merge prototype prefixes imported names with `batch-a-` and `batch-b-`, remaps each destination's page reference, and then asks PDF.js to resolve both names in the merged output. Expected destinations are merged page 1 and merged page 3.

The fixture is committed in `tests/pdf-merge-compatibility.html` (commits `a84fff7` and `c74665c`). GitHub Actions run `45977104047` completed successfully in Chromium on 2026-11-27. PDF.js resolved the colliding source keys after namespacing: `batch-a-chapter-start` → merged page 1 and `batch-b-chapter-start` → merged page 3. The fixture validates this catalog name-tree shape, not every possible named destination encoding or annotation action form.


## Next PDF compatibility boundary: AcroForms

The current merge harness uses `PDFDocument.copyPages`. It verifies page-level annotations and navigation structures, but it does not yet establish that document-level AcroForm field dictionaries, field names, widget appearances, calculation order, or form actions survive. Treat interactive form preservation as unsupported/unverified until a dedicated source-PDF form fixture and post-merge field/value/appearance assertions pass. A copied widget annotation alone is not proof that the AcroForm catalog and field tree are intact.


## AcroForm limitation observed in Chromium

GitHub Actions run `45977262548` (commit `2e51484`) completed successfully, but the result is a compatibility finding, not evidence of form preservation: the source PDF contained one text field (`batchA.sampleField`), while PDF.js reported **0 AcroForm fields** after the two batches were merged with `PDFDocument.copyPages`. The page-level merge test still passed. This confirms that the current copyPages-only merge path must not be described as preserving interactive PDF forms.

A follow-up fixture (commit `f6575d8`) makes this loss an explicit expected assertion and adds highlight annotations to both source batches to test whether page-level text markup annotations survive. Its result is pending. Even if highlights pass, that does not imply support for AcroForms, widgets, signatures, attachments, or other catalog-level structures.

Product implication: until a dedicated field-tree reconstruction strategy is implemented and tested, interactive forms must be marked unsupported/unverified in any PDF merge/translation workflow; do not silently promise that filled forms remain editable.
