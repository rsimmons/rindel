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

Runtime.prototype.createStream = function() {
  return {
    currentValue: undefined,
    triggers: [],
  };
};

Runtime.prototype.getStreamValue = function(stream) {
  return stream.value;
};

Runtime.prototype.setStreamValue = function(stream, value, atTime) {
  stream.value = value;
  for (var i = 0; i < stream.triggers.length; i++) {
    stream.triggers[i](atTime);
  }
};

Runtime.prototype.addTrigger = function(stream, closure) {
  stream.triggers.push(closure);
};

Runtime.prototype.removeTrigger = function(stream, closure) {
  var idx;

  for (var i = 0; i < stream.triggers.length; i++) {
    if (stream.triggers[i] === closure) {
      if (idx !== undefined) {
        throw new Error('found two identical triggers');
      }
      idx = i;
    }
  }

  if (idx === undefined) {
    throw new Error('no matching trigger found');
  }

  // remove matched trigger from stream triggers list
  stream.triggers.splice(idx, 1);
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
