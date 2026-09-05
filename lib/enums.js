"use strict";
/**
 * Named constants for the Nordic Thingy:52 GATT profile.
 *
 * These were previously bare integers scattered across lib/thingy.js and the
 * examples (e.g. `speaker_mode_set(2)`, `gas_mode_set(1)`).  Centralising
 * them here means:
 *   - call sites are self-documenting,
 *   - typos produce undefined rather than silently wrong firmware behaviour,
 *   - user code can `const { GasMode } = require('thingy52/enums')`.
 *
 * Direction and Orientation carry a reverse-lookup array (index → name) so
 * that decoding a raw byte for display is a single array access.
 */

/**
 * Tap direction codes reported by TMS_TAP_UUID.
 * The numeric values also act as array indices for the name strings below.
 */
const Direction = Object.freeze({
  UNDEFINED: 0,
  TAP_X_UP: 1,
  TAP_X_DOWN: 2,
  TAP_Y_UP: 3,
  TAP_Y_DOWN: 4,
  TAP_Z_UP: 5,
  TAP_Z_DOWN: 6,
  // Reverse map: Direction[code] → human-readable name
  0: "UNDEFINED",
  1: "TAP_X_UP",
  2: "TAP_X_DOWN",
  3: "TAP_Y_UP",
  4: "TAP_Y_DOWN",
  5: "TAP_Z_UP",
  6: "TAP_Z_DOWN",
});

/**
 * Device orientation codes reported by TMS_ORIENTATION_UUID.
 */
const Orientation = Object.freeze({
  PORTRAIT: 0,
  LANDSCAPE: 1,
  REVERSE_PORTRAIT: 2,
  REVERSE_LANDSCAPE: 3,
  // Reverse map
  0: "Portrait",
  1: "Landscape",
  2: "Reverse portrait",
  3: "Reverse landscape",
});

/**
 * Gas sensor sampling mode written to byte 8 of TES_CONF_UUID.
 */
const GasMode = Object.freeze({
  EVERY_1S: 1,
  EVERY_10S: 2,
  EVERY_60S: 3,
});

/**
 * LED operating mode written as byte 0 of UIS_LED_UUID.
 */
const LedMode = Object.freeze({
  CONSTANT: 1, // led_set   – constant RGB colour
  BREATHE: 2, // led_breathe – slow pulse
  ONE_SHOT: 3, // led_one_shot – single flash
});

/**
 * LED colour palette indices used in BREATHE and ONE_SHOT modes
 * (byte 1 of the UIS_LED_UUID payload).
 * Firmware valid range is 1–7; index 0 and 8 are treated as index 1.
 */
const LedColor = Object.freeze({
  RED: 1,
  GREEN: 2,
  YELLOW: 3,
  BLUE: 4,
  PURPLE: 5,
  CYAN: 6,
  WHITE: 7,
});

/**
 * Speaker playback mode written to byte 0 of TSS_CONF_UUID.
 */
const SpeakerMode = Object.freeze({
  FREQUENCY: 1, // Tone generation (freq + duration)
  PCM: 2, // Raw 8-bit PCM stream via TSS_SPEAKER_DATA_UUID
  SAMPLE: 3, // Stored sample playback
});

/**
 * Microphone capture mode written to byte 0 of TSS_CONF_UUID.
 * Note: speaker_mode_set and mic_mode_set both write byte 0, so they share
 * the _tssCfgQueue in thingy.js to avoid racing each other.
 */
const MicMode = Object.freeze({
  ADPCM: 1, // ADPCM-encoded audio via TSS_MIC_UUID notifications
  SPL: 2, // Sound Pressure Level only
});

module.exports = {
  Direction,
  Orientation,
  GasMode,
  LedMode,
  LedColor,
  SpeakerMode,
  MicMode,
};
