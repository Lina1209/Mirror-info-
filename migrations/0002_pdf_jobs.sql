-- Mirror-info: metadata for resumable large-PDF jobs.
-- Migration: 0002_pdf_jobs.sql
-- This migration creates metadata tables only. PDF bytes belong in a private R2 bucket.
-- Do not apply to production until the staging R2 binding and API implementation are ready.

CREATE TABLE IF NOT EXISTS pdf_jobs (
    id TEXT PRIMARY KEY,
    capability_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'uploading', 'merging', 'verifying',
                          'completed', 'failed', 'cancelled', 'expired')),
    source_bytes INTEGER NOT NULL CHECK (source_bytes > 0),
    expected_pages INTEGER NOT NULL CHECK (expected_pages > 0),
    batch_count INTEGER NOT NULL CHECK (batch_count > 0),
    total_batch_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_batch_bytes >= 0),
    output_key TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS pdf_jobs_expiry_idx
    ON pdf_jobs(status, expires_at);

CREATE TABLE IF NOT EXISTS pdf_job_batches (
    job_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    first_page INTEGER NOT NULL CHECK (first_page > 0),
    last_page INTEGER NOT NULL CHECK (last_page >= first_page),
    object_key TEXT NOT NULL UNIQUE,
    byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
    sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered', 'uploaded', 'verified', 'failed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (job_id, batch_id),
    FOREIGN KEY (job_id) REFERENCES pdf_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pdf_job_batches_range_idx
    ON pdf_job_batches(job_id, first_page, last_page);

CREATE INDEX IF NOT EXISTS pdf_job_batches_status_idx
    ON pdf_job_batches(job_id, status);
