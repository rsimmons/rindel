'use strict';

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

ConstStream.prototype.hasTriggers = function() {
  return false;
}

var TriggerSet = function() {
  this.funcs = [];
}

TriggerSet.prototype.add = function(func) {
  this.funcs.push(func);
}

TriggerSet.prototype.remove = function(func) {
  var idx;

  // Remove first match. There could be more than one match, which is OK.
  //  For example in "yield Vec2(x, x)", Vec2 would put two triggers on x.
  //  The priority queue will make sure only one computation happens.
  for (var i = 0; i < this.funcs.length; i++) {
    if (this.funcs[i] === func) {
      idx = i;
      break;
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

TriggerSet.prototype.isEmpty = function() {
  return (this.funcs.length === 0);
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
  if (atTime === undefined) {
    throw new Error('changeValue at undefined time');
  }
  this.triggerSet.fire(atTime);
}

StepStream.prototype.addTrigger = function(closure) {
  this.triggerSet.add(closure);
};

StepStream.prototype.removeTrigger = function(closure) {
  this.triggerSet.remove(closure);
};

StepStream.prototype.hasTriggers = function() {
  return !this.triggerSet.isEmpty();
}

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

EventStream.prototype.hasTriggers = function() {
  return !this.triggerSet.isEmpty();
}

module.exports = {
  ConstStream: ConstStream,
  StepStream: StepStream,
  EventStream: EventStream,
};
