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
const { Direction, Orientation } = require("../index");
const { parseArgs } = require("node:util");

const { values: cliArgs } = parseArgs({
  options: {
    address: { type: "string", short: "a" },
  },
  strict: false,
});

console.log("Reading Thingy Motion sensors!");
console.log("Press the button to toggle all sensors on/off.");

async function onDiscover(thingy) {
  try {
    await thingy.connect();
    console.log("Connected!");

    await thingy.motion.configure((cfg) => {
      cfg.motionProcessingFrequency = 5; // Hz
    });
    console.log("Motion processing frequency set to 5 Hz!");

    const sensors = [
      thingy.motion.tap,
      thingy.motion.orientation,
      thingy.motion.quaternion,
      thingy.motion.stepCounter,
      thingy.motion.rawMotion,
      thingy.motion.euler,
      thingy.motion.rotation,
      thingy.motion.heading,
      thingy.motion.gravity,
    ];

    function startStream(sensor, handler) {
      (async () => {
        for await (const val of sensor) {
          handler(val);
        }
      })();
    }

    async function startAll() {
      for (const sensor of sensors) {
        await sensor.enable();
      }
      startStream(thingy.motion.tap, (tap) =>
        console.log(
          `Tap: direction ${Direction[tap.direction]} (${tap.direction}), count ${tap.count}`,
        ),
      );
      startStream(thingy.motion.orientation, (o) =>
        console.log(`Orientation: ${Orientation[o]} (${o})`),
      );
      startStream(thingy.motion.quaternion, (q) =>
        console.log(
          `Quaternion: w ${q.w.toFixed(4)} x ${q.x.toFixed(4)} y ${q.y.toFixed(4)} z ${q.z.toFixed(4)}`,
        ),
      );
      startStream(thingy.motion.stepCounter, (sc) =>
        console.log(`Step Counter: ${sc.steps} steps, ${sc.time} ms`),
      );
      startStream(thingy.motion.rawMotion, (r) =>
        console.log(
          `Accelerometer: x ${r.accelerometer.x.toFixed(3)} y ${r.accelerometer.y.toFixed(3)} z ${r.accelerometer.z.toFixed(3)}  ` +
            `Gyroscope: x ${r.gyroscope.x.toFixed(3)} y ${r.gyroscope.y.toFixed(3)} z ${r.gyroscope.z.toFixed(3)}`,
        ),
      );
      startStream(thingy.motion.euler, (e) =>
        console.log(
          `Euler: roll ${e.roll.toFixed(2)} pitch ${e.pitch.toFixed(2)} yaw ${e.yaw.toFixed(2)}`,
        ),
      );
      startStream(thingy.motion.rotation, (m) => {
        console.log("Rotation matrix:");
        console.table(m);
      });
      startStream(thingy.motion.heading, (h) =>
        console.log(`Heading: ${h.toFixed(2)}`),
      );
      startStream(thingy.motion.gravity, (g) =>
        console.log(
          `Gravity: x ${g.x.toFixed(3)} y ${g.y.toFixed(3)} z ${g.z.toFixed(3)}`,
        ),
      );
      console.log("Motion sensors started!");
    }

    async function stopAll() {
      for (const sensor of sensors) {
        await sensor.disable();
      }
      console.log("Motion sensors stopped!");
    }

    await startAll();

    let streaming = true;
    await thingy.ui.button.enable();

    for await (const pressed of thingy.ui.button) {
      if (!pressed) continue;
      if (streaming) {
        streaming = false;
        await stopAll();
      } else {
        streaming = true;
        await startAll();
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
