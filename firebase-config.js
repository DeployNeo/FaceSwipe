// firebase-config.js
// --> Replace with your Firebase project config from the Console.
// Keep this file next to index.html, profile.html, feed.html, app.js

// Example:
/*
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "XXXXX",
  appId: "1:XXXXX:web:YYYYYYYY"
};
*/

const firebaseConfig = {
  apiKey: "AIzaSyBgiraanKawGrw8bqaxjNWm2THKWhYr9Qo",
  authDomain: "faceswipe-baa55.firebaseapp.com",
  projectId: "faceswipe-baa55",
  storageBucket: "faceswipe-baa55.firebasestorage.app",
  messagingSenderId: "313473345622",
  appId: "1:313473345622:web:c7a61764c4b86846fa33f7",
};

// Initialize Firebase (v8 syntax used for simplicity with CDN)
if (!window.firebase || !firebase.apps) {
  console.error("Firebase SDK not loaded - make sure firebase libs are included in HTML files.");
}
firebase.initializeApp(firebaseConfig);

// Expose commonly used instances
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
