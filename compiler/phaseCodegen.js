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
      } else if (node.kind === 'boolean') {
        litValueExpr = node.value.toString();
      } else if (node.kind === 'number') {
        litValueExpr = node.value.toString();
      } else if (node.kind === 'function') {
        litValueExpr = util.indentFuncExpr(codegenFunctionRecursive(node.value));
      } else {
        throw new errors.InternalError('Unexpected literal kind');
      }

      codeFragments.push('  var ' + getNodeStreamExpr(node) + ' = runtime.createConstStream(' + litValueExpr + ', startTime);\n');
    } else if (node.type === 'delayed') {
      var streamCode;
      if (node.tempo === 'step') {
        streamCode = 'runtime.createStepStream(undefined, startTime)';
      } else if (node.tempo === 'event') {
        streamCode = 'runtime.createEventStream(undefined, startTime)';
      } else {
        throw new errors.InternalError('Unexpected tempo');
      }
      codeFragments.push('  var ' + getNodeStreamExpr(node) + ' = ' + streamCode + ';\n');
    } else if (node.type === 'copy') {
      var deactivateCopyTriggerVarname = 'deactCopy' + node.uid;

      var addFuncName;
      if (node.tempo === 'step') {
        addFuncName = 'runtime.addStepCopyTrigger';
      } else if (node.tempo === 'event') {
        addFuncName = 'runtime.addEventCopyTrigger';
      } else {
        throw new errors.InternalError('Unexpected tempo');
      }

      codeFragments.push('  var ' + deactivateCopyTriggerVarname + ' = ' + addFuncName + '(' + getNodeStreamExpr(node.fromNode) + ', ' + getNodeStreamExpr(node.toNode) + ', startTime);\n');
      deactivatorCalls.push(deactivateCopyTriggerVarname + '()');
    } else {
      throw new errors.InternalError('Unexpected node type found in tree');
    }
  }

  // Generate code for on-become clauses
  for (var i = 0; i < func.body.onBecomes.length; i++) {
    var ob = func.body.onBecomes[i];
    // TODO: stuff
    codeFragments.push('  ' + getNodeStreamExpr(ob.conditionExpr) + '.addTrigger(function(atTime) {\n');
    // codeFragments.push('    console.log(\'Condition value changed to\', ' + getNodeStreamExpr(ob.conditionExpr) + '.value);\n');
    codeFragments.push('    if (' + getNodeStreamExpr(ob.conditionExpr) + '.value) {\n');
    // codeFragments.push('      console.log(\'switching\');\n');
    codeFragments.push('      result.deactivator();\n');
    codeFragments.push('      result.deactivator = null;\n');
    // console.log('BLAAAH', ob.consequentFunc);
    // TODO: fix this next indent
    codeFragments.push('      var newAct = ' + util.indentFuncExpr(codegenFunctionRecursive(ob.consequentFunc)) + '(runtime, atTime, [], baseTopoOrder, result);\n');
    codeFragments.push('    }\n');
    codeFragments.push('  });\n');
  }

  // I don't think these actually need to be reversed for things to work correctly,
  //  but it just seems appropriate.
  deactivatorCalls.reverse();

  // Build result
  codeFragments.push('  result = runtime.buildResult(result, ' + getNodeStreamExpr(func.body.yield) + ', function() {\n');
  for (var i = 0; i < deactivatorCalls.length; i++) {
    codeFragments.push('    ' + deactivatorCalls[i] + ';\n');
  }
  codeFragments.push('  });\n');

  // Return result
  codeFragments.push('  return result;\n');
  codeFragments.push('})');

  // join generated code fragments and return
  return codeFragments.join('');
}

module.exports = codegenFunctionRecursive;
