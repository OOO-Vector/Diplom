
--liquibase formatted sql

--changeset teamai:003-core-ownership splitStatements:false

-- Each project must have exactly one Owner at transaction commit.
-- Migration 002 already prevents multiple Owners.

CREATE OR REPLACE FUNCTION fn_check_project_has_owner(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_owner_count integer;
BEGIN
    PERFORM 1
    FROM projects
    WHERE id = p_project_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT count(*) INTO v_owner_count
    FROM project_members
    WHERE project_id = p_project_id
      AND role = 'owner';

    IF v_owner_count <> 1 THEN
        RAISE EXCEPTION
            'Project % must have exactly one Owner (found %)',
            p_project_id, v_owner_count
            USING ERRCODE = '23514',
                  CONSTRAINT = 'ck_project_exactly_one_owner';
    END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION fn_check_owner_after_project_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    PERFORM fn_check_project_has_owner(NEW.id);
    RETURN NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION fn_check_owner_after_membership_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM fn_check_project_has_owner(NEW.project_id);

    ELSIF TG_OP = 'DELETE' THEN
        PERFORM fn_check_project_has_owner(OLD.project_id);

    ELSE
        PERFORM fn_check_project_has_owner(OLD.project_id);

        IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
            PERFORM fn_check_project_has_owner(NEW.project_id);
        END IF;
    END IF;

    RETURN NULL;
END;
$function$;


CREATE CONSTRAINT TRIGGER trg_project_must_have_owner
AFTER INSERT ON projects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_check_owner_after_project_insert();


CREATE CONSTRAINT TRIGGER trg_membership_must_preserve_owner
AFTER INSERT OR UPDATE OR DELETE ON project_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_check_owner_after_membership_change();


--rollback DROP TRIGGER IF EXISTS trg_membership_must_preserve_owner ON project_members;
--rollback DROP TRIGGER IF EXISTS trg_project_must_have_owner ON projects;
--rollback DROP FUNCTION IF EXISTS fn_check_owner_after_membership_change();
--rollback DROP FUNCTION IF EXISTS fn_check_owner_after_project_insert();
--rollback DROP FUNCTION IF EXISTS fn_check_project_has_owner(uuid);
