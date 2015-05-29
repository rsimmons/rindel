'use strict';

function liftStep(func, arity) {
  return function(runtime, startTime, argStreams, outputStream, baseTopoOrder, lexEnv) {
    if (argStreams.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    // define function that computes output value from input stream values
    function computeOutput() {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(runtime.getStreamValue(argStreams[i]));
      }
      return func.apply(null, argVals);
    }

    // create or validate outputStream, set initial value
    if (outputStream) {
      if (outputStream.tempo !== 'step') {
        throw new Error('Incorrect output stream tempo');
      }
      runtime.setStreamValue(outputStream, computeOutput(), startTime);
    } else {
      outputStream = runtime.createStepStream(computeOutput(), startTime);
    }

    // task closure that updates output value
    function updateTask(atTime) {
      runtime.setStreamValue(outputStream, computeOutput(), atTime);
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
      runtime.addTrigger(argStreams[i], updateTrigger);
    }

    return {
      outputStream: outputStream,
      deactivator: function() {
        for (var i = 0; i < arity; i++) {
          runtime.removeTrigger(argStreams[i], updateTrigger);
        }
      },
    };
  };
};

module.exports = {
  liftStep: liftStep,
};
