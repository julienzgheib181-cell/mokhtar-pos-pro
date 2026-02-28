"use client";

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getMessaging, isSupported, Messaging, getToken } from "firebase/messaging";

function getFirebaseApp(): FirebaseApp | null {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId || !cfg.messagingSenderId || !cfg.appId) return null;

  if (getApps().length) return getApps()[0]!;
  return initializeApp(cfg);
}

export async function getMessagingIfSupported(): Promise<Messaging | null> {
  const app = getFirebaseApp();
  if (!app) return null;
  const ok = await isSupported();
  if (!ok) return null;
  return getMessaging(app);
}

export async function getFcmToken(): Promise<string> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error("NEXT_PUBLIC_FIREBASE_VAPID_KEY is required");

  const messaging = await getMessagingIfSupported();
  if (!messaging) throw new Error("Firebase messaging not supported in this browser");

  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw new Error("No FCM token returned (permission denied?)");
  return token;
}
