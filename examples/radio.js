/*
  Copyright (c) 2010 - 2026, Nordic Semiconductor ASA
  All rights reserved.

  Internet Radio Stream to Nordic Thingy:52 Speaker example.
  Uses 8 kHz 8-bit PCM audio stream over BLE.
*/

"use strict";

const Thingy = require("../index");
const { SpeakerMode } = require("../index");
const icecast = require("icecast");
const lame = require("lame");
const util = require("util");

const url = "http://lyd.nrk.no:80/nrk_radio_p3_mp3_h";

let thisThingy = null;
let speakerConfigured = false;
let readyToSend = true;

const AUDIO_BUFFER_SIZE = 1000000;
const audioBuffer = Buffer.alloc(AUDIO_BUFFER_SIZE);
let audioBufferTail = 0;
let audioBufferHead = 0;

function convertAndBuffer(data) {
  if (speakerConfigured) {
    for (let index = 0; index < data.length - 1; index += 2) {
      const sample16 = data.readInt16LE(index);

      if ((audioBufferTail + 1) % AUDIO_BUFFER_SIZE === audioBufferHead) {
        console.log("Audio buffer full!");
      } else {
        const sample8 = Math.floor(sample16 / 256) + 128;
        audioBuffer.writeUInt8(sample8, audioBufferTail);
        audioBufferTail = (audioBufferTail + 1) % AUDIO_BUFFER_SIZE;
      }
    }
  }
}

function sendAudio() {
  if (!speakerConfigured || !thisThingy || !readyToSend) return;

  const blePacketSize = 273; // Max BLE packet size for Thingy speaker
  let bytesToSend = 0;

  if (audioBufferHead > audioBufferTail) {
    bytesToSend = AUDIO_BUFFER_SIZE - audioBufferHead;
  } else {
    bytesToSend = audioBufferTail - audioBufferHead;
  }

  if (bytesToSend >= blePacketSize) {
    const blePacket = Buffer.alloc(blePacketSize);
    audioBuffer.copy(
      blePacket,
      0,
      audioBufferHead,
      audioBufferHead + blePacketSize,
    );
    audioBufferHead = (audioBufferHead + blePacketSize) % AUDIO_BUFFER_SIZE;

    readyToSend = false;
    thisThingy.sound.speaker
      .write(blePacket)
      .then(() => {
        readyToSend = true;
      })
      .catch((_err) => {
        readyToSend = true;
      });
  }
}

const decoder8kHz = lame.Decoder();
decoder8kHz.on("format", function (format) {
  console.log(util.format("Decoder 8kHz Format: %j", format));
});
decoder8kHz.on("data", function (data) {
  convertAndBuffer(data);
});

const decoder = lame.Decoder();
decoder.on("format", function (format) {
  console.log(util.format("Decoder Format: %j", format));
  const encoder = lame.Encoder({
    channels: format.channels,
    bitDepth: format.bitDepth,
    sampleRate: format.sampleRate,
    bitRate: 128,
    outSampleRate: 8000,
    mode: lame.MONO,
  });
  decoder.pipe(encoder).pipe(decoder8kHz);
});

async function onDiscover(thingy) {
  console.log("Discovered: " + thingy.id);
  thisThingy = thingy;

  thingy.on("disconnect", function () {
    console.log("Disconnected!");
    speakerConfigured = false;
  });

  try {
    await thingy.connect({
      services: [Thingy.TSS_UUID],
      signal: AbortSignal.timeout(15000),
    });
    console.log("Connected to Thingy!");

    await thingy.sound.speaker.setMode(SpeakerMode.PCM);
    console.log("Speaker mode configured to PCM!");
    speakerConfigured = true;

    await thingy.sound.speaker.status.enable();
    (async () => {
      for await (const status of thingy.sound.speaker.status) {
        console.log("Speaker status:", status);
      }
    })();

    icecast.get(url, function (res) {
      res.on("data", function (data) {
        decoder.write(data);
      });
      res.on("metadata", function (metadata) {
        const track = icecast.parse(metadata).StreamTitle;
        if (track) console.log("Playing:", track);
      });
    });

    setInterval(sendAudio, 7);
  } catch (err) {
    console.error("Connection or setup failed:", err.message);
  }
}

Thingy.discover(onDiscover);
