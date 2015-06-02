'use strict';

var parser = require('./parser.js');

function indentFuncExpr(code) {
  var lines = code.trim().split('\n');
  for (var j = 1; j < lines.length; j++) {
    lines[j] = '  ' + lines[j];
  }
  return lines.join('\n');
}

function compileFunction(paramNames, bodyParts, outerLexEnvNames) {
  // derive "set" of parameter names for easy lookup
  var paramNamesSet = {};
  for (var i = 0; i < paramNames.length; i++) {
    paramNamesSet[paramNames[i]] = null;
  }

  // verify that there is exactly one yield clause
  var yieldObj;
  for (var i = 0; i < bodyParts.length; i++) {
    var bp = bodyParts[i];
    if (bp.type === 'yield') {
      if (yieldObj) {
        throw new Error('Multiple yield clauses found in function body');
      }
      yieldObj = bp;
    }
  }

  if (!yieldObj) {
    throw new Error('No yield clause found in function body');
  }

  var yieldExpr = yieldObj.expr;

  var localBindingExprs = {}; // mapping of names bound in this function to their expressions
  for (var i = 0; i < bodyParts.length; i++) {
    var bp = bodyParts[i];
    if (bp.type === 'binding') {
      if (paramNamesSet.hasOwnProperty(bp.ident)) {
        throw new Error('Can\'t bind name to same name as a parameter');
      }
      if (localBindingExprs.hasOwnProperty(bp.ident)) {
        throw new Error('Same name bound more than once');
      }
      localBindingExprs[bp.ident] = bp.expr;
    }
  }

  // Determine names of new lexical environment created by this function
  var curLexEnvNames = {};
  // copy outer lex env
  for (var k in outerLexEnvNames) {
    curLexEnvNames[k] = null;
  }
  // add parameters
  for (var i = 0; i < paramNames.length; i++) {
    curLexEnvNames[paramNames[i]] = null;
  }
  // add bindings
  for (var k in localBindingExprs) {
    curLexEnvNames[k] = null;
  }

  // Name resolution
  // Return value is a (possibly) new node ref that caller should use in place of argument node ref
  // We'll detect if there are any "name loops", like "a = b; b = a".
  var RES_IN_PROGRESS = 1;
  var RES_COMPLETE = 2;
  var freeVarNames = {}; // track names we reference in the outer lexical environment
  function resolveNamesRecursive(node) {
    if (node.type === 'op') {
      if (node.resState === RES_COMPLETE) {
        return node;
      }
      for (var i = 0; i < node.args.length; i++) {
        node.args[i] = resolveNamesRecursive(node.args[i]);
      }
      node.resState = RES_COMPLETE;
      return node;
    } else if (node.type === 'varIdent') {
      if (node.resState === undefined) {
        if (localBindingExprs.hasOwnProperty(node.ident)) {
          node.resState = RES_IN_PROGRESS;

          var n = localBindingExprs[node.ident];
          n = resolveNamesRecursive(n);

          node.resNode = n;
          node.resState = RES_COMPLETE;

          return n;
        } else {
          // check if node.ident is actually in lexical environment
          if (!curLexEnvNames.hasOwnProperty(node.ident)) {
            throw new Error('Name not found: ' + node.ident);
          }

          // change the type of this node to lexEnv. 'ident' property stays unchanged
          node.type = 'lexEnv';
          if (!paramNamesSet.hasOwnProperty(node.ident)) {
            freeVarNames[node.ident] = null;
          }
          return node;
        }
      } else if (node.resState === RES_IN_PROGRESS) {
        throw new Error('Circular bindings');
      } else if (node.resState === RES_COMPLETE) {
        return node.resNode;
      } else {
        throw new Error('Invalid resState');
      }
    } else if (node.type === 'literal') {
      // nothing to do
      return node;
    } else if (node.type === 'lexEnv') {
      // nothing to do
      return node;
    } else {
      throw new Error('Unexpected node type');
    }
  }

  // Do name resolution from all expression roots
  yieldExpr = resolveNamesRecursive(yieldExpr);
  for (var k in localBindingExprs) {
    localBindingExprs[k] = resolveNamesRecursive(localBindingExprs[k]);
  }

  // Topological sorting to determine computation/update order
  var TOPOSTATE_ENTERED = 1; // node has been entered in traversal, but not yet added to ordering
  var TOPOSTATE_ADDED = 2; // node has been added to ordering, and is "done"
  var sortedNodes = [];
  function toposortVisit(node) {
    if (node.topoState === TOPOSTATE_ENTERED) {
      throw new Error('Cycle in computation graph, can\'t toposort');
    } else if (node.topoState === TOPOSTATE_ADDED) {
      // already taken care of
      return;
    }

    node.topoState = TOPOSTATE_ENTERED;

    // visit any nodes this node depends on
    if (node.type === 'op') {
      for (var i = 0; i < node.args.length; i++) {
        toposortVisit(node.args[i]);
      }
    } else if (node.type === 'lexEnv') {
      // nothing to do since leaf
    } else if (node.type === 'literal') {
      // nothing to do since leaf
    } else {
      throw new Error('Unexpected node type found during toposort');
    }

    // finally, add this node to sort order and update its state
    sortedNodes.push(node);
    node.topoState = TOPOSTATE_ADDED;
  }

  // Traverse from all expression roots, building sortedNodes array
  toposortVisit(yieldExpr);
  // NOTE: Nodes not already added to sortedNodes are not needed to compute output,
  //  but we might have inner functions that refer to names defined in this scope.
  for (var k in localBindingExprs) {
    toposortVisit(localBindingExprs[k]);
  }

  // We zero-pad ordering numbers to make lexicographically sortable topoOrder strings.
  // Here we determine the resulting length of string we need to make.
  var paddedOrderLength = (sortedNodes.length - 1).toString().length;
  var zeroStr = Array(paddedOrderLength).join('0');
  function padOrderNumber(n) {
    return (zeroStr + n.toString()).slice(-paddedOrderLength);
  }

  // Store the topographic sort order strings on nodes themselves.
  for (var i = 0; i < sortedNodes.length; i++) {
    sortedNodes[i].topoOrder = padOrderNumber(i);
  }

  // begin code generation
  var codeFragments = [];

  // this is sort of ghetto but will do for now
  codeFragments.push('(function(runtime, startTime, argStreams, baseTopoOrder, result) {\n');
  codeFragments.push('  if (argStreams.length !== ' + paramNames.length + ') { throw new Error(\'called with wrong number of arguments\'); }\n');

  for (var i = 0; i < paramNames.length; i++) {
    codeFragments.push('  var $_' + paramNames[i] + ' = argStreams[' + i + '];\n');
  }

  function getNodeStreamExpr(node) {
    if ((node.type === 'op') || (node.type === 'literal')) {
      return 'reg' + node.topoOrder;
    } else if (node.type === 'lexEnv') {
      return '$_' + node.ident;
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }

  // iterate sorted nodes, doing some code generation
  var deactivatorCalls = [];
  for (var i = 0; i < sortedNodes.length; i++) {
    var node = sortedNodes[i];
    if (node.type === 'op') {
      var argStreamExprs = [];
      for (var j = 0; j < node.args.length; j++) {
        argStreamExprs.push(getNodeStreamExpr(node.args[j]));
      }

      var opFuncName = 'runtime.opFuncs.' + node.op;

      codeFragments.push('  var act' + node.topoOrder + ' = ' + opFuncName + '(runtime, startTime, [' + argStreamExprs.join(', ') + '], baseTopoOrder+\'' + node.topoOrder + '\', null); var reg' + node.topoOrder + ' = act' + node.topoOrder + '.outputStream;\n');

      deactivatorCalls.push('act' + node.topoOrder + '.deactivator()');
    } else if (node.type === 'lexEnv') {
      // do nothing
    } else if (node.type === 'literal') {
      var litValueExpr;
      if (node.kind === 'string') {
        // TODO: we might want to call a proper repr()-style escape on the value, but it should only be safe characters anyways
        litValueExpr = '\'' + node.value + '\'';
      } else if (node.kind === 'number') {
        litValueExpr = node.value.toString();
      } else if (node.kind === 'function') {
        var subFuncResult = compileFunction(node.value.params, node.value.body, curLexEnvNames);
        litValueExpr = indentFuncExpr(subFuncResult.code);
      } else {
        throw new Error('unexpected literal kind');
      }

      codeFragments.push('  var reg' + node.topoOrder + ' = runtime.createConstStream(' + litValueExpr + ', startTime);\n');
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }

  // add vars for bound names
  for (var k in localBindingExprs) {
    codeFragments.push('  var $_' + k + ' = ' + getNodeStreamExpr(localBindingExprs[k]) + ';\n');
  }

  // I don't think these actually need to be reversed for things to work correctly,
  //  but it just seems appropriate.
  deactivatorCalls.reverse();

  // we might need to copy "inner" output to real output stream, if outputStream arg was provided
  var innerOutputExpr = getNodeStreamExpr(yieldExpr);
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
  return {
    code: codeFragments.join(''),
    freeVarNames: freeVarNames,
  };
}

function compile(sourceCode, rootLexEnvNames) {
  // parse source code, to get our top-level AST structure, which is a list of "function body parts"
  var topFuncBodyParts = parser.parse(sourceCode);

  // compile the top-level parts, treating them as implicitly wrapped in no-parameter "main" definition
  var topFuncResult = compileFunction([], topFuncBodyParts, rootLexEnvNames);

  // now wrap this in another function to make a scope to define 'globals'
  var codeFragments = [];
  codeFragments.push('(function(runtime, rootLexEnv) {\n');
  codeFragments.push('  \'use strict\';\n');

  for (var n in rootLexEnvNames) {
    codeFragments.push('  var $_' + n + ' = rootLexEnv[\'' + n + '\'];\n'); // TODO: we should string-escape n here
  }

  codeFragments.push('  return ' + indentFuncExpr(topFuncResult.code) + '(runtime, 0, [], null, \'\');\n');
  codeFragments.push('})');
  return codeFragments.join('');
}

module.exports = {
  compile: compile,
};
