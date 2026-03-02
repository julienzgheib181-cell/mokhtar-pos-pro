"use client";
import { useEffect } from "react";

export default function PushInit() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/push-sw.js")
        .then(() => console.log("Service Worker Registered"))
        .catch((err) => console.error("SW error", err));
    }
  }, []);

  return null;
}