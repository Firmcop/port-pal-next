
ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS gate_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS gate_fee_currency text,
  ADD COLUMN IF NOT EXISTS gate_fee_invoice_id uuid REFERENCES public.invoices(id);

CREATE OR REPLACE FUNCTION public.seed_default_fx_rates(_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0;
BEGIN
  INSERT INTO public.fx_rates(organization_id, currency_from, currency_to, rate, as_of_date, source) VALUES
    (_org,'EUR','USD',1.08, CURRENT_DATE,'seed'),
    (_org,'USD','EUR',0.93, CURRENT_DATE,'seed'),
    (_org,'KES','USD',0.0078, CURRENT_DATE,'seed'),
    (_org,'USD','KES',128.5, CURRENT_DATE,'seed'),
    (_org,'KES','EUR',0.0072, CURRENT_DATE,'seed'),
    (_org,'EUR','KES',138.7, CURRENT_DATE,'seed')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.seed_default_dunning_rules(_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.dunning_rules WHERE organization_id=_org) THEN RETURN 0; END IF;
  INSERT INTO public.dunning_rules(organization_id,name,days_after_due,channel,template,is_active) VALUES
    (_org,'Friendly Reminder',7,'email','Hi {{customer_name}}, invoice {{invoice_number}} for {{currency}} {{total_amount}} is now {{days_overdue}} days overdue.',true),
    (_org,'Second Notice',21,'email','Dear {{customer_name}}, second reminder: invoice {{invoice_number}} ({{currency}} {{total_amount}}) is {{days_overdue}} days overdue.',true),
    (_org,'Final Demand',45,'email','FINAL NOTICE: invoice {{invoice_number}} for {{currency}} {{total_amount}} is {{days_overdue}} days overdue. Payment required within 7 days.',true);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.seed_default_tax_codes(_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; _country text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tax_codes WHERE organization_id=_org) THEN RETURN 0; END IF;
  SELECT upper(coalesce(country,'')) INTO _country FROM public.organizations WHERE id=_org;
  IF _country IN ('KE','KENYA') THEN
    INSERT INTO public.tax_codes(organization_id,code,name,rate,kind,jurisdiction,is_active) VALUES
      (_org,'VAT16','VAT Standard 16%',16,'output','KE',true),
      (_org,'VAT8','VAT Fuel 8%',8,'output','KE',true),
      (_org,'VAT0','Zero Rated',0,'output','KE',true),
      (_org,'EXEMPT','Exempt',0,'output','KE',true),
      (_org,'WHT5','Withholding 5%',5,'withholding','KE',true),
      (_org,'WHT3','Withholding 3% Services',3,'withholding','KE',true);
  ELSIF _country IN ('US','USA') THEN
    INSERT INTO public.tax_codes(organization_id,code,name,rate,kind,jurisdiction,is_active) VALUES
      (_org,'NONE','No Sales Tax',0,'output','US',true);
  ELSE
    INSERT INTO public.tax_codes(organization_id,code,name,rate,kind,jurisdiction,is_active) VALUES
      (_org,'VAT_STD','VAT Standard 20%',20,'output','EU',true),
      (_org,'VAT_RED','VAT Reduced 10%',10,'output','EU',true),
      (_org,'VAT_ZERO','Zero Rated',0,'output','EU',true),
      (_org,'EXEMPT','Exempt',0,'output','EU',true);
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
DECLARE _o record;
BEGIN
  FOR _o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_fx_rates(_o.id);
    PERFORM public.seed_default_dunning_rules(_o.id);
    PERFORM public.seed_default_tax_codes(_o.id);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.v_unposted_documents
WITH (security_invoker=on) AS
SELECT 'invoice'::text AS doc_type, i.id AS doc_id, i.invoice_number AS doc_number,
       i.organization_id, i.total_amount AS amount, i.currency, i.issued_at AS doc_date
FROM public.invoices i
WHERE i.status::text IN ('sent','paid','overdue')
  AND NOT EXISTS (SELECT 1 FROM public.accounting_transactions t WHERE t.reference_type='invoice' AND t.reference_id=i.id)
UNION ALL
SELECT 'purchase_order', po.id, po.po_number, po.organization_id, po.total_cost,
       COALESCE((SELECT currency FROM public.organizations WHERE id=po.organization_id),'USD'), po.created_at
FROM public.purchase_orders po
WHERE po.status::text NOT IN ('draft','cancelled')
  AND NOT EXISTS (SELECT 1 FROM public.accounting_transactions t WHERE t.reference_type='purchase_order' AND t.reference_id=po.id);

GRANT SELECT ON public.v_unposted_documents TO authenticated;
GRANT ALL ON public.v_unposted_documents TO service_role;

CREATE OR REPLACE FUNCTION public.adopt_legacy_org_data(_target_org uuid, _dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _legacy uuid := '00000000-0000-0000-0000-000000000001';
  _tables text[] := ARRAY[
    'containers','container_movements','container_sales','container_conversions',
    'customers','suppliers','tariffs','depots','yard_blocks',
    'eir_records','gate_appointments','inspections','damage_estimates',
    'invoices','invoice_line_items','payments','payment_allocations',
    'purchase_orders','po_items','goods_receipts','goods_receipt_items',
    'vendor_payments','accounting_transactions','financial_accounts','gl_accounts',
    'employees','payslips','payroll_runs','quotes','quote_items','deals','leads',
    'repatriations','repatriation_costs','release_instructions',
    'work_orders','materials','material_stock','material_movements','projects'
  ];
  _t text; _moved jsonb := '{}'::jsonb; _cnt int; _total int := 0;
BEGIN
  IF NOT (public.is_platform_admin() OR public.has_role(auth.uid(),'admin'::app_role) OR public.is_org_admin(_target_org)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _target_org = _legacy THEN RAISE EXCEPTION 'target_cannot_be_legacy'; END IF;

  FOREACH _t IN ARRAY _tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=_t AND column_name='organization_id') THEN CONTINUE; END IF;
    IF _dry_run THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id=$1',_t) INTO _cnt USING _legacy;
    ELSE
      EXECUTE format('UPDATE public.%I SET organization_id=$1 WHERE organization_id=$2',_t) USING _target_org,_legacy;
      GET DIAGNOSTICS _cnt = ROW_COUNT;
    END IF;
    IF _cnt > 0 THEN
      _moved := _moved || jsonb_build_object(_t,_cnt);
      _total := _total + _cnt;
    END IF;
  END LOOP;

  IF NOT _dry_run AND _total > 0 THEN
    BEGIN
      INSERT INTO public.finance_audit_log(organization_id,actor_user_id,action,entity_type,entity_id,details)
      VALUES (_target_org, auth.uid(),'adopt_legacy_org_data','organization',_target_org,
              jsonb_build_object('moved',_moved,'total',_total,'source',_legacy));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('dry_run',_dry_run,'target_org',_target_org,'total_rows',_total,'by_table',_moved);
END $$;

REVOKE ALL ON FUNCTION public.adopt_legacy_org_data(uuid,boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.adopt_legacy_org_data(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.stamp_eir_gate_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _size text; _fee numeric; _cur text;
BEGIN
  IF NEW.gate_fee_amount IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.container_id IS NULL THEN RETURN NEW; END IF;
  SELECT size::text INTO _size FROM public.containers WHERE id = NEW.container_id;
  SELECT gate_in_fee, currency INTO _fee, _cur
    FROM public.tariffs
    WHERE organization_id = NEW.organization_id
      AND is_active = true
      AND (container_size IS NULL OR container_size::text = _size)
      AND gate_in_fee IS NOT NULL AND gate_in_fee > 0
    ORDER BY (container_size IS NOT NULL) DESC, created_at DESC
    LIMIT 1;
  IF _fee IS NOT NULL THEN
    NEW.gate_fee_amount := _fee;
    NEW.gate_fee_currency := COALESCE(_cur,(SELECT currency FROM public.organizations WHERE id=NEW.organization_id));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_eir_gate_fee ON public.eir_records;
CREATE TRIGGER trg_stamp_eir_gate_fee
  BEFORE INSERT ON public.eir_records
  FOR EACH ROW EXECUTE FUNCTION public.stamp_eir_gate_fee();
