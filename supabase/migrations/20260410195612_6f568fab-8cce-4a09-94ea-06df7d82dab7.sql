
-- Notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  reference_id UUID,
  reference_type TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Index for fast lookup
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, is_read) WHERE is_read = false;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger function: notify all users on container movement
CREATE OR REPLACE FUNCTION public.notify_on_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _container_number TEXT;
  _user RECORD;
BEGIN
  SELECT container_number INTO _container_number FROM public.containers WHERE id = NEW.container_id;
  FOR _user IN SELECT DISTINCT user_id FROM public.user_roles LOOP
    INSERT INTO public.notifications (user_id, title, message, type, reference_id, reference_type)
    VALUES (
      _user.user_id,
      'Container Movement',
      COALESCE(_container_number, 'Unknown') || ' — ' || REPLACE(NEW.movement_type::text, '_', ' '),
      'movement',
      NEW.id,
      'container_movements'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_movement
  AFTER INSERT ON public.container_movements
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_movement();

-- Trigger function: notify on appointment status change
CREATE OR REPLACE FUNCTION public.notify_on_appointment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user RECORD;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    FOR _user IN SELECT DISTINCT user_id FROM public.user_roles LOOP
      INSERT INTO public.notifications (user_id, title, message, type, reference_id, reference_type)
      VALUES (
        _user.user_id,
        'Gate Appointment',
        NEW.appointment_number || ' — ' || REPLACE(NEW.status::text, '_', ' '),
        'appointment',
        NEW.id,
        'gate_appointments'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_appointment
  AFTER INSERT OR UPDATE ON public.gate_appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_appointment_change();

-- Trigger function: notify on work order assignment/status change
CREATE OR REPLACE FUNCTION public.notify_on_work_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user RECORD;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)) THEN
    FOR _user IN SELECT DISTINCT user_id FROM public.user_roles LOOP
      INSERT INTO public.notifications (user_id, title, message, type, reference_id, reference_type)
      VALUES (
        _user.user_id,
        'Work Order',
        NEW.wo_number || ' — ' || REPLACE(NEW.status::text, '_', ' '),
        'work_order',
        NEW.id,
        'work_orders'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_work_order
  AFTER INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_work_order_change();
