// Client-side helper to trigger a server push notification.
// Fire-and-forget: POS should not block if push fails.

export async function notify(title: string, body: string) {
  try {
    await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
  } catch {
    // ignore
  }
}
