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
  var didTCO = false;
  for (var i = 0; i < func.sortedNodes.length; i++) {
    var node = func.sortedNodes[i];
    if (node.type === 'op') {
      var argStreamExprs = [];
      for (var j = 0; j < node.args.length; j++) {
        argStreamExprs.push(getNodeStreamExpr(node.args[j]));
      }

      var opFuncName = 'runtime.opFuncs.' + node.op;

      var resultArgStr;
      if ((node == func.body.yield) && (deactivatorCalls.length == 0) && (func.body.onBecomes.length == 0)) {
        // Do TCO
        if (didTCO) {
          throw new errors.InternalError('Should not be possible');
        }
        if (i != (func.sortedNodes.length-1)) {
          throw new errors.InternalError('Confusing');
        }

        didTCO = true;
        resultArgStr = 'result';
        codeFragments.push('  /*TCO*/\n');
      } else {
        resultArgStr = 'null';
        deactivatorCalls.push('act' + node.uid + '.deactivator()');
      }
      if ((node.op === 'app') && (node.args[0].type === 'literal')) {
        // Op is app and function being applied is literal. Special case this to just directly call activator
        codeFragments.push('  var act' + node.uid + ' = ' + argStreamExprs[0] + '.value(runtime, startTime, [' + argStreamExprs.slice(1).join(', ') + '], baseTopoOrder+\'' + node.topoOrder + '\', ' + resultArgStr + '); var ' + getNodeStreamExpr(node) + ' = act' + node.uid + '.outputStream;\n');
      } else {
        // Otherwise just call operator implementation function
        codeFragments.push('  var act' + node.uid + ' = ' + opFuncName + '(runtime, startTime, [' + argStreamExprs.join(', ') + '], baseTopoOrder+\'' + node.topoOrder + '\', ' + resultArgStr + '); var ' + getNodeStreamExpr(node) + ' = act' + node.uid + '.outputStream;\n');
      }
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
    codeFragments.push('  var trig' + ob.uid + ' = function(atTime) {\n');
    codeFragments.push('    if (' + getNodeStreamExpr(ob.conditionExpr) + '.value) {\n');
    codeFragments.push('      result.deactivator();\n');
    codeFragments.push('      result.deactivator = null;\n');
    for (var j = 0; j < ob.triggerFunc.sortedNodes.length; j++) {
      var node = ob.triggerFunc.sortedNodes[j];
      if (node.type === 'sample') {
        codeFragments.push('      var reg' + node.uid + ' = runtime.createConstStream(reg' + node.target.uid + '.value, atTime);\n');
      } else {
        throw new errors.InternalError('Unexpected node type');
      }
    }
    // TODO: fix this next indent
    codeFragments.push('      var newAct = ' + util.indentFuncExpr(codegenFunctionRecursive(ob.consequentFunc)) + '(runtime, atTime, [], baseTopoOrder, result);\n');
    codeFragments.push('    }\n');
    codeFragments.push('  };\n');
    codeFragments.push('  ' + getNodeStreamExpr(ob.conditionExpr) + '.addTrigger(trig' + ob.uid + ');\n');
    deactivatorCalls.push(getNodeStreamExpr(ob.conditionExpr) + '.removeTrigger(trig' + ob.uid + ')');
  }

  // I don't think these actually need to be reversed for things to work correctly,
  //  but it just seems appropriate.
  deactivatorCalls.reverse();

  if (didTCO) {
    codeFragments.push('  return act' + func.body.yield.uid + ';\n');
  } else {
    // Build result
    codeFragments.push('  result = runtime.buildResult(startTime, result, ' + getNodeStreamExpr(func.body.yield) + ', function() {\n');
    for (var i = 0; i < deactivatorCalls.length; i++) {
      codeFragments.push('    ' + deactivatorCalls[i] + ';\n');
    }
    codeFragments.push('  });\n');
    codeFragments.push('  return result;\n');
  }

  // Return result
  codeFragments.push('})');

  // join generated code fragments and return
  return codeFragments.join('');
}

module.exports = codegenFunctionRecursive;
