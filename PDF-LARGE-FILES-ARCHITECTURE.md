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

## Immediate decision

Do not raise the current 150-page translation limit yet. The safe next implementation step is a prototype of one small page batch plus temporary object storage and a verified merge path. The current repository configuration does not yet provide that infrastructure.
