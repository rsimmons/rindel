'use strict';

function main(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  return {
    outputSlot: lexEnv.mousePos,
    deactivator: function() {
      // nothing to deactivate
    },
  };
}

module.exports = {
  code: 'yield mousePos',
  main: main,
};
