'use strict';

function main(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  var $_0Result = runtime.addApplication(startTime, lexEnv.delay1, [lexEnv.mousePos], baseTopoOrder+'0');
  var $_outResult = runtime.addApplication(startTime, lexEnv.ifte, [lexEnv.mouseDown, lexEnv.mousePos, $_0Result.outputSlot], baseTopoOrder+'1');

  return {
    outputSlot: $_outResult.outputSlot,
    deactivator: function() {
      $_0Result.deactivator();
      $_outResult.deactivator();
    },
  };
}

module.exports = {
  code: 'yield if mouseDown then mousePos else delay1(mousePos)',
  main: main,
};
