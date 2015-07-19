'use strict';

var primUtils = require('./primUtils');
var liftStep = primUtils.liftStep;

function dynamicApplication(runtime, startTime, argStreams, baseTopoOrder, result) {
  var innerResult;
  var funcStream = argStreams[0];
  var actualArgStreams = argStreams.slice(1);

  // make closure for updating activation
  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (innerResult !== undefined) {
      innerResult.deactivator();
      innerResult.deactivator = null;
    }

    // get activator function from stream
    var activator = funcStream.value;

    // TODO: we could save the last activator, and check if the activator function _actually_ changed...

    // call new activator
    if (innerResult) {
      activator(runtime, atTime, actualArgStreams, baseTopoOrder, innerResult);
    } else {
      innerResult = activator(runtime, atTime, actualArgStreams, baseTopoOrder, null);
      // note that we save the outputStream from the first activator, even after it's deactivated. this seems OK
    }
  }

  // do first update
  updateActivator(startTime);

  // add trigger to update activator
  funcStream.addTrigger(updateActivator);

  return runtime.buildResult(startTime, result, innerResult.outputStream, function() {
    funcStream.removeTrigger(updateActivator);
    innerResult.deactivator();
  });
};

module.exports = {
  ifte: liftStep(function(a, b, c) { return a ? b : c; }, 3),

  app: dynamicApplication,
  prop: liftStep(function(a, b) { return a[b]; }, 2),

  uplus: liftStep(function(a) { return +a; }, 1),
  uminus: liftStep(function(a) { return -a; }, 1),
  bitnot: liftStep(function(a) { return ~a; }, 1),

  mul: liftStep(function(a, b) { return a*b; }, 2),
  div: liftStep(function(a, b) { return a/b; }, 2),

  add: liftStep(function(a, b) { return a+b; }, 2),
  sub: liftStep(function(a, b) { return a-b; }, 2),

  lshift: liftStep(function(a, b) { return a<<b; }, 2),
  srshift: liftStep(function(a, b) { return a>>b; }, 2),
  zrshift: liftStep(function(a, b) { return a>>>b; }, 2),

  lt: liftStep(function(a, b) { return a<b; }, 2),
  lte: liftStep(function(a, b) { return a<=b; }, 2),
  gt: liftStep(function(a, b) { return a>b; }, 2),
  gte: liftStep(function(a, b) { return a>=b; }, 2),
  'in': liftStep(function(a, b) { return a in b; }, 2),

  eq: liftStep(function(a, b) { return a===b; }, 2),
  neq: liftStep(function(a, b) { return a!==b; }, 2),

  bitand: liftStep(function(a, b) { return a&b; }, 2),

  bitxor: liftStep(function(a, b) { return a^b; }, 2),

  bitor: liftStep(function(a, b) { return a|b; }, 2),

  not: liftStep(function(a, b) { return !a; }, 1),

  and: liftStep(function(a, b) { return a && b; }, 2),

  xor: liftStep(function(a, b) { return (!!a) ^ (!!b); }, 2),

  or: liftStep(function(a, b) { return a || b; }, 2),
};
