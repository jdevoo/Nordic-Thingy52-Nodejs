"use strict";

/**
 * An async-iterable wrapper around a single BLE notification characteristic.
 *
 * Lifecycle:
 *   1. await stream.enable([{ signal }])  — subscribe (BLE CCCD write)
 *   2. for await (const val of stream)   — consume decoded values
 *   3. await stream.disable()            — unsubscribe; terminates iterator
 *
 * The stream may be re-enabled after disable(). Multiple enable() calls
 * without an intervening disable() are no-ops. Breaking out of a for-await
 * loop calls return() on the iterator which calls disable() automatically.
 *
 * Back-pressure: values that arrive before the consumer calls next() are
 * buffered in an unbounded queue. At BLE sensor data rates this is safe.
 *
 * Disconnect: if the device disconnects, active iterators drain to done.
 */
class SensorStream {
  /**
   * @param {object}   thingy     Noble-device Thingy instance (EventEmitter).
   * @param {string}   svcUuid    GATT service UUID (lowercase, no dashes).
   * @param {string}   charUuid   GATT characteristic UUID.
   * @param {function} decode     (Buffer) → value  — must be a pure function.
   */
  constructor(thingy, svcUuid, charUuid, decode) {
    this._thingy = thingy;
    this._svcUuid = svcUuid;
    this._charUuid = charUuid;
    this._decode = decode;

    this._enabled = false;
    this._done = false;
    this._handler = null; // stable reference used for un-subscribe
    this._disconnectHandler = null;
    this._queue = []; // decoded values buffered ahead of consumer
    this._waiters = []; // pending { resolve } from iterator.next()
  }

  /**
   * Subscribe to BLE notifications for this characteristic.
   *
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<void>}
   */
  enable(opts = {}) {
    if (this._enabled) return Promise.resolve();

    if (opts.signal?.aborted) {
      return Promise.reject(
        Object.assign(new Error("SensorStream.enable aborted"), {
          name: "AbortError",
        }),
      );
    }

    return new Promise((resolve, reject) => {
      this._done = false;
      this._handler = (rawBuf) => {
        const value = this._decode(rawBuf);
        if (this._waiters.length > 0) {
          this._waiters.shift().resolveValue(value);
        } else {
          this._queue.push(value);
        }
      };

      // If the device disconnects mid-stream, mark as done so the iterator
      // unblocks and returns rather than waiting forever.
      this._disconnectHandler = () => this._flush();
      this._thingy.once("disconnect", this._disconnectHandler);

      this._thingy.notifyCharacteristic(
        this._svcUuid,
        this._charUuid,
        true,
        this._handler,
        (err) => {
          if (err) {
            this._thingy.removeListener("disconnect", this._disconnectHandler);
            this._disconnectHandler = null;
            this._handler = null;
            return reject(err instanceof Error ? err : new Error(String(err)));
          }
          this._enabled = true;
          resolve();
        },
      );

      if (opts.signal) {
        opts.signal.addEventListener(
          "abort",
          () => {
            this._flush();
            this.disable().catch(() => {});
          },
          { once: true },
        );
      }
    });
  }

  /**
   * Unsubscribe from BLE notifications and terminate any active iterator.
   *
   * @returns {Promise<void>}
   */
  disable() {
    if (!this._enabled) {
      this._flush();
      return Promise.resolve();
    }

    this._enabled = false;
    const handler = this._handler || (() => {});
    this._flush();

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 2000);

      this._thingy.notifyCharacteristic(
        this._svcUuid,
        this._charUuid,
        false,
        handler,
        () => {
          clearTimeout(timer);
          resolve();
        },
      );
    });
  }

  /**
   * Flush internal state, unblock all waiters with done=true.
   * Called on disable() completion and on device disconnect.
   * @private
   */
  _flush() {
    this._done = true;
    this._handler = null;
    if (this._disconnectHandler) {
      this._thingy.removeListener("disconnect", this._disconnectHandler);
      this._disconnectHandler = null;
    }
    for (const waiter of this._waiters) {
      waiter.resolveDone();
    }
    this._waiters = [];
    this._queue = [];
  }

  /**
   * Async iterator. Yields one decoded value per BLE notification.
   * Completes when disable() is called, the AbortSignal fires, or the device
   * disconnects.
   *
   * @returns {AsyncIterator}
   */
  [Symbol.asyncIterator]() {
    const self = this;
    return {
      next() {
        if (self._done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        if (self._queue.length > 0) {
          return Promise.resolve({ value: self._queue.shift(), done: false });
        }
        return new Promise((resolve) => {
          self._waiters.push({
            resolveValue: (val) => resolve({ value: val, done: false }),
            resolveDone: () => resolve({ value: undefined, done: true }),
          });
        });
      },
      return() {
        // Called when the consumer breaks out of the for-await loop.
        return self.disable().then(() => ({ value: undefined, done: true }));
      },
    };
  }
}

module.exports = { SensorStream };
