// Service Worker for Web Push Notifications
self.addEventListener("push", (event) => {
  let data = { title: "Depot Notification", body: "", type: "info" };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    data.body = event.data?.text() || "";
  }

  const options = {
    body: data.body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.type || "general",
    data: { type: data.type },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const routeMap = {
    movement: "/movements",
    appointment: "/gate-appointments",
    work_order: "/work-orders",
  };

  const type = event.notification.data?.type;
  const url = routeMap[type] || "/";

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
