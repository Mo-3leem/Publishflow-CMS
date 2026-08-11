-- FTS5 full-text index over posts (subject, excerpt, content).
--
-- Tokenizer: `unicode61` with diacritic folding, plus `porter` stemming so that
-- "publishing" matches "publish". `content=''` is intentionally NOT used — this is
-- an external-content table (`content='posts'`) so the index stores only the
-- inverted index and reads columns back from `posts` on demand, which keeps the
-- database smaller and prevents the two copies from drifting.
--
-- This migration is applied conditionally by the migration runner: if the bundled
-- SQLite build has no FTS5 module, it is skipped and search falls back to a
-- parameterised LIKE query (see src/server/services/search-service.ts).

CREATE VIRTUAL TABLE posts_fts USING fts5(
    subject,
    excerpt,
    content,
    content='posts',
    content_rowid='id',
    tokenize="porter unicode61 remove_diacritics 2"
);
--> statement-breakpoint

CREATE TRIGGER posts_fts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, subject, excerpt, content)
    VALUES (new.id, new.subject, new.excerpt, new.content);
END;
--> statement-breakpoint

CREATE TRIGGER posts_fts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, subject, excerpt, content)
    VALUES ('delete', old.id, old.subject, old.excerpt, old.content);
END;
--> statement-breakpoint

CREATE TRIGGER posts_fts_au AFTER UPDATE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, subject, excerpt, content)
    VALUES ('delete', old.id, old.subject, old.excerpt, old.content);
    INSERT INTO posts_fts(rowid, subject, excerpt, content)
    VALUES (new.id, new.subject, new.excerpt, new.content);
END;
--> statement-breakpoint

-- Backfill any rows that already exist (no-op on a fresh database).
INSERT INTO posts_fts(rowid, subject, excerpt, content)
SELECT id, subject, excerpt, content FROM posts;
