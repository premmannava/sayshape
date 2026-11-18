-- The last 7 days of saved chat answers. Run with: npm run report (in worker/).

-- How it went.
SELECT
  COUNT(*) AS answers,
  COUNT(DISTINCT chat) AS chats,
  ROUND(100.0 * SUM(outcome = 'done') / COUNT(*), 1) AS drawn_pct,
  ROUND(100.0 * SUM(repaired) / COUNT(*), 1) AS repaired_pct,
  ROUND(100.0 * SUM(problems > 0) / COUNT(*), 1) AS with_problems_pct,
  ROUND(100.0 * SUM(changes + actions + screens > 0) / SUM(outcome = 'done'), 1) AS used_pct,
  ROUND(100.0 * SUM(vote = 'up') / NULLIF(SUM(vote IS NOT NULL), 0), 1) AS thumbs_up_pct,
  SUM(vote IS NOT NULL) AS votes,
  ROUND(100.0 * SUM(width < 480) / COUNT(*), 1) AS phone_pct
FROM answers WHERE at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days');

-- Answers that got a follow-up: the next turn's words show whether it was a fix or more.
SELECT a.question AS asked, b.question AS then_asked, a.vote
FROM answers a JOIN answers b ON b.chat = a.chat AND b.turn = a.turn + 1
WHERE a.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days') ORDER BY a.at DESC LIMIT 50;

-- Thumbs down, with what people said.
SELECT at, question, note, outcome, problems FROM answers
WHERE vote = 'down' AND at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days') ORDER BY at DESC LIMIT 50;

-- Answers that drew nothing or failed.
SELECT at, question, outcome, error FROM answers
WHERE outcome != 'done' AND at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days') ORDER BY at DESC LIMIT 50;
