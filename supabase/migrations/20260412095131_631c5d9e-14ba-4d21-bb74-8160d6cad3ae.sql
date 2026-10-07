
-- Push subscriptions table for Web Push
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
  ON public.push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions"
  ON public.push_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Notification queue table
CREATE TABLE public.push_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web_push', 'whatsapp')),
  recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

ALTER TABLE public.push_notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view queue"
  ON public.push_notification_queue FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  );

CREATE INDEX idx_queue_status ON public.push_notification_queue(status) WHERE status = 'pending';
CREATE INDEX idx_queue_notification ON public.push_notification_queue(notification_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.push_notification_queue;

-- Trigger function to queue notifications for push delivery
CREATE OR REPLACE FUNCTION public.queue_push_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sub RECORD;
  _customer RECORD;
BEGIN
  -- Queue Web Push for each active subscription of this user
  FOR _sub IN
    SELECT endpoint, p256dh, auth
    FROM public.push_subscriptions
    WHERE user_id = NEW.user_id
  LOOP
    INSERT INTO public.push_notification_queue (notification_id, channel, recipient, payload)
    VALUES (
      NEW.id,
      'web_push',
      _sub.endpoint,
      jsonb_build_object(
        'title', NEW.title,
        'body', NEW.message,
        'type', NEW.type,
        'p256dh', _sub.p256dh,
        'auth', _sub.auth
      )
    );
  END LOOP;

  -- Queue WhatsApp if notification references a customer with whatsapp_number
  IF NEW.reference_type IS NOT NULL THEN
    -- Try to find a linked customer with whatsapp number
    -- Check common reference types that link to customers
    FOR _customer IN
      SELECT DISTINCT c.whatsapp_number
      FROM public.customers c
      WHERE c.whatsapp_number IS NOT NULL
        AND c.whatsapp_number != ''
        AND (
          -- gate appointments link via shipping_line
          (NEW.reference_type = 'gate_appointments' AND EXISTS (
            SELECT 1 FROM public.gate_appointments ga
            WHERE ga.id = NEW.reference_id AND ga.shipping_line = c.company_name
          ))
          OR
          -- containers link via owner or shipping_line
          (NEW.reference_type = 'containers' AND EXISTS (
            SELECT 1 FROM public.containers ct
            WHERE ct.id = NEW.reference_id AND (ct.owner = c.company_name OR ct.shipping_line = c.company_name)
          ))
        )
      LIMIT 1
    LOOP
      INSERT INTO public.push_notification_queue (notification_id, channel, recipient, payload)
      VALUES (
        NEW.id,
        'whatsapp',
        _customer.whatsapp_number,
        jsonb_build_object('title', NEW.title, 'body', NEW.message, 'type', NEW.type)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_queue_push_notifications
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_push_notifications();
