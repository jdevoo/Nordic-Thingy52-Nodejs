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

"use strict";

const NobleDevice = require("noble-device");
const codec = require("./codec");
const { LedMode } = require("./enums");
const { SensorStream } = require("./sensor-stream");

// Patch noble's Gap.prototype.startScanning on Linux HCI sockets.
// noble by default re-issues setScanParameters() on every scan restart,
// which fails with HCI Error 0x0C (Command Disallowed) on Linux controllers
// (such as Raspberry Pi 3) whenever an active BLE connection exists.
try {
  const noble = require("noble");
  const bindings = noble?._bindings;
  if (bindings && bindings._gap) {
    const gap = bindings._gap;
    let scanParamsSet = false;
    gap.startScanning = function (allowDuplicates) {
      this._scanState = "starting";
      this._scanFilterDuplicates = !allowDuplicates;

      if (!scanParamsSet) {
        this._hci.setScanEnabled(false, true);
        this._hci.setScanParameters();
        scanParamsSet = true;
      }

      this._hci.setScanEnabled(true, this._scanFilterDuplicates);
    };
  }
} catch {
  // Ignore if noble is not loaded or on non-HCI platforms
}

// ─── GATT UUIDs ──────────────────────────────────────────────────────────────

const TCS_UUID = "ef6801009b3549339b1052ffa9740042";

const TES_UUID = "ef6802009b3549339b1052ffa9740042";
const TES_TEMP_UUID = "ef6802019b3549339b1052ffa9740042";
const TES_PRESS_UUID = "ef6802029b3549339b1052ffa9740042";
const TES_HUMID_UUID = "ef6802039b3549339b1052ffa9740042";
const TES_GAS_UUID = "ef6802049b3549339b1052ffa9740042";
const TES_COLOR_UUID = "ef6802059b3549339b1052ffa9740042";
const TES_CONF_UUID = "ef6802069b3549339b1052ffa9740042";

const UIS_UUID = "ef6803009b3549339b1052ffa9740042";
const UIS_LED_UUID = "ef6803019b3549339b1052ffa9740042";
const UIS_BTN_UUID = "ef6803029b3549339b1052ffa9740042";

const TMS_UUID = "ef6804009b3549339b1052ffa9740042";
const TMS_CONF_UUID = "ef6804019b3549339b1052ffa9740042";
const TMS_TAP_UUID = "ef6804029b3549339b1052ffa9740042";
const TMS_ORIENTATION_UUID = "ef6804039b3549339b1052ffa9740042";
const TMS_QUATERNION_UUID = "ef6804049b3549339b1052ffa9740042";
const TMS_STEP_COUNTER_UUID = "ef6804059b3549339b1052ffa9740042";
const TMS_RAW_DATA_UUID = "ef6804069b3549339b1052ffa9740042";
const TMS_EULER_UUID = "ef6804079b3549339b1052ffa9740042";
const TMS_ROTATION_UUID = "ef6804089b3549339b1052ffa9740042";
const TMS_HEADING_UUID = "ef6804099b3549339b1052ffa9740042";
const TMS_GRAVITY_UUID = "ef68040a9b3549339b1052ffa9740042";

const TSS_UUID = "ef6805009b3549339b1052ffa9740042";
const TSS_CONF_UUID = "ef6805019b3549339b1052ffa9740042";
const TSS_SPEAKER_DATA_UUID = "ef6805029b3549339b1052ffa9740042";
const TSS_SPEAKER_STAT_UUID = "ef6805039b3549339b1052ffa9740042";
const TSS_MIC_UUID = "ef6805049b3549339b1052ffa9740042";

// Standard BLE Battery Service UUIDs
const BATTERY_SVC_UUID = "180f";
const BATTERY_LEVEL_UUID = "2a19";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalise any thrown / callback error value into a proper Error. */
function asError(e) {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * One-at-a-time async serial queue.
 * Each task receives `release`; call it when the async work finishes.
 * Serialises concurrent read-modify-write operations on a shared config
 * characteristic so no write is built from a stale snapshot.
 */
function makeSerialQueue() {
  let busy = false;
  const pending = [];
  function drain() {
    if (busy || pending.length === 0) return;
    busy = true;
    pending.shift()(function release() {
      busy = false;
      drain();
    });
  }
  return {
    push(task) {
      pending.push(task);
      drain();
    },
  };
}

/**
 * Serialised read-modify-write on a config characteristic.
 * Resolves after the write is acknowledged. Rejects on any BLE error.
 *
 * @param {object}   thingy     Noble-device Thingy instance.
 * @param {object}   queue      Serial queue for this characteristic.
 * @param {string}   svcUuid
 * @param {string}   charUuid
 * @param {function} mutateFn   Synchronous (proxy) → void; throw to abort.
 * @param {function} buildProxy (Buffer) → config proxy object.
 * @returns {Promise<void>}
 */
function configTransaction(
  thingy,
  queue,
  svcUuid,
  charUuid,
  mutateFn,
  buildProxy,
) {
  return new Promise((resolve, reject) => {
    queue.push((release) => {
      thingy.readDataCharacteristic(svcUuid, charUuid, (readErr, rawData) => {
        if (readErr) {
          release();
          return reject(asError(readErr));
        }

        let data = rawData;
        // TMS_CONF_UUID is 9 bytes long on Thingy:52 firmware.
        // If read returns an 8-byte buffer, expand to 9 bytes so wakeOnMotion (byte 8) can be written.
        if (charUuid === TMS_CONF_UUID && data.length < 9) {
          const expanded = Buffer.alloc(9);
          data.copy(expanded);
          data = expanded;
        }

        try {
          mutateFn(buildProxy(data));
        } catch (e) {
          release();
          return reject(asError(e));
        }
        thingy.writeDataCharacteristic(svcUuid, charUuid, data, (writeErr) => {
          release();
          writeErr ? reject(asError(writeErr)) : resolve();
        });
      });
    });
  });
}

// ─── Config proxy builders ────────────────────────────────────────────────────

function buildTesProxy(data) {
  return {
    get temperatureInterval() {
      return data.readUInt16LE(0);
    },
    set temperatureInterval(v) {
      data.writeUInt16LE(v, 0);
    },
    get pressureInterval() {
      return data.readUInt16LE(2);
    },
    set pressureInterval(v) {
      data.writeUInt16LE(v, 2);
    },
    get humidityInterval() {
      return data.readUInt16LE(4);
    },
    set humidityInterval(v) {
      data.writeUInt16LE(v, 4);
    },
    get colorInterval() {
      return data.readUInt16LE(6);
    },
    set colorInterval(v) {
      data.writeUInt16LE(v, 6);
    },
    get gasMode() {
      return data.readUInt8(8);
    },
    set gasMode(v) {
      data.writeUInt8(v, 8);
    },
    get refLed() {
      return {
        red: data.readUInt8(9),
        green: data.readUInt8(10),
        blue: data.readUInt8(11),
      };
    },
    set refLed(v) {
      data.writeUInt8(v.red, 9);
      data.writeUInt8(v.green, 10);
      data.writeUInt8(v.blue, 11);
    },
  };
}

function buildTmsProxy(data) {
  return {
    get stepCounterInterval() {
      return data.readUInt16LE(0);
    },
    set stepCounterInterval(v) {
      data.writeUInt16LE(v, 0);
    },
    get tempCompensationInterval() {
      return data.readUInt16LE(2);
    },
    set tempCompensationInterval(v) {
      data.writeUInt16LE(v, 2);
    },
    get magnetometerCompensationInterval() {
      return data.readUInt16LE(4);
    },
    set magnetometerCompensationInterval(v) {
      data.writeUInt16LE(v, 4);
    },
    get motionProcessingFrequency() {
      return data.readUInt16LE(6);
    },
    set motionProcessingFrequency(v) {
      data.writeUInt16LE(v, 6);
    },
    get wakeOnMotion() {
      return data.length >= 9 ? data.readUInt8(8) : 0;
    },
    set wakeOnMotion(v) {
      if (data.length >= 9) {
        data.writeUInt8(v, 8);
      }
    },
  };
}

// ─── Service factories ────────────────────────────────────────────────────────

/**
 * Environment service namespace.
 *
 * Sensors (all SensorStreams):
 *   temperature — number (°C)
 *   pressure    — number (Pa)
 *   humidity    — number (% RH)
 *   gas         — { eco2: number, tvoc: number }
 *   color       — { red, green, blue, clear }
 *
 * configure(fn) — single atomic read-modify-write on TES_CONF_UUID.
 */
function makeEnvironmentService(thingy) {
  const q = makeSerialQueue();
  return Object.freeze({
    temperature: new SensorStream(
      thingy,
      TES_UUID,
      TES_TEMP_UUID,
      (b) => codec.decodeTemperature(b).value,
    ),
    pressure: new SensorStream(
      thingy,
      TES_UUID,
      TES_PRESS_UUID,
      (b) => codec.decodePressure(b).value,
    ),
    humidity: new SensorStream(
      thingy,
      TES_UUID,
      TES_HUMID_UUID,
      codec.decodeHumidity,
    ),
    gas: new SensorStream(thingy, TES_UUID, TES_GAS_UUID, codec.decodeGas),
    color: new SensorStream(
      thingy,
      TES_UUID,
      TES_COLOR_UUID,
      codec.decodeColor,
    ),
    /**
     * Atomically configure one or more environment settings.
     * @param {function(cfg: TesConfig): void} mutateFn
     * @returns {Promise<void>}
     * @example
     * await thingy.environment.configure(cfg => {
     *   cfg.temperatureInterval = 1000;
     *   cfg.gasMode             = GasMode.EVERY_10S;
     * });
     */
    configure(mutateFn) {
      return configTransaction(
        thingy,
        q,
        TES_UUID,
        TES_CONF_UUID,
        mutateFn,
        buildTesProxy,
      );
    },
  });
}

/**
 * Motion service namespace.
 *
 * Sensors (all SensorStreams):
 *   tap         — { direction: number, count: number }
 *   orientation — number  (see Orientation enum)
 *   quaternion  — { w, x, y, z }  Q30
 *   stepCounter — { steps: number, time: number }
 *   rawMotion   — { accelerometer, gyroscope, compass }  (Q10/Q5/Q4)
 *   euler       — { roll, pitch, yaw }  Q16
 *   rotation    — { m_11 … m_33 }  Q14 row-major
 *   heading     — number  Q16
 *   gravity     — { x, y, z }  float32
 *
 * configure(fn) — single atomic read-modify-write on TMS_CONF_UUID.
 */
function makeMotionService(thingy) {
  const q = makeSerialQueue();
  return Object.freeze({
    tap: new SensorStream(thingy, TMS_UUID, TMS_TAP_UUID, codec.decodeTap),
    orientation: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_ORIENTATION_UUID,
      codec.decodeOrientation,
    ),
    quaternion: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_QUATERNION_UUID,
      codec.decodeQuaternion,
    ),
    stepCounter: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_STEP_COUNTER_UUID,
      codec.decodeStepCounter,
    ),
    rawMotion: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_RAW_DATA_UUID,
      codec.decodeRawMotion,
    ),
    euler: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_EULER_UUID,
      codec.decodeEuler,
    ),
    rotation: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_ROTATION_UUID,
      codec.decodeRotationMatrix,
    ),
    heading: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_HEADING_UUID,
      codec.decodeHeading,
    ),
    gravity: new SensorStream(
      thingy,
      TMS_UUID,
      TMS_GRAVITY_UUID,
      codec.decodeGravity,
    ),
    /**
     * Atomically configure one or more motion settings.
     * @param {function(cfg: TmsConfig): void} mutateFn
     * @returns {Promise<void>}
     */
    configure(mutateFn) {
      return configTransaction(
        thingy,
        q,
        TMS_UUID,
        TMS_CONF_UUID,
        mutateFn,
        buildTmsProxy,
      );
    },
  });
}

/**
 * User Interface service namespace.
 *
 *   button — SensorStream yielding boolean (true = pressed)
 *   led    — { set, breathe, oneShot, off }  all return Promise<void>
 */
function makeUIService(thingy) {
  const button = new SensorStream(
    thingy,
    UIS_UUID,
    UIS_BTN_UUID,
    codec.decodeButton,
  );

  /**
   * Write a buffer to the LED characteristic, returning a Promise.
   * @private
   */
  function writeLed(buf) {
    return new Promise((resolve, reject) =>
      thingy.writeDataCharacteristic(UIS_UUID, UIS_LED_UUID, buf, (err) =>
        err ? reject(asError(err)) : resolve(),
      ),
    );
  }

  const led = Object.freeze({
    /** Turn the LED off. @returns {Promise<void>} */
    off() {
      return new Promise((resolve, reject) =>
        thingy.writeUInt8Characteristic(UIS_UUID, UIS_LED_UUID, 0, (err) =>
          err ? reject(asError(err)) : resolve(),
        ),
      );
    },
    /**
     * Constant RGB colour.
     * @param {{ r: number, g: number, b: number }} data  Values 0–255.
     * @returns {Promise<void>}
     */
    set(data) {
      if (!data || !("r" in data) || !("g" in data) || !("b" in data)) {
        return Promise.reject(new TypeError("led.set: expected { r, g, b }"));
      }
      const buf = Buffer.alloc(4);
      buf.writeUInt8(LedMode.CONSTANT, 0);
      buf.writeUInt8(data.r, 1);
      buf.writeUInt8(data.g, 2);
      buf.writeUInt8(data.b, 3);
      return writeLed(buf);
    },
    /**
     * Breathing pulse.
     * @param {{ color: number, intensity: number, delay: number }} data
     * @returns {Promise<void>}
     */
    breathe(data) {
      if (
        !data ||
        !("color" in data) ||
        !("intensity" in data) ||
        !("delay" in data)
      ) {
        return Promise.reject(
          new TypeError("led.breathe: expected { color, intensity, delay }"),
        );
      }
      const buf = Buffer.alloc(5);
      buf.writeUInt8(LedMode.BREATHE, 0);
      buf.writeUInt8(data.color, 1);
      buf.writeUInt8(data.intensity, 2);
      buf.writeUInt16LE(data.delay, 3);
      return writeLed(buf);
    },
    /**
     * Single flash.
     * @param {{ color: number, intensity: number }} data
     * @returns {Promise<void>}
     */
    oneShot(data) {
      if (!data || !("color" in data) || !("intensity" in data)) {
        return Promise.reject(
          new TypeError("led.oneShot: expected { color, intensity }"),
        );
      }
      const buf = Buffer.alloc(3);
      buf.writeUInt8(LedMode.ONE_SHOT, 0);
      buf.writeUInt8(data.color, 1);
      buf.writeUInt8(data.intensity, 2);
      return writeLed(buf);
    },
  });

  return Object.freeze({ button, led });
}

/**
 * Sound service namespace.
 *
 *   microphone         — SensorStream yielding { header: Buffer, data: Buffer }
 *   microphone.setMode — (MicMode) → Promise<void>
 *   speaker.setMode    — (SpeakerMode) → Promise<void>
 *   speaker.write      — (pcmBuffer) → Promise<void>
 *   speaker.status     — SensorStream yielding number
 *
 * speaker.setMode and microphone.setMode both write byte 0 of TSS_CONF_UUID
 * and share a serial queue to prevent racing each other.
 */
function makeSoundService(thingy) {
  const q = makeSerialQueue();

  /** Read-modify-write byte 0 of TSS_CONF_UUID through the shared queue. */
  function setTssConf(mode) {
    return new Promise((resolve, reject) => {
      q.push((release) => {
        thingy.readDataCharacteristic(TSS_UUID, TSS_CONF_UUID, (err, data) => {
          if (err) {
            release();
            return reject(asError(err));
          }
          data.writeUInt8(mode, 0);
          thingy.writeDataCharacteristic(
            TSS_UUID,
            TSS_CONF_UUID,
            data,
            (writeErr) => {
              release();
              writeErr ? reject(asError(writeErr)) : resolve();
            },
          );
        });
      });
    });
  }

  const microphone = new SensorStream(
    thingy,
    TSS_UUID,
    TSS_MIC_UUID,
    codec.decodeMicrophone,
  );
  microphone.setMode = setTssConf;

  const speakerStatus = new SensorStream(
    thingy,
    TSS_UUID,
    TSS_SPEAKER_STAT_UUID,
    codec.decodeSpeakerStatus,
  );

  const speaker = Object.freeze({
    /** Set the speaker playback mode (SpeakerMode enum). @returns {Promise<void>} */
    setMode: setTssConf,
    /** Write a raw PCM buffer. @param {Buffer} pcm @returns {Promise<void>} */
    write(pcm) {
      return new Promise((resolve, reject) =>
        thingy.writeDataCharacteristic(
          TSS_UUID,
          TSS_SPEAKER_DATA_UUID,
          pcm,
          (err) => (err ? reject(asError(err)) : resolve()),
        ),
      );
    },
    /** Speaker status notification stream (yields number). */
    status: speakerStatus,
  });

  return Object.freeze({ microphone, speaker });
}

/**
 * Battery service.
 * Returns a SensorStream (for level-change notifications) augmented with
 * a one-shot read() method. Standard BLE UUIDs 0x180F / 0x2A19.
 *
 *   await thingy.battery.read()        — current level (0–100 %)
 *   await thingy.battery.enable()      — start notifications
 *   for await (const lvl of thingy.battery) { ... }
 */
function makeBatteryService(thingy) {
  const stream = new SensorStream(
    thingy,
    BATTERY_SVC_UUID,
    BATTERY_LEVEL_UUID,
    (buf) => buf.readUInt8(0),
  );
  stream.read = () =>
    new Promise((resolve, reject) =>
      thingy.readDataCharacteristic(
        BATTERY_SVC_UUID,
        BATTERY_LEVEL_UUID,
        (err, data) =>
          err ? reject(asError(err)) : resolve(data.readUInt8(0)),
      ),
    );
  return stream;
}

/**
 * Device Information service (standard BLE, requires the DIS mixin).
 * All methods return Promise<string>.
 */
function makeDeviceInfoService(thingy) {
  function rd(fn) {
    return new Promise((resolve, reject) =>
      thingy[fn]((err, val) => (err ? reject(asError(err)) : resolve(val))),
    );
  }
  return Object.freeze({
    readManufacturerName: () => rd("readManufacturerName"),
    readModelNumber: () => rd("readModelNumber"),
    readFirmwareRevision: () => rd("readFirmwareRevisionString"),
    readHardwareRevision: () => rd("readHardwareRevisionString"),
    readSoftwareRevision: () => rd("readSoftwareRevisionString"),
    readSystemId: () => rd("readSystemId"),
  });
}

// ─── Thingy class ─────────────────────────────────────────────────────────────

const Thingy = function Thingy(peripheral) {
  NobleDevice.call(this, peripheral);

  /** @type {EnvironmentService} */
  this.environment = makeEnvironmentService(this);
  /** @type {MotionService} */
  this.motion = makeMotionService(this);
  /** @type {UIService} */
  this.ui = makeUIService(this);
  /** @type {SoundService} */
  this.sound = makeSoundService(this);
  /** @type {SensorStream & { read(): Promise<number> }} */
  this.battery = makeBatteryService(this);
  /** @type {DeviceInfoService} */
  this.deviceInfo = makeDeviceInfoService(this);
};

Thingy.TCS_UUID = TCS_UUID;
Thingy.TES_UUID = TES_UUID;
Thingy.UIS_UUID = UIS_UUID;
Thingy.TMS_UUID = TMS_UUID;
Thingy.TSS_UUID = TSS_UUID;
Thingy.BATTERY_SVC_UUID = BATTERY_SVC_UUID;

Thingy.SCAN_UUIDS = [];
Thingy.SCAN_DUPLICATES = true;

Thingy._targetAddresses = new Set();

Thingy.is = function is(peripheral) {
  const localName = String(
    (peripheral.advertisement && peripheral.advertisement.localName) || "",
  ).toLowerCase();

  // Ignore devices in bootloader / DFU mode
  if (localName.includes("dfu")) {
    return false;
  }

  const devAddr = String(peripheral.address || "")
    .toLowerCase()
    .replace(/[:-]/g, "");
  const devId = String(peripheral.id || "")
    .toLowerCase()
    .replace(/[:-]/g, "");

  if (
    Thingy._targetAddresses.has(devAddr) ||
    (devId && Thingy._targetAddresses.has(devId))
  ) {
    return true;
  }

  const serviceUuids =
    (peripheral.advertisement && peripheral.advertisement.serviceUuids) || [];
  const serviceData =
    (peripheral.advertisement && peripheral.advertisement.serviceData) || [];

  const hasThingyUuid =
    serviceUuids.some((u) => u.toLowerCase() === TCS_UUID) ||
    serviceData.some((s) => s && s.uuid && s.uuid.toLowerCase() === TCS_UUID) ||
    serviceUuids.some((u) => u.toLowerCase().includes("ef68"));

  return hasThingyUuid || localName.includes("thingy");
};

NobleDevice.Util.inherits(Thingy, NobleDevice);
NobleDevice.Util.mixin(Thingy, NobleDevice.DeviceInformationService);

/**
 * Discover a Thingy by MAC address (case-insensitive, optional colons/hyphens).
 */
Thingy.discoverByAddress = function discoverByAddress(address, callback) {
  const norm = String(address).toLowerCase().replace(/[:-]/g, "");
  Thingy._targetAddresses.add(norm);
  return Thingy.discoverWithFilter(
    (device) => {
      const devAddr = String(device.address || "")
        .toLowerCase()
        .replace(/[:-]/g, "");
      const devId = String(device.id || "")
        .toLowerCase()
        .replace(/[:-]/g, "");
      return devAddr === norm || devId === norm;
    },
    (device) => {
      Thingy._targetAddresses.delete(norm);
      callback(device);
    },
  );
};

/**
 * Discover a Thingy by ID or MAC address (case-insensitive, optional colons/hyphens).
 */
Thingy.discoverById = function discoverById(id, callback) {
  return Thingy.discoverByAddress(id, callback);
};

/**
 * Discover services and characteristics on the peripheral.
 * If serviceUuids are provided (array of strings), only those specific GATT
 * services are discovered, speeding up connection setup on Linux/HCI.
 *
 * @param {string[]|function} [serviceUuids]
 * @param {string[]|function} [characteristicUuids]
 * @param {function(Error=): void} [callback]
 */
Thingy.prototype.discoverServicesAndCharacteristics = function (
  serviceUuids,
  characteristicUuids,
  callback,
) {
  const cb =
    typeof serviceUuids === "function"
      ? serviceUuids
      : typeof characteristicUuids === "function"
        ? characteristicUuids
        : callback;

  const svcs = Array.isArray(serviceUuids) ? serviceUuids : [];
  const chars = Array.isArray(characteristicUuids) ? characteristicUuids : [];

  const discoverFn =
    typeof this._peripheral.discoverSomeServicesAndCharacteristics ===
    "function"
      ? (done) =>
          this._peripheral.discoverSomeServicesAndCharacteristics(
            svcs,
            chars,
            done,
          )
      : (done) => this._peripheral.discoverAllServicesAndCharacteristics(done);

  discoverFn((error, services) => {
    if (error) return cb(asError(error));

    for (const service of services || []) {
      const serviceUuid = service.uuid;
      this._services[serviceUuid] = service;
      this._characteristics[serviceUuid] = {};
      for (const characteristic of service.characteristics || []) {
        this._characteristics[serviceUuid][characteristic.uuid] =
          characteristic;
      }
    }
    cb(null);
  });
};

/**
 * Connect to the peripheral and discover services / characteristics (callback version).
 * Automatically pauses active BLE scanning during GATT connection and service
 * discovery to prevent HCI command collisions, then resumes scanning.
 *
 * @param {{ services?: string[], serviceUuids?: string[] }|function(Error=): void} [opts]
 * @param {function(Error=): void} [callback]
 */
Thingy.prototype.connectAndSetUp = Thingy.prototype.connectAndSetup =
  function connectAndSetUp(opts, callback) {
    const cb = typeof opts === "function" ? opts : callback;
    const options = typeof opts === "object" && opts !== null ? opts : {};
    const services = options.services || options.serviceUuids || [];
    const characteristics =
      options.characteristics || options.characteristicUuids || [];

    const wasScanning = Thingy.emitter.listeners("discover").length > 0;
    if (wasScanning) {
      try {
        Thingy.stopScanning();
      } catch (_err) {
        // Ignore errors when stopping scanning
      }
    }

    const connParams = {
      minInterval: 0x0018, // 30 ms
      maxInterval: 0x0028, // 50 ms
      latency: 0x0000,
      timeout: 0x0190, // 4000 ms supervision timeout (vs noble default 420 ms)
    };

    const doConnect = () => {
      this._peripheral.connect(connParams, (err) => {
        if (err) {
          if (wasScanning) setTimeout(() => Thingy.startScanning(), 200);
          return cb(asError(err));
        }
        this._peripheral.once("disconnect", this.onDisconnect.bind(this));
        this.discoverServicesAndCharacteristics(
          services,
          characteristics,
          (discErr) => {
            if (!discErr) this.connectedAndSetUp = true;
            if (wasScanning) setTimeout(() => Thingy.startScanning(), 200);
            cb(discErr ? asError(discErr) : null);
          },
        );
      });
    };

    if (wasScanning) {
      setTimeout(doConnect, 100);
    } else {
      doConnect();
    }
  };

/**
 * Connect to the peripheral and discover services / characteristics.
 *
 * @param {{ services?: string[], serviceUuids?: string[], signal?: AbortSignal } | function} [opts]
 * @param {function} [cb]
 * @returns {Promise<void>|void}
 */
Thingy.prototype.connect = function connect(opts, cb) {
  const callback = typeof opts === "function" ? opts : cb;
  const options = typeof opts === "object" && opts !== null ? opts : {};

  if (typeof callback === "function" && typeof opts !== "object") {
    return this.connectAndSetUp(callback);
  }

  return new Promise((resolve, reject) => {
    if (options.signal && options.signal.aborted) {
      return reject(
        Object.assign(new Error("connect() aborted"), { name: "AbortError" }),
      );
    }

    const onAbort = () => {
      const wasScanning = Thingy.emitter.listeners("discover").length > 0;
      try {
        if (this._peripheral && this._peripheral.state === "connecting") {
          this._peripheral.cancelConnect();
        } else {
          this.disconnect(() => {});
        }
      } catch (_err) {
        // Ignore errors during cancelConnect or disconnect
      }
      if (wasScanning) {
        setTimeout(() => Thingy.startScanning(), 1500);
      }
      reject(
        Object.assign(new Error("connect() aborted"), {
          name: "AbortError",
        }),
      );
    };

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    this.connectAndSetUp(options, (err) => {
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      err ? reject(asError(err)) : resolve();
    });
  });
};

/**
 * Disconnect from the peripheral.
 *
 * @param {function(Error=): void} [cb]
 * @returns {Promise<void>|void}
 */
Thingy.prototype.disconnect = function disconnect(cb) {
  const wasScanning = Thingy.emitter.listeners("discover").length > 0;

  if (typeof cb === "function") {
    return NobleDevice.prototype.disconnect.call(this, (err) => {
      if (wasScanning) setTimeout(() => Thingy.startScanning(), 200);
      cb(err ? asError(err) : null);
    });
  }

  return new Promise((resolve) => {
    NobleDevice.prototype.disconnect.call(this, () => {
      if (wasScanning) setTimeout(() => Thingy.startScanning(), 200);
      resolve();
    });
  });
};

module.exports = Thingy;
