REVOKE ALL ON FUNCTION public.ensure_attendance_week(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_attendance_week(date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_attendance_line(uuid, uuid, numeric, numeric, numeric, uuid, uuid, text, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_attendance_line(uuid, uuid, numeric, numeric, numeric, uuid, uuid, text, uuid, numeric, text) TO authenticated, service_role;