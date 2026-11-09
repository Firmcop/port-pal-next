-- =====================================================================
-- Staff tasks in weekly attendance (9 Nov 2026).
--
-- Agreed with Firmcop:
--  * tasks are optional; a person can have several on the same day;
--  * each task can be linked to a conversion job and/or a project;
--  * staff sign the printed task sheet; the supervisor then records each
--    task as complete or incomplete (with a reason) in the app;
--  * tasks record performance only: pay stays on attendance.
-- An incomplete task can be carried over to a later day (carried_from_id).
-- The two old conversion_tasks rows are copied in; the conversion page now
-- reads work_tasks.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.work_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  assignee_name text,                 -- only for tasks not tied to a staff record
  work_date date NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  details text,
  conversion_id uuid REFERENCES public.container_conversions(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete', 'incomplete')),
  incomplete_reason text,
  sheet_signed boolean NOT NULL DEFAULT false,   -- staff signed the printed sheet
  recorded_by uuid,
  recorded_at timestamptz,
  carried_from_id uuid REFERENCES public.work_tasks(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_tasks_reason_when_incomplete CHECK (status <> 'incomplete' OR length(btrim(coalesce(incomplete_reason, ''))) > 0),
  CONSTRAINT work_tasks_has_assignee CHECK (employee_id IS NOT NULL OR assignee_name IS NOT NULL)
);
COMMENT ON TABLE public.work_tasks IS 'Daily staff tasks (HR > Attendance > Tasks). Performance record only; pay comes from attendance_lines.';

CREATE INDEX IF NOT EXISTS work_tasks_org_date_idx ON public.work_tasks (organization_id, work_date);
CREATE INDEX IF NOT EXISTS work_tasks_employee_idx ON public.work_tasks (employee_id, work_date);
CREATE INDEX IF NOT EXISTS work_tasks_conversion_idx ON public.work_tasks (conversion_id) WHERE conversion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_tasks_project_idx ON public.work_tasks (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_tasks_carried_from_idx ON public.work_tasks (carried_from_id) WHERE carried_from_id IS NOT NULL;

-- who recorded a status, and when; a job's project follows the job
CREATE OR REPLACE FUNCTION public.trg_work_tasks_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'complete' THEN NEW.incomplete_reason := NULL; END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.incomplete_reason IS DISTINCT FROM OLD.incomplete_reason THEN
    IF NEW.status = 'open' THEN
      NEW.recorded_by := NULL; NEW.recorded_at := NULL;
    ELSE
      NEW.recorded_by := auth.uid(); NEW.recorded_at := now();
    END IF;
  END IF;
  IF NEW.project_id IS NULL AND NEW.conversion_id IS NOT NULL THEN
    SELECT project_id INTO NEW.project_id FROM container_conversions WHERE id = NEW.conversion_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_work_tasks_stamp
BEFORE INSERT OR UPDATE ON public.work_tasks
FOR EACH ROW EXECUTE FUNCTION public.trg_work_tasks_stamp();

ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;

-- read: attendance and production people of the company
CREATE POLICY work_tasks_select ON public.work_tasks FOR SELECT USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr_manager')
    OR public.has_role(auth.uid(), 'production_manager') OR public.has_role(auth.uid(), 'mr_supervisor')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_permission(auth.uid(), 'hrm_attendance', 'view'::app_action)
    OR public.can_view_module(auth.uid(), 'manufacturing'))));

-- write: supervisors (HR, production, M&R) and admins
CREATE POLICY work_tasks_insert ON public.work_tasks FOR INSERT WITH CHECK (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr_manager')
    OR public.has_role(auth.uid(), 'production_manager') OR public.has_role(auth.uid(), 'mr_supervisor')
    OR public.can_write_module(auth.uid(), 'manufacturing'))));
CREATE POLICY work_tasks_update ON public.work_tasks FOR UPDATE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr_manager')
    OR public.has_role(auth.uid(), 'production_manager') OR public.has_role(auth.uid(), 'mr_supervisor')
    OR public.can_write_module(auth.uid(), 'manufacturing'))))
  WITH CHECK (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY work_tasks_delete ON public.work_tasks FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr_manager')
    OR public.has_role(auth.uid(), 'production_manager'))));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_tasks TO authenticated;

-- old conversion tasks -> work_tasks (kept in conversion_tasks too)
INSERT INTO public.work_tasks (id, organization_id, employee_id, assignee_name, work_date, title, conversion_id,
                               status, created_at)
SELECT t.id, t.organization_id,
       (SELECT e.id FROM employees e WHERE e.organization_id = t.organization_id
           AND lower(e.name) = lower(btrim(regexp_replace(t.assigned_to, '\s*\(.*\)\s*$', ''))) LIMIT 1),
       t.assigned_to,
       (coalesce(t.start_time, t.created_at) AT TIME ZONE 'Africa/Nairobi')::date,
       t.task_name, t.conversion_id,
       CASE WHEN t.status IN ('completed', 'done', 'complete') THEN 'complete' ELSE 'open' END,
       t.created_at
  FROM public.conversion_tasks t
 WHERE t.task_name IS NOT NULL AND btrim(t.task_name) <> '' AND t.assigned_to IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- attendance clerks (hrm_attendance create/edit) record tasks too
DROP POLICY IF EXISTS work_tasks_insert ON public.work_tasks;
DROP POLICY IF EXISTS work_tasks_update ON public.work_tasks;
CREATE POLICY work_tasks_insert ON public.work_tasks FOR INSERT WITH CHECK (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr_manager')
    OR public.has_role(auth.uid(), 'production_manager') OR public.has_role(auth.uid(), 'mr_supervisor')
    OR public.has_permission(auth.uid(), 'hrm_attendance', 'create'::app_action)
    OR public.can_write_module(auth.uid(), 'manufacturing'))));
CREATE POLICY work_tasks_update ON public.work_tasks FOR UPDATE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr_manager')
    OR public.has_role(auth.uid(), 'production_manager') OR public.has_role(auth.uid(), 'mr_supervisor')
    OR public.has_permission(auth.uid(), 'hrm_attendance', 'edit'::app_action)
    OR public.can_write_module(auth.uid(), 'manufacturing'))))
  WITH CHECK (organization_id = public.current_org_id() OR public.is_platform_admin());
