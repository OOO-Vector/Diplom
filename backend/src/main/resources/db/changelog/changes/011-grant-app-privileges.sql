--liquibase formatted sql

--changeset teamai:011-grant-app-privileges splitStatements:false
-- Prerequisite: database/security/001-bootstrap-roles.sql applied by DBA.
-- Privilege scope is explicit: NEVER grant access to DATABASECHANGELOG tables.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE team_ai_db TO team_ai_app;
GRANT USAGE ON SCHEMA public TO app_read, app_write;

GRANT SELECT ON TABLE
    users, projects, project_members,
    specifications, backlogs, tasks, task_dependencies,
    github_connections, github_issues,
    architectural_decisions, decision_versions, decision_resolutions,
    knowledge_sources, knowledge_chunks,
    ai_operations, chat_sessions, chat_messages, chat_message_sources,
    conflict_checks, conflict_evidence,
    ml_datasets, ml_training_examples, ml_models, ml_predictions,
    review_events, activity_events, outbox_events,
    v_ai_review_stats
TO app_read;

GRANT INSERT, UPDATE, DELETE ON TABLE
    users, projects, project_members,
    specifications, backlogs, tasks, task_dependencies,
    github_connections, github_issues,
    architectural_decisions, decision_versions, decision_resolutions,
    knowledge_sources, knowledge_chunks,
    ai_operations, chat_sessions, chat_messages, chat_message_sources,
    conflict_checks, conflict_evidence,
    ml_datasets, ml_training_examples, ml_models, ml_predictions,
    review_events, activity_events, outbox_events
TO app_write;

-- app_write inherits SELECT through membership in app_read.
-- No schema CREATE, table ALTER/DROP, TRUNCATE, or Liquibase history access.
-- Future tables must receive explicit grants in their own migrations.
