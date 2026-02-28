"use client";

import { useState } from "react";
import { getFcmToken } from "@/lib/firebase";

export default function PushButtons() {
  const [status, setStatus] = useState<string>("");

  async function enable() {
    try {
      setStatus("Requesting permission...");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("Permission denied");
        alert("Permission denied");
        return;
      }

      setStatus("Getting token...");
      const token = await getFcmToken();

      setStatus("Registering token...");
      const res = await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Register failed");

      setStatus("Enabled ✅");
      alert("Notifications enabled ✅");
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? "unknown"));
      alert("Enable failed: " + (e?.message ?? "unknown"));
    }
  }

  async function sendTest() {
    try {
      setStatus("Sending test...");
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Mokhtar Cell", body: "Test notification ✅" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Send failed");
      setStatus("Sent ✅");
      alert("Test sent 🚀");
    } catch (e: any) {
      setStatus("Error: " + (e?.message ?? "unknown"));
      alert("Send failed: " + (e?.message ?? "unknown"));
    }
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "10px 0" }}>
      <button className="pill" type="button" onClick={enable}>
        Enable Notifications
      </button>
      <button className="pill" type="button" onClick={sendTest}>
        Send Test
      </button>
      <span style={{ opacity: 0.8, fontSize: 12 }}>{status}</span>
    </div>
  );
}
