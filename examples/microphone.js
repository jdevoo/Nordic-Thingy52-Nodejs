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
const Speaker = require("speaker");
const { parseArgs } = require("node:util");

// ─── ADPCM decoder ───────────────────────────────────────────────────────────
// Intel ADPCM step variation table
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

// ADPCM step size table
const STEP_SIZE_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];

/**
 * Decode an ADPCM frame (as emitted by thingy.sound.microphone) into signed
 * 16-bit PCM suitable for writing to a Speaker instance.
 *
 * @param {{ header: Buffer, data: Buffer }} adpcm
 * @returns {Buffer}  16-bit LE mono PCM at 16 kHz
 */
function adpcm_decode(adpcm) {
  const pcm = Buffer.alloc(adpcm.data.length * 4);
  let valuePredicted = adpcm.header.readInt16BE(0);
  let index = adpcm.header.readInt8(2);
  if (index < 0) index = 0;
  if (index > 88) index = 88;

  let bufferStep = false,
    inputBuffer = 0,
    delta,
    sign,
    diff;
  let step = STEP_SIZE_TABLE[index];

  for (let _in = 0, _out = 0; _in < adpcm.data.length; _out += 2) {
    if (bufferStep) {
      delta = inputBuffer & 0x0f;
      _in++;
    } else {
      inputBuffer = adpcm.data.readInt8(_in);
      delta = (inputBuffer >> 4) & 0x0f;
    }
    bufferStep = !bufferStep;

    index += INDEX_TABLE[delta];
    if (index < 0) index = 0;
    if (index > 88) index = 88;

    sign = delta & 8;
    delta = delta & 7;

    diff = step >> 3;
    if (delta & 4) diff += step;
    if (delta & 2) diff += step >> 1;
    if (delta & 1) diff += step >> 2;

    if (sign) valuePredicted -= diff;
    else valuePredicted += diff;

    if (valuePredicted > 32767) valuePredicted = 32767;
    else if (valuePredicted < -32768) valuePredicted = -32768;

    step = STEP_SIZE_TABLE[index];
    pcm.writeInt16LE(valuePredicted, _out);
  }
  return pcm;
}

// ─── CLI arguments ────────────────────────────────────────────────────────────
const { values: cliArgs } = parseArgs({
  options: {
    address: { type: "string", short: "a" },
    device: { type: "string", short: "d" },
  },
  strict: false,
});
const thingyId = cliArgs.address || null;
const soundDevice = cliArgs.device || null;

// ─── Speaker setup ────────────────────────────────────────────────────────────
const speakerOpts = {
  channels: 1,
  bitDepth: 16,
  sampleRate: 16000,
  samplesPerFrame: 256,
};
if (soundDevice) speakerOpts.device = soundDevice;
const speaker = new Speaker(speakerOpts);

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(
  "Microphone example — press and hold the button on the Thingy:52 to record.",
);

async function onDiscover(thingy) {
  try {
    await thingy.connect();
    console.log("Connected!");

    await thingy.ui.button.enable();
    console.log("Button enabled — press to start recording.");

    let micTask = null;

    for await (const pressed of thingy.ui.button) {
      if (pressed) {
        // Enable mic and start streaming it to the speaker in a background task.
        await thingy.sound.microphone.enable();
        thingy.ui.led.set({ r: 1, g: 40, b: 1 }).catch(() => {});
        console.log("Microphone enabled!");

        micTask = (async () => {
          for await (const adpcm of thingy.sound.microphone) {
            speaker.write(adpcm_decode(adpcm));
          }
        })();
      } else {
        // Disable mic — terminates the background for-await in micTask.
        await thingy.sound.microphone.disable();
        if (micTask) {
          await micTask;
          micTask = null;
        }
        thingy.ui.led
          .breathe({ color: 6, intensity: 20, delay: 3500 })
          .catch(() => {});
        console.log("Microphone disabled!");
      }
    }
  } catch (err) {
    console.error("Fatal:", err.message);
    process.exit(1);
  }
}

if (!thingyId) {
  Thingy.discover(onDiscover);
} else {
  Thingy.discoverById(thingyId, onDiscover);
}
