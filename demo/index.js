'use strict';

var Runtime = require('../runtime');

var runtime = new Runtime();

var rootLexEnv;

var finalOutput = runtime.createSlot();

var initialDateNow = Date.now();

function getMasterTime() {
  return 0.001*(Date.now() - initialDateNow);
}

var timeoutID;

// "run" the runtime as necessary
function tryRunning() {
  if (!runtime.isRunnable()) {
    return;
  }

  var t = getMasterTime();
  var nextTime = runtime.runToTime(t);
  // console.log(t, nextTime);
  console.log('output is now', runtime.getSlotValue(finalOutput));

  if (nextTime && !timeoutID) {
    timeoutID = window.setTimeout(function() {
      timeoutID = null;
      tryRunning();
    }, 1000*(nextTime-t));
  }
}

document.addEventListener('mousemove', function(e) {
  var t = getMasterTime();
  var mouseX = e.clientX||e.pageX;
  var mouseY = e.clientY||e.pageY;
  // console.log('mouse', t, mouseX, mouseY);
  runtime.setSlotValue(rootLexEnv.mouseX, mouseX, t);
  runtime.setSlotValue(rootLexEnv.mouseY, mouseY, t);

  tryRunning();
}, false);

function startDemoProg(prog) {
  rootLexEnv = runtime.createLexEnv({
    add: runtime.createSlot(),
    delay1: runtime.createSlot(),
    mouseX: runtime.createSlot(),
    mouseY: runtime.createSlot(),
  });

  runtime.setSlotValue(rootLexEnv.add, runtime.primitives.add, 0);
  runtime.setSlotValue(rootLexEnv.delay1, runtime.primitives.delay1, 0);
  runtime.setSlotValue(rootLexEnv.mouseX, 0, 0);
  runtime.setSlotValue(rootLexEnv.mouseY, 0, 0);

  // assume main activator definition has been generated by compiler
  prog.main(runtime, 0, [], finalOutput, '', rootLexEnv);

  console.log('initial output is', runtime.getSlotValue(finalOutput));

  tryRunning();
}

// require demo programs
var prog0 = require('./progs/prog0');
var prog1 = require('./progs/prog1');

startDemoProg(prog1);
