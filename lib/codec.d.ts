/// <reference types="node" />

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

export function decodeTemperature(buf: Buffer): {
  integer: number;
  decimal: number;
  value: number;
};
export function decodePressure(buf: Buffer): {
  integer: number;
  decimal: number;
  value: number;
};
export function decodeHumidity(buf: Buffer): number;
export function decodeGas(buf: Buffer): Gas;
export function decodeColor(buf: Buffer): Color;
export function decodeButton(buf: Buffer): boolean;
export function decodeTap(buf: Buffer): Tap;
export function decodeOrientation(buf: Buffer): number;
export function decodeQuaternion(buf: Buffer): Quaternion;
export function decodeStepCounter(buf: Buffer): StepCounter;
export function decodeRawMotion(buf: Buffer): RawMotion;
export function decodeEuler(buf: Buffer): Euler;
export function decodeRotationMatrix(buf: Buffer): RotationMatrix;
export function decodeHeading(buf: Buffer): number;
export function decodeGravity(buf: Buffer): Vec3;
export function decodeSpeakerStatus(buf: Buffer): number;
export function decodeMicrophone(buf: Buffer): AdpcmFrame;
