/*
  Copyright (c) 2010 - 2026, Nordic Semiconductor ASA
  All rights reserved.

  Passive BLE Motion Logger with Firebase Realtime Database integration.
  
  Architecture:
  - Preserves Thingy:52 battery life (3–6 months in Deep Sleep with wakeOnMotion).
  - Uses passive BLE advertisement scanning (discoverAll) rather than active GATT
    connections to prevent Broadcom HCI driver state lockups and connection timeouts
    on Linux / Raspberry Pi controllers.
  - Applies a 3.5-minute cooldown (185s) per device so that lingering post-wake
    advertisements are ignored while the Thingy returns to Deep Sleep (~6 µA).
  - Updates an authenticated Firebase Realtime Database schema with motion counters
    and timestamps.
*/

"use strict";

const Thingy = require("../index");
const { parseArgs } = require("node:util");

const { initializeApp } = require("firebase/app");
const { getDatabase, ref, update, increment } = require("firebase/database");
const {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} = require("firebase/auth");

// Suppress low-level noble warnings about malformed ambient BLE packets over the air
const origWarn = console.warn;
console.warn = function (...args) {
  if (
    typeof args[0] === "string" &&
    args[0].startsWith("processLeAdvertisingReport:")
  ) {
    return;
  }
  origWarn.apply(console, args);
};

// ─── Required environment variables ──────────────────────────────────────────
const required = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_DATABASE_URL",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_EMAIL",
  "FIREBASE_PASSWORD",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  console.error(
    "Copy .env.example → .env and fill in values, then run: source .env (or pass via env)",
  );
  process.exit(1);
}

// ─── Firebase singletons ─────────────────────────────────────────────────────
const app = initializeApp({
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});
const db = getDatabase(app);
const auth = getAuth(app);

// ─── CLI arguments ────────────────────────────────────────────────────────────
const { values: cliArgs } = parseArgs({
  options: {
    cooldown: { type: "string", short: "c" }, // Cooldown in seconds (default: 185)
  },
  strict: false,
});

const COOLDOWN_MS = (parseInt(cliArgs.cooldown, 10) || 185) * 1000;

// Device mapping: MAC address -> friendly metadata
const ASSIGNMENTS = {
  "e2:64:f9:1e:61:8c": { name: "Thingy 1 (Door)", emoji: "🚪", key: "door" },
  "fd:19:af:ba:73:c0": {
    name: "Thingy 2 (Washer)",
    emoji: "🧺",
    key: "washer",
  },
  "e1:29:01:98:33:9a": {
    name: "Thingy 3 (Furniture)",
    emoji: "🧹",
    key: "furniture",
  },
};

const cooldowns = new Map();
let isShuttingDown = false;

function findConfig(thingy) {
  const normAddr = String(thingy.address || "")
    .toLowerCase()
    .replace(/[:-]/g, "");
  const normId = String(thingy.id || "")
    .toLowerCase()
    .replace(/[:-]/g, "");

  for (const [mac, cfg] of Object.entries(ASSIGNMENTS)) {
    const normMac = String(mac).toLowerCase().replace(/[:-]/g, "");
    if ((normAddr && normMac === normAddr) || (normId && normMac === normId)) {
      return cfg;
    }
  }

  // Fallback: accept any Thingy:52 and derive a key from its ID
  const devKey = normAddr || normId || "unknown";
  return {
    name: `Thingy (${devKey.slice(-4)})`,
    emoji: "📍",
    key: devKey,
  };
}

// ─── Firebase event recording ────────────────────────────────────────────────
async function recordMotionEvent(config, rssi) {
  const timestamp = Math.round(Date.now() / 1000);
  const isoTime = new Date().toISOString();

  try {
    await update(ref(db, `motionEvents/${config.key}`), {
      name: config.name,
      lastMotion: timestamp,
      lastMotionIso: isoTime,
      rssi: rssi !== null && rssi !== undefined ? rssi : null,
      counter: increment(1),
    });
    console.log(
      `[Firebase] Logged motion event for ${config.name} at ${isoTime}`,
    );
  } catch (err) {
    console.error(`[Firebase] Failed to write motion event:`, err.message);
  }
}

// ─── SIGINT handler ───────────────────────────────────────────────────────────
process.on("SIGINT", function () {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("\nStopping Motion Logger and signing out of Firebase...");

  try {
    Thingy.stopScanning();
  } catch (_err) {
    // Ignore error stopping scan
  }

  signOut(auth)
    .then(() => {
      console.log("Firebase signed out. Exiting.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Sign out error:", err.message);
      process.exit(1);
    });
});

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log("Starting Passive BLE Motion Logger with Firebase...");
console.log(`Cooldown period: ${COOLDOWN_MS / 1000}s`);

signInWithEmailAndPassword(
  auth,
  process.env.FIREBASE_EMAIL,
  process.env.FIREBASE_PASSWORD,
)
  .then(() => {
    console.log("Firebase sign-in successful!");
    console.log(
      "Listening for Thingy:52 wake-on-motion advertisement packets...\n",
    );

    Thingy.discoverAll((thingy) => {
      if (isShuttingDown) return;

      const config = findConfig(thingy);
      if (!config) return;

      const until = cooldowns.get(config.name) || 0;
      if (Date.now() < until) return;

      // Set cooldown immediately so subsequent advertisements during the 180s wake window are ignored
      cooldowns.set(config.name, Date.now() + COOLDOWN_MS);

      const rssi = thingy._peripheral ? thingy._peripheral.rssi : null;
      const rssiStr =
        rssi !== null && rssi !== undefined ? ` (RSSI: ${rssi} dBm)` : "";

      console.log(
        `${config.emoji} [${config.name}] MOTION DETECTED!${rssiStr}`,
      );

      recordMotionEvent(config, rssi);
    });
  })
  .catch((err) => {
    console.error("Firebase sign-in failed:", err.code || err.message);
    process.exit(1);
  });
