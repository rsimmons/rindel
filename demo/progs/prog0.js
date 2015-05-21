'use strict';

function main(runtime, startTime, argSlots, outputSlot, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  // add application for final output (slot already created)
  var $_unappOut = runtime.addApplication(startTime, lexEnv.add, [lexEnv.mouseX, lexEnv.mouseY], outputSlot, baseTopoOrder+'1');

  // create and return deactivator closure. it needs to undo any applications
  return function() {
    $_unappOut();
  };
}

module.exports = {
  code: 'yield mouseX + mouseY',
  main: main,
};
