import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export function usePushSubscription() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!user || !("serviceWorker" in navigator) || !("PushManager" in window)) return;

    // Check if already subscribed
    navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      if (existing) setSubscribed(true);
    });
  }, [user]);

  const subscribe = async () => {
    if (!user) return;

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      // Register service worker
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Get VAPID public key from depot config
      const { data: depot } = await supabase
        .from("depots")
        .select("config")
        .limit(1)
        .single();

      const config = depot?.config as Record<string, any> | null;
      const vapidPublicKey = config?.vapid_public_key;

      if (!vapidPublicKey) {
        console.error("VAPID public key not configured in depot settings");
        return;
      }

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });

      const keys = subscription.toJSON();

      // Save to database
      await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh: keys.keys?.p256dh || "",
          auth: keys.keys?.auth || "",
        },
        { onConflict: "user_id,endpoint" }
      );

      setSubscribed(true);
    } catch (err) {
      console.error("Push subscription failed:", err);
    }
  };

  const unsubscribe = async () => {
    if (!user) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", user.id)
          .eq("endpoint", subscription.endpoint);

        await subscription.unsubscribe();
      }

      setSubscribed(false);
    } catch (err) {
      console.error("Push unsubscribe failed:", err);
    }
  };

  return { permission, subscribed, subscribe, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
