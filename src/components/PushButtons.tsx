"use client";

import { useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushButtons({ compact }: { compact?: boolean }) {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const enable = async () => {
    try {
      setLoading(true);
      setStatus("");

      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator)) {
        setStatus("Service Worker not supported");
        return;
      }
      if (!("PushManager" in window)) {
        setStatus("Push not supported on this browser");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Permission denied");
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setStatus("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
        return;
      }

      const reg = await navigator.serviceWorker.register("/push-sw.js");

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });

      if (!res.ok) {
        const t = await res.text();
        setStatus(`Register failed (${res.status}): ${t}`);
        return;
      }

      setStatus("Notifications enabled ✅");
    } catch (e: any) {
      setStatus(e?.message ?? "Enable failed");
    } finally {
      setLoading(false);
    }
  };

  const test = async () => {
    try {
      setLoading(true);
      setStatus("");
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Mokhtar Cell", body: "Test notification ✅" }),
      });
      if (!res.ok) {
        const t = await res.text();
        setStatus(`Test failed (${res.status}): ${t}`);
        return;
      }
      setStatus("Test sent ✅");
    } catch (e: any) {
      setStatus(e?.message ?? "Test failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className={compact ? "pill" : "btn primary"} onClick={enable} disabled={loading}>
          Enable notifications
        </button>
        <button className={compact ? "pill" : "btn"} onClick={test} disabled={loading}>
          Test
        </button>
      </div>
      {status ? <div className="muted" style={{ fontWeight: 800 }}>{status}</div> : null}
    </div>
  );
}
