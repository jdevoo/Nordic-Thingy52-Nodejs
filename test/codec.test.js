"use strict";
/**
 * Byte-table unit tests for lib/codec.js.
 *
 * Every test feeds a hand-constructed Buffer whose bytes are derived directly
 * from the GATT spec or the firmware fixed-point definitions, then asserts the
 * decoded value.  No BLE hardware is required.
 *
 * Run with:  node --test test/codec.test.js
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const codec = require("../lib/codec");

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Assert two numbers are within `epsilon` of each other. */
function assertClose(actual, expected, epsilon, message) {
  epsilon = epsilon || 1e-9;
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    (message || "") + ` expected ${expected}, got ${actual} (ε = ${epsilon})`,
  );
}

// ─── decodeTemperature ───────────────────────────────────────────────────────

describe("decodeTemperature", () => {
  test("typical positive temperature 22.5 °C", () => {
    // byte 0: int8  = 22   → 0x16
    // byte 1: uint8 = 50   → hundredths → 0.50  → 22 + 0.50 = 22.5
    const buf = Buffer.from([0x16, 50]);
    const { integer, decimal, value } = codec.decodeTemperature(buf);
    assert.equal(integer, 22);
    assert.equal(decimal, 50);
    assert.equal(value, 22.5);
  });

  test("zero degrees", () => {
    const buf = Buffer.from([0x00, 0x00]);
    const { integer, decimal, value } = codec.decodeTemperature(buf);
    assert.equal(integer, 0);
    assert.equal(decimal, 0);
    assert.equal(value, 0);
  });

  test("maximum uint8 decimal (99)", () => {
    const buf = Buffer.from([10, 99]);
    const { value } = codec.decodeTemperature(buf);
    assertClose(value, 10.99, 1e-9);
  });

  test("negative temperature — as-shipped formula (MODERNIZATION.md §8)", () => {
    // KNOWN AMBIGUITY: the firmware may encode −5.25 °C as integer = −5,
    // decimal = 25.  Because decimal is read as *unsigned* uint8, the
    // formula  integer + decimal/100  gives  −5 + 0.25 = −4.75, NOT −5.25.
    // This test pins the as-shipped decoding.  Capture a real device packet
    // at a sub-zero temperature and compare to confirm or refute.
    const buf = Buffer.from([0xfb, 25]); // int8(0xFB) = −5
    const { integer, decimal, value } = codec.decodeTemperature(buf);
    assert.equal(integer, -5);
    assert.equal(decimal, 25);
    assert.equal(value, -4.75); // as-shipped; may not be physically correct
  });
});

// ─── decodePressure ──────────────────────────────────────────────────────────

describe("decodePressure", () => {
  test("standard atmosphere 101325 Pa + 12 hundredths", () => {
    // 101325 = 0x0001_8BCD  little-endian: CD 8B 01 00
    const buf = Buffer.from([0xcd, 0x8b, 0x01, 0x00, 12]);
    const { integer, decimal, value } = codec.decodePressure(buf);
    assert.equal(integer, 101325);
    assert.equal(decimal, 12);
    assertClose(value, 101325.12, 1e-6);
  });

  test("zero", () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
    assert.equal(codec.decodePressure(buf).value, 0);
  });
});

// ─── decodeHumidity ──────────────────────────────────────────────────────────

describe("decodeHumidity", () => {
  test("55 %", () => {
    assert.equal(codec.decodeHumidity(Buffer.from([55])), 55);
  });

  test("0 %", () => {
    assert.equal(codec.decodeHumidity(Buffer.from([0])), 0);
  });

  test("100 %", () => {
    assert.equal(codec.decodeHumidity(Buffer.from([100])), 100);
  });
});

// ─── decodeGas ───────────────────────────────────────────────────────────────

describe("decodeGas", () => {
  test("eco2 = 400 ppm  tvoc = 1 ppb  (clean-air baseline)", () => {
    // 400  = 0x0190  LE: 90 01
    // 1    = 0x0001  LE: 01 00
    const buf = Buffer.from([0x90, 0x01, 0x01, 0x00]);
    const { eco2, tvoc } = codec.decodeGas(buf);
    assert.equal(eco2, 400);
    assert.equal(tvoc, 1);
  });

  test("eco2 = 1000, tvoc = 3000", () => {
    // 1000 = 0x03E8 LE: E8 03
    // 3000 = 0x0BB8 LE: B8 0B
    const buf = Buffer.from([0xe8, 0x03, 0xb8, 0x0b]);
    const { eco2, tvoc } = codec.decodeGas(buf);
    assert.equal(eco2, 1000);
    assert.equal(tvoc, 3000);
  });
});

// ─── decodeColor ─────────────────────────────────────────────────────────────

describe("decodeColor", () => {
  test("four known channel values", () => {
    // red=256 [00 01], green=512 [00 02], blue=1024 [00 04], clear=2048 [00 08]
    const buf = Buffer.from([
      0x00,
      0x01, // red  = 256
      0x00,
      0x02, // green= 512
      0x00,
      0x04, // blue = 1024
      0x00,
      0x08, // clear= 2048
    ]);
    const { red, green, blue, clear } = codec.decodeColor(buf);
    assert.equal(red, 256);
    assert.equal(green, 512);
    assert.equal(blue, 1024);
    assert.equal(clear, 2048);
  });

  test("all zeros", () => {
    const buf = Buffer.alloc(8);
    const c = codec.decodeColor(buf);
    assert.equal(c.red, 0);
    assert.equal(c.green, 0);
    assert.equal(c.blue, 0);
    assert.equal(c.clear, 0);
  });
});

// ─── decodeButton ────────────────────────────────────────────────────────────

describe("decodeButton", () => {
  test("0x01 → true (pressed)", () => {
    assert.equal(codec.decodeButton(Buffer.from([0x01])), true);
  });

  test("0x00 → false (released)", () => {
    assert.equal(codec.decodeButton(Buffer.from([0x00])), false);
  });

  test("non-zero value is truthy", () => {
    assert.equal(codec.decodeButton(Buffer.from([0xff])), true);
  });

  test("returns a boolean, not a number", () => {
    assert.equal(typeof codec.decodeButton(Buffer.from([0x01])), "boolean");
  });
});

// ─── decodeTap ───────────────────────────────────────────────────────────────

describe("decodeTap", () => {
  test("TAP_Z_UP (5), count 3", () => {
    const buf = Buffer.from([5, 3]);
    const { direction, count } = codec.decodeTap(buf);
    assert.equal(direction, 5);
    assert.equal(count, 3);
  });
});

// ─── decodeOrientation ───────────────────────────────────────────────────────

describe("decodeOrientation", () => {
  test("Landscape = 1", () => {
    assert.equal(codec.decodeOrientation(Buffer.from([1])), 1);
  });
});

// ─── decodeQuaternion ────────────────────────────────────────────────────────

describe("decodeQuaternion", () => {
  test("identity quaternion (w=1, x=y=z=0)", () => {
    // w = 1.0 × 2**30 = 1 073 741 824 = 0x40000000 LE: 00 00 00 40
    // x = y = z = 0
    const buf = Buffer.from([
      0x00,
      0x00,
      0x00,
      0x40, // w = 1.0
      0x00,
      0x00,
      0x00,
      0x00, // x = 0
      0x00,
      0x00,
      0x00,
      0x00, // y = 0
      0x00,
      0x00,
      0x00,
      0x00, // z = 0
    ]);
    const { w, x, y, z } = codec.decodeQuaternion(buf);
    assert.equal(w, 1.0);
    assert.equal(x, 0);
    assert.equal(y, 0);
    assert.equal(z, 0);
  });

  test("all components 0.5 (half Q30)", () => {
    // 0.5 × 2**30 = 536 870 912 = 0x20000000 LE: 00 00 00 20
    const qBuf = Buffer.from([0x00, 0x00, 0x00, 0x20]);
    const buf = Buffer.concat([qBuf, qBuf, qBuf, qBuf]);
    const q = codec.decodeQuaternion(buf);
    assert.equal(q.w, 0.5);
    assert.equal(q.x, 0.5);
    assert.equal(q.y, 0.5);
    assert.equal(q.z, 0.5);
  });

  test("negative component (w = -1)", () => {
    // −1 × 2**30 = −1 073 741 824 = 0xC0000000 as int32 LE: 00 00 00 C0
    const buf = Buffer.alloc(16);
    buf.writeInt32LE(-1073741824, 0);
    const { w } = codec.decodeQuaternion(buf);
    assert.equal(w, -1.0);
  });
});

// ─── decodeStepCounter ───────────────────────────────────────────────────────

describe("decodeStepCounter", () => {
  test("steps = 100, time = 1000 ms", () => {
    // 100  LE uint32: 64 00 00 00
    // 1000 LE uint32: E8 03 00 00
    const buf = Buffer.from([0x64, 0x00, 0x00, 0x00, 0xe8, 0x03, 0x00, 0x00]);
    const { steps, time } = codec.decodeStepCounter(buf);
    assert.equal(steps, 100);
    assert.equal(time, 1000);
  });
});

// ─── decodeRawMotion ─────────────────────────────────────────────────────────

describe("decodeRawMotion", () => {
  test("acc x = 1.0 g, all others zero", () => {
    // 1.0 × 2**10 = 1024 = 0x0400  int16LE: 00 04
    const buf = Buffer.alloc(18);
    buf.writeInt16LE(1024, 0); // acc.x
    const { accelerometer, gyroscope, compass } = codec.decodeRawMotion(buf);
    assert.equal(accelerometer.x, 1.0);
    assert.equal(accelerometer.y, 0);
    assert.equal(accelerometer.z, 0);
    assert.equal(gyroscope.x, 0);
    assert.equal(compass.x, 0);
  });

  test("gyroscope y = 1.0 (Q5)", () => {
    // 1.0 × 2**5 = 32 = 0x0020  int16LE at offset 8
    const buf = Buffer.alloc(18);
    buf.writeInt16LE(32, 8); // gyro.y
    const { gyroscope } = codec.decodeRawMotion(buf);
    assert.equal(gyroscope.y, 1.0);
  });

  test("compass z = 1.0 (Q4)", () => {
    // 1.0 × 2**4 = 16  int16LE at offset 16
    const buf = Buffer.alloc(18);
    buf.writeInt16LE(16, 16); // compass.z
    const { compass } = codec.decodeRawMotion(buf);
    assert.equal(compass.z, 1.0);
  });

  test("negative accelerometer value", () => {
    // −1.0 × 1024 = −1024  int16LE: 00 FC
    const buf = Buffer.alloc(18);
    buf.writeInt16LE(-1024, 0);
    const { accelerometer } = codec.decodeRawMotion(buf);
    assert.equal(accelerometer.x, -1.0);
  });
});

// ─── decodeEuler ─────────────────────────────────────────────────────────────

describe("decodeEuler", () => {
  test("roll = 1.0 (Q16), pitch = yaw = 0", () => {
    // 1.0 × 2**16 = 65536 = 0x00010000  int32LE: 00 00 01 00
    const buf = Buffer.alloc(12);
    buf.writeInt32LE(65536, 0);
    const { roll, pitch, yaw } = codec.decodeEuler(buf);
    assert.equal(roll, 1.0);
    assert.equal(pitch, 0);
    assert.equal(yaw, 0);
  });

  test("all three axes = −0.5 (Q16)", () => {
    // −0.5 × 65536 = −32768
    const buf = Buffer.alloc(12);
    buf.writeInt32LE(-32768, 0);
    buf.writeInt32LE(-32768, 4);
    buf.writeInt32LE(-32768, 8);
    const e = codec.decodeEuler(buf);
    assert.equal(e.roll, -0.5);
    assert.equal(e.pitch, -0.5);
    assert.equal(e.yaw, -0.5);
  });
});

// ─── decodeRotationMatrix ────────────────────────────────────────────────────

describe("decodeRotationMatrix", () => {
  test("identity matrix (diagonal = 1, off-diagonal = 0)", () => {
    // 1.0 × 2**14 = 16384 = 0x4000  int16LE: 00 40
    const buf = Buffer.alloc(18);
    buf.writeInt16LE(16384, 0); // m_11 = 1
    buf.writeInt16LE(16384, 8); // m_22 = 1
    buf.writeInt16LE(16384, 16); // m_33 = 1
    const m = codec.decodeRotationMatrix(buf);
    assert.equal(m.m_11, 1.0);
    assert.equal(m.m_12, 0);
    assert.equal(m.m_13, 0);
    assert.equal(m.m_21, 0);
    assert.equal(m.m_22, 1.0);
    assert.equal(m.m_23, 0);
    assert.equal(m.m_31, 0);
    assert.equal(m.m_32, 0);
    assert.equal(m.m_33, 1.0);
  });

  test("off-diagonal element m_12 = 0.5 (Q14)", () => {
    // 0.5 × 16384 = 8192  int16LE at byte offset 2
    const buf = Buffer.alloc(18);
    buf.writeInt16LE(8192, 2);
    assert.equal(codec.decodeRotationMatrix(buf).m_12, 0.5);
  });
});

// ─── decodeHeading ───────────────────────────────────────────────────────────

describe("decodeHeading", () => {
  test("90.0 (Q16)", () => {
    // 90 × 65536 = 5 898 240 = 0x005A0000  int32LE: 00 00 5A 00
    const buf = Buffer.from([0x00, 0x00, 0x5a, 0x00]);
    assert.equal(codec.decodeHeading(buf), 90.0);
  });

  test("0.0", () => {
    assert.equal(codec.decodeHeading(Buffer.alloc(4)), 0);
  });
});

// ─── decodeGravity ───────────────────────────────────────────────────────────

describe("decodeGravity", () => {
  test("(1.0, 2.0, −1.5) as float32", () => {
    // 1.0, 2.0, -1.5 are all exactly representable in float32 and float64.
    const buf = Buffer.alloc(12);
    buf.writeFloatLE(1.0, 0);
    buf.writeFloatLE(2.0, 4);
    buf.writeFloatLE(-1.5, 8);
    const { x, y, z } = codec.decodeGravity(buf);
    assertClose(x, 1.0, 1e-7);
    assertClose(y, 2.0, 1e-7);
    assertClose(z, -1.5, 1e-7);
  });

  test("zero vector", () => {
    const g = codec.decodeGravity(Buffer.alloc(12));
    assert.equal(g.x, 0);
    assert.equal(g.y, 0);
    assert.equal(g.z, 0);
  });
});

// ─── decodeSpeakerStatus ─────────────────────────────────────────────────────

describe("decodeSpeakerStatus", () => {
  test("status byte 2", () => {
    assert.equal(codec.decodeSpeakerStatus(Buffer.from([2])), 2);
  });
});

// ─── decodeMicrophone ────────────────────────────────────────────────────────

describe("decodeMicrophone", () => {
  test("header is first 3 bytes, data is the rest", () => {
    const buf = Buffer.from([0xaa, 0xbb, 0xcc, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const { header, data } = codec.decodeMicrophone(buf);

    assert.equal(header.length, 3);
    assert.equal(header[0], 0xaa);
    assert.equal(header[1], 0xbb);
    assert.equal(header[2], 0xcc);

    assert.equal(data.length, 5);
    assert.equal(data[0], 0x01);
    assert.equal(data[4], 0x05);
  });

  test("returns Buffer instances (not copies — subarray semantics)", () => {
    const buf = Buffer.alloc(6, 0x42);
    const { header, data } = codec.decodeMicrophone(buf);
    // subarray shares memory; mutating the original changes the view
    buf[0] = 0xff;
    assert.equal(header[0], 0xff);
    // and vice versa (proves it is a view, not a copy)
    header[1] = 0x11;
    assert.equal(buf[1], 0x11);
    void data; // suppress unused warning
  });
});
