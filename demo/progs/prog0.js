'use strict';

function main(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  var outputSlot = runtime.createSlot();

  // add application for final output
  var $_outResult = runtime.addApplication(startTime, lexEnv.add, [lexEnv.mouseX, lexEnv.mouseY], baseTopoOrder+'1');

  return {
    outputSlot: $_outResult.outputSlot,
    deactivator: function() {
      $_outResult.deactivator();
    },
  };
}

module.exports = {
  code: 'yield mouseX + mouseY',
  main: main,
};
