'use strict';

var errors = require('./errors.js');

// Do various bookkeeping tasks on tree.
// - number function param nodes
// - set containingFunction property of all (non-function) nodes
function expandFuncRecursive(func) {
  // set position numbers and containingFunction of param nodes
  for (var i = 0; i < func.params.length; i++) {
    func.params[i].position = i;
    func.params[i].containingFunction = func;
  }

  function expandNodeRecursive(node) {
    if (node.containingFunction) {
      return;
    }

    node.containingFunction = func;

    // Recursively expand any children.
    if (node.type === 'op') {
      for (var i = 0; i < node.args.length; i++) {
        expandNodeRecursive(node.args[i]);
      }
    } else if (node.type === 'varIdent') {
    } else if (node.type === 'literal') {
      if (node.kind === 'function') {
        expandFuncRecursive(node.value);
      }
    } else {
      throw new errors.InternalError('Unexpected node type');
    }
  }

  // Expand from all expression roots
  expandNodeRecursive(func.body.yield);
  for (var k in func.body.bindings) {
    expandNodeRecursive(func.body.bindings[k]);
  }
}

module.exports = expandFuncRecursive;
