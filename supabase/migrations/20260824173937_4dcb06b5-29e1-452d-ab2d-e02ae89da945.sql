
REVOKE ALL ON FUNCTION public.apply_loan_payments_to_schedule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_loan_schedule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_loan_transaction(uuid, date, public.loan_txn_type, numeric, text, uuid, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_loan_transaction(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_loan_facility(text, public.loan_type, numeric, numeric, date, date, numeric, text, integer, text, text, uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_loan_statement(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loan_balances() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commitments_due(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.apply_loan_payments_to_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_loan_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_loan_transaction(uuid, date, public.loan_txn_type, numeric, text, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_loan_transaction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_loan_facility(text, public.loan_type, numeric, numeric, date, date, numeric, text, integer, text, text, uuid, uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_loan_statement(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.commitments_due(integer) TO authenticated;
