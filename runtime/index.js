'use strict';

var PriorityQueue = require('./pq');

var Stream = function() {
};

var ConstStream = function(value, startTime) {
  this.value = value;
  this.startTime = startTime;
  this.triggers = []; // TODO: remove this?
}

ConstStream.prototype = Object.create(Stream.prototype);
ConstStream.prototype.constructor = ConstStream;

ConstStream.prototype.tempo = 'const';

ConstStream.prototype.addTrigger = function(closure) {
  // ignore
};

ConstStream.prototype.removeTrigger = function(closure) {
  // ignore
};

var TriggerSet = function() {
  this.funcs = [];
}

TriggerSet.prototype.add = function(func) {
  this.funcs.push(func);
}

TriggerSet.prototype.remove = function(func) {
  var idx;

  for (var i = 0; i < this.funcs.length; i++) {
    if (this.funcs[i] === func) {
      if (idx !== undefined) {
        throw new Error('found two identical func');
      }
      idx = i;
    }
  }

  if (idx === undefined) {
    throw new Error('no matching func found');
  }

  // remove matched func from func list
  this.funcs.splice(idx, 1);
};

TriggerSet.prototype.fire = function(atTime) {
  for (var i = 0; i < this.funcs.length; i++) {
    this.funcs[i](atTime);
  }
}

var StepStream = function(initialValue, startTime) {
  this.value = initialValue;
  this.startTime = startTime;
  this.triggerSet = new TriggerSet();
};

StepStream.prototype = Object.create(Stream.prototype);
StepStream.prototype.constructor = StepStream;

StepStream.prototype.tempo = 'step';

StepStream.prototype.changeValue = function(value, atTime) {
  this.value = value;
  this.triggerSet.fire(atTime);
}

StepStream.prototype.addTrigger = function(closure) {
  this.triggerSet.add(closure);
};

StepStream.prototype.removeTrigger = function(closure) {
  this.triggerSet.remove(closure);
};

var EventStream = function(initialValue, startTime) {
  this.value = initialValue;
  this.startTime = startTime;
  this.triggerSet = new TriggerSet();
}

EventStream.prototype = Object.create(Stream.prototype);
EventStream.prototype.constructor = EventStream;

EventStream.prototype.tempo = 'event';

EventStream.prototype.emitValue = function(value, atTime) {
  this.value = value;
  this.triggerSet.fire(atTime);
}

EventStream.prototype.addTrigger = function(closure) {
  this.triggerSet.add(closure);
};

EventStream.prototype.removeTrigger = function(closure) {
  this.triggerSet.remove(closure);
};

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

Runtime.prototype.createConstStream = function(value, startTime) {
  return new ConstStream(value, startTime);
};

Runtime.prototype.createStepStream = function(initialValue, startTime) {
  return new StepStream(initialValue, startTime);
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

Runtime.prototype.builtins = require('./builtins');

Runtime.prototype.opFuncs = require('./opFuncs');

module.exports = Runtime;
