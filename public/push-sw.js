self.addEventListener("push", function (event) {
  const data = event.data?.json() || {};

  self.registration.showNotification(data.title || "Notification", {
    body: data.body || "New update",
  });
});