'use strict';

var primUtils = require('./primUtils');
var liftN = primUtils.liftN;

function dynamicApplication(runtime, startTime, argStreams, baseTopoOrder, lexEnv) {
  // make closure for updating activation
  var deactivator;
  var outputStream = runtime.createStream();
  var funcStream = argStreams[0];
  var actualArgStreams = argStreams.slice(1);

  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (deactivator !== undefined) {
      deactivator();
    }

    // get activator function from stream
    var activator = runtime.getStreamValue(funcStream);

    // call new activator
    var result = activator(runtime, atTime, actualArgStreams, baseTopoOrder, lexEnv);

    if (result === undefined) {
      throw new Error('activator did not return result');
    }

    // update current deactivator
    deactivator = result.deactivator;

    // do first copy of 'internal' output to 'external' output
    runtime.setStreamValue(outputStream, runtime.getStreamValue(result.outputStream), atTime);

    // set trigger to copy output of current activation to output of this application
    runtime.addTrigger(result.outputStream, function(atTime) {
      // copy value from 'internal' output to 'external' output
      runtime.setStreamValue(outputStream, runtime.getStreamValue(result.outputStream), atTime);
    });
  }

  // do first update
  updateActivator(startTime);

  // add trigger to update activator
  runtime.addTrigger(funcStream, updateActivator);

  return {
    outputStream: outputStream,
    deactivator: function() {
      runtime.removeTrigger(funcStream, updateActivator);
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

  lshift: liftN(function(a, b) { return a<<b; }, 2),
  srshift: liftN(function(a, b) { return a>>b; }, 2),
  zrshift: liftN(function(a, b) { return a>>>b; }, 2),

  lt: liftN(function(a, b) { return a<b; }, 2),
  lte: liftN(function(a, b) { return a<=b; }, 2),
  gt: liftN(function(a, b) { return a>b; }, 2),
  gte: liftN(function(a, b) { return a>=b; }, 2),
  'in': liftN(function(a, b) { return a in b; }, 2),

  eq: liftN(function(a, b) { return a===b; }, 2),
  neq: liftN(function(a, b) { return a!==b; }, 2),

  bitand: liftN(function(a, b) { return a&b; }, 2),

  bitxor: liftN(function(a, b) { return a^b; }, 2),

  bitor: liftN(function(a, b) { return a|b; }, 2),

  not: liftN(function(a, b) { return !a; }, 1),

  and: liftN(function(a, b) { return a && b; }, 2),

  xor: liftN(function(a, b) { return (!!a) ^ (!!b); }, 2),

  or: liftN(function(a, b) { return a || b; }, 2),
};
