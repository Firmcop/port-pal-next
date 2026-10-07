REVOKE EXECUTE ON FUNCTION public.sync_attendance_line_to_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_attendance_line_to_job(uuid) TO service_role;