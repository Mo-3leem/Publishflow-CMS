-- PublishFlow CMS — initial schema.
-- Authoritative DDL: CHECK constraints, partial indexes and collations are all
-- enforced by the database, not only by TypeScript validation.

CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
    email           TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'AUTHOR'
                    CHECK (role IN ('ADMIN', 'EDITOR', 'AUTHOR')),
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at   TEXT
);
--> statement-breakpoint

CREATE TABLE sessions (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,
    csrf_nonce      TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      TEXT NOT NULL,
    last_seen_at    TEXT,
    revoked_at      TEXT,
    user_agent      TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE media_assets (
    id              INTEGER PRIMARY KEY,
    original_name   TEXT NOT NULL,
    storage_key     TEXT NOT NULL UNIQUE,
    mime_type       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL CHECK (size_bytes > 0),
    width           INTEGER CHECK (width IS NULL OR width > 0),
    height          INTEGER CHECK (height IS NULL OR height > 0),
    alt_text        TEXT,
    uploaded_by     INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      TEXT,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE categories (
    id              INTEGER PRIMARY KEY,
    parent_id       INTEGER,
    title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 100),
    slug            TEXT NOT NULL COLLATE NOCASE UNIQUE,
    description     TEXT NOT NULL DEFAULT '',
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT,
    CHECK (parent_id IS NULL OR parent_id <> id)
);
--> statement-breakpoint

CREATE TABLE posts (
    id                  INTEGER PRIMARY KEY,
    category_id         INTEGER NOT NULL,
    author_id           INTEGER NOT NULL,
    featured_image_id   INTEGER,
    subject             TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 3 AND 200),
    slug                TEXT NOT NULL COLLATE NOCASE UNIQUE,
    excerpt             TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL,
    source_url          TEXT,
    status              TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED')),
    reads_count         INTEGER NOT NULL DEFAULT 0 CHECK (reads_count >= 0),
    seo_title           TEXT,
    seo_description     TEXT,
    scheduled_at        TEXT,
    published_at        TEXT,
    version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at          TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (featured_image_id) REFERENCES media_assets(id) ON DELETE SET NULL
);
--> statement-breakpoint

CREATE TABLE post_revisions (
    id                  INTEGER PRIMARY KEY,
    post_id             INTEGER NOT NULL,
    version             INTEGER NOT NULL,
    category_id         INTEGER NOT NULL,
    featured_image_id   INTEGER,
    subject             TEXT NOT NULL,
    slug                TEXT NOT NULL,
    excerpt             TEXT NOT NULL,
    content             TEXT NOT NULL,
    source_url          TEXT,
    status              TEXT NOT NULL,
    seo_title           TEXT,
    seo_description     TEXT,
    scheduled_at        TEXT,
    published_at        TEXT,
    saved_by            INTEGER NOT NULL,
    change_summary      TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (featured_image_id) REFERENCES media_assets(id) ON DELETE SET NULL,
    FOREIGN KEY (saved_by) REFERENCES users(id) ON DELETE RESTRICT,
    UNIQUE (post_id, version)
);
--> statement-breakpoint

CREATE TABLE workflow_events (
    id              INTEGER PRIMARY KEY,
    post_id         INTEGER NOT NULL,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    actor_id        INTEGER NOT NULL,
    comment         TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE menus (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    location        TEXT NOT NULL UNIQUE CHECK (location IN ('HEADER', 'FOOTER')),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE TABLE menu_items (
    id                  INTEGER PRIMARY KEY,
    menu_id             INTEGER NOT NULL,
    parent_id           INTEGER,
    title               TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
    item_type           TEXT NOT NULL CHECK (item_type IN ('CUSTOM', 'POST', 'CATEGORY')),
    url                 TEXT,
    post_id             INTEGER,
    category_id         INTEGER,
    position            INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    open_in_new_tab     INTEGER NOT NULL DEFAULT 0 CHECK (open_in_new_tab IN (0, 1)),
    is_visible          INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (
        (item_type = 'CUSTOM' AND url IS NOT NULL AND post_id IS NULL AND category_id IS NULL)
        OR
        (item_type = 'POST' AND url IS NULL AND post_id IS NOT NULL AND category_id IS NULL)
        OR
        (item_type = 'CATEGORY' AND url IS NULL AND post_id IS NULL AND category_id IS NOT NULL)
    )
);
--> statement-breakpoint

CREATE TABLE site_settings (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    site_name               TEXT NOT NULL,
    site_description        TEXT NOT NULL DEFAULT '',
    logo_media_id           INTEGER,
    default_seo_title       TEXT,
    default_seo_description TEXT,
    posts_per_page          INTEGER NOT NULL DEFAULT 10
                            CHECK (posts_per_page BETWEEN 1 AND 100),
    timezone                TEXT NOT NULL DEFAULT 'UTC',
    updated_by              INTEGER,
    updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (logo_media_id) REFERENCES media_assets(id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint

CREATE TABLE post_views (
    post_id         INTEGER NOT NULL,
    viewer_hash     TEXT NOT NULL,
    viewed_on       TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, viewer_hash, viewed_on),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE audit_logs (
    id              INTEGER PRIMARY KEY,
    actor_id        INTEGER,
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    metadata_json   TEXT,
    request_id      TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint

-- Bounded, database-backed login throttling for this single-instance deployment.
CREATE TABLE login_attempts (
    id              INTEGER PRIMARY KEY,
    attempt_key     TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE INDEX idx_sessions_user_active
    ON sessions(user_id, expires_at, revoked_at);
--> statement-breakpoint

CREATE INDEX idx_categories_parent
    ON categories(parent_id, is_active);
--> statement-breakpoint

CREATE INDEX idx_posts_admin_list
    ON posts(status, updated_at DESC);
--> statement-breakpoint

CREATE INDEX idx_posts_author
    ON posts(author_id, status, updated_at DESC);
--> statement-breakpoint

CREATE INDEX idx_posts_category
    ON posts(category_id, status, published_at DESC);
--> statement-breakpoint

CREATE INDEX idx_posts_public
    ON posts(status, published_at DESC)
    WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX idx_revisions_post
    ON post_revisions(post_id, version DESC);
--> statement-breakpoint

CREATE INDEX idx_workflow_post
    ON workflow_events(post_id, created_at DESC);
--> statement-breakpoint

CREATE INDEX idx_menu_items_order
    ON menu_items(menu_id, parent_id, position);
--> statement-breakpoint

CREATE INDEX idx_post_views_date
    ON post_views(viewed_on);
--> statement-breakpoint

CREATE INDEX idx_audit_created
    ON audit_logs(created_at DESC);
--> statement-breakpoint

CREATE INDEX idx_login_attempts_key
    ON login_attempts(attempt_key, created_at);
--> statement-breakpoint

INSERT INTO site_settings (
    id,
    site_name,
    site_description,
    posts_per_page
) VALUES (
    1,
    'PublishFlow',
    'A lightweight editorial CMS',
    10
);
--> statement-breakpoint

INSERT INTO menus (name, location) VALUES ('Main Navigation', 'HEADER');
--> statement-breakpoint

INSERT INTO menus (name, location) VALUES ('Footer Navigation', 'FOOTER');
