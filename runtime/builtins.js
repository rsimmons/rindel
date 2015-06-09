'use strict';

var typeUtils = require('../compiler/typeUtils.js');
var primUtils = require('./primUtils');
var liftStep = primUtils.liftStep;

function delay1(runtime, startTime, argStreams, baseTopoOrder, result) {
  if (argStreams.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var argStream = argStreams[0];

  // create or validate outputStream, set initial value
  // initial output is just initial input
  var argVal = argStream.value;
  if (result) {
    if (result.outputStream.tempo !== 'step') {
      throw new Error('Incorrect output stream tempo');
    }
    result.outputStream.changeValue(argVal, startTime);
  } else {
    result = {
      outputStream: runtime.createStepStream(argVal, startTime),
      deactivator: null,
    };
  }

  if (result.deactivator) { throw new Error('Deactivator should be null'); }
  result.deactivator = function() {
    argStream.removeTrigger(argChangedTrigger);
    if (pendingOutputChangeTask) {
      runtime.priorityQueue.remove(pendingOutputChangeTask);
    }
  };

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

    result.outputStream.changeValue(nextChange.value, atTime);

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
  argStream.addTrigger(argChangedTrigger);

  // create deactivator
  result.deactivator = function() {
    argStream.removeTrigger(argChangedTrigger);
    if (pendingOutputChangeTask) {
      runtime.priorityQueue.remove(pendingOutputChangeTask);
    }
  };

  return result;
};

function timeOfLatest(runtime, startTime, argStreams, baseTopoOrder, result) {
  if (argStreams.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var argStream = argStreams[0];
  if (argStream.tempo !== 'event') {
    throw new Error('Incorrect input stream tempo');
  }

  // create or validate result, set initial output value
  if (result) {
    if (result.outputStream.tempo !== 'step') {
      throw new Error('Incorrect output stream tempo');
    }
    result.outputStream.changeValue(0, startTime);
  } else {
    result = {
      outputStream: runtime.createStepStream(0, startTime),
      deactivator: null,
    };
  }

  if (result.deactivator) { throw new Error('Deactivator should be null'); }
  result.deactivator = function() {
    argStream.removeTrigger(argChangedTrigger);
  };

  // closure to update output value
  var argChangedTask = function(atTime) {
    result.outputStream.changeValue(atTime-startTime, atTime);
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
  argStream.addTrigger(argChangedTrigger);

  return result;
}

function integral(runtime, startTime, argStreams, baseTopoOrder, result) {
  if (argStreams.length !== 2) {
    throw new Error('got wrong number of arguments');
  }

  // split out parameters and validate their tempos
  var integrand = argStreams[0];
  if (integrand.tempo !== 'step') {
    throw new Error('Argument integrand must be step');
  }
  var update = argStreams[1];
  if (update.tempo !== 'event') {
    throw new Error('Argument update must be event');
  }

  // create or validate result, set initial output value to zero
  if (result) {
    if (result.outputStream.tempo !== 'step') {
      throw new Error('Incorrect output stream tempo');
    }
    result.outputStream.changeValue(0, startTime);
  } else {
    result = {
      outputStream: runtime.createStepStream(0, startTime),
      deactivator: null,
    };
  }

  // here is our internal state and accumulating machinery
  var sum = 0; // the integral up to this point
  var lastTime = startTime; // the last time we accumulated to sum
  var lastIntegrandVal = integrand.value; // the value of integrand at lastTime
  function accumulate(upToTime) {
    sum += (upToTime - lastTime)*lastIntegrandVal;
    lastTime = upToTime;
    lastIntegrandVal = integrand.value;
  }

  // If integrand and update inputs change at same time, it seems like it
  //  doesn't matter which we handle first, but we'll have integrand go
  //  first to keep things consistent.

  // task for when integrand changes
  var integrandChangedTask = function(atTime) {
    accumulate(atTime);
    // don't change output
  };

  // trigger for when integrand changes
  var integrandChangedTrigger = function(atTime) {
    runtime.priorityQueue.insert({
      time: atTime,
      topoOrder: baseTopoOrder+'0',
      closure: integrandChangedTask,
    });
  };

  // add trigger on integrand
  integrand.addTrigger(integrandChangedTrigger);

  // task for when update changes
  var updateChangedTask = function(atTime) {
    accumulate(atTime);
    result.outputStream.changeValue(sum, atTime);
  };

  // trigger for when update changes
  var updateChangedTrigger = function(atTime) {
    runtime.priorityQueue.insert({
      time: atTime,
      topoOrder: baseTopoOrder+'1',
      closure: updateChangedTask,
    });
  };

  // add trigger on update
  update.addTrigger(updateChangedTrigger);

  if (result.deactivator) { throw new Error('Deactivator should be null'); }
  result.deactivator = function() {
    update.removeTrigger(updateChangedTrigger);
    integrand.removeTrigger(integrandChangedTrigger);
  };

  return result;
}

module.exports = {
  id: {
    value: liftStep(function(a) { return a; }, 1),
    type: (function() {
      var a = typeUtils.createVariableType();
      return typeUtils.createFunctionType([{type: a}], a);
    })(),
  },
  Vec2: {
    value: liftStep(function(x, y) { return {x: x, y: y}; }, 2),
    // TODO: make yield type more specific when type system supports it
    type: typeUtils.createFunctionType([{type: typeUtils.NUMBER}, {type: typeUtils.NUMBER}], typeUtils.createVariableType()),
  },
  sin: {
    value: liftStep(function(x) { return Math.sin(x); }, 1),
    type: typeUtils.createFunctionType([{type: typeUtils.NUMBER}], typeUtils.NUMBER),
  },
  cos: {
    value: liftStep(function(x) { return Math.cos(x); }, 1),
    type: typeUtils.createFunctionType([{type: typeUtils.NUMBER}], typeUtils.NUMBER),
  },

  delay1: {
    value: delay1,
    type: (function() {
      var a = typeUtils.createVariableType();
      return typeUtils.createFunctionType([{type: a}], a);
    })(),
  },
  timeOfLatest: {
    value: timeOfLatest,
    // TODO: make parameter type more specific when type system supports it
    type: typeUtils.createFunctionType([{type: typeUtils.createVariableType()}], typeUtils.NUMBER),
  },
  integral: {
    value: integral,
    // TODO: make second parameter type more specific when type system supports it
    // TODO: add delayed to integrand once we fix implementation to actually be delayed
    type: typeUtils.createFunctionType([{type: typeUtils.NUMBER}, {type: typeUtils.createVariableType()}], typeUtils.NUMBER),
  },
};
