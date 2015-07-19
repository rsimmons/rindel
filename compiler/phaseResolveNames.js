'use strict';

var errors = require('./errors.js');

function resolveFunctionNamesRecursive(func, outerLexEnv) {
  // number parameters and derive "set" of parameter names for easy lookup
  var paramNamesSet = {};
  for (var i = 0; i < func.params.length; i++) {
    paramNamesSet[func.params[i].ident] = null;
  }

  for (var k in func.body.bindings) {
    if (paramNamesSet.hasOwnProperty(k)) {
      throw new errors.RebindingError('Can\'t bind name ' + k + ' because it\'s the name of a parameter');
    }
  }

  // Determine new lexical environment created by this function.
  //  This includes parameters and bindings.
  var curLexEnv = {};
  // copy outer lex env
  for (var k in outerLexEnv) {
    curLexEnv[k] = outerLexEnv[k];
  }
  // add parameters
  for (var i = 0; i < func.params.length; i++) {
    curLexEnv[func.params[i].ident] = func.params[i];
  }
  // add bindings
  for (var k in func.body.bindings) {
    curLexEnv[k] = func.body.bindings[k];
  }

  // Name resolution
  var RES_IN_PROGRESS = 1;
  var RES_COMPLETE = 2;
  var freeVarNames = {}; // track names we reference in the outer lexical environment

  // Takes a varIdent node, and returns the non-varIdent node that it ultimately refers to.
  function resolveVarIdent(node) {
    if (node.type !== 'varIdent') {
      throw new errors.InternalError('Expected varIdent');
    }

    if (node.resState === RES_COMPLETE) {
      return node.resNode;
    } else if (node.resState === RES_IN_PROGRESS) {
      throw new errors.CircularBindingError('Circular name bindings');
    } else if (node.resState === undefined) {
      if (curLexEnv.hasOwnProperty(node.ident)) {
        var n = curLexEnv[node.ident];
        if (n.type === 'varIdent') {
          node.resState = RES_IN_PROGRESS;
          n = resolveVarIdent(n);
        }

        node.resNode = n;
        node.resState = RES_COMPLETE;

        return node.resNode;
      } else {
        throw new errors.NameResolutionError('Name "'+ node.ident + '" not found');
      }
    } else {
      throw new errors.InternalError('Invalid resState');
    }
  }

  // Return value is a (possibly) new node ref that caller should use in place of argument node ref
  function resolveNodeNamesRecursive(node) {
    if (node.type === 'op') {
      if (node.resState === RES_COMPLETE) {
        return node;
      }

      node.resState = RES_COMPLETE;

      for (var i = 0; i < node.args.length; i++) {
        node.args[i] = resolveNodeNamesRecursive(node.args[i]);
      }

      return node;
    } else if (node.type === 'varIdent') {
      var n = resolveVarIdent(node);
      resolveNodeNamesRecursive(n);
      return n;
    } else if (node.type === 'param') {
      if (node.resState === RES_COMPLETE) {
        return node;
      }

      node.resState = RES_COMPLETE;

      return node;
    } else if (node.type === 'literal') {
      if (node.resState === RES_COMPLETE) {
        return node;
      }

      node.resState = RES_COMPLETE;

      if (node.kind === 'function') {
        resolveFunctionNamesRecursive(node.value, curLexEnv);
      }

      return node;
    } else if (node.type === 'sample') {
      if (node.resState === RES_COMPLETE) {
        return node;
      }

      node.resState = RES_COMPLETE;

      node.target = resolveNodeNamesRecursive(node.target);

      return node;
    } else {
      throw new errors.InternalError('Unexpected node type: ' + node.type);
    }
  }

  // Do name resolution from all expression roots
  func.body.yield = resolveNodeNamesRecursive(func.body.yield);
  for (var k in func.body.bindings) {
    func.body.bindings[k] = resolveNodeNamesRecursive(func.body.bindings[k]);
  }
  for (var i = 0; i < func.body.onBecomes.length; i++) {
    var ob = func.body.onBecomes[i];
    ob.conditionExpr = resolveNodeNamesRecursive(ob.conditionExpr);

    // Create object representing the trigger function, to contain sample nodes
    ob.triggerFunc = {
      sortedNodes: [],
    };

    // Make alternate environment with local bindings "sampled" with sample nodes.
    //  It's important that we make a separate one of these for each on-become.
    var curLexEnvSampled = {};
    // copy outer lex env
    for (var k in outerLexEnv) {
      curLexEnvSampled[k] = outerLexEnv[k];
    }
    // add parameters
    for (var j = 0; j < func.params.length; j++) {
      curLexEnvSampled[func.params[j].ident] = func.params[j];
    }
    // add bindings
    for (var k in func.body.bindings) {
      var sampleNode = {
        type: 'sample',
        tempo: 'const', // TODO: should this be 'event' if target is event?
        containingFunction: ob.triggerFunc, // contained by trigger
        target: func.body.bindings[k], // TODO: is this safe/correct? bindings[k] can get modified
      };
      curLexEnvSampled[k] = sampleNode;
    }

    resolveFunctionNamesRecursive(ob.consequentFunc, curLexEnvSampled);
  }
}

function resolveProgramNames(topFunc) {
  resolveFunctionNamesRecursive(topFunc, {});
}

module.exports = resolveProgramNames;
