"use strict";
/**
 * Unit tests for lib/sensor-stream.js.
 *
 * Uses a MockThingy (plain EventEmitter with a stubbed notifyCharacteristic)
 * so no BLE hardware or native addon is needed.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { SensorStream } = require("../lib/sensor-stream");

// ─── MockThingy ───────────────────────────────────────────────────────────────

/** Simulates the subset of noble-device used by SensorStream. */
class MockThingy extends EventEmitter {
  constructor() {
    super();
    this._subs = new Map(); // `${svcUuid}:${charUuid}` → handler
  }

  notifyCharacteristic(svcUuid, charUuid, enable, handler, callback) {
    const key = `${svcUuid}:${charUuid}`;
    if (enable) {
      this._subs.set(key, handler);
    } else {
      this._subs.delete(key);
    }
    // Simulate async BLE round-trip
    setImmediate(() => callback(null));
  }

  /** Returns true if BLE notifications are currently subscribed for this char. */
  isSubscribed(svcUuid, charUuid) {
    return this._subs.has(`${svcUuid}:${charUuid}`);
  }

  /** Deliver a raw Buffer as a BLE notification. */
  push(svcUuid, charUuid, buf) {
    const handler = this._subs.get(`${svcUuid}:${charUuid}`);
    if (handler) handler(buf);
  }
}

// ─── Test constants ────────────────────────────────────────────────────────────

const SVC = "deadbeef0000";
const CHAR = "cafebabe0000";

/** Identity decode: returns the raw buffer's first byte as a number. */
const decodeUint8 = (buf) => buf.readUInt8(0);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePair() {
  const mock = new MockThingy();
  const stream = new SensorStream(mock, SVC, CHAR, decodeUint8);
  return { mock, stream };
}

/** Push one byte of data and return the decoded value from the iterator. */
async function pushAndReceive(mock, stream, byte) {
  const iter = stream[Symbol.asyncIterator]();
  const p = iter.next();
  mock.push(SVC, CHAR, Buffer.from([byte]));
  return (await p).value;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SensorStream", () => {
  describe("enable()", () => {
    test("registers BLE subscription", async () => {
      const { mock, stream } = makePair();
      assert.ok(!mock.isSubscribed(SVC, CHAR));
      await stream.enable();
      assert.ok(mock.isSubscribed(SVC, CHAR));
      await stream.disable();
    });

    test("resolves with no value", async () => {
      const { stream } = makePair();
      const result = await stream.enable();
      assert.equal(result, undefined);
      await stream.disable();
    });

    test("second enable() while already enabled is a no-op", async () => {
      const { mock, stream } = makePair();
      await stream.enable();
      // Calling a second time must not throw, and should still be subscribed
      await stream.enable();
      assert.ok(mock.isSubscribed(SVC, CHAR));
      await stream.disable();
    });

    test("resolves immediately if signal is not aborted", async () => {
      const { stream } = makePair();
      const ac = new AbortController();
      await stream.enable({ signal: ac.signal });
      await stream.disable();
    });

    test("rejects immediately if signal is already aborted", async () => {
      const { stream } = makePair();
      const ac = new AbortController();
      ac.abort();
      await assert.rejects(() => stream.enable({ signal: ac.signal }), {
        name: "AbortError",
      });
    });
  });

  describe("disable()", () => {
    test("removes BLE subscription", async () => {
      const { mock, stream } = makePair();
      await stream.enable();
      await stream.disable();
      assert.ok(!mock.isSubscribed(SVC, CHAR));
    });

    test("calling disable() when not enabled resolves cleanly", async () => {
      const { stream } = makePair();
      await assert.doesNotReject(() => stream.disable());
    });
  });

  describe("iterator — value flow", () => {
    test("yields a decoded value when data arrives after next() is called", async () => {
      const { mock, stream } = makePair();
      await stream.enable();
      const value = await pushAndReceive(mock, stream, 42);
      assert.equal(value, 42);
      await stream.disable();
    });

    test("decode function receives the raw Buffer", async () => {
      const mock = new MockThingy();
      const seen = [];
      const stream = new SensorStream(mock, SVC, CHAR, (buf) => {
        seen.push(Buffer.from(buf)); // capture a copy
        return buf.readUInt8(0);
      });

      await stream.enable();
      const value = await pushAndReceive(mock, stream, 7);
      assert.equal(value, 7);
      assert.equal(seen.length, 1);
      assert.equal(seen[0][0], 7);
      await stream.disable();
    });

    test("yields multiple consecutive values in order", async () => {
      const { mock, stream } = makePair();
      await stream.enable();

      const results = [];
      const iter = stream[Symbol.asyncIterator]();

      for (const byte of [10, 20, 30]) {
        const p = iter.next();
        mock.push(SVC, CHAR, Buffer.from([byte]));
        results.push((await p).value);
      }

      assert.deepEqual(results, [10, 20, 30]);
      await stream.disable();
    });
  });

  describe("iterator — buffering", () => {
    test("buffers values that arrive before the consumer calls next()", async () => {
      const { mock, stream } = makePair();
      await stream.enable();

      // Push before the consumer starts iterating
      mock.push(SVC, CHAR, Buffer.from([11]));
      mock.push(SVC, CHAR, Buffer.from([22]));

      const iter = stream[Symbol.asyncIterator]();
      const r1 = await iter.next();
      const r2 = await iter.next();

      assert.equal(r1.value, 11);
      assert.equal(r2.value, 22);
      assert.equal(r1.done, false);
      assert.equal(r2.done, false);

      await stream.disable();
    });
  });

  describe("iterator — termination", () => {
    test("disable() resolves a pending next() as done", async () => {
      const { stream } = makePair();
      await stream.enable();

      const iter = stream[Symbol.asyncIterator]();
      const nextP = iter.next(); // pending — no data has arrived
      await stream.disable();

      const result = await nextP;
      assert.equal(result.done, true);
    });

    test("disable() completes an active for-await loop", async () => {
      const { mock, stream } = makePair();
      await stream.enable();

      const collected = [];
      const loopP = (async () => {
        for await (const val of stream) {
          collected.push(val);
        }
      })();

      mock.push(SVC, CHAR, Buffer.from([5]));
      mock.push(SVC, CHAR, Buffer.from([6]));
      // Give the loop a tick to process the buffered values
      await new Promise((r) => setImmediate(r));
      await stream.disable();
      await loopP; // must resolve (loop exits)

      assert.ok(collected.includes(5));
      assert.ok(collected.includes(6));
    });

    test("breaking the for-await loop calls return() which disables the stream", async () => {
      const { mock, stream } = makePair();
      await stream.enable();

      mock.push(SVC, CHAR, Buffer.from([99]));

      // break after the first value — triggers iter.return() → stream.disable()
      for await (const val of stream) {
        assert.equal(val, 99);
        break;
      }

      // After break, disable() has been awaited by the for-await mechanism
      assert.ok(!mock.isSubscribed(SVC, CHAR));
    });

    test("done=true once disabled, subsequent next() resolves immediately", async () => {
      const { stream } = makePair();
      await stream.enable();
      await stream.disable();

      const iter = stream[Symbol.asyncIterator]();
      const result = await iter.next();
      assert.equal(result.done, true);
    });
  });

  describe("AbortSignal", () => {
    test("aborting the signal after enable() calls disable()", async () => {
      const { mock, stream } = makePair();
      const ac = new AbortController();

      await stream.enable({ signal: ac.signal });
      assert.ok(mock.isSubscribed(SVC, CHAR));

      ac.abort();
      // disable() is async; give it a tick
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      assert.ok(!mock.isSubscribed(SVC, CHAR));
    });
  });

  describe("device disconnect", () => {
    test("disconnect event terminates a pending next()", async () => {
      const { mock, stream } = makePair();
      await stream.enable();

      const iter = stream[Symbol.asyncIterator]();
      const nextP = iter.next(); // pending

      mock.emit("disconnect"); // simulate BLE disconnect

      const result = await nextP;
      assert.equal(result.done, true);
    });

    test("disconnect event completes a for-await loop", async () => {
      const { mock, stream } = makePair();
      await stream.enable();

      const loopP = (async () => {
        for await (const _ of stream) {
          /* consume */
        }
      })();

      mock.emit("disconnect");
      await assert.doesNotReject(() => loopP);
    });
  });

  describe("re-enable after disable", () => {
    test("stream works normally after a full enable → disable → enable cycle", async () => {
      const { mock, stream } = makePair();

      await stream.enable();
      await stream.disable();

      // Second enable
      await stream.enable();
      const value = await pushAndReceive(mock, stream, 77);
      assert.equal(value, 77);
      await stream.disable();
    });
  });
});
