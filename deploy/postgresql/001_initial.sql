-- Apply through the reviewed migration identity with the application owner role.
BEGIN;
CREATE TABLE public.solutiondeploy_schema (
    app_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE public.solutiondeploy_import (
    app_id TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL,
    validation JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.favorites (
    team_id TEXT PRIMARY KEY CHECK (length(team_id) BETWEEN 1 AND 80),
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public.solutiondeploy_schema(app_id, version) VALUES ('team-scoreboard', 1);
INSERT INTO public.favorites(team_id) VALUES
    ('134927'), ('134949'), ('134873'), ('135279'), ('purdue-all');
COMMIT;
