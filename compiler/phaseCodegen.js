'use strict';

var errors = require('./errors.js');
var util = require('./util.js');

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
        litValueExpr = util.indentFuncExpr(codegenFunctionRecursive(node.value));
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

module.exports = codegenFunctionRecursive;
