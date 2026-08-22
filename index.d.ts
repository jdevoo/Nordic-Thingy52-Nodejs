// Type declarations for the thingy52 package — Node.js ≥ 20.

/// <reference types="node" />

// ─── Decoded sensor value shapes ─────────────────────────────────────────────

export interface Gas {
  eco2: number;
  tvoc: number;
}
export interface Color {
  red: number;
  green: number;
  blue: number;
  clear: number;
}
export interface Tap {
  direction: number;
  count: number;
}
export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}
export interface StepCounter {
  steps: number;
  time: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface RawMotion {
  accelerometer: Vec3;
  gyroscope: Vec3;
  compass: Vec3;
}
export interface Euler {
  roll: number;
  pitch: number;
  yaw: number;
}
export interface RotationMatrix {
  m_11: number;
  m_12: number;
  m_13: number;
  m_21: number;
  m_22: number;
  m_23: number;
  m_31: number;
  m_32: number;
  m_33: number;
}
export interface AdpcmFrame {
  header: Buffer;
  data: Buffer;
}

// ─── Config proxy shapes (passed to configure() callbacks) ───────────────────

export interface EnvironmentConfig {
  temperatureInterval: number; // ms, byte offset 0
  pressureInterval: number; // ms, byte offset 2
  humidityInterval: number; // ms, byte offset 4
  colorInterval: number; // ms, byte offset 6
  gasMode: number; // 1 | 2 | 3, byte offset 8 — see GasMode
  refLed: { red: number; green: number; blue: number }; // byte offsets 9-11
}

export interface MotionConfig {
  stepCounterInterval: number; // ms, byte offset 0
  tempCompensationInterval: number; // ms, byte offset 2
  magnetometerCompensationInterval: number; // ms, byte offset 4
  motionProcessingFrequency: number; // Hz, byte offset 6
  wakeOnMotion: number; //     byte offset 8
}

// ─── SensorStream ─────────────────────────────────────────────────────────────

/**
 * An async-iterable BLE notification stream for a single characteristic.
 *
 * @example
 * await stream.enable();
 * for await (const value of stream) {
 *   console.log(value);
 * }
 */
export class SensorStream<T> {
  /** Subscribe to BLE notifications. Rejects on BLE error. */
  enable(opts?: { signal?: AbortSignal }): Promise<void>;
  /** Unsubscribe. Terminates any active iterator. */
  disable(): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<T, undefined, undefined>;
}

// ─── LED controller ───────────────────────────────────────────────────────────

export interface LedController {
  off(): Promise<void>;
  /** Constant RGB colour — values 0–255. */
  set(data: { r: number; g: number; b: number }): Promise<void>;
  /** Breathing pulse. `color` is a LedColor (1–7); `delay` in ms. */
  breathe(data: {
    color: number;
    intensity: number;
    delay: number;
  }): Promise<void>;
  /** Single flash. */
  oneShot(data: { color: number; intensity: number }): Promise<void>;
}

// ─── Service interfaces ───────────────────────────────────────────────────────

export interface EnvironmentService {
  readonly temperature: SensorStream<number>; // °C
  readonly pressure: SensorStream<number>; // Pa
  readonly humidity: SensorStream<number>; // % RH
  readonly gas: SensorStream<Gas>;
  readonly color: SensorStream<Color>;
  /** Single atomic read-modify-write on TES_CONF_UUID. */
  configure(mutateFn: (cfg: EnvironmentConfig) => void): Promise<void>;
}

export interface MotionService {
  readonly tap: SensorStream<Tap>;
  readonly orientation: SensorStream<number>; // see Orientation enum
  readonly quaternion: SensorStream<Quaternion>; // Q30 fixed-point
  readonly stepCounter: SensorStream<StepCounter>;
  readonly rawMotion: SensorStream<RawMotion>; // Q10/Q5/Q4
  readonly euler: SensorStream<Euler>; // Q16 fixed-point
  readonly rotation: SensorStream<RotationMatrix>; // Q14 row-major
  readonly heading: SensorStream<number>; // Q16 fixed-point
  readonly gravity: SensorStream<Vec3>; // float32 m/s²
  /** Single atomic read-modify-write on TMS_CONF_UUID. */
  configure(mutateFn: (cfg: MotionConfig) => void): Promise<void>;
}

export interface UIService {
  readonly button: SensorStream<boolean>; // true = pressed
  readonly led: LedController;
}

export interface MicrophoneStream extends SensorStream<AdpcmFrame> {
  /** Write mic mode byte to TSS_CONF_UUID (serialised with speaker.setMode). */
  setMode(mode: number): Promise<void>;
}

export interface Speaker {
  /** Write speaker mode byte to TSS_CONF_UUID (serialised with mic.setMode). */
  setMode(mode: number): Promise<void>;
  write(pcm: Buffer): Promise<void>;
  readonly status: SensorStream<number>;
}

export interface SoundService {
  readonly microphone: MicrophoneStream;
  readonly speaker: Speaker;
}

export interface BatteryStream extends SensorStream<number> {
  /** Read battery level once (0–100 %). */
  read(): Promise<number>;
}

export interface DeviceInfoService {
  readManufacturerName(): Promise<string>;
  readModelNumber(): Promise<string>;
  readFirmwareRevision(): Promise<string>;
  readHardwareRevision(): Promise<string>;
  readSoftwareRevision(): Promise<string>;
  readSystemId(): Promise<string>;
}

// ─── Enums ────────────────────────────────────────────────────────────────────

export declare const Direction: Readonly<{
  UNDEFINED: 0;
  TAP_X_UP: 1;
  TAP_X_DOWN: 2;
  TAP_Y_UP: 3;
  TAP_Y_DOWN: 4;
  TAP_Z_UP: 5;
  TAP_Z_DOWN: 6;
  0: "UNDEFINED";
  1: "TAP_X_UP";
  2: "TAP_X_DOWN";
  3: "TAP_Y_UP";
  4: "TAP_Y_DOWN";
  5: "TAP_Z_UP";
  6: "TAP_Z_DOWN";
}>;

export declare const Orientation: Readonly<{
  PORTRAIT: 0;
  LANDSCAPE: 1;
  REVERSE_PORTRAIT: 2;
  REVERSE_LANDSCAPE: 3;
  0: "Portrait";
  1: "Landscape";
  2: "Reverse portrait";
  3: "Reverse landscape";
}>;

export declare const GasMode: Readonly<{
  EVERY_1S: 1;
  EVERY_10S: 2;
  EVERY_60S: 3;
}>;

export declare const LedMode: Readonly<{
  CONSTANT: 1;
  BREATHE: 2;
  ONE_SHOT: 3;
}>;

export declare const LedColor: Readonly<{
  RED: 1;
  GREEN: 2;
  YELLOW: 3;
  BLUE: 4;
  PURPLE: 5;
  CYAN: 6;
  WHITE: 7;
}>;

export declare const SpeakerMode: Readonly<{
  FREQUENCY: 1;
  PCM: 2;
  SAMPLE: 3;
}>;

export declare const MicMode: Readonly<{
  ADPCM: 1;
  SPL: 2;
}>;

// ─── Codec sub-namespace (require('thingy52/codec') or Thingy.codec) ─────────

export declare namespace codec {
  function decodeTemperature(buf: Buffer): {
    integer: number;
    decimal: number;
    value: number;
  };
  function decodePressure(buf: Buffer): {
    integer: number;
    decimal: number;
    value: number;
  };
  function decodeHumidity(buf: Buffer): number;
  function decodeGas(buf: Buffer): Gas;
  function decodeColor(buf: Buffer): Color;
  function decodeButton(buf: Buffer): boolean;
  function decodeTap(buf: Buffer): Tap;
  function decodeOrientation(buf: Buffer): number;
  function decodeQuaternion(buf: Buffer): Quaternion;
  function decodeStepCounter(buf: Buffer): StepCounter;
  function decodeRawMotion(buf: Buffer): RawMotion;
  function decodeEuler(buf: Buffer): Euler;
  function decodeRotationMatrix(buf: Buffer): RotationMatrix;
  function decodeHeading(buf: Buffer): number;
  function decodeGravity(buf: Buffer): Vec3;
  function decodeSpeakerStatus(buf: Buffer): number;
  function decodeMicrophone(buf: Buffer): AdpcmFrame;
}

// ─── Thingy class ─────────────────────────────────────────────────────────────

export declare class Thingy {
  static readonly SCAN_UUIDS: readonly string[];

  /**
   * Scan for Thingy:52 peripherals. Calls `callback` for each one found.
   * The async-function pattern is supported: an async callback is called and
   * its returned Promise is ignored — add a `.catch` guard inside the callback.
   */
  static discover(callback: (thingy: Thingy) => void | Promise<void>): void;
  static discoverById(
    id: string,
    callback: (thingy: Thingy) => void | Promise<void>,
  ): void;

  // Noble-device peripheral metadata
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly rssi: number;

  // Service namespaces (available immediately; must call connect() first)
  readonly environment: EnvironmentService;
  readonly motion: MotionService;
  readonly ui: UIService;
  readonly sound: SoundService;
  readonly battery: BatteryStream;
  readonly deviceInfo: DeviceInfoService;

  /**
   * Connect to the peripheral and discover services / characteristics.
   * Wraps noble-device's `connectAndSetUp`.
   */
  connect(opts?: { signal?: AbortSignal }): Promise<void>;

  /** Disconnect. Uses noble-device's callback signature for backward compat. */
  disconnect(callback?: (err: Error | null) => void): void;

  on(event: "disconnect", listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;

  // Enum + codec namespaces (re-exported at top level for convenience)
  static readonly enums: {
    Direction: typeof Direction;
    Orientation: typeof Orientation;
    GasMode: typeof GasMode;
    LedMode: typeof LedMode;
    LedColor: typeof LedColor;
    SpeakerMode: typeof SpeakerMode;
    MicMode: typeof MicMode;
  };
  static readonly codec: typeof codec;

  // Individual enum re-exports
  static readonly Direction: typeof Direction;
  static readonly Orientation: typeof Orientation;
  static readonly GasMode: typeof GasMode;
  static readonly LedMode: typeof LedMode;
  static readonly LedColor: typeof LedColor;
  static readonly SpeakerMode: typeof SpeakerMode;
  static readonly MicMode: typeof MicMode;
}

export { Thingy as default };
