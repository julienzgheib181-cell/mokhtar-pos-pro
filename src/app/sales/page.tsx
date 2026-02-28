"use client";

import React, { useState } from "react";

const VAPID_PUBLIC_KEY =
  "BCqJ7j-dqFxSSaBAbMgJeCnfphtG_8r7rEgWa0jflP_s6O14TT8KOAq-ZI5HEE4iwU8SDlPrnRULFuDXbaAG5cY"; // <-- حط الـ key تبعك هون

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function SalesPage() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const enableNotifications = async () => {
    try {
      setLoading(true);
      setStatus("");

      // 1) request permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Permission denied ❌");
        return;
      }

      // 2) register service worker
      if (!("serviceWorker" in navigator)) {
        setStatus("Service Worker not supported ❌");
        return;
      }

      const reg = await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js"
      );

      // 3) subscribe to push with VAPID
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // ✅ IMPORTANT: store ONLY endpoint (string)
      const token = sub.endpoint;

      // 4) send token to backend (Supabase table push_tokens)
      const res = await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("Register failed:", data);
        setStatus(`Register failed ❌ (${res.status})`);
        return;
      }

      setStatus("Notifications enabled ✅ Token saved!");
    } catch (e: any) {
      console.error(e);
      setStatus(`Error ❌ ${e?.message ?? "unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  const sendTest = async () => {
    try {
      setLoading(true);
      setStatus("");

      const res = await fetch("/api/push/send", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("Send failed:", data);
        setStatus(`Send failed ❌ (${res.status})`);
        return;
      }

      setStatus("Test sent ✅");
    } catch (e: any) {
      console.error(e);
      setStatus(`Error ❌ ${e?.message ?? "unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>Sales</h1>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button onClick={enableNotifications} disabled={loading}>
          Enable Notifications
        </button>

        <button onClick={sendTest} disabled={loading}>
          Send Test
        </button>
      </div>

      {status ? (
        <div style={{ marginTop: 10, fontFamily: "monospace" }}>{status}</div>
      ) : null}
    </div>
  );
}