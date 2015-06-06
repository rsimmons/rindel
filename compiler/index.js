'use strict';

var parser = require('./parser.js');
var errors = require('./errors.js');

function Counter() {
  this.next = 1;
}

Counter.prototype.getNext = function() {
  var result = this.next;
  this.next++;
  return result;
}

function indentFuncExpr(code) {
  var lines = code.trim().split('\n');
  for (var j = 1; j < lines.length; j++) {
    lines[j] = '  ' + lines[j];
  }
  return lines.join('\n');
}

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
    } else {
      throw new errors.InternalError('Unexpected node type');
    }
  }

  // Do name resolution from all expression roots
  func.body.yield = resolveNodeNamesRecursive(func.body.yield);
  for (var k in func.body.bindings) {
    func.body.bindings[k] = resolveNodeNamesRecursive(func.body.bindings[k]);
  }
}

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

function codegenFunctionRecursive(func) {
  // We zero-pad ordering numbers to make lexicographically sortable topoOrder strings.
  // Here we determine the resulting length of string we need to make.
  var paddedOrderLength = (func.sortedNodes.length - 1).toString().length;
  var zeroStr = Array(paddedOrderLength).join('0');
  function padOrderNumber(n) {
    return (zeroStr + n.toString()).slice(-paddedOrderLength);
  }

  // Store the local topographic sort order strings on nodes themselves.
  for (var i = 0; i < func.sortedNodes.length; i++) {
    func.sortedNodes[i].topoOrder = padOrderNumber(i);
  }

  // begin code generation
  var codeFragments = [];

  // this is sort of ghetto but will do for now
  codeFragments.push('(function(runtime, startTime, argStreams, baseTopoOrder, result) {\n');
  codeFragments.push('  if (argStreams.length !== ' + func.params.length + ') { throw new Error(\'called with wrong number of arguments\'); }\n');

  function getNodeStreamExpr(node) {
    return 'reg' + node.uid;
  }

  // iterate sorted nodes, doing some code generation
  var deactivatorCalls = [];
  for (var i = 0; i < func.sortedNodes.length; i++) {
    var node = func.sortedNodes[i];
    if (node.type === 'op') {
      var argStreamExprs = [];
      for (var j = 0; j < node.args.length; j++) {
        argStreamExprs.push(getNodeStreamExpr(node.args[j]));
      }

      var opFuncName = 'runtime.opFuncs.' + node.op;

      codeFragments.push('  var act' + node.uid + ' = ' + opFuncName + '(runtime, startTime, [' + argStreamExprs.join(', ') + '], baseTopoOrder+\'' + node.topoOrder + '\', null); var ' + getNodeStreamExpr(node) + ' = act' + node.uid + '.outputStream;\n');

      deactivatorCalls.push('act' + node.uid + '.deactivator()');
    } else if (node.type === 'param') {
      codeFragments.push('  var ' + getNodeStreamExpr(node) + ' = argStreams[' + node.position + '];\n');
    } else if (node.type === 'literal') {
      var litValueExpr;
      if (node.kind === 'string') {
        // TODO: we might want to call a proper repr()-style escape on the value, but it should only be safe characters anyways
        litValueExpr = '\'' + node.value + '\'';
      } else if (node.kind === 'number') {
        litValueExpr = node.value.toString();
      } else if (node.kind === 'function') {
        litValueExpr = indentFuncExpr(codegenFunctionRecursive(node.value));
      } else {
        throw new errors.InternalError('Unexpected literal kind');
      }

      codeFragments.push('  var ' + getNodeStreamExpr(node) + ' = runtime.createConstStream(' + litValueExpr + ', startTime);\n');
    } else {
      throw new errors.InternalError('Unexpected node type found in tree');
    }
  }

  // I don't think these actually need to be reversed for things to work correctly,
  //  but it just seems appropriate.
  deactivatorCalls.reverse();

  // we might need to copy "inner" output to real output stream, if outputStream arg was provided
  var innerOutputExpr = getNodeStreamExpr(func.body.yield);
  codeFragments.push('  var deactivateCopyTrigger;\n');
  codeFragments.push('  if (result) {\n');
  codeFragments.push('    deactivateCopyTrigger = runtime.addCopyTrigger(' + innerOutputExpr + ', result.outputStream);\n');
  codeFragments.push('  } else {\n');
  codeFragments.push('    result = {outputStream: ' + innerOutputExpr + ', deactivator: null};\n');
  codeFragments.push('  }\n');

  codeFragments.push('  if (result.deactivator) { throw new Error(\'deactivator should be null\'); }\n');

  codeFragments.push('  result.deactivator = function() {\n');
  codeFragments.push('    if (deactivateCopyTrigger) { deactivateCopyTrigger(); }\n');
  for (var i = 0; i < deactivatorCalls.length; i++) {
    codeFragments.push('    ' + deactivatorCalls[i] + ';\n');
  }
  codeFragments.push('  };\n');

  // generate return statement
  codeFragments.push('  return result;\n');
  codeFragments.push('})');

  // join generated code fragments and return
  return codeFragments.join('');
}

function compile(sourceCode, rootLexEnvNames) {
  // put these into an arbitrary but fixed order for later use
  var orderedRootLexEnvNames = [];
  for (var n in rootLexEnvNames) {
    orderedRootLexEnvNames.push(n);
  }

  // parse source code, to get our top-level AST structure, which is a list of "function body parts"
  try {
    var topFuncBody = parser.parse(sourceCode);
  } catch (e) {
    if (e instanceof parser.SyntaxError) {
      throw new errors.SyntaxError('At line ' + e.line + ' column ' + e.column + ': ' + e.message);
    } else {
      throw e;
    }
  }

  // wrap top-level code in implicit function
  var topFunc = {
    params: [],
    body: topFuncBody,
  }

  // make top-level func take all root lexenv names as arguments
  for (var i = 0; i < orderedRootLexEnvNames.length; i++) {
    topFunc.params.push({
      type: 'param',
      ident: orderedRootLexEnvNames[i],
    });
  }

  // expand (do various bookkeeping)
  expandFuncRecursive(topFunc);

  // resolve names
  resolveFunctionNamesRecursive(topFunc, {});

  // toposort
  toposortFunctionRecursive(topFunc, new Counter());

  // generate code
  var topFuncCode = codegenFunctionRecursive(topFunc);

  // wrap the top-level function code in another function to break out root lexenv and put into args array
  var codeFragments = [];
  codeFragments.push('(function(runtime, rootLexEnv) {\n');
  codeFragments.push('  \'use strict\';\n');
  codeFragments.push('  var topArgStreams = [];\n');

  for (var i = 0; i < orderedRootLexEnvNames.length; i++) {
    codeFragments.push('  topArgStreams.push(rootLexEnv[\'' + orderedRootLexEnvNames[i] + '\']);\n'); // TODO: string-escape properly just in case?
  }

  codeFragments.push('  return ' + indentFuncExpr(topFuncCode) + '(runtime, 0, topArgStreams, null, \'\');\n');
  codeFragments.push('})');
  return codeFragments.join('');
}

module.exports = {
  compile: compile,
  errors: errors,
};
