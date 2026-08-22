/*
  Copyright (c) 2010 - 2017, Nordic Semiconductor ASA
  All rights reserved.
  Redistribution and use in source and binary forms, with or without modification,
  are permitted provided that the following conditions are met:
  1. Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.
  2. Redistributions in binary form, except as embedded into a Nordic
     Semiconductor ASA integrated circuit in a product or a software update for
     such product, must reproduce the above copyright notice, this list of
     conditions and the following disclaimer in the documentation and/or other
     materials provided with the distribution.
  3. Neither the name of Nordic Semiconductor ASA nor the names of its
     contributors may be used to endorse or promote products derived from this
     software without specific prior written permission.
  4. This software, with or without modification, must only be used with a
     Nordic Semiconductor ASA integrated circuit.
  5. Any software provided in binary form under this license must not be reverse
     engineered, decompiled, modified and/or disassembled.
  THIS SOFTWARE IS PROVIDED BY NORDIC SEMICONDUCTOR ASA "AS IS" AND ANY EXPRESS
  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
  OF MERCHANTABILITY, NONINFRINGEMENT, AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
  GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
  HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
  LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
  OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Firebase v9+ modular SDK.
// Credentials come from environment variables — copy .env.example → .env.

const Thingy = require("../index");
const { GasMode } = require("../index");
const { parseArgs } = require("node:util");

const { initializeApp } = require("firebase/app");
const { getDatabase, ref, set } = require("firebase/database");
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
  console.error(
    "Copy .env.example → .env and fill in values, then: source .env",
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
  options: { address: { type: "string", short: "a" } },
  strict: false,
});
let thingyId = cliArgs.address || null;

// ─── State ────────────────────────────────────────────────────────────────────
let thisThingy = null;
let sigint = false;

// ─── SIGINT handler ───────────────────────────────────────────────────────────
process.on("SIGINT", function () {
  sigint = true;
  console.log("Signing out of Firebase...");
  signOut(auth)
    .then(() => console.log("Firebase signed out!"))
    .catch((err) => console.error("Sign out failed:", err.message));

  if (thisThingy) {
    // Disabling the streams unblocks the for-await loops in runSession(),
    // which causes the while loop to exit via the sigint check.
    Promise.all([
      thisThingy.environment.gas.disable(),
      thisThingy.environment.temperature.disable(),
    ])
      .catch(() => {})
      .then(() => {
        thisThingy.disconnect(() => process.exit(0));
      });
  } else {
    process.exit(0);
  }
});

// ─── Firebase write ───────────────────────────────────────────────────────────
async function firebaseWriteGasData(gas, temperature) {
  const now = new Date().toISOString();
  // "2026-08-17/14_30_00.000" — safe as a Firebase key
  const path =
    now.split("T")[0] + "/" + now.split("T")[1].split("Z")[0].replace(".", "_");
  console.log(path);
  await set(ref(db, `thingy/${thingyId}/${path}`), {
    eco2: gas.eco2,
    tvoc: gas.tvoc,
    temp: temperature,
  });
}

// ─── BLE session ─────────────────────────────────────────────────────────────
async function runSession(thingy) {
  await thingy.connect();
  console.log("Connected!");

  // Single atomic BLE write for both config fields.
  await thingy.environment.configure((cfg) => {
    cfg.gasMode = GasMode.EVERY_60S;
    cfg.temperatureInterval = 5000;
  });
  console.log("Environment configured!");

  await thingy.environment.gas.enable();
  await thingy.environment.temperature.enable();

  let currentTemp = 0;

  // Temperature stream runs in the background and populates currentTemp.
  const tempTask = (async () => {
    for await (const temp of thingy.environment.temperature) {
      currentTemp = temp;
    }
  })();

  // Gas stream drives the main loop; exits on disconnect or SIGINT.
  for await (const gas of thingy.environment.gas) {
    if (sigint) break;
    console.log(`Gas: eCO₂ ${gas.eco2} ppm  TVOC ${gas.tvoc} ppb`);
    firebaseWriteGasData(gas, currentTemp).catch(console.error);
  }

  await tempTask; // ensure background task cleans up
}

// ─── Discover & reconnect loop ────────────────────────────────────────────────
Thingy.discover(async function (thingy) {
  thingyId = thingyId || thingy.id;
  thisThingy = thingy;

  while (!sigint) {
    try {
      await runSession(thingy);
    } catch (err) {
      if (sigint) break;
      console.error("Session error:", err.message);
    }
    if (!sigint) {
      console.log("Disconnected! Reconnecting in 2 s...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("Firebase Thingy gas sensor!");
console.log("Signing in as:", process.env.FIREBASE_EMAIL);
signInWithEmailAndPassword(
  auth,
  process.env.FIREBASE_EMAIL,
  process.env.FIREBASE_PASSWORD,
).catch((err) => {
  console.error("Firebase sign-in failed:", err.code, "-", err.message);
  process.exit(1);
});
