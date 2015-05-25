'use strict';

function liftN(func, arity) {
  return function(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
    if (argSlots.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    var outputSlot = runtime.createSlot();

    var updateTask = function(atTime) {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(runtime.getSlotValue(argSlots[i]));
      }
      var outVal = func.apply(null, argVals);
      runtime.setSlotValue(outputSlot, outVal, atTime);
    };

    // make closure that queues task to update value in outputSlot
    var updateTrigger = function(atTime) {
      runtime.priorityQueue.insert({
        time: atTime,
        topoOrder: baseTopoOrder,
        closure: updateTask,
      });
    }

    // set initial output
    updateTask(startTime);

    // add triggers
    for (var i = 0; i < arity; i++) {
      runtime.addTrigger(argSlots[i], updateTrigger);
    }

    return {
      outputSlot: outputSlot,
      deactivator: function() {
        for (var i = 0; i < arity; i++) {
          runtime.removeTrigger(argSlots[i], updateTrigger);
        }
      },
    };
  };
};

module.exports = {
  liftN: liftN,
};
