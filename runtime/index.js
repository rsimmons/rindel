'use strict';

var PriorityQueue = require('./pq');

var streams = require('./streams');
var ConstStream = streams.ConstStream;
var StepStream = streams.StepStream;
var EventStream = streams.EventStream;

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

Runtime.prototype.createEventStream = function(initialValue, startTime) {
  return new EventStream(initialValue, startTime);
};

Runtime.prototype.addStepCopyTrigger = function(fromNode, toNode, startTime) {
  function doCopy(atTime) {
    toNode.changeValue(fromNode.value, atTime);
  }

  doCopy(startTime);

  fromNode.addTrigger(doCopy);

  return function() {
    fromNode.removeTrigger(doCopy);
  };
};

Runtime.prototype.addEventCopyTrigger = function(fromNode, toNode, startTime) {
  function doCopy(atTime) {
    toNode.emitValue(fromNode.value, atTime);
  }

  if (fromNode.value) {
    doCopy(startTime);
  }

  fromNode.addTrigger(doCopy);

  return function() {
    fromNode.removeTrigger(doCopy);
  };
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
