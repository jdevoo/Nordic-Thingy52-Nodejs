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
const { parseArgs } = require("node:util");

const { values: cliArgs } = parseArgs({
  options: {
    address: { type: "string", short: "a" },
  },
  strict: false,
});

const MIN_INTENSITY = 2600;
const MAX_INTENSITY = 2650;

let led = { red: 120, green: 60, blue: 20 };

function clamp(v) {
  return Math.max(0, Math.min(255, v));
}

console.log("Nordic Thingy:52 colour sensor calibration!");
console.log(
  "Place the Thingy:52 on something white, then press the button to start.",
);

async function onDiscover(thingy) {
  try {
    await thingy.connect();
    console.log("Connected!");

    await thingy.ui.led.off();

    // Initialise colour interval and reference LED in one atomic write.
    await thingy.environment.configure((cfg) => {
      cfg.colorInterval = 1500;
      cfg.refLed = led;
    });

    await thingy.ui.button.enable();
    console.log("Button enabled — press to toggle colour sensor on/off.");

    let streaming = false;
    let colorTask = null;

    for await (const pressed of thingy.ui.button) {
      if (!pressed) continue;

      if (streaming) {
        // Stop: disable stream → terminates the background IIFE's for-await.
        streaming = false;
        await thingy.environment.color.disable();
        if (colorTask) {
          await colorTask;
          colorTask = null;
        }
        console.log("Colour sensor stopped!");
      } else {
        // Start: enable stream → kick off background calibration loop.
        streaming = true;
        await thingy.environment.color.enable();
        console.log("Colour sensor started!");

        colorTask = (async () => {
          for await (const color of thingy.environment.color) {
            console.log(
              `Color: r${color.red} g${color.green} b${color.blue} c${color.clear}`,
            );

            // Compute normalised 8-bit RGB for display
            const sum = color.red + color.green + color.blue;
            if (sum > 0) {
              const norm = Math.max(0, (color.clear - 300) / 100);
              const r8 = Math.min(255, (color.red / sum) * 255 * 3 * norm);
              const g8 = Math.min(255, (color.green / sum) * 255 * 3 * norm);
              const b8 = Math.min(255, (color.blue / sum) * 255 * 3 * norm);
              console.log(
                `rgb(${r8.toFixed(0)},${g8.toFixed(0)},${b8.toFixed(0)})`,
              );
            }

            // Closed-loop: nudge the reference LED to bring each channel into
            // [MIN_INTENSITY, MAX_INTENSITY].
            const newLed = {
              red:
                color.red < MIN_INTENSITY
                  ? clamp(led.red + 1)
                  : color.red > MAX_INTENSITY
                    ? clamp(led.red - 1)
                    : led.red,
              green:
                color.green < MIN_INTENSITY
                  ? clamp(led.green + 1)
                  : color.green > MAX_INTENSITY
                    ? clamp(led.green - 1)
                    : led.green,
              blue:
                color.blue < MIN_INTENSITY
                  ? clamp(led.blue + 1)
                  : color.blue > MAX_INTENSITY
                    ? clamp(led.blue - 1)
                    : led.blue,
            };

            if (
              newLed.red !== led.red ||
              newLed.green !== led.green ||
              newLed.blue !== led.blue
            ) {
              led = newLed;
              console.log(`Led config: r${led.red} g${led.green} b${led.blue}`);
              // The configure() queue serialises this write against any other
              // pending config operations.
              await thingy.environment
                .configure((cfg) => {
                  cfg.refLed = led;
                })
                .catch(console.error);
            }
          }
        })();
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
