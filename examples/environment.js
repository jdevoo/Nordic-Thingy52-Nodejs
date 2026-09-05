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

const Thingy = require("../index");
const { GasMode } = require("../index");
const { parseArgs } = require("node:util");

const { values: cliArgs } = parseArgs({
  options: {
    address: { type: "string", short: "a" },
  },
  strict: false,
});

console.log("Reading Thingy environment sensors!");
console.log("Press the button to toggle all sensors on/off.");

async function onDiscover(thingy) {
  try {
    await thingy.connect();
    console.log("Connected!");

    // Single atomic read-modify-write — no lost-update race.
    await thingy.environment.configure((cfg) => {
      cfg.temperatureInterval = 1000;
      cfg.pressureInterval = 1000;
      cfg.humidityInterval = 1000;
      cfg.colorInterval = 1000;
      cfg.gasMode = GasMode.EVERY_1S;
    });
    console.log("Environment configured!");

    // Gather all sensor streams into an array so we can enable/disable them together.
    const sensors = [
      thingy.environment.temperature,
      thingy.environment.pressure,
      thingy.environment.humidity,
      thingy.environment.color,
      thingy.environment.gas,
    ];

    /**
     * Runs a sensor in a background task.
     * The for-await loop exits automatically when the stream is disabled.
     */
    function startStream(sensor, handler) {
      (async () => {
        for await (const val of sensor) {
          handler(val);
        }
      })();
    }

    async function startAll() {
      await Promise.all(sensors.map((s) => s.enable()));
      startStream(thingy.environment.temperature, (t) =>
        console.log(`Temperature: ${t} °C`),
      );
      startStream(thingy.environment.pressure, (p) =>
        console.log(`Pressure: ${p} Pa`),
      );
      startStream(thingy.environment.humidity, (h) =>
        console.log(`Humidity: ${h} %`),
      );
      startStream(thingy.environment.color, (c) =>
        console.log(`Color: r${c.red} g${c.green} b${c.blue} c${c.clear}`),
      );
      startStream(thingy.environment.gas, (g) =>
        console.log(`Gas: eCO₂ ${g.eco2} ppm  TVOC ${g.tvoc} ppb`),
      );
      console.log("Environment sensors started!");
    }

    async function stopAll() {
      await Promise.all(sensors.map((s) => s.disable()));
      console.log("Environment sensors stopped!");
    }

    await startAll();

    let streaming = true;
    await thingy.ui.button.enable();

    // Button drives the toggle; the for-await exits when the device disconnects.
    for await (const pressed of thingy.ui.button) {
      if (!pressed) continue;
      if (streaming) {
        streaming = false;
        await stopAll();
      } else {
        streaming = true;
        await startAll(); // new background IIFEs start here
      }
    }
  } catch (err) {
    console.error("Fatal:", err.message);
    process.exit(1);
  }
}

if (cliArgs.address) {
  Thingy.discoverByAddress(cliArgs.address, onDiscover);
} else {
  Thingy.discover(onDiscover);
}
