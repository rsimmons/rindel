'use strict';

var PriorityQueue = require('./pq');

var Runtime = function() {
  this.priorityQueue = new PriorityQueue();
};

Runtime.prototype.createLexEnv = function(addProps) {
  return this.deriveLexEnv(null, addProps);
};

Runtime.prototype.deriveLexEnv = function(parentLexEnv, addProps) {
  var propsObj = {};

  for (var k in addProps) {
    if (addProps.hasOwnProperty(k)) {
      propsObj[k] = {
        value: addProps[k],
        writeable: false,
        enumerable: true,
      };
    }
  }

  return Object.create(parentLexEnv, propsObj);
};

Runtime.prototype.createSlot = function() {
  return {
    currentValue: undefined,
    triggers: [],
  };
};

Runtime.prototype.getSlotValue = function(slot) {
  return slot.value;
};

Runtime.prototype.setSlotValue = function(slot, value, atTime) {
  slot.value = value;
  for (var i = 0; i < slot.triggers.length; i++) {
    slot.triggers[i](atTime);
  }
};

Runtime.prototype.addTrigger = function(slot, closure) {
  slot.triggers.push(closure);
};

Runtime.prototype.removeTrigger = function(slot, closure) {
  var idx;

  for (var i = 0; i < slot.triggers.length; i++) {
    if (slot.triggers[i] === closure) {
      if (idx !== undefined) {
        throw new Error('found two identical triggers');
      }
      idx = i;
    }
  }

  if (idx === undefined) {
    throw new Error('no matching trigger found');
  }

  // remove matched trigger from slot triggers list
  slot.triggers.splice(idx, 1);
};

// run until time of next task is _greater than_ toTime
Runtime.prototype.runToTime = function(toTime) {
  while (true) {
    if (this.priorityQueue.isEmpty()) {
      return null;
    }
    var nextTask = this.priorityQueue.peek();
    if (nextTask.time > toTime) {
      return nextTask.time;
    }
    this.runNextTask();
  }
};

Runtime.prototype.runNextTask = function() {
  var nextTask = this.priorityQueue.pull(); // gets most "urgent" task
  nextTask.closure(nextTask.time);
};

Runtime.prototype.isRunnable = function() {
  return !this.priorityQueue.isEmpty();
};

Runtime.prototype.addApplication = function(startTime, func, args, baseTopoOrder, lexEnv) {
  // make closure for updating activation
  var deactivator;
  var runtime = this;
  var outputSlot = runtime.createSlot();

  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (deactivator !== undefined) {
      deactivator();
    }

    // get activator function from slot
    var activator = runtime.getSlotValue(func);

    // call new activator
    var result = activator(runtime, atTime, args, baseTopoOrder, lexEnv);

    if (result === undefined) {
      throw new Error('activator did not return result');
    }

    // update current deactivator
    deactivator = result.deactivator;

    // do first copy of 'internal' output to 'external' output
    runtime.setSlotValue(outputSlot, runtime.getSlotValue(result.outputSlot), atTime);

    // set trigger to copy output of current activation to output of this application
    runtime.addTrigger(result.outputSlot, function(atTime) {
      // copy value from 'internal' output to 'external' output
      runtime.setSlotValue(outputSlot, runtime.getSlotValue(result.outputSlot), atTime);
    });
  }

  // do first update
  updateActivator(startTime);

  // add trigger to update activator
  runtime.addTrigger(func, updateActivator);

  return {
    outputSlot: outputSlot,
    deactivator: function() {
      runtime.removeTrigger(func, updateActivator);
      deactivator();
    },
  };
};

Runtime.prototype.primitives = require('./prims');

module.exports = Runtime;
