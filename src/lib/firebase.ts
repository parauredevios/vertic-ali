// src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Remplace ces valeurs par celles que Firebase te donne
const firebaseConfig = {
  apiKey: "AIzaSyAynvBrerWEtxEcvGpQ1b4FWcWA_G1XI1s",
  authDomain: "vertic-ali-webapp.firebaseapp.com",
  projectId: "vertic-ali-webapp",
  storageBucket: "vertic-ali-webapp.firebasestorage.app",
  messagingSenderId: "865152704222",
  appId: "1:865152704222:web:f3a61607b81804ee48ec4f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);