import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function usePortalAuth() {
  const { user, session, loading: authLoading } = useAuth();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setCustomerId(null);
      setCustomerName(null);
      setLoading(false);
      return;
    }

    const fetch = async () => {
      const { data } = await supabase
        .from("customer_portal_users")
        .select("customer_id, customers(company_name)")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (data) {
        setCustomerId(data.customer_id);
        setCustomerName((data as any).customers?.company_name ?? null);
      } else {
        setCustomerId(null);
        setCustomerName(null);
      }
      setLoading(false);
    };
    fetch();
  }, [user, authLoading]);

  return { user, session, customerId, customerName, loading: authLoading || loading, isPortalUser: !!customerId };
}
