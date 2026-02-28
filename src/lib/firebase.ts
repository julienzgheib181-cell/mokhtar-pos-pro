import { initializeApp, getApps } from "firebase/app";
import { getMessaging, isSupported } from "firebase/messaging";

export function getFirebaseApp() {
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

export async function getMessagingIfSupported() {
  const app = getFirebaseApp();
  if (!app) return null;
  const ok = await isSupported();
  if (!ok) return null;
  return getMessaging(app);
}
