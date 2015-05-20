'use strict';

function liftN(func, arity) {
  return function(runtime, startTime, argSlots, outputSlot, baseTopoOrder, lexEnv) {
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

function delay1(runtime, startTime, argSlots, outputSlot, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var argSlot = argSlots[0];
  var scheduledChanges = []; // ordered list of {time: ..., value: ...}
  var pendingOutputChangeTask = null;

  // if needed, add task for updating output, and update our bookeeping
  var updateTasks = function() {
    if ((scheduledChanges.length > 0) && !pendingOutputChangeTask) {
      var nextChange = scheduledChanges[0];
      // TODO: this should probably call a method of runtime instead of accessing priorityQueue directly
      // TODO: this call could get back a 'task handle' that we use to remove a pending task on deactivate
      runtime.priorityQueue.insert({
        time: nextChange.time,
        topoOrder: baseTopoOrder,
        closure: changeOutput,
      });
    }
  };

  // closure to be called when time has come to change output value
  var changeOutput = function(atTime) {
    if (scheduledChanges.length === 0) {
      throw new Error('no changes to make');
    }

    // pull next change off 'front' of queue
    var nextChange = scheduledChanges.shift();

    // sanity check
    if (atTime !== nextChange.time) {
      throw new Error('times do not match');
    }

    runtime.setSlotValue(outputSlot, nextChange.value, atTime);

    pendingOutputChangeTask = null;
    updateTasks();
  };

  // make closure to be called when argument value changes
  var argChanged = function(atTime) {
    var argVal = runtime.getSlotValue(argSlot);
    scheduledChanges.push({
      time: atTime + 1.0, // here is the delay amount
      value: argVal,
    });

    updateTasks();
  };

  // set initial output to be initial input
  var argVal = runtime.getSlotValue(argSlot);
  runtime.setSlotValue(outputSlot, argVal, startTime);

  // add trigger on argument
  runtime.addTrigger(argSlot, baseTopoOrder, argChanged);

  // create and return deactivator closure, which removes created triggers
  return function() {
    runtime.removeTrigger(argSlot, baseTopoOrder, argChanged);
    if (pendingOutputChangeTask) {
      this.priorityQueue.remove(pendingOutputChangeTask);
    }
  };
};

module.exports = {
  add: liftN(function(a, b) { return a+b; }, 2),
  sub: liftN(function(a, b) { return a-b; }, 2),

  delay1: delay1,
};
