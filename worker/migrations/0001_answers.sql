-- Answers visitors chose to save from the chat page (worker/src/records.ts).
-- Kept for 30 days: the worker's daily cron deletes older rows.
-- No IP address, browser or account is ever stored.
CREATE TABLE answers (
  id TEXT PRIMARY KEY,          -- random; only the page that asked knows it
  chat TEXT NOT NULL,           -- random per chat, made by the page
  turn INTEGER NOT NULL,        -- which answer in the chat, from 1
  at TEXT NOT NULL,             -- ISO timestamp
  followup INTEGER NOT NULL,    -- 1 when it followed up an earlier answer
  question TEXT NOT NULL,       -- the visitor's words
  outcome TEXT NOT NULL,        -- done, empty or failed
  spec TEXT NOT NULL,           -- the final SayShape spec
  problems INTEGER NOT NULL,    -- problems SayShape found in it
  repaired INTEGER NOT NULL,    -- 1 when the one repair ran
  ms INTEGER,                   -- the model's time
  tokens_in INTEGER,
  tokens_out INTEGER,
  model TEXT NOT NULL,
  width INTEGER,                -- the answer's width in CSS px, rounded to 10
  error TEXT,                   -- the message shown, for empty or failed answers
  vote TEXT,                    -- up or down
  note TEXT,                    -- what was wrong, in the visitor's words
  changes INTEGER NOT NULL DEFAULT 0,  -- state changes after it was drawn
  actions INTEGER NOT NULL DEFAULT 0,  -- emit: actions
  screens INTEGER NOT NULL DEFAULT 0   -- screens moved to
);
CREATE INDEX answers_at ON answers (at);
