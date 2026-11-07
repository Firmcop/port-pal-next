-- Approval push notifications pointed at pre-Next.js paths (/purchase-orders,
-- /finance/vendor-payments, /eir, ...) that now 404. Same targets as
-- src/lib/doc-links.ts.
CREATE OR REPLACE FUNCTION public.notify_approval_target(_user_id uuid, _org_id uuid, _title text, _message text, _doc_type text, _doc_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n_id uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications(user_id, organization_id, title, message, type, reference_id, reference_type)
  VALUES (_user_id, _org_id, _title, _message, 'approval', _doc_id, _doc_type)
  RETURNING id INTO n_id;

  -- Queue push (web/whatsapp dispatcher reads this)
  BEGIN
    INSERT INTO public.push_notification_queue(notification_id, channel, recipient, payload, status)
    VALUES (n_id, 'web_push', _user_id::text,
      jsonb_build_object('title', _title, 'body', _message,
        'url', CASE _doc_type
          WHEN 'quote' THEN '/quotes/' || _doc_id::text
          WHEN 'purchase_order' THEN '/procurement?open=' || _doc_id::text
          WHEN 'payment' THEN '/billing/payments?tab=customer&open=' || _doc_id::text
          WHEN 'vendor_payment' THEN '/billing/payments?tab=vendor&open=' || _doc_id::text
          WHEN 'repatriation' THEN '/repatriation?highlight=' || _doc_id::text
          WHEN 'eir' THEN '/gate/eir?open=' || _doc_id::text
          WHEN 'operating_expense' THEN '/finance/operating-expenses'
          ELSE '/finance/approvals' END),
      'queued');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $function$;
