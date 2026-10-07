
CREATE TABLE public.tax_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('output','input','withholding')),
  gl_account_id UUID REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'KE',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
ALTER TABLE public.tax_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read tax_codes" ON public.tax_codes FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write tax_codes" ON public.tax_codes FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_tax_codes_updated BEFORE UPDATE ON public.tax_codes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.invoice_line_items ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES public.tax_codes(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES public.tax_codes(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS order_date DATE NOT NULL DEFAULT CURRENT_DATE;

CREATE TABLE public.tax_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE RESTRICT,
  jurisdiction TEXT NOT NULL DEFAULT 'KE',
  output_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  input_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','filed')),
  filed_at TIMESTAMPTZ,
  reference TEXT,
  journal_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period_id, jurisdiction)
);
ALTER TABLE public.tax_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read tax_returns" ON public.tax_returns FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write tax_returns" ON public.tax_returns FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_tax_returns_updated BEFORE UPDATE ON public.tax_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.etims_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  cu_number TEXT,
  qr_payload TEXT,
  signed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.etims_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read etims" ON public.etims_submissions FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write etims" ON public.etims_submissions FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());

CREATE TABLE public.withholding_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  vendor_payment_id UUID REFERENCES public.vendor_payments(id) ON DELETE SET NULL,
  supplier_id UUID,
  certificate_number TEXT NOT NULL,
  rate NUMERIC(6,4) NOT NULL DEFAULT 0,
  base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_withheld NUMERIC(14,2) NOT NULL DEFAULT 0,
  certificate_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','filed','void')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, certificate_number)
);
ALTER TABLE public.withholding_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read wht" ON public.withholding_certificates FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write wht" ON public.withholding_certificates FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_wht_updated BEFORE UPDATE ON public.withholding_certificates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.compute_tax_return(_period_id UUID, _jurisdiction TEXT DEFAULT 'KE')
RETURNS TABLE(output_total NUMERIC, input_total NUMERIC, net_payable NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE p_start DATE; p_end DATE; org UUID;
BEGIN
  SELECT start_date, end_date, organization_id INTO p_start, p_end, org FROM public.fiscal_periods WHERE id = _period_id;
  IF p_start IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  RETURN QUERY
  WITH out_t AS (
    SELECT COALESCE(SUM(ili.quantity * ili.unit_price * COALESCE(tc.rate,0)),0)::numeric AS amt
    FROM public.invoice_line_items ili
    JOIN public.invoices i ON i.id = ili.invoice_id
    LEFT JOIN public.tax_codes tc ON tc.id = ili.tax_code_id
    WHERE i.organization_id = org AND i.issued_at::date BETWEEN p_start AND p_end
      AND COALESCE(tc.kind,'output') = 'output'
      AND COALESCE(tc.jurisdiction, _jurisdiction) = _jurisdiction
  ), in_t AS (
    SELECT COALESCE(SUM(po.total_cost * COALESCE(tc.rate,0)),0)::numeric AS amt
    FROM public.purchase_orders po
    LEFT JOIN public.tax_codes tc ON tc.id = po.tax_code_id
    WHERE po.organization_id = org AND po.order_date BETWEEN p_start AND p_end
      AND COALESCE(tc.kind,'input') = 'input'
      AND COALESCE(tc.jurisdiction, _jurisdiction) = _jurisdiction
  )
  SELECT out_t.amt, in_t.amt, (out_t.amt - in_t.amt) FROM out_t, in_t;
END $$;

CREATE OR REPLACE FUNCTION public.post_tax_return(_period_id UUID, _jurisdiction TEXT DEFAULT 'KE')
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE org UUID; r RECORD; ret_id UUID;
BEGIN
  SELECT organization_id INTO org FROM public.fiscal_periods WHERE id = _period_id;
  IF org IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  SELECT * INTO r FROM public.compute_tax_return(_period_id, _jurisdiction);
  INSERT INTO public.tax_returns (organization_id, period_id, jurisdiction, output_total, input_total, net_payable, status)
  VALUES (org, _period_id, _jurisdiction, r.output_total, r.input_total, r.net_payable, 'posted')
  ON CONFLICT (organization_id, period_id, jurisdiction) DO UPDATE
    SET output_total = EXCLUDED.output_total, input_total = EXCLUDED.input_total,
        net_payable = EXCLUDED.net_payable, status = 'posted', updated_at = now()
  RETURNING id INTO ret_id;
  RETURN ret_id;
END $$;
