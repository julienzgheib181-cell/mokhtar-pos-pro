/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBkGRdD92V6gjQYeh-9698ESVJJSUt4eAo",
  authDomain: "mokhtar-notifications.firebaseapp.com",
  projectId: "mokhtar-notifications",
  messagingSenderId: "205339221427",
  appId: "205339221427:web:5207a3f05cdac86a377fc6",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Mokhtar Cell";
  const options = {
    body: payload?.notification?.body || "New notification",
    data: payload?.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification?.data && event.notification.data.click_action) || "/";
  event.waitUntil(clients.openWindow(url));
});
