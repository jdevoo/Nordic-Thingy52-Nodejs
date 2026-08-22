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

// Uses the built-in `fetch` (Node 18+) — no `request` npm package needed.

const Thingy = require("../index");
const { GasMode } = require("../index");
const { format, parseArgs } = require("node:util");

const BASE_URL = "https://maker.ifttt.com/trigger/%s/with/key/%s";

// ─── CLI arguments ────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    address: { type: "string", short: "a" },
    event: { type: "string", short: "e" },
    key: { type: "string", short: "k" },
  },
  strict: false,
});

const thingyId = args.address || null;
const makerEvt = args.event || null;
const makerKey = args.key || null;

if (!makerKey || !makerEvt) {
  console.log("Please specify IFTTT Maker Service event and key:");
  console.log("node ifttt_gas.js -e <event> -k <key> [-a <address>]");
  process.exit(1);
}

// ─── IFTTT push via built-in fetch ───────────────────────────────────────────
async function ifttt_gas_push(eco2, tvoc) {
  const url =
    format(BASE_URL, makerEvt, makerKey) +
    "?value1=" +
    encodeURIComponent(eco2) +
    "&value2=" +
    encodeURIComponent(tvoc);
  try {
    const res = await fetch(url, { method: "POST" });
    if (res.ok) {
      console.log("Gas data pushed to IFTTT");
    } else {
      const body = await res.json().catch(() => null);
      console.log("IFTTT push failed: " + JSON.stringify(body));
    }
  } catch (err) {
    console.log("IFTTT request error: " + err.message);
  }
}

// ─── BLE session ─────────────────────────────────────────────────────────────
async function runSession(thingy) {
  await thingy.connect();
  console.log("Connected!");

  await thingy.environment.configure((cfg) => {
    cfg.gasMode = GasMode.EVERY_60S;
  });
  console.log("Gas sensor configured!");

  await thingy.environment.gas.enable();
  console.log("Gas sensor started!");

  // for-await exits when the device disconnects (SensorStream flushes on disconnect).
  for await (const gas of thingy.environment.gas) {
    console.log(`Gas: eCO₂ ${gas.eco2} ppm  TVOC ${gas.tvoc} ppb`);
    ifttt_gas_push(gas.eco2, gas.tvoc).catch(console.error);
  }
}

async function onDiscover(thingy) {
  while (true) {
    try {
      await runSession(thingy);
    } catch (err) {
      console.error("Connection error:", err.message);
    }
    console.log("Disconnected! Reconnecting in 2 s...");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("IFTTT Thingy gas sensor!");

if (!thingyId) {
  Thingy.discover(onDiscover);
} else {
  Thingy.discoverById(thingyId, onDiscover);
}
