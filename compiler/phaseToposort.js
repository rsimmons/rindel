'use strict';

var errors = require('./errors.js');

// Topological sorting to determine computation/update order
function toposortFunctionRecursive(func, counter) {
  var TOPOSTATE_ENTERED = 1; // node has been entered in traversal, but not yet added to ordering
  var TOPOSTATE_ADDED = 2; // node has been added to ordering, and is "done"

  func.sortedNodes = [];

  function toposortVisit(node) {
    if (node.topoState === TOPOSTATE_ENTERED) {
      throw new errors.CycleError('Cycle in computation graph found during topological sort');
    } else if (node.topoState === TOPOSTATE_ADDED) {
      // already taken care of
      return;
    }

    node.topoState = TOPOSTATE_ENTERED;

    node.uid = counter.getNext();

    // visit any nodes this node depends on
    if (node.type === 'op') {
      for (var i = 0; i < node.args.length; i++) {
        toposortVisit(node.args[i]);
      }
    } else if (node.type === 'param') {
      // nothing to do
    } else if (node.type === 'literal') {
      if (node.kind === 'function') {
        toposortFunctionRecursive(node.value, counter);
      }
    } else {
      throw new errors.InternalError('Unexpected node type found during toposort');
    }

    // finally, add this node to sort order and update its state
    node.containingFunction.sortedNodes.push(node);
    node.topoState = TOPOSTATE_ADDED;
  }

  // Traverse from all expression roots sortedNodes arrays
  toposortVisit(func.body.yield);
  // NOTE: Nodes not already added to a sortedNodes array are not needed to compute output,
  //  but we might have inner functions that refer to names defined in this scope.
  // TODO: pass flag to toposortVisit so these don't get computed? or don't traverse at all?
  for (var k in func.body.bindings) {
    toposortVisit(func.body.bindings[k]);
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
  toposortFunctionRecursive(topFunc, new Counter());
}

module.exports = toposortProgram;
