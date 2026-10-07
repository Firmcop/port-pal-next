DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('can_manage_payroll','attendance_line_amount','recalc_attendance_week',
      'ensure_attendance_week','upsert_attendance_line','delete_attendance_line','approve_attendance_week',
      'pay_attendance_week','generate_monthly_wage_payslips','set_employee_code')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('ensure_attendance_week','upsert_attendance_line','delete_attendance_line',
      'approve_attendance_week','pay_attendance_week','generate_monthly_wage_payslips','can_manage_payroll')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;