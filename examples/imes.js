"use strict";

/**
 * imes.js — Smart MES integration gateway for Nordic Thingy:52.
 *
 * Connects to a physical Thingy:52, monitors button presses & taps as physical
 * product counts ("pulses"), and updates the live counter and heartbeat under
 * the MES Firebase company schema.
 *
 * Usage:
 *   node examples/imes.js -n "Thingy Blue"
 *   node examples/imes.js -a "aa:bb:cc:dd:ee:01"
 */

const Thingy = require("../index");
const { Direction } = require("../index");
const { parseArgs } = require("node:util");

const { initializeApp } = require("firebase/app");
const {
  getDatabase,
  ref,
  get,
  update,
  increment,
} = require("firebase/database");
const {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} = require("firebase/auth");

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
  console.error("Copy .env.example → .env and fill in values.");
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
    address: { type: "string", short: "a" }, // BLE MAC address of the Thingy
    name: { type: "string", short: "n" }, // Device record Name in the MES to bind to
  },
  strict: false,
});

const targetAddress = cliArgs.address || null;
const targetName = cliArgs.name || null;

let thisThingy = null;
let sigint = false;
let companyKey = null;
let boundDeviceKey = null;
let heartbeatInterval = null;

// ─── SIGINT handler ───────────────────────────────────────────────────────────
process.on("SIGINT", function () {
  sigint = true;
  console.log("\nGraceful shutdown initiated...");

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  signOut(auth)
    .then(() => console.log("Firebase session signed out."))
    .catch((err) => console.error("Sign out failed:", err.message));

  if (thisThingy) {
    Promise.all([
      thisThingy.ui.button.disable(),
      thisThingy.motion.tap.disable(),
    ])
      .catch(() => {})
      .then(() => {
        thisThingy.disconnect(() => {
          console.log("Bluetooth disconnected. Exiting.");
          process.exit(0);
        });
      });
  } else {
    process.exit(0);
  }
});

// ─── Pulse & Heartbeat writes ────────────────────────────────────────────────
async function recordPulse(deviceKey) {
  if (!companyKey || !deviceKey) return;
  const timestamp = Math.round(Date.now() / 1000);

  console.log(
    `[Pulse] Incrementing counter and updating heartbeat for device: ${deviceKey}`,
  );
  try {
    await update(
      ref(db, `data/${companyKey}/factoryData/device/${deviceKey}`),
      {
        counter: increment(1),
        update: timestamp,
      },
    );
  } catch (err) {
    console.error("Failed to write pulse:", err.message);
  }
}

async function sendHeartbeat(deviceKey) {
  if (!companyKey || !deviceKey) return;
  const timestamp = Math.round(Date.now() / 1000);

  console.log(`[Heartbeat] Keeping device online: ${deviceKey}`);
  try {
    await update(
      ref(db, `data/${companyKey}/factoryData/device/${deviceKey}`),
      {
        update: timestamp,
      },
    );
  } catch (err) {
    console.error("Failed to send heartbeat:", err.message);
  }
}

// ─── BLE Session ─────────────────────────────────────────────────────────────
async function runSession(thingy, deviceKey) {
  await thingy.connect({ signal: AbortSignal.timeout(8000) });
  console.log(`Connected to Thingy:52 (${thingy.id})!`);

  try {
    // Ensure hardware auto-wake is programmed on the Thingy
    await thingy.motion.configure((cfg) => {
      cfg.motionProcessingFrequency = 5;
      cfg.wakeOnMotion = 1;
    }).catch(() => {});

    // Set reference LED cyan to show online status
    await thingy.ui.led.set({ r: 0, g: 15, b: 15 }).catch(() => {});

    await thingy.ui.button.enable();
    await thingy.motion.tap.enable();
    console.log(
      "Sensors enabled. Press the button or tap the Thingy to count pieces.",
    );

    // Send initial heartbeat
    await sendHeartbeat(deviceKey);

    // Set up periodic heartbeat every 10 seconds to keep the device "Online" in the MES dashboard
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      sendHeartbeat(deviceKey).catch(console.error);
    }, 10000);

    // Task 1: Tap sensor pulse detection
    const tapTask = (async () => {
      for await (const tap of thingy.motion.tap) {
        console.log(
          `[Sensor] Tap registered! Direction: ${Direction[tap.direction] || tap.direction}, Count: ${tap.count}`,
        );
        await recordPulse(deviceKey);
      }
    })();

    // Task 2: Button press pulse detection
    const buttonTask = (async () => {
      for await (const pressed of thingy.ui.button) {
        if (pressed) {
          console.log("[Sensor] Button Pressed!");
          await recordPulse(deviceKey);

          // Flash Green on success
          await thingy.ui.led
            .oneShot({ color: 2, intensity: 30 })
            .catch(() => {});
          // Restore cyan status
          await thingy.ui.led.set({ r: 0, g: 15, b: 15 }).catch(() => {});
        }
      }
    })();

    // Wait for both loops to terminate (on disconnect or disable)
    await Promise.all([tapTask, buttonTask]);

  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }
}

// ─── Setup Device Association from Firebase ─────────────────────────────────
async function fetchCompanyAndDevice() {
  const user = auth.currentUser;
  if (!user) throw new Error("User not logged in");

  // 1. Fetch user's company key
  const userSnap = await get(ref(db, `user/${user.uid}/key`));
  companyKey = userSnap.val();
  if (!companyKey)
    throw new Error(`No company key configured for user ${user.uid}`);
  console.log("Discovered Company Key:", companyKey);

  // 2. Fetch list of devices under this company to match our target
  const devicesSnap = await get(
    ref(db, `data/${companyKey}/factoryData/device`),
  );
  const devices = devicesSnap.val() || {};

  console.log("\nRegistered MES Devices:");
  console.table(
    Object.entries(devices).map(([key, d]) => ({
      Key: key,
      Name: d.name,
      Type: d.type,
      Machine: d.machine || "Unallocated",
      Counter: d.counter,
      Enabled: d.enable,
    })),
  );

  // Try to find a match
  for (const [key, dev] of Object.entries(devices)) {
    // Match by exact name parameter if provided
    if (targetName && dev.name === targetName) {
      boundDeviceKey = key;
      break;
    }
    // Match by target BLE address if matching the name/id
    if (targetAddress) {
      const cleanAddress = targetAddress.replace(/:/g, "").toLowerCase();
      const cleanDevName = dev.name.replace(/:/g, "").toLowerCase();
      if (cleanAddress === cleanDevName) {
        boundDeviceKey = key;
        break;
      }
    }
    // Fallback: If no parameters, find the first device that is enabled and not named 'Disable'
    if (!targetName && !targetAddress && dev.enable && dev.name !== "Disable") {
      boundDeviceKey = key;
      break;
    }
  }

  if (!boundDeviceKey) {
    if (targetName) {
      throw new Error(
        `Could not find an active MES device with name "${targetName}"`,
      );
    } else if (targetAddress) {
      throw new Error(
        `Could not find an active MES device matching BLE address "${targetAddress}"`,
      );
    } else {
      throw new Error(
        "No active/enabled MES devices found in database to bind with.",
      );
    }
  }

  console.log(
    `\nSuccessfully bound to MES Device Node: "${devices[boundDeviceKey].name}" (Key: ${boundDeviceKey})`,
  );
}

// ─── Entry Point ─────────────────────────────────────────────────────────────
console.log("=============================================");
console.log("   iMES Nordic Thingy:52 Telemetry Gateway   ");
console.log("=============================================");
console.log("Signing in to Smart MES as:", process.env.FIREBASE_EMAIL);

signInWithEmailAndPassword(
  auth,
  process.env.FIREBASE_EMAIL,
  process.env.FIREBASE_PASSWORD,
)
  .then(async () => {
    console.log("Sign-in successful!");
    await fetchCompanyAndDevice();

    const targetBle = targetAddress || "any nearby Thingy:52";
    console.log(`\nScanning for ${targetBle}...`);

    const onDiscover = async (thingy) => {
      thisThingy = thingy;

      while (!sigint) {
        try {
          await runSession(thingy, boundDeviceKey);
        } catch (err) {
          if (sigint) break;
          console.error("Session disconnected or failed:", err.message);
        }
        if (!sigint) {
          console.log("Attempting to reconnect to Thingy in 2 seconds...");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    };

    if (targetAddress) {
      Thingy.discoverById(targetAddress, onDiscover);
    } else {
      Thingy.discover(onDiscover);
    }
  })
  .catch((err) => {
    console.error("Failed to initialize gateway:", err.message);
    process.exit(1);
  });
