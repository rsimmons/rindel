'use strict';

function liftStep(func, arity) {
  return function(runtime, startTime, argStreams, baseTopoOrder, result) {
    if (argStreams.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    // define function that computes output value from input stream values
    function computeOutput() {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(argStreams[i].value);
      }
      return func.apply(null, argVals);
    }

    // create or validate result, set initial output value
    if (result) {
      if (result.outputStream.tempo !== 'step') {
        throw new Error('Incorrect output stream tempo');
      }
      result.outputStream.changeValue(computeOutput(), startTime);
    } else {
      result = {
        outputStream: runtime.createStepStream(computeOutput(), startTime),
        deactivator: null,
      };
    }

    if (result.deactivator) { throw new Error('Deactivator should be null'); }
    result.deactivator = function() {
      for (var i = 0; i < arity; i++) {
        argStreams[i].removeTrigger(updateTrigger);
      }
    };

    // task closure that updates output value
    function updateTask(atTime) {
      result.outputStream.changeValue(computeOutput(), atTime);
    };

    // closure that queues updateTask
    function updateTrigger(atTime) {
      runtime.priorityQueue.insert({
        time: atTime,
        topoOrder: baseTopoOrder,
        closure: updateTask,
      });
    }

    // add triggers to input streams
    for (var i = 0; i < arity; i++) {
      argStreams[i].addTrigger(updateTrigger);
    }

    return result;
  };
};

module.exports = {
  liftStep: liftStep,
};
