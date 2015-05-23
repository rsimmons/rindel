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
  commentary: '<p>This program switches between yielding the current mouse position and the delayed mouse position, based on whether the mouse button is down. The if/then/else syntax is an expression (like the ternary operator "?:"), not a statement.</p><p>Note that even if the mouse button is held down, the delayed position is computed. This is necessary to avoid "time leaks", i.e. we don\'t know when we\'ll need the value when the mouse button is released, so we must keep it up to date.</p>',
};
