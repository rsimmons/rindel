'use strict';

var primUtils = require('./primUtils');
var liftN = primUtils.liftN;

function dynamicApplication(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  // make closure for updating activation
  var deactivator;
  var outputSlot = runtime.createSlot();
  var funcSlot = argSlots[0];
  var actualArgSlots = argSlots.slice(1);

  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (deactivator !== undefined) {
      deactivator();
    }

    // get activator function from slot
    var activator = runtime.getSlotValue(funcSlot);

    // call new activator
    var result = activator(runtime, atTime, actualArgSlots, baseTopoOrder, lexEnv);

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
  runtime.addTrigger(funcSlot, updateActivator);

  return {
    outputSlot: outputSlot,
    deactivator: function() {
      runtime.removeTrigger(funcSlot, updateActivator);
      deactivator();
    },
  };
};

module.exports = {
  ifte: liftN(function(a, b, c) { return a ? b : c; }, 3),

  app: dynamicApplication,
  prop: liftN(function(a, b) { return a[b]; }, 2),

  uplus: liftN(function(a) { return +a; }, 1),
  uminus: liftN(function(a) { return -a; }, 1),
  bitnot: liftN(function(a) { return ~a; }, 1),

  mul: liftN(function(a, b) { return a*b; }, 2),
  div: liftN(function(a, b) { return a/b; }, 2),

  add: liftN(function(a, b) { return a+b; }, 2),
  sub: liftN(function(a, b) { return a-b; }, 2),
};
