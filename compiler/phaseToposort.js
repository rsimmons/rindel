'use strict';

var errors = require('./errors.js');

function toposortFunctionRecursive(func, uidCounter, applicationDepth) {
  var TOPOSTATE_ENTERED = 1; // node has been entered in traversal, but not yet added to ordering
  var TOPOSTATE_ADDED = 2; // node has been added to ordering, and is "done"

  if (!func.toposortVisited) {
    func.sortedNodes = [];
    func.subfunctions = []; // functions defined in the scope of this function
    func.toposortVisited = true;
  }

  function toposortVisit(node, applicationDepth) {
    if (node.topoState === TOPOSTATE_ENTERED) {
      throw new errors.CycleError('Cycle in computation graph found during topological sort');
    } else if ((node.topoState === TOPOSTATE_ADDED) && (applicationDepth <= node.topoAddedToApplicationDepth)) {
      // already taken care of
      return;
    }

    if (!node.topoState) {
      node.topoState = TOPOSTATE_ENTERED;
      node.uid = uidCounter.getNext();
    }

    // Visit any nodes this node depends on.
    if (node.type === 'op') {
      // TODO: Not all ops should pass on their applicationDepth unchanged when visiting children.
      //  For example, if-then-else should pass applicationDepth 0 to its condition expression node,
      //  but pass on the same applicationDepth to its consequent and alternative children.
      for (var i = 0; i < node.args.length; i++) {
        toposortVisit(node.args[i], applicationDepth);
      }

      if (node.op === 'app') {
        toposortVisit(node.args[0], applicationDepth+1);
      }
    } else if (node.type === 'param') {
      // nothing to do
    } else if (node.type === 'literal') {
      // nothing to do
    } else {
      throw new errors.InternalError('Unexpected node type found during toposort');
    }

    // If this is this first call of toposortVisit on this node, node.topoState will be
    //  TOPOSTATE_ENTERED at this point. Do some work that we only want to do on the
    //  first visit, like adding it to the correct sortedNodes array and moving it to
    //  TOPOSTATE_ADDED.
    if (node.topoState === TOPOSTATE_ENTERED) {
      // add this node to sort order and update its state
      node.containingFunction.sortedNodes.push(node);
      node.topoState = TOPOSTATE_ADDED;

      // We track all functions that are immediately contained by a function, for later use.
      if ((node.type === 'literal') && (node.kind === 'function')) {
        node.containingFunction.subfunctions.push(node.value);
      }
    }

    // Update the "high water mark" of applicationDepth to which we have been called on this node.
    node.topoAddedToApplicationDepth = applicationDepth;

    // If this node is a function literal and applicationDepth is > 0, then that means its defined
    //  function will be applied. Recurse into its function, to find what nodes it depends on.
    if ((node.type === 'literal') && (node.kind === 'function') && (applicationDepth > 0)) {
      toposortFunctionRecursive(node.value, uidCounter, applicationDepth-1);
    }
  }

  // Traverse from all expression roots sortedNodes arrays
  toposortVisit(func.body.yield, applicationDepth);
  // NOTE: Nodes not already added to a sortedNodes array are not needed to compute output.
  //  If we wanted to eliminate dead code, we could pass a "dead" flag so that anything reached
  //  in these next recursive calls would not be added to sortedNodes arrays.
  for (var k in func.body.bindings) {
    toposortVisit(func.body.bindings[k], applicationDepth);
  }

  // Here we handle a different type of "dead" code. There may be subfunctions (functions defined
  //  in the immediate scope of func) that never got recursed into, because they were never applied.
  //  Check for those, and recurse into them. Once again, could pass "dead" flag here.
  for (var i = 0; i < func.subfunctions.length; i++) {
    if (!func.subfunctions[i].toposortVisited) {
      toposortFunctionRecursive(func.subfunctions[i], uidCounter, 0);
    }
  }
}

function Counter() {
  this.next = 1;
}

Counter.prototype.getNext = function() {
  var result = this.next;
  this.next++;
  return result;
}

function toposortProgram(topFunc) {
  toposortFunctionRecursive(topFunc, new Counter(), 0);
}

module.exports = toposortProgram;
