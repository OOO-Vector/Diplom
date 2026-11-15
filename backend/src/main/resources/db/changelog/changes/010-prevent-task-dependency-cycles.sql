--liquibase formatted sql

--changeset teamai:010-prevent-task-dependency-cycles splitStatements:false

-- Serialize graph modifications per backlog. Advisory locks are transaction-scoped.
-- Applications must use READ COMMITTED for these writes, or implement
-- serialization-failure retries at stricter isolation levels.
CREATE FUNCTION fn_lock_task_dependency_graph()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_new_key bigint;
    v_old_key bigint;
BEGIN
    v_new_key := hashtextextended(NEW.backlog_id::text, 20261115);

    IF TG_OP = 'UPDATE' AND OLD.backlog_id IS DISTINCT FROM NEW.backlog_id THEN
        v_old_key := hashtextextended(OLD.backlog_id::text, 20261115);
        -- Stable lock ordering when moving a dependency between backlogs.
        PERFORM pg_advisory_xact_lock(LEAST(v_old_key, v_new_key));
        IF v_old_key <> v_new_key THEN
            PERFORM pg_advisory_xact_lock(GREATEST(v_old_key, v_new_key));
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(v_new_key);
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_lock_task_dependency_graph
BEFORE INSERT OR UPDATE ON task_dependencies
FOR EACH ROW
EXECUTE FUNCTION fn_lock_task_dependency_graph();

-- A new edge blocking_task -> blocked_task creates a cycle if there already
-- exists a path blocked_task -> ... -> blocking_task.
-- UNION (rather than UNION ALL) guarantees termination even for cyclic data.
CREATE FUNCTION fn_reject_task_dependency_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_cycle boolean;
BEGIN
    -- In a deferred trigger, this edge may already have been removed or moved.
    IF NOT EXISTS (
        SELECT 1
        FROM task_dependencies d
        WHERE d.backlog_id = NEW.backlog_id
          AND d.blocking_task_id = NEW.blocking_task_id
          AND d.blocked_task_id = NEW.blocked_task_id
    ) THEN
        RETURN NULL;
    END IF;

    WITH RECURSIVE reachable(task_id) AS (
        SELECT d.blocked_task_id
        FROM task_dependencies d
        WHERE d.backlog_id = NEW.backlog_id
          AND d.blocking_task_id = NEW.blocked_task_id

        UNION

        SELECT d.blocked_task_id
        FROM task_dependencies d
        JOIN reachable r ON d.blocking_task_id = r.task_id
        WHERE d.backlog_id = NEW.backlog_id
    )
    SELECT EXISTS (
        SELECT 1 FROM reachable WHERE task_id = NEW.blocking_task_id
    ) INTO v_cycle;

    IF v_cycle THEN
        RAISE EXCEPTION
            'Task dependency cycle detected in backlog %: % -> %',
            NEW.backlog_id, NEW.blocking_task_id, NEW.blocked_task_id
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_task_dependencies_acyclic';
    END IF;

    RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER trg_task_dependencies_acyclic
AFTER INSERT OR UPDATE ON task_dependencies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_reject_task_dependency_cycle();

--rollback DROP TRIGGER IF EXISTS trg_task_dependencies_acyclic ON task_dependencies;
--rollback DROP TRIGGER IF EXISTS trg_lock_task_dependency_graph ON task_dependencies;
--rollback DROP FUNCTION IF EXISTS fn_reject_task_dependency_cycle();
--rollback DROP FUNCTION IF EXISTS fn_lock_task_dependency_graph();
