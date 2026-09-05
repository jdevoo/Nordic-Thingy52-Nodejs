"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const Thingy = require("../lib/thingy");

function createMockPeripheral() {
  return {
    id: "mock-id",
    uuid: "mock-uuid",
    address: "11:22:33:44:55:66",
    addressType: "public",
    connect(opts, cb) {
      const callback = typeof opts === "function" ? opts : cb;
      setTimeout(() => callback(null), 5);
    },
    disconnect(cb) {
      if (cb) cb();
    },
    discoverAllServicesAndCharacteristics(cb) {
      setTimeout(() => cb(null, []), 5);
    },
    once() {},
  };
}

describe("Thingy connection methods", () => {
  test("connect() resolves Promise without stack overflow", async () => {
    const peripheral = createMockPeripheral();
    const thingy = new Thingy(peripheral);

    await thingy.connect();
    assert.strictEqual(thingy.connectedAndSetUp, true);
  });

  test("connectAndSetUp(cb) executes callback without stack overflow", async () => {
    const peripheral = createMockPeripheral();
    const thingy = new Thingy(peripheral);

    await new Promise((resolve, reject) => {
      thingy.connectAndSetUp((err) => {
        if (err) return reject(err);
        assert.strictEqual(thingy.connectedAndSetUp, true);
        resolve();
      });
    });
  });

  test("discoverByAddress matches uppercase and lowercase MAC addresses", () => {
    const peripheral = createMockPeripheral();
    peripheral.address = "fd:19:af:ba:73:c0";
    peripheral.id = "fd19afba73c0";

    const thingy = new Thingy(peripheral);

    let filterFn;
    const origFilter = Thingy.discoverWithFilter;
    Thingy.discoverWithFilter = (fn) => {
      filterFn = fn;
    };

    try {
      Thingy.discoverByAddress("FD:19:AF:BA:73:C0");
      assert.strictEqual(filterFn(thingy), true);

      Thingy.discoverByAddress("fd19afba73c0");
      assert.strictEqual(filterFn(thingy), true);

      Thingy.discoverById("FD19AFBA73C0");
      assert.strictEqual(filterFn(thingy), true);

      Thingy.discoverByAddress("00:00:00:00:00:00");
      assert.strictEqual(filterFn(thingy), false);
    } finally {
      Thingy.discoverWithFilter = origFilter;
    }
  });

  test("motion.configure safely handles wakeOnMotion on 8-byte or 9-byte TMS_CONF buffer", async () => {
    const peripheral = createMockPeripheral();
    const tmsConfBuffer = Buffer.alloc(8);
    const thingy = new Thingy(peripheral);

    const tmsUuid = "ef6804009b3549339b1052ffa9740042";
    const tmsConfUuid = "ef6804019b3549339b1052ffa9740042";

    thingy._services[tmsUuid] = {};
    thingy._characteristics[tmsUuid] = {
      [tmsConfUuid]: {
        uuid: tmsConfUuid,
        properties: ["read", "write"],
        read(cb) {
          cb(null, tmsConfBuffer);
        },
        write(data, withoutResp, cb) {
          data.copy(tmsConfBuffer);
          cb(null);
        },
      },
    };

    // 8-byte buffer: expanded to 9-byte buffer so wakeOnMotion is safely written at index 8
    await thingy.motion.configure((cfg) => {
      cfg.wakeOnMotion = 1;
      assert.strictEqual(cfg.wakeOnMotion, 1);
    });

    // 9-byte buffer: wakeOnMotion writes byte at index 8
    const tmsConfBuffer9 = Buffer.alloc(9);
    thingy._characteristics[tmsUuid][tmsConfUuid].read = (cb) =>
      cb(null, tmsConfBuffer9);
    thingy._characteristics[tmsUuid][tmsConfUuid].write = (
      data,
      withoutResp,
      cb,
    ) => {
      data.copy(tmsConfBuffer9);
      cb(null);
    };

    await thingy.motion.configure((cfg) => {
      cfg.wakeOnMotion = 1;
      assert.strictEqual(cfg.wakeOnMotion, 1);
    });
    assert.strictEqual(tmsConfBuffer9.readUInt8(8), 1);
  });

  test("connect() with AbortSignal does not disconnect prematurely after successful connection", async () => {
    let disconnected = false;
    const peripheral = createMockPeripheral();
    peripheral.disconnect = (cb) => {
      disconnected = true;
      if (cb) cb();
    };

    const thingy = new Thingy(peripheral);
    // Connect with a 50ms timeout signal
    await thingy.connect({ signal: AbortSignal.timeout(50) });
    assert.strictEqual(thingy.connectedAndSetUp, true);

    // Wait past the timeout to ensure the abort event does not disconnect an already connected device
    await new Promise((r) => setTimeout(r, 70));
    assert.strictEqual(disconnected, false);
  });

  test("connectAndSetUp attaches disconnect handler to peripheral", async () => {
    let disconnectHandlerAttached = false;
    const peripheral = createMockPeripheral();
    peripheral.once = (event, handler) => {
      if (event === "disconnect" && typeof handler === "function") {
        disconnectHandlerAttached = true;
      }
    };

    const thingy = new Thingy(peripheral);
    await thingy.connect();
    assert.strictEqual(disconnectHandlerAttached, true);
  });
});
