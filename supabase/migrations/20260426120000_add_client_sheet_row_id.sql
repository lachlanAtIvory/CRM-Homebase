-- Add sheet_row_id (for n8n idempotent upserts) and notes to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS sheet_row_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS notes        TEXT;
