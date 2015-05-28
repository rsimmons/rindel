'use strict';

function liftN(func, arity) {
  return function(runtime, startTime, argStreams, baseTopoOrder, lexEnv) {
    if (argStreams.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    var outputStream = runtime.createStream();

    var updateTask = function(atTime) {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(runtime.getStreamValue(argStreams[i]));
      }
      var outVal = func.apply(null, argVals);
      runtime.setStreamValue(outputStream, outVal, atTime);
    };

    // make closure that queues task to update value in outputStream
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
  liftN: liftN,
};
