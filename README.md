# Nordic Thingy:52 Node.js library

A Node.js BLE library for the [Nordic Thingy:52](https://www.nordicsemi.com/Products/Nordic-Thingy-52) IoT sensor kit. It wraps the Thingy:52 GATT profile into a **Promise / async-iterator API** across five service namespaces: **environment**, **motion**, **ui** (LED + button), **sound**, and **battery**.

## Requirements

| Requirement               | Detail                                                                       |
| ------------------------- | ---------------------------------------------------------------------------- |
| **Node.js**               | 20 LTS or later (`engines: ">=20.0.0"`)                                      |
| **Bluetooth adapter**     | 4.0+ supported by [@abandonware/noble](https://github.com/abandonware/noble) |
| **Linux system packages** | `bluetooth bluez libbluetooth-dev libudev-dev`                               |
| **Build tools**           | Python 3, g++, make (to compile the native BLE addon)                        |

> **Raspberry Pi?** See [RASPBERRYPI.md](RASPBERRYPI.md) for a step-by-step OS and Node.js setup guide.

## Installation

```bash
npm install thingy52
```

`npm install` compiles the native Bluetooth addon via node-gyp. Build tools must be present — on Debian/Ubuntu/Raspberry Pi OS:

```bash
sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev python3 make g++
```

## Quick start

```js
const Thingy = require("thingy52");
const { GasMode, LedColor } = require("thingy52");

Thingy.discover(async function (thingy) {
  await thingy.connect();

  // One atomic BLE read-modify-write — no lost-update races
  await thingy.environment.configure((cfg) => {
    cfg.temperatureInterval = 1000; // ms
    cfg.humidityInterval = 1000;
    cfg.gasMode = GasMode.EVERY_10S;
  });

  // Enable streams (subscribes to BLE notifications)
  await thingy.environment.temperature.enable();
  await thingy.environment.humidity.enable();
  await thingy.environment.gas.enable();

  // Consume readings with for-await — runs until disable() or disconnect
  for await (const temp of thingy.environment.temperature) {
    console.log("Temperature:", temp, "°C");
  }
});
```

Streams run concurrently by launching each sensor loop as a background task:

```js
Thingy.discover(async function (thingy) {
  await thingy.connect();

  await thingy.environment.configure((cfg) => {
    cfg.temperatureInterval = 1000;
    cfg.humidityInterval = 1000;
    cfg.gasMode = GasMode.EVERY_10S;
  });

  await thingy.environment.temperature.enable();
  await thingy.environment.humidity.enable();
  await thingy.environment.gas.enable();

  // Each loop runs as an independent background task
  (async () => {
    for await (const temp of thingy.environment.temperature) {
      console.log("Temperature:", temp, "°C");
    }
  })();

  (async () => {
    for await (const rh of thingy.environment.humidity) {
      console.log("Humidity:", rh, "%");
    }
  })();

  (async () => {
    for await (const gas of thingy.environment.gas) {
      console.log(`eCO₂: ${gas.eco2} ppm   TVOC: ${gas.tvoc} ppb`);
    }
  })();

  // Button drives the LED
  await thingy.ui.button.enable();
  for await (const pressed of thingy.ui.button) {
    if (pressed)
      await thingy.ui.led.breathe({
        color: LedColor.CYAN,
        intensity: 20,
        delay: 1000,
      });
  }
});
```

## Library modules

| Import                      | Contents                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `require('thingy52')`       | `Thingy` class — BLE connection and all five service namespaces                                         |
| `require('thingy52/codec')` | Pure `Buffer → value` decoder functions for every GATT characteristic — usable without hardware         |
| `require('thingy52/enums')` | Named constants: `Direction`, `Orientation`, `GasMode`, `LedMode`, `LedColor`, `SpeakerMode`, `MicMode` |

Enums are also re-exported from the top-level module:

```js
const {
  GasMode,
  LedColor,
  LedMode,
  Direction,
  Orientation,
} = require("thingy52");
```

## API notes

### Service namespaces

After `await thingy.connect()` the following namespaces are available on the `thingy` instance:

| Namespace            | Properties                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `thingy.environment` | `temperature`, `pressure`, `humidity`, `gas`, `color` streams; `configure()`                                                     |
| `thingy.motion`      | `tap`, `orientation`, `quaternion`, `stepCounter`, `rawMotion`, `euler`, `rotation`, `heading`, `gravity` streams; `configure()` |
| `thingy.ui`          | `button` stream; `led` controller                                                                                                |
| `thingy.sound`       | `microphone` stream; `speaker` controller                                                                                        |
| `thingy.battery`     | `read()`, `enable()`, `disable()`, async-iterable                                                                                |
| `thingy.deviceInfo`  | `read()` — returns `{ model, serial, firmware, … }`                                                                              |

### SensorStream interface

Every sensor property is a `SensorStream<T>` object that:

- **`stream.enable(opts?)`** — subscribes to BLE notifications; returns a `Promise<void>`.  
  Accepts an optional `{ signal: AbortSignal }` to cancel mid-stream.
- **`stream.disable()`** — unsubscribes; terminates any active `for-await` loop; returns a `Promise<void>`.
- **`stream[Symbol.asyncIterator]()`** — yields decoded values; the loop ends automatically when `disable()` is called or the device disconnects.

```js
const stream = thingy.environment.temperature;

await stream.enable();

for await (const temp of stream) {
  console.log(temp); // number in °C
  if (temp > 30) await stream.disable(); // exits the loop
}

// AbortSignal example — stop after 10 seconds
const ac = new AbortController();
setTimeout(() => ac.abort(), 10_000);
await thingy.motion.quaternion.enable({ signal: ac.signal });

for await (const q of thingy.motion.quaternion) {
  console.log(q); // { w, x, y, z }
}
```

### Sensor data types

| Stream                    | Decoded type                                                  |
| ------------------------- | ------------------------------------------------------------- |
| `environment.temperature` | `number` (°C)                                                 |
| `environment.pressure`    | `number` (hPa)                                                |
| `environment.humidity`    | `number` (% RH)                                               |
| `environment.gas`         | `{ eco2: number, tvoc: number }`                              |
| `environment.color`       | `{ red, green, blue, clear }`                                 |
| `motion.tap`              | `{ direction: number, count: number }` — see `Direction` enum |
| `motion.orientation`      | `number` — see `Orientation` enum                             |
| `motion.quaternion`       | `{ w, x, y, z }` — Q30 fixed-point                            |
| `motion.stepCounter`      | `{ steps: number, time: number }`                             |
| `motion.rawMotion`        | `{ accelerometer, gyroscope, compass }`                       |
| `motion.euler`            | `{ roll, pitch, yaw }` — Q16 fixed-point                      |
| `motion.rotation`         | `{ m_11 … m_33 }` — Q14 fixed-point, row-major                |
| `motion.heading`          | `number` — Q16 fixed-point                                    |
| `motion.gravity`          | `{ x, y, z }` — float32                                       |
| `ui.button`               | `boolean` (`true` = pressed, `false` = released)              |
| `sound.microphone`        | `{ header: object, data: Buffer }` — ADPCM frame              |
| `battery` (iterable)      | `number` (%)                                                  |

### Configuration transactions

`configure()` performs a single atomic BLE read-modify-write. The callback receives a proxy object; any properties you set are merged into the characteristic before it is written back — no lost-update race is possible:

```js
await thingy.environment.configure((cfg) => {
  cfg.temperatureInterval = 1000; // ms
  cfg.pressureInterval = 1000;
  cfg.colorInterval = 1500;
  cfg.gasMode = GasMode.EVERY_60S;
  cfg.refLed = { red: 120, green: 60, blue: 20 };
});

await thingy.motion.configure((cfg) => {
  cfg.motionProcessingFrequency = 5; // Hz
});
```

### LED

All LED methods return a `Promise<void>`:

```js
await thingy.ui.led.set({ r: 0, g: 10, b: 10 }); // constant colour
await thingy.ui.led.breathe({
  color: LedColor.CYAN,
  intensity: 20,
  delay: 1000,
}); // pulse
await thingy.ui.led.oneShot({ color: LedColor.RED, intensity: 50 }); // single flash
await thingy.ui.led.off();
```

### Battery

```js
// One-shot read
const level = await thingy.battery.read();
console.log(level, "%");

// Notification stream
await thingy.battery.enable();
for await (const pct of thingy.battery) {
  console.log(pct, "%");
}
```

### Pure decoder module

```js
const codec = require("thingy52/codec");

// Feed any Buffer from a real device or a test fixture
const { value } = codec.decodeTemperature(Buffer.from([22, 50])); // 22.5
const gas = codec.decodeGas(Buffer.from([0xe8, 0x03, 0xb8, 0x0b])); // { eco2: 1000, tvoc: 3000 }
```

## Examples

| File                      | What it demonstrates                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/battery.js`     | Battery level notifications                                                                                                                                     |
| `examples/btn_led.js`     | Button press cycles through LED breathe colours                                                                                                                 |
| `examples/color_calib.js` | Closed-loop calibration of the colour sensor reference LED                                                                                                      |
| `examples/environment.js` | Temperature, pressure, humidity, colour and gas sensors; button toggles streaming                                                                               |
| `examples/firebase.js`    | Streams gas + temperature data to Firebase Realtime Database (v9 modular SDK)                                                                                   |
| `examples/ifttt_gas.js`   | Posts gas readings to IFTTT Maker Webhooks via `fetch`                                                                                                          |
| `examples/imes.js`        | [Smart-Industry MES](https://github.com/jdevoo/smart-industry) telemetry gateway: streams button press / tap product pulses and heartbeats to Firebase database |
| `examples/led.js`         | Sets a constant LED colour                                                                                                                                      |
| `examples/microphone.js`  | ADPCM microphone captured and decoded to PCM via the speaker package                                                                                            |
| `examples/motion.js`      | All motion sensors — tap, orientation, quaternion, step counter, raw IMU, Euler, rotation matrix, heading, gravity                                              |

Example-specific npm packages (not in `package.json`) must be installed manually before running:

| Example         | Extra package(s)       |
| --------------- | ---------------------- |
| `microphone.js` | `npm install speaker`  |
| `firebase.js`   | `npm install firebase` |
| `imes.js`       | `npm install firebase` |

## Development

```bash
npm test   # 57 assertions via node:test — no hardware needed
npm run lint
```

The test suite covers every GATT decoder in `lib/codec.js` with hand-constructed byte sequences derived from the firmware fixed-point specifications, and every `SensorStream` behaviour (buffering, abort, disconnect propagation) with a mock BLE emitter — no physical device required.

## License

Nordic 5-clause licence — see [LICENSE.md](LICENSE.md).
