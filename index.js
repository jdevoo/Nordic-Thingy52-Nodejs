"use strict";
const Thingy = require("./lib/thingy");
const codec = require("./lib/codec");
const enums = require("./lib/enums");

// Re-export all enum objects at the top level so callers can write:
//   const { GasMode, LedColor, Direction } = require('thingy52');
// or access codec / enums as sub-namespaces:
//   const { codec, enums } = require('thingy52');
Object.assign(Thingy, enums);
Thingy.enums = enums;
Thingy.codec = codec;

module.exports = Thingy;
