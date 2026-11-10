-- =====================================================================
-- Daily exchange rates (finance fix #9, 10 Nov 2026).
--
-- Until now fx_rates held one placeholder USD rate (128.5, 21 Jun), so USD
-- documents dated before it were booked at a rate of 1. Rates now come
-- daily from the open currency-api dataset (fawazahmed0, served by
-- jsDelivr, mirror on pages.dev) through pg_net:
--   fx_request_rates(date)  asks for one day's rates;
--   fx_collect_rates()      stores answered requests in fx_rates for every
--                           company (USD, EUR, GBP against KES, both ways).
-- Cron: request today's rates at 06:05 and 18:05 Nairobi; collect every
-- 15 minutes. Rates already stored for a date are replaced only by a
-- fetched rate, never by the seed.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.fx_rate_requests (
  request_id bigint PRIMARY KEY,
  rate_date date NOT NULL,
  url text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz,
  result text
);
ALTER TABLE public.fx_rate_requests ENABLE ROW LEVEL SECURITY;  -- no policies: internal only

CREATE OR REPLACE FUNCTION public.fx_request_rates(_date date DEFAULT current_date, _mirror boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE _url text; _id bigint; _tag text;
BEGIN
  _tag := CASE WHEN _date >= (now() AT TIME ZONE 'Africa/Nairobi')::date THEN 'latest' ELSE to_char(_date, 'YYYY-MM-DD') END;
  _url := CASE WHEN _mirror
    THEN format('https://%s.currency-api.pages.dev/v1/currencies/usd.min.json', _tag)
    ELSE format('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@%s/v1/currencies/usd.min.json', _tag) END;
  SELECT net.http_get(_url, timeout_milliseconds := 20000) INTO _id;
  INSERT INTO fx_rate_requests (request_id, rate_date, url) VALUES (_id, _date, _url);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.fx_collect_rates()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'net' AS $$
DECLARE r record; _j jsonb; _date date; _kes numeric; _cur text; _per_usd numeric; _to_kes numeric; _n int := 0;
BEGIN
  FOR r IN
    SELECT q.request_id, q.rate_date, q.url, h.status_code, h.content, h.error_msg, h.timed_out
      FROM fx_rate_requests q JOIN net._http_response h ON h.id = q.request_id
     WHERE q.collected_at IS NULL
  LOOP
    BEGIN
      IF r.status_code IS DISTINCT FROM 200 THEN
        UPDATE fx_rate_requests SET collected_at = now(), result = coalesce('http ' || r.status_code, r.error_msg, 'timed out')
         WHERE request_id = r.request_id;
        -- try the mirror once when the main source has no file for that date
        IF r.url LIKE '%jsdelivr%' THEN PERFORM fx_request_rates(r.rate_date, true); END IF;
        CONTINUE;
      END IF;
      _j := r.content::jsonb;
      _date := coalesce((_j->>'date')::date, r.rate_date);
      _kes := (_j->'usd'->>'kes')::numeric;
      IF _kes IS NULL OR _kes < 50 OR _kes > 500 THEN
        UPDATE fx_rate_requests SET collected_at = now(), result = 'no plausible KES rate' WHERE request_id = r.request_id;
        CONTINUE;
      END IF;
      FOREACH _cur IN ARRAY ARRAY['USD', 'EUR', 'GBP'] LOOP
        _per_usd := CASE WHEN _cur = 'USD' THEN 1 ELSE (_j->'usd'->>lower(_cur))::numeric END;
        CONTINUE WHEN _per_usd IS NULL OR _per_usd = 0;
        _to_kes := round(_kes / _per_usd, 6);
        INSERT INTO fx_rates (organization_id, currency_from, currency_to, rate, as_of_date, source)
        SELECT o.id, _cur, 'KES', _to_kes, _date, 'currency-api' FROM organizations o
        ON CONFLICT (organization_id, currency_from, currency_to, as_of_date)
        DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source;
        INSERT INTO fx_rates (organization_id, currency_from, currency_to, rate, as_of_date, source)
        SELECT o.id, 'KES', _cur, round(1 / _to_kes, 10), _date, 'currency-api' FROM organizations o
        ON CONFLICT (organization_id, currency_from, currency_to, as_of_date)
        DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source;
      END LOOP;
      UPDATE fx_rate_requests SET collected_at = now(), result = format('USD/KES %s on %s', _kes, _date)
       WHERE request_id = r.request_id;
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE fx_rate_requests SET collected_at = now(), result = 'error: ' || SQLERRM WHERE request_id = r.request_id;
    END;
  END LOOP;
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.fx_request_rates(date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fx_collect_rates() FROM PUBLIC, anon, authenticated;

-- schedule (cron runs in UTC: 03:05 and 15:05 UTC = 06:05 and 18:05 Nairobi)
SELECT cron.schedule('fx-rates-request', '5 3,15 * * *', $$SELECT public.fx_request_rates(current_date)$$);
SELECT cron.schedule('fx-rates-collect', '*/15 * * * *', $$SELECT public.fx_collect_rates()$$);

-- backfill from the first entries in May to today
SELECT public.fx_request_rates(d::date) FROM generate_series(DATE '2026-05-01', current_date, interval '1 day') d;
