'use strict';

var primUtils = require('./primUtils');
var liftStep = primUtils.liftStep;

function delay1(runtime, startTime, argStreams, outputStream, baseTopoOrder, lexEnv) {
  if (argStreams.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var argStream = argStreams[0];

  // create or validate outputStream, set initial value
  // initial output is just initial input
  var argVal = argStream.value;
  if (outputStream) {
    if (outputStream.tempo !== 'step') {
      throw new Error('Incorrect output stream tempo');
    }
    outputStream.changeValue(argVal, startTime);
  } else {
    outputStream = runtime.createStepStream(argVal, startTime);
  }

  var scheduledChanges = []; // ordered list of {time: ..., value: ...}
  var pendingOutputChangeTask = null;

  // if needed, add task for updating output, and update our bookeeping
  var updateTasks = function() {
    if ((scheduledChanges.length > 0) && !pendingOutputChangeTask) {
      var nextChange = scheduledChanges[0];
      // TODO: this should probably call a method of runtime instead of accessing priorityQueue directly
      // TODO: this call could get back a 'task handle' that we use to remove a pending task on deactivate
      var changeTask = {
        time: nextChange.time,
        topoOrder: baseTopoOrder,
        closure: changeOutput,
      };
      runtime.priorityQueue.insert(changeTask);
      pendingOutputChangeTask = changeTask;
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

    outputStream.changeValue(nextChange.value, atTime);

    pendingOutputChangeTask = null;
    updateTasks();
  };

  var argChangedTask = function(atTime) {
    var argVal = argStream.value;
    scheduledChanges.push({
      time: atTime + 1.0, // here is the delay amount
      value: argVal,
    });

    updateTasks();
  };

  // make closure to add task when argument value changes
  var argChangedTrigger = function(atTime) {
    runtime.priorityQueue.insert({
      time: atTime,
      topoOrder: baseTopoOrder,
      closure: argChangedTask,
    });
  };

  // add trigger on argument
  runtime.addTrigger(argStream, argChangedTrigger);

  return {
    outputStream: outputStream,
    deactivator: function() {
      runtime.removeTrigger(argStream, argChangedTrigger);
      if (pendingOutputChangeTask) {
        runtime.priorityQueue.remove(pendingOutputChangeTask);
      }
    },
  };
};

module.exports = {
  id: liftStep(function(a) { return a; }, 1),
  Vec2: liftStep(function(x, y) { return {x: x, y: y}; }, 2),

  delay1: delay1,
};
