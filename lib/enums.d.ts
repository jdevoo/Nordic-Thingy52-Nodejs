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
