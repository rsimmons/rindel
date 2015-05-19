'use strict';

function liftN(func, arity) {
  return function(runtime, startTime, argSlots, outputSlot, baseTopoOrder) {
    if (argSlots.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    // make closure that updates value in outputSlot
    var update = function(atTime) {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(runtime.getSlotValue(argSlots[i]));
      }
      var outVal = func.apply(null, argVals);
      runtime.setSlotValue(outputSlot, outVal, atTime);
    }

    // set initial output
    update(startTime);

    // add triggers
    for (var i = 0; i < arity; i++) {
      runtime.addTrigger(argSlots[i], baseTopoOrder, update);
    }

    // create and return deactivator closure, which removes created triggers
    return function() {
      for (var i = 0; i < arity; i++) {
        runtime.removeTrigger(argSlots[i], baseTopoOrder, update);
      }
    };
  };
};

module.exports = {
  add: liftN(function(a, b) { return a+b; }, 2),
  sub: liftN(function(a, b) { return a-b; }, 2),
};
