import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required");
if (!clientEmail) throw new Error("FIREBASE_CLIENT_EMAIL is required");
if (!privateKey) throw new Error("FIREBASE_PRIVATE_KEY is required");

export function getAdminMessaging() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }
  return getMessaging();
}
