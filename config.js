'use strict';

module.exports = {
  // Room lifecycle
  ROOM_EXPIRY_MS:    3 * 60 * 1000,
  CODE_LENGTH:       4,
  CODE_CHARS:        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  CODE_GEN_ATTEMPTS: 10,

  // Phase durations
  PHASE1_DURATION_MS:    5000,
  PHASE2_DURATION_MS:    3000,
  DRAW_REPEAT_DELAY_MS:  2000,
  NEXT_ROUND_DELAY_MS:   2000,

  // Game rules
  MAX_DRAWS:      5,
  STARTING_LIVES: 3,
};
