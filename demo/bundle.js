(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

function main(runtime, startTime, argSlots, outputSlot, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  // add application for final output (slot already created)
  var $_unappOut = runtime.addApplication(startTime, lexEnv.add, [lexEnv.mouseX, lexEnv.mouseY], outputSlot, baseTopoOrder+'1');

  // create and return deactivator closure. it needs to undo any applications
  return function() {
    $_unappOut();
  };
}

module.exports = {
  code: 'yield mouseX + mouseY',
  main: main,
};

},{}],2:[function(require,module,exports){
'use strict';

function main(runtime, startTime, argSlots, outputSlot, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  // add application for final output (slot already created)
  var $_unappOut = runtime.addApplication(startTime, lexEnv.delay1, [lexEnv.mouseX], outputSlot, baseTopoOrder+'1');

  // create and return deactivator closure. it needs to undo any applications
  return function() {
    $_unappOut();
  };
}

module.exports = {
  code: 'yield delay1(mouseX)',
  main: main,
};

},{}],3:[function(require,module,exports){
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

Runtime.prototype.createSlot = function() {
  return {
    currentValue: undefined,
    triggers: [],
  };
};

Runtime.prototype.getSlotValue = function(slot) {
  return slot.value;
};

Runtime.prototype.setSlotValue = function(slot, value, atTime) {
  slot.value = value;
  for (var i = 0; i < slot.triggers.length; i++) {
    slot.triggers[i](atTime);
  }
};

Runtime.prototype.addTrigger = function(slot, closure) {
  slot.triggers.push(closure);
};

Runtime.prototype.removeTrigger = function(slot, closure) {
  var idx;

  for (var i = 0; i < slot.triggers.length; i++) {
    if (slot.triggers[i] === closure) {
      if (idx !== undefined) {
        throw new Error('found two identical triggers');
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
};

Runtime.prototype.runNextTask = function() {
  var nextTask = this.priorityQueue.pull(); // gets most "urgent" task
  nextTask.closure(nextTask.time);
};

Runtime.prototype.isRunnable = function() {
  return !this.priorityQueue.isEmpty();
};

Runtime.prototype.addApplication = function(startTime, func, args, output, baseTopoOrder, lexEnv) {
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
    deactivator = activator(runtime, atTime, args, output, baseTopoOrder, lexEnv);

    if (deactivator === undefined) {
      throw new Error('activator did not return deactivator function');
    }
  }

  // do first update
  updateActivator(startTime);

  // add trigger to update activator
  runtime.addTrigger(func, updateActivator);

  // return function that removes anything set up by this activation
  return function() {
    runtime.removeTrigger(func, updateActivator);
    deactivator();
  }
};

Runtime.prototype.primitives = require('./prims');

module.exports = Runtime;

},{"./pq":6,"./prims":7}],4:[function(require,module,exports){
module.exports = require('./lib/heap');

},{"./lib/heap":5}],5:[function(require,module,exports){
// Generated by CoffeeScript 1.8.0
(function() {
  var Heap, defaultCmp, floor, heapify, heappop, heappush, heappushpop, heapreplace, insort, min, nlargest, nsmallest, updateItem, _siftdown, _siftup;

  floor = Math.floor, min = Math.min;


  /*
  Default comparison function to be used
   */

  defaultCmp = function(x, y) {
    if (x < y) {
      return -1;
    }
    if (x > y) {
      return 1;
    }
    return 0;
  };


  /*
  Insert item x in list a, and keep it sorted assuming a is sorted.
  
  If x is already in a, insert it to the right of the rightmost x.
  
  Optional args lo (default 0) and hi (default a.length) bound the slice
  of a to be searched.
   */

  insort = function(a, x, lo, hi, cmp) {
    var mid;
    if (lo == null) {
      lo = 0;
    }
    if (cmp == null) {
      cmp = defaultCmp;
    }
    if (lo < 0) {
      throw new Error('lo must be non-negative');
    }
    if (hi == null) {
      hi = a.length;
    }
    while (lo < hi) {
      mid = floor((lo + hi) / 2);
      if (cmp(x, a[mid]) < 0) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return ([].splice.apply(a, [lo, lo - lo].concat(x)), x);
  };


  /*
  Push item onto heap, maintaining the heap invariant.
   */

  heappush = function(array, item, cmp) {
    if (cmp == null) {
      cmp = defaultCmp;
    }
    array.push(item);
    return _siftdown(array, 0, array.length - 1, cmp);
  };


  /*
  Pop the smallest item off the heap, maintaining the heap invariant.
   */

  heappop = function(array, cmp) {
    var lastelt, returnitem;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    lastelt = array.pop();
    if (array.length) {
      returnitem = array[0];
      array[0] = lastelt;
      _siftup(array, 0, cmp);
    } else {
      returnitem = lastelt;
    }
    return returnitem;
  };


  /*
  Pop and return the current smallest value, and add the new item.
  
  This is more efficient than heappop() followed by heappush(), and can be
  more appropriate when using a fixed size heap. Note that the value
  returned may be larger than item! That constrains reasonable use of
  this routine unless written as part of a conditional replacement:
      if item > array[0]
        item = heapreplace(array, item)
   */

  heapreplace = function(array, item, cmp) {
    var returnitem;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    returnitem = array[0];
    array[0] = item;
    _siftup(array, 0, cmp);
    return returnitem;
  };


  /*
  Fast version of a heappush followed by a heappop.
   */

  heappushpop = function(array, item, cmp) {
    var _ref;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    if (array.length && cmp(array[0], item) < 0) {
      _ref = [array[0], item], item = _ref[0], array[0] = _ref[1];
      _siftup(array, 0, cmp);
    }
    return item;
  };


  /*
  Transform list into a heap, in-place, in O(array.length) time.
   */

  heapify = function(array, cmp) {
    var i, _i, _j, _len, _ref, _ref1, _results, _results1;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    _ref1 = (function() {
      _results1 = [];
      for (var _j = 0, _ref = floor(array.length / 2); 0 <= _ref ? _j < _ref : _j > _ref; 0 <= _ref ? _j++ : _j--){ _results1.push(_j); }
      return _results1;
    }).apply(this).reverse();
    _results = [];
    for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
      i = _ref1[_i];
      _results.push(_siftup(array, i, cmp));
    }
    return _results;
  };


  /*
  Update the position of the given item in the heap.
  This function should be called every time the item is being modified.
   */

  updateItem = function(array, item, cmp) {
    var pos;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    pos = array.indexOf(item);
    if (pos === -1) {
      return;
    }
    _siftdown(array, 0, pos, cmp);
    return _siftup(array, pos, cmp);
  };


  /*
  Find the n largest elements in a dataset.
   */

  nlargest = function(array, n, cmp) {
    var elem, result, _i, _len, _ref;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    result = array.slice(0, n);
    if (!result.length) {
      return result;
    }
    heapify(result, cmp);
    _ref = array.slice(n);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      elem = _ref[_i];
      heappushpop(result, elem, cmp);
    }
    return result.sort(cmp).reverse();
  };


  /*
  Find the n smallest elements in a dataset.
   */

  nsmallest = function(array, n, cmp) {
    var elem, i, los, result, _i, _j, _len, _ref, _ref1, _results;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    if (n * 10 <= array.length) {
      result = array.slice(0, n).sort(cmp);
      if (!result.length) {
        return result;
      }
      los = result[result.length - 1];
      _ref = array.slice(n);
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        elem = _ref[_i];
        if (cmp(elem, los) < 0) {
          insort(result, elem, 0, null, cmp);
          result.pop();
          los = result[result.length - 1];
        }
      }
      return result;
    }
    heapify(array, cmp);
    _results = [];
    for (i = _j = 0, _ref1 = min(n, array.length); 0 <= _ref1 ? _j < _ref1 : _j > _ref1; i = 0 <= _ref1 ? ++_j : --_j) {
      _results.push(heappop(array, cmp));
    }
    return _results;
  };

  _siftdown = function(array, startpos, pos, cmp) {
    var newitem, parent, parentpos;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    newitem = array[pos];
    while (pos > startpos) {
      parentpos = (pos - 1) >> 1;
      parent = array[parentpos];
      if (cmp(newitem, parent) < 0) {
        array[pos] = parent;
        pos = parentpos;
        continue;
      }
      break;
    }
    return array[pos] = newitem;
  };

  _siftup = function(array, pos, cmp) {
    var childpos, endpos, newitem, rightpos, startpos;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    endpos = array.length;
    startpos = pos;
    newitem = array[pos];
    childpos = 2 * pos + 1;
    while (childpos < endpos) {
      rightpos = childpos + 1;
      if (rightpos < endpos && !(cmp(array[childpos], array[rightpos]) < 0)) {
        childpos = rightpos;
      }
      array[pos] = array[childpos];
      pos = childpos;
      childpos = 2 * pos + 1;
    }
    array[pos] = newitem;
    return _siftdown(array, startpos, pos, cmp);
  };

  Heap = (function() {
    Heap.push = heappush;

    Heap.pop = heappop;

    Heap.replace = heapreplace;

    Heap.pushpop = heappushpop;

    Heap.heapify = heapify;

    Heap.updateItem = updateItem;

    Heap.nlargest = nlargest;

    Heap.nsmallest = nsmallest;

    function Heap(cmp) {
      this.cmp = cmp != null ? cmp : defaultCmp;
      this.nodes = [];
    }

    Heap.prototype.push = function(x) {
      return heappush(this.nodes, x, this.cmp);
    };

    Heap.prototype.pop = function() {
      return heappop(this.nodes, this.cmp);
    };

    Heap.prototype.peek = function() {
      return this.nodes[0];
    };

    Heap.prototype.contains = function(x) {
      return this.nodes.indexOf(x) !== -1;
    };

    Heap.prototype.replace = function(x) {
      return heapreplace(this.nodes, x, this.cmp);
    };

    Heap.prototype.pushpop = function(x) {
      return heappushpop(this.nodes, x, this.cmp);
    };

    Heap.prototype.heapify = function() {
      return heapify(this.nodes, this.cmp);
    };

    Heap.prototype.updateItem = function(x) {
      return updateItem(this.nodes, x, this.cmp);
    };

    Heap.prototype.clear = function() {
      return this.nodes = [];
    };

    Heap.prototype.empty = function() {
      return this.nodes.length === 0;
    };

    Heap.prototype.size = function() {
      return this.nodes.length;
    };

    Heap.prototype.clone = function() {
      var heap;
      heap = new Heap();
      heap.nodes = this.nodes.slice(0);
      return heap;
    };

    Heap.prototype.toArray = function() {
      return this.nodes.slice(0);
    };

    Heap.prototype.insert = Heap.prototype.push;

    Heap.prototype.top = Heap.prototype.peek;

    Heap.prototype.front = Heap.prototype.peek;

    Heap.prototype.has = Heap.prototype.contains;

    Heap.prototype.copy = Heap.prototype.clone;

    return Heap;

  })();

  (function(root, factory) {
    if (typeof define === 'function' && define.amd) {
      return define([], factory);
    } else if (typeof exports === 'object') {
      return module.exports = factory();
    } else {
      return root.Heap = factory();
    }
  })(this, function() {
    return Heap;
  });

}).call(this);

},{}],6:[function(require,module,exports){
'use strict';

var Heap = require('heap');

var PriorityQueue = function() {
  this.heap = new Heap(function(a, b) {
    if (a.time === b.time) {
      return (a.topoOrder < b.topoOrder) ? -1 : ((b.topoOrder > a.topoOrder) ? 1 : 0);
    } else {
      return a.time - b.time;
    }
  });
};

PriorityQueue.prototype.isEmpty = function() {
  this.pullRemoved();
  return this.heap.empty();
};

PriorityQueue.prototype.insert = function(task) {
  this.heap.push(task);
};

PriorityQueue.prototype.peek = function() {
  this.pullRemoved();
  return this.heap.peek();
};

PriorityQueue.prototype.pull = function() {
  // We allow inserting tasks that are exactly identical to other tasks,
  //  but we want them to be coalesced (de-duplicated). Rather than do that
  //  at insert time, it seems easier to do it at pull time.

  this.pullRemoved();

  // pop next task
  var task = this.heap.pop();

  // As long as heap is not empty, keep popping off any tasks identical to this one.
  // They must all come in a row, so we can stop when we get a different one.
  while (true) {
    this.pullRemoved();

    if (this.heap.empty()) {
      break;
    }

    var nextTask = this.heap.peek();
    if ((nextTask.time === task.time) && (nextTask.topoOrder === task.topoOrder) && (nextTask.closure === task.closure)) {
      this.heap.pop();
    } else {
      break;
    }
  }

  return task;
};

PriorityQueue.prototype.remove = function(task) {
  // We don't actually remove it, we just set a flag so it will be ignored later.
  task.removed = true;
};

// keep pulling until queue is empty or next task is not flagged as removed
PriorityQueue.prototype.pullRemoved = function() {
  while (!this.heap.empty()) {
    var nextTask = this.heap.peek();
    if (nextTask.removed) {
      this.heap.pop();
    } else {
      break;
    }
  }
}

module.exports = PriorityQueue;

},{"heap":4}],7:[function(require,module,exports){
'use strict';

function liftN(func, arity) {
  return function(runtime, startTime, argSlots, outputSlot, baseTopoOrder, lexEnv) {
    if (argSlots.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    var updateTask = function(atTime) {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(runtime.getSlotValue(argSlots[i]));
      }
      var outVal = func.apply(null, argVals);
      runtime.setSlotValue(outputSlot, outVal, atTime);
    };

    // make closure that queues task to update value in outputSlot
    var updateTrigger = function(atTime) {
      runtime.priorityQueue.insert({
        time: atTime,
        topoOrder: baseTopoOrder,
        closure: updateTask,
      });
    }

    // set initial output
    updateTrigger(startTime);

    // add triggers
    for (var i = 0; i < arity; i++) {
      runtime.addTrigger(argSlots[i], updateTrigger);
    }

    // create and return deactivator closure, which removes created triggers
    return function() {
      for (var i = 0; i < arity; i++) {
        runtime.removeTrigger(argSlots[i], updateTrigger);
      }
    };
  };
};

function delay1(runtime, startTime, argSlots, outputSlot, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var argSlot = argSlots[0];
  var scheduledChanges = []; // ordered list of {time: ..., value: ...}
  var pendingOutputChangeTask = null;

  // if needed, add task for updating output, and update our bookeeping
  var updateTasks = function() {
    if ((scheduledChanges.length > 0) && !pendingOutputChangeTask) {
      var nextChange = scheduledChanges[0];
      // TODO: this should probably call a method of runtime instead of accessing priorityQueue directly
      // TODO: this call could get back a 'task handle' that we use to remove a pending task on deactivate
      var changeTask = {
        time: nextChange.time,
        topoOrder: baseTopoOrder,
        closure: changeOutput,
      };
      runtime.priorityQueue.insert(changeTask);
      pendingOutputChangeTask = changeTask;
    }
  };

  // closure to be called when time has come to change output value
  var changeOutput = function(atTime) {
    if (scheduledChanges.length === 0) {
      throw new Error('no changes to make');
    }

    // pull next change off 'front' of queue
    var nextChange = scheduledChanges.shift();

    // sanity check
    if (atTime !== nextChange.time) {
      throw new Error('times do not match');
    }

    runtime.setSlotValue(outputSlot, nextChange.value, atTime);

    pendingOutputChangeTask = null;
    updateTasks();
  };

  var argChangedTask = function(atTime) {
    var argVal = runtime.getSlotValue(argSlot);
    scheduledChanges.push({
      time: atTime + 1.0, // here is the delay amount
      value: argVal,
    });

    updateTasks();
  };

  // make closure to add task when argument value changes
  var argChangedTrigger = function(atTime) {
    runtime.priorityQueue.insert({
      time: atTime,
      topoOrder: baseTopoOrder,
      closure: argChangedTask,
    });
  };

  // set initial output to be initial input
  var argVal = runtime.getSlotValue(argSlot);
  runtime.setSlotValue(outputSlot, argVal, startTime);

  // add trigger on argument
  runtime.addTrigger(argSlot, argChangedTrigger);

  // create and return deactivator closure, which removes created triggers
  return function() {
    runtime.removeTrigger(argSlot, argChangedTrigger);
    if (pendingOutputChangeTask) {
      runtime.priorityQueue.remove(pendingOutputChangeTask);
    }
  };
};

module.exports = {
  add: liftN(function(a, b) { return a+b; }, 2),
  sub: liftN(function(a, b) { return a-b; }, 2),

  delay1: delay1,
};

},{}],8:[function(require,module,exports){
'use strict';

var Runtime = require('../runtime');

var demoProgs = {
  'same position': require('./progs/prog0'),
  'delayed position': require('./progs/prog1'),
};

var initialDateNow = Date.now();
var runtime;
var rootLexEnv;
var finalOutput;
var timeoutID;
var currentDeactivator;
var inputValues = {
  mouseX: 0,
  mouseY: 0,
}

function getMasterTime() {
  return 0.001*(Date.now() - initialDateNow);
}

// "run" the runtime as necessary
function tryRunning() {
  if (!runtime.isRunnable()) {
    return;
  }

  var t = getMasterTime();
  var nextTime = runtime.runToTime(t);

  if (nextTime && !timeoutID) {
    timeoutID = window.setTimeout(function() {
      timeoutID = null;
      tryRunning();
    }, 1000*(nextTime-t));
  }
}

document.addEventListener('mousemove', function(e) {
  var t = getMasterTime();
  inputValues.mouseX = e.clientX||e.pageX;
  inputValues.mouseY = e.clientY||e.pageY;
  // console.log('mouse', t, mouseX, mouseY);
  runtime.setSlotValue(rootLexEnv.mouseX, inputValues.mouseX, t);
  runtime.setSlotValue(rootLexEnv.mouseY, inputValues.mouseY, t);
  runtime.setSlotValue(rootLexEnv.mousePos, {x: inputValues.mouseX, y: inputValues.mouseY}, t);

  tryRunning();
}, false);

function startDemoProg(prog) {
  if (currentDeactivator) {
    // deactivate current running program
    currentDeactivator();

    // remove any timeout that's set
    if (timeoutID) {
      window.clearTimeout(timeoutID);
      timeoutID = null;
    }

    // begin sanity checking

    // make sure its not runnable
    if (runtime.isRunnable()) {
      throw new Error('something went wrong');
    }

    // make sure there are no triggers on global slots
    for (var k in rootLexEnv) {
      if (rootLexEnv[k].triggers.length > 0) {
        throw new Error('something went wrong');
      }
    }

    // end sanity checking
  }

  runtime = new Runtime();

  rootLexEnv = runtime.createLexEnv({
    add: runtime.createSlot(),
    delay1: runtime.createSlot(),
    mouseX: runtime.createSlot(),
    mouseY: runtime.createSlot(),
    mousePos: runtime.createSlot(),
  });

  runtime.setSlotValue(rootLexEnv.add, runtime.primitives.add, 0);
  runtime.setSlotValue(rootLexEnv.delay1, runtime.primitives.delay1, 0);
  runtime.setSlotValue(rootLexEnv.mouseX, inputValues.mouseX, 0);
  runtime.setSlotValue(rootLexEnv.mouseY, inputValues.mouseY, 0);
  runtime.setSlotValue(rootLexEnv.mousePos, {x: inputValues.mouseX, y: inputValues.mouseY}, 0);

  finalOutput = runtime.createSlot();
  runtime.addTrigger(finalOutput, function(atTime) {
    var outputVal = runtime.getSlotValue(finalOutput);

    console.log('output is now', outputVal);

    var squareElem = document.getElementById('square');
    squareElem.style.left = (outputVal - 17) + 'px';
    squareElem.style.top = '100px';
    // squareElem.style.left = (outputVal.x - 17) + 'px';
    // squareElem.style.top = (outputVal.y - 17) + 'px';
  });

  document.getElementById('code-column-code').textContent = prog.code;

  // assume main activator definition has been generated by compiler
  currentDeactivator = prog.main(runtime, 0, [], finalOutput, '', rootLexEnv);

  tryRunning();
}

function createDemoControls() {
  var demosListElem = document.getElementById('demos-list');

  for (var name in demoProgs) {
    var li = document.createElement('LI');
    li.setAttribute('class', 'demo-choice');
    li.appendChild(document.createTextNode(name));
    demosListElem.appendChild(li);

/*
    var ce = document.createElement('CODE');
    ce.className = 'language-javascript';
    var extractedCode = /\/\/SHOWBEGIN([^]*)\/\/SHOWEND/gm.exec(demos[name].code)[1].trim();
    ce.appendChild(document.createTextNode(extractedCode));

    var pe = document.createElement('PRE');
    pe.className = 'code-wrapper';
    pe.style.display = 'none';
    pe.appendChild(ce);

    codeColumnElem.appendChild(pe);

    demos[k].preElem = pe;
*/
  }
  demosListElem.firstChild.classList.add('demo-active');

  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('demo-choice')) {
      // update UI
      for (var i = 0; i < demosListElem.childNodes.length; i++) {
        demosListElem.childNodes[i].classList.remove('demo-active');
      }
      e.target.classList.add('demo-active');

      // run program
      var name = e.target.textContent;
      var prog = demoProgs[name];
      startDemoProg(prog);
    }
  }, false);
}

document.addEventListener('DOMContentLoaded', function() {
  createDemoControls();

  startDemoProg(demoProgs['same position']);
});

},{"../runtime":3,"./progs/prog0":1,"./progs/prog1":2}]},{},[8]);
