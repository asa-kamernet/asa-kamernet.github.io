// Kamernet Live service worker: only shows alerts (new landlord messages, reminders) and opens the site on that
// listing's card when one is tapped. It caches nothing.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Kamernet Live", {
    body: d.body || "New message", tag: d.tag || undefined, data: { url: d.url && d.url !== self.registration.scope ? d.url : self.registration.scope + "#todo" }, // no listing: open To do
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(self.registration.scope)) { await w.focus(); try { await w.navigate(url); } catch {} return; }
    await clients.openWindow(url);
  })());
});
