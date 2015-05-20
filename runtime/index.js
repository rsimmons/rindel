'use strict';

var PriorityQueue = require('./pq');

var Runtime = function() {
  this.priorityQueue = new PriorityQueue();
}

Runtime.prototype.createSlot = function() {
  return {
    currentValue: undefined,
    triggers: [],
  };
};

Runtime.prototype.getSlotValue = function(slot) {
  return slot.value;
}

Runtime.prototype.setSlotValue = function(slot, value, atTime) {
  slot.value = value;
  for (var i = 0; i < slot.triggers.length; i++) {
    var trig = slot.triggers[i];
    this.priorityQueue.insert({
      closure: trig.closure,
      time: atTime,
      topoOrder: trig.topoOrder,
    });
  }
};

Runtime.prototype.addTrigger = function(slot, topoOrder, closure) {
  slot.triggers.push({
    topoOrder: topoOrder,
    closure: closure,
  });
};

Runtime.prototype.removeTrigger = function(slot, topoOrder, closure) {
  var idx;

  for (var i = 0; i < slot.triggers.length; i++) {
    var trig = slot.triggers[i];
    if ((trig.topoOrder === topoOrder) && (trig.closure === closure)) {
      if (idx !== undefined) {
        throw new Error('found two triggers with same topoOrder and closure');
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
}

Runtime.prototype.runNextTask = function() {
  var nextTask = this.priorityQueue.pull(); // gets most "urgent" task
  nextTask.closure(nextTask.time);
}

Runtime.prototype.addApplication = function(startTime, func, args, output, baseTopoOrder) {
  // make closure for updating activation
  var deactivator;
  var runtime = this;
  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (deactivator !== undefined) {
      deactivator();
    }

    // get activator function from slot
    var activator = runtime.getSlotValue(func);

    // call new activator, updating deactivator
    // if both func and args changed, func should be updated first, so we pass baseTopoOrder +'1' here
    deactivator = activator(runtime, atTime, args, output, baseTopoOrder +'1');

    if (deactivator === undefined) {
      throw new Error('activator did not return deactivator function');
    }
  }

  // do first update
  updateActivator(startTime);

  // add trigger to update activator
  // if both func and args changed, func should be updated first, so we pass baseTopoOrder +'0' here
  runtime.addTrigger(func, baseTopoOrder +'0', updateActivator);

  // return function that removes anything set up by this activation
  return function() {
    runtime.removeTrigger(func, baseTopoOrder+'0', updateActivator);
    deactivator();
  }
};

Runtime.prototype.primitives = require('./prims');

module.exports = Runtime;
