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

var StepStream = function(initialValue, startTime) {
  this.value = initialValue;
  this.startTime = startTime;
  this.triggers = [];
};

StepStream.prototype = Object.create(Stream.prototype);
StepStream.prototype.constructor = StepStream;

StepStream.prototype.tempo = 'step';

StepStream.prototype.changeValue = function(value, atTime) {
  this.value = value;
  for (var i = 0; i < this.triggers.length; i++) {
    this.triggers[i](atTime);
  }
}

StepStream.prototype.addTrigger = function(closure) {
  this.triggers.push(closure);
};

StepStream.prototype.removeTrigger = function(closure) {
  var idx;

  for (var i = 0; i < this.triggers.length; i++) {
    if (this.triggers[i] === closure) {
      if (idx !== undefined) {
        throw new Error('found two identical triggers');
      }
      idx = i;
    }
  }

  if (idx === undefined) {
    throw new Error('no matching trigger found');
  }

  // remove matched trigger from triggers list
  this.triggers.splice(idx, 1);
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
