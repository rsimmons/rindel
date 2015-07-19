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
      if (node.op === 'app') {
        var funcType = node.args[0].inferredType;
        if (funcType && ((funcType.tag !== 'function') || (funcType.fields.params.length !== (node.args.length - 1)))) {
          throw new errors.InternalError('Should have been caught during type checking');
        }

        toposortVisit(node.args[0], applicationDepth);
        for (var i = 1; i < node.args.length; i++) {
          if (funcType && funcType.fields.params[i-1].delayed) {
            // TODO: If the argument is a constant, we could skip this stuff.
            // This arg is "delayed", we don't need its value right away to initialize current app-op node.

            // Create a "delayed" node to pass in for now. This is a stream that starts undefined and gets
            //  its value copied in by a "copy" node.
            var delayedNode = {
              type: 'delayed',
              uid: uidCounter.getNext(),
              tempo: 'step', // TODO: this needs to be set correctly
              containingFunction: node.containingFunction,
              topoState: TOPOSTATE_ADDED,
            };
            node.containingFunction.sortedNodes.push(delayedNode);

            // Create a "copy" node that will see changes on the "real" argument, and copy them
            //  to the "delayed" node we just created.
            var copyNode = {
              type: 'copy',
              uid: uidCounter.getNext(),
              tempo: 'step', // TODO: this needs to be set correctly
              fromNode: node.args[i],
              toNode: delayedNode,
              containingFunction: node.containingFunction,
            };
            exprRootsToVisit.push({node: copyNode, applicationDepth: applicationDepth}); // Visit this later

            node.args[i] = delayedNode; // Change the reference that this node has to its argument to point at "delayed" node.
          } else {
            toposortVisit(node.args[i], applicationDepth);
          }
        }

        toposortVisit(node.args[0], applicationDepth+1);
      } else {
        // TODO: Not all ops should pass on their applicationDepth unchanged when visiting children.
        //  For example, if-then-else should pass applicationDepth 0 to its condition expression node,
        //  but pass on the same applicationDepth to its consequent and alternative children.
        for (var i = 0; i < node.args.length; i++) {
          toposortVisit(node.args[i], applicationDepth);
        }
      }
    } else if (node.type === 'param') {
      // nothing to do
    } else if (node.type === 'literal') {
      // nothing to do
    } else if (node.type === 'sample') {
      toposortVisit(node.target, applicationDepth);
    } else if (node.type === 'copy') {
      if (node.toNode.topoState !== TOPOSTATE_ADDED) {
        throw new errors.InternalError('Should have already been added');
      }
      toposortVisit(node.fromNode, applicationDepth);
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

  // Traverse from all expression roots sortedNodes arrays.
  // We keep an array here because as we go, because we may add to it because of
  //  applicaiton of functions with delayed parameters. And while visiting those
  //  added roots, we could end up adding more.
  var exprRootsToVisit = [];
  exprRootsToVisit.push({node: func.body.yield, applicationDepth: applicationDepth});
  for (var i = 0; i < func.body.onBecomes.length; i++) {
    var ob = func.body.onBecomes[i];
    ob.uid = uidCounter.getNext(); // we give each on-become itself a uid, as it's useful later
    exprRootsToVisit.push({node: ob.conditionExpr, applicationDepth: applicationDepth});
  }
  // NOTE: Nodes not already added to a sortedNodes array are not needed to compute output.
  //  If we wanted to eliminate dead code, we could pass a "dead" flag so that anything reached
  //  in these next recursive calls would not be added to sortedNodes arrays.
  for (var k in func.body.bindings) {
    exprRootsToVisit.push({node: func.body.bindings[k], applicationDepth: applicationDepth});
  }

  while (exprRootsToVisit.length > 0) {
    var next = exprRootsToVisit.shift();
    toposortVisit(next.node, next.applicationDepth);
  }

  // Handle on-become consequents.
  // TODO: not so sure this is correct, need to think and test more
  for (var i = 0; i < func.body.onBecomes.length; i++) {
    var ob = func.body.onBecomes[i];
    toposortFunctionRecursive(ob.consequentFunc, uidCounter, 0);
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
