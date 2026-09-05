"use strict";
/*
  Pure Buffer → value decoders for every GATT characteristic in the Nordic
  Thingy:52 GATT profile.  No I/O, no side-effects: feed a Buffer, get back a
  plain JS value or object.  These are the only functions that understand the
  wire format, and they are independently testable without hardware.

  Fixed-point scales (verbatim from the firmware specification):
    Quaternion  – Q30  (÷ 2**30)
    Euler       – Q16  (÷ 2**16)
    Rotation    – Q14  (÷ 2**14)
    Accel       – Q10  (÷ 2**10)
    Gyro        – Q5   (÷ 2**5)
    Compass     – Q4   (÷ 2**4)
    Heading     – Q16  (÷ 2**16)
*/

/**
 * Temperature service characteristic (2 bytes).
 * Byte 0: signed integer part (°C).
 * Byte 1: unsigned decimal part (hundredths of °C).
 *
 * NOTE (MODERNIZATION.md §8): for negative temperatures the sign of the
 * fractional term is ambiguous without a device capture.  If the firmware
 * sends magnitude-split (integer = -5, decimal = 25 for −5.25 °C) the
 * formula integer + decimal/100 yields −4.75, not −5.25.  The test suite
 * pins the as-shipped behaviour; replace with a real device capture to
 * confirm.
 *
 * @param {Buffer} buf
 * @returns {{ integer: number, decimal: number, value: number }}
 */
function decodeTemperature(buf) {
  const integer = buf.readInt8(0);
  const decimal = buf.readUInt8(1);
  return { integer, decimal, value: integer + decimal / 100 };
}

/**
 * Pressure service characteristic (5 bytes).
 * Bytes 0–3: signed 32-bit integer part (Pa, little-endian).
 * Byte 4: unsigned decimal part (hundredths of Pa).
 *
 * @param {Buffer} buf
 * @returns {{ integer: number, decimal: number, value: number }}
 */
function decodePressure(buf) {
  const integer = buf.readInt32LE(0);
  const decimal = buf.readUInt8(4);
  return { integer, decimal, value: integer + decimal / 100 };
}

/**
 * Humidity service characteristic (1 byte).
 * @param {Buffer} buf
 * @returns {number}  Relative humidity 0–100 %.
 */
function decodeHumidity(buf) {
  return buf.readUInt8(0);
}

/**
 * Gas (eCO₂ / TVOC) service characteristic (4 bytes).
 * @param {Buffer} buf
 * @returns {{ eco2: number, tvoc: number }}
 */
function decodeGas(buf) {
  return {
    eco2: buf.readUInt16LE(0),
    tvoc: buf.readUInt16LE(2),
  };
}

/**
 * Colour sensor characteristic (8 bytes, four uint16LE channels).
 * @param {Buffer} buf
 * @returns {{ red: number, green: number, blue: number, clear: number }}
 */
function decodeColor(buf) {
  return {
    red: buf.readUInt16LE(0),
    green: buf.readUInt16LE(2),
    blue: buf.readUInt16LE(4),
    clear: buf.readUInt16LE(6),
  };
}

/**
 * Button characteristic (1 byte).
 * @param {Buffer} buf
 * @returns {boolean}  true = pressed, false = released.
 */
function decodeButton(buf) {
  return buf.readUInt8(0) !== 0;
}

/**
 * Tap characteristic (2 bytes).
 * @param {Buffer} buf
 * @returns {{ direction: number, count: number }}
 */
function decodeTap(buf) {
  return {
    direction: buf.readUInt8(0),
    count: buf.readUInt8(1),
  };
}

/**
 * Orientation characteristic (1 byte).
 * @param {Buffer} buf
 * @returns {number}  0 = Portrait, 1 = Landscape, 2 = Reverse portrait,
 *                    3 = Reverse landscape.
 */
function decodeOrientation(buf) {
  return buf.readUInt8(0);
}

/**
 * Quaternion characteristic (16 bytes, four int32LE Q30 values).
 * @param {Buffer} buf
 * @returns {{ w: number, x: number, y: number, z: number }}
 */
function decodeQuaternion(buf) {
  return {
    w: buf.readInt32LE(0) / 2 ** 30,
    x: buf.readInt32LE(4) / 2 ** 30,
    y: buf.readInt32LE(8) / 2 ** 30,
    z: buf.readInt32LE(12) / 2 ** 30,
  };
}

/**
 * Step counter characteristic (8 bytes).
 * Bytes 0–3: uint32LE step count.
 * Bytes 4–7: uint32LE elapsed time (ms).
 * @param {Buffer} buf
 * @returns {{ steps: number, time: number }}
 */
function decodeStepCounter(buf) {
  return {
    steps: buf.readUInt32LE(0),
    time: buf.readUInt32LE(4),
  };
}

/**
 * Raw IMU characteristic (18 bytes).
 * Accelerometer: three int16LE Q10 (÷ 1024).
 * Gyroscope:     three int16LE Q5  (÷ 32).
 * Compass:       three int16LE Q4  (÷ 16).
 * @param {Buffer} buf
 * @returns {{ accelerometer, gyroscope, compass }}
 */
function decodeRawMotion(buf) {
  return {
    accelerometer: {
      x: buf.readInt16LE(0) / 2 ** 10,
      y: buf.readInt16LE(2) / 2 ** 10,
      z: buf.readInt16LE(4) / 2 ** 10,
    },
    gyroscope: {
      x: buf.readInt16LE(6) / 2 ** 5,
      y: buf.readInt16LE(8) / 2 ** 5,
      z: buf.readInt16LE(10) / 2 ** 5,
    },
    compass: {
      x: buf.readInt16LE(12) / 2 ** 4,
      y: buf.readInt16LE(14) / 2 ** 4,
      z: buf.readInt16LE(16) / 2 ** 4,
    },
  };
}

/**
 * Euler angles characteristic (12 bytes, three int32LE Q16 values).
 * @param {Buffer} buf
 * @returns {{ roll: number, pitch: number, yaw: number }}
 */
function decodeEuler(buf) {
  return {
    roll: buf.readInt32LE(0) / 2 ** 16,
    pitch: buf.readInt32LE(4) / 2 ** 16,
    yaw: buf.readInt32LE(8) / 2 ** 16,
  };
}

/**
 * Rotation matrix characteristic (18 bytes, nine int16LE Q14 values,
 * row-major order).
 * @param {Buffer} buf
 * @returns {{ m_11, m_12, m_13, m_21, m_22, m_23, m_31, m_32, m_33 }}
 */
function decodeRotationMatrix(buf) {
  return {
    m_11: buf.readInt16LE(0) / 2 ** 14,
    m_12: buf.readInt16LE(2) / 2 ** 14,
    m_13: buf.readInt16LE(4) / 2 ** 14,
    m_21: buf.readInt16LE(6) / 2 ** 14,
    m_22: buf.readInt16LE(8) / 2 ** 14,
    m_23: buf.readInt16LE(10) / 2 ** 14,
    m_31: buf.readInt16LE(12) / 2 ** 14,
    m_32: buf.readInt16LE(14) / 2 ** 14,
    m_33: buf.readInt16LE(16) / 2 ** 14,
  };
}

/**
 * Heading characteristic (4 bytes, int32LE Q16).
 * @param {Buffer} buf
 * @returns {number}
 */
function decodeHeading(buf) {
  return buf.readInt32LE(0) / 2 ** 16;
}

/**
 * Gravity vector characteristic (12 bytes, three floatLE).
 * @param {Buffer} buf
 * @returns {{ x: number, y: number, z: number }}
 */
function decodeGravity(buf) {
  return {
    x: buf.readFloatLE(0),
    y: buf.readFloatLE(4),
    z: buf.readFloatLE(8),
  };
}

/**
 * Speaker status characteristic (1 byte).
 * @param {Buffer} buf
 * @returns {number}
 */
function decodeSpeakerStatus(buf) {
  return buf.readUInt8(0);
}

/**
 * Microphone (ADPCM) characteristic.
 * Bytes 0–2: frame header (predicted value + index).
 * Bytes 3+:  ADPCM-encoded audio data.
 * Uses subarray (not slice) so no copy is made.
 * @param {Buffer} buf
 * @returns {{ header: Buffer, data: Buffer }}
 */
function decodeMicrophone(buf) {
  return {
    header: buf.subarray(0, 3),
    data: buf.subarray(3),
  };
}

module.exports = {
  decodeTemperature,
  decodePressure,
  decodeHumidity,
  decodeGas,
  decodeColor,
  decodeButton,
  decodeTap,
  decodeOrientation,
  decodeQuaternion,
  decodeStepCounter,
  decodeRawMotion,
  decodeEuler,
  decodeRotationMatrix,
  decodeHeading,
  decodeGravity,
  decodeSpeakerStatus,
  decodeMicrophone,
};
