
-- Null-out FK references first to allow safe purge
UPDATE logistics_trip_costs c SET expense_txn_id = NULL
WHERE expense_txn_id IN (SELECT id FROM accounting_transactions WHERE reference_type='logistics_trip_cost');

DELETE FROM accounting_transactions WHERE reference_type='logistics_trip_cost';

-- Trigger function: keep balanced pair + write expense_txn_id back
CREATE OR REPLACE FUNCTION public.post_trip_cost_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _c logistics_trip_costs%ROWTYPE; _curr text; _txn uuid;
BEGIN
  SELECT * INTO _c FROM logistics_trip_costs WHERE id=_id;
  IF NOT FOUND OR COALESCE(_c.amount,0) <= 0 THEN RETURN; END IF;
  IF _c.expense_txn_id IS NOT NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='trip_cost' AND reference_id=_id) THEN
    UPDATE logistics_trip_costs SET expense_txn_id=(SELECT id FROM accounting_transactions WHERE reference_type='trip_cost' AND reference_id=_id AND debit_amount>0 LIMIT 1) WHERE id=_c.id;
    RETURN;
  END IF;
  _curr := COALESCE(_c.currency, (SELECT currency FROM organizations WHERE id=_c.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TC-DR-'||substring(_c.id::text,1,8), COALESCE(_c.created_at,now()),
    'expense', COALESCE(_c.category::text,'logistics'),
    'Trip cost — '||COALESCE(_c.description,_c.category::text,'logistics'),
    _c.amount, 0, 'trip_cost', _c.id, _c.organization_id, _curr)
  RETURNING id INTO _txn;

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TC-CR-'||substring(_c.id::text,1,8), COALESCE(_c.created_at,now()),
    'liability','accounts_payable','Trip cost payable', 0, _c.amount,
    'trip_cost', _c.id, _c.organization_id, _curr);

  UPDATE logistics_trip_costs SET expense_txn_id=_txn WHERE id=_c.id;
END $function$;

-- Neuter duplicate RPC: rely on trigger, just return the existing txn id
CREATE OR REPLACE FUNCTION public.logistics_post_trip_cost(_cost_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _txn uuid;
BEGIN
  SELECT expense_txn_id INTO _txn FROM logistics_trip_costs WHERE id=_cost_id AND organization_id = current_org_id();
  IF _txn IS NULL THEN
    PERFORM public.post_trip_cost_to_ledger(_cost_id);
    SELECT expense_txn_id INTO _txn FROM logistics_trip_costs WHERE id=_cost_id;
  END IF;
  RETURN _txn;
END $function$;

-- Backfill expense_txn_id on existing costs from surviving 'trip_cost' debit row
UPDATE logistics_trip_costs c SET expense_txn_id = t.id
FROM accounting_transactions t
WHERE t.reference_type='trip_cost' AND t.reference_id=c.id AND t.debit_amount > 0
  AND c.expense_txn_id IS NULL;

-- Auto-record trip revenue when order invoices get attached
CREATE OR REPLACE FUNCTION public.log_order_invoice_revenue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _inv_id uuid; _inv_total numeric; _inv_currency text; _trip record; _n int; _share numeric;
  _inv_ids uuid[]; _i int;
BEGIN
  _inv_ids := ARRAY[]::uuid[];
  IF NEW.deposit_invoice_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.deposit_invoice_id IS DISTINCT FROM OLD.deposit_invoice_id) THEN
    _inv_ids := _inv_ids || NEW.deposit_invoice_id;
  END IF;
  IF NEW.balance_invoice_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.balance_invoice_id IS DISTINCT FROM OLD.balance_invoice_id) THEN
    _inv_ids := _inv_ids || NEW.balance_invoice_id;
  END IF;
  IF NEW.invoice_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id) THEN
    _inv_ids := _inv_ids || NEW.invoice_id;
  END IF;

  FOREACH _inv_id IN ARRAY _inv_ids LOOP
    SELECT total_amount, currency INTO _inv_total, _inv_currency FROM invoices WHERE id=_inv_id;
    SELECT COUNT(DISTINCT trip_id) INTO _n FROM logistics_trip_legs WHERE transport_order_id=NEW.id;
    IF COALESCE(_n,0) > 0 AND COALESCE(_inv_total,0) > 0 THEN
      _share := _inv_total / _n;
      FOR _trip IN SELECT DISTINCT trip_id FROM logistics_trip_legs WHERE transport_order_id=NEW.id LOOP
        IF NOT EXISTS (SELECT 1 FROM logistics_trip_revenue
                       WHERE trip_id=_trip.trip_id AND invoice_id=_inv_id AND transport_order_id=NEW.id) THEN
          INSERT INTO logistics_trip_revenue(organization_id, trip_id, transport_order_id, amount, currency, invoice_id)
          VALUES (NEW.organization_id, _trip.trip_id, NEW.id, _share, _inv_currency, _inv_id);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_order_invoice_revenue ON public.logistics_transport_orders;
CREATE TRIGGER trg_log_order_invoice_revenue
AFTER INSERT OR UPDATE OF deposit_invoice_id, balance_invoice_id, invoice_id
ON public.logistics_transport_orders
FOR EACH ROW EXECUTE FUNCTION public.log_order_invoice_revenue();

-- Backfill revenue for existing orders
DO $mig$
DECLARE _o record; _inv_id uuid; _inv_total numeric; _inv_currency text; _trip record; _n int; _share numeric;
BEGIN
  FOR _o IN SELECT * FROM logistics_transport_orders
            WHERE deposit_invoice_id IS NOT NULL OR balance_invoice_id IS NOT NULL OR invoice_id IS NOT NULL LOOP
    FOREACH _inv_id IN ARRAY ARRAY[_o.deposit_invoice_id, _o.balance_invoice_id, _o.invoice_id] LOOP
      IF _inv_id IS NULL THEN CONTINUE; END IF;
      SELECT total_amount, currency INTO _inv_total, _inv_currency FROM invoices WHERE id=_inv_id;
      SELECT COUNT(DISTINCT trip_id) INTO _n FROM logistics_trip_legs WHERE transport_order_id=_o.id;
      IF COALESCE(_n,0)=0 OR COALESCE(_inv_total,0)=0 THEN CONTINUE; END IF;
      _share := _inv_total / _n;
      FOR _trip IN SELECT DISTINCT trip_id FROM logistics_trip_legs WHERE transport_order_id=_o.id LOOP
        IF NOT EXISTS (SELECT 1 FROM logistics_trip_revenue
                       WHERE trip_id=_trip.trip_id AND invoice_id=_inv_id AND transport_order_id=_o.id) THEN
          INSERT INTO logistics_trip_revenue(organization_id, trip_id, transport_order_id, amount, currency, invoice_id)
          VALUES (_o.organization_id, _trip.trip_id, _o.id, _share, _inv_currency, _inv_id);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $mig$;

-- Add currency to logistics_trip_pnl view
DROP VIEW IF EXISTS public.logistics_trip_pnl;
CREATE VIEW public.logistics_trip_pnl AS
SELECT
  t.id AS trip_id, t.organization_id, t.ref, t.trip_date, t.route_id, t.carrier_id, t.vehicle_id,
  COALESCE((SELECT SUM(r.amount) FROM logistics_trip_revenue r WHERE r.trip_id=t.id), 0) AS revenue,
  COALESCE((SELECT SUM(c.amount) FROM logistics_trip_costs c WHERE c.trip_id=t.id), 0) AS total_cost,
  COALESCE((SELECT SUM(r.amount) FROM logistics_trip_revenue r WHERE r.trip_id=t.id), 0)
   - COALESCE((SELECT SUM(c.amount) FROM logistics_trip_costs c WHERE c.trip_id=t.id), 0) AS gross_margin,
  CASE WHEN COALESCE((SELECT SUM(r.amount) FROM logistics_trip_revenue r WHERE r.trip_id=t.id), 0) = 0 THEN NULL
       ELSE ROUND((COALESCE((SELECT SUM(r.amount) FROM logistics_trip_revenue r WHERE r.trip_id=t.id), 0)
                   - COALESCE((SELECT SUM(c.amount) FROM logistics_trip_costs c WHERE c.trip_id=t.id), 0))
                  / COALESCE((SELECT SUM(r.amount) FROM logistics_trip_revenue r WHERE r.trip_id=t.id), 0) * 100, 2)
  END AS margin_pct,
  COALESCE(
    (SELECT r.currency FROM logistics_trip_revenue r WHERE r.trip_id=t.id LIMIT 1),
    (SELECT c.currency FROM logistics_trip_costs c WHERE c.trip_id=t.id LIMIT 1),
    (SELECT o.currency FROM organizations o WHERE o.id=t.organization_id)
  ) AS currency
FROM logistics_trips t;

GRANT SELECT ON public.logistics_trip_pnl TO authenticated;
GRANT ALL ON public.logistics_trip_pnl TO service_role;
