'use strict';

var errors = require('./errors.js');
var typeUtils = require('./typeUtils.js');

function typeFuncRecursive(func) {
  if (func.typeChecked) {
    return;
  }
  func.typeChecked = true;

  function typeNodeRecursive(node) {
    if (node.typeChecked) {
      return;
    }
    node.typeChecked = true;

    // Type this node and recursively type any children.
    if (node.type === 'op') {
      // Type any children.
      for (var i = 0; i < node.args.length; i++) {
        typeNodeRecursive(node.args[i]);
      }

      // Unify this node type and argument types in some way, based on operation.
      if (node.op === 'app') {
        var argTypes = [];
        for (var i = 1; i < node.args.length; i++) {
          argTypes.push(node.args[i].inferredType);
        }
        var expectedYieldType = node.inferredType;
        var expectedFuncType = typeUtils.createFunctionType(argTypes, expectedYieldType);
        typeUtils.unifyTypes(expectedFuncType, node.args[0].inferredType);
      } else if (node.op === 'ifte') {
        typeUtils.unifyTypes(node.args[0].inferredType, typeUtils.createBooleanType());
        typeUtils.unifyTypes(node.args[1].inferredType, node.args[2].inferredType);
        typeUtils.unifyTypes(node.inferredType, node.args[1].inferredType);
      } else {
        // TODO: implement
      }
    } else if (node.type === 'param') {
    } else if (node.type === 'literal') {
      if (node.kind === 'function') {
        typeFuncRecursive(node.value);
      }
    } else {
      throw new errors.InternalError('Unexpected node type');
    }
  }

  // Type from all expression roots
  typeNodeRecursive(func.body.yield);
  for (var k in func.body.bindings) {
    typeNodeRecursive(func.body.bindings[k]);
  }
}

function initializeFuncTypesRecursive(func) {
  if (func.inferredType) {
    return;
  }

  var paramTypes = [];
  for (var i = 0; i < func.params.length; i++) {
    var pt = typeUtils.createVariableType();
    func.params[i].inferredType = pt;
    paramTypes.push(pt);
  }
  var yieldType = typeUtils.createVariableType();
  func.inferredType = typeUtils.createFunctionType(paramTypes, yieldType);

  function initializeNodeTypesRecursive(node) {
    if (node.inferredType) {
      return;
    }

    // Give this node initial type and recursively initialize any children
    if (node.type === 'op') {
      node.inferredType = typeUtils.createVariableType();
      for (var i = 0; i < node.args.length; i++) {
        initializeNodeTypesRecursive(node.args[i]);
      }
    } else if (node.type === 'param') {
      // params are given types when their function is traversed to
      throw new errors.InternalError('Should not have gotten here');
    } else if (node.type === 'literal') {
      if (node.kind === 'function') {
        initializeFuncTypesRecursive(node.value);
        node.inferredType = node.value.inferredType;
      } else if (node.kind === 'boolean') {
        node.inferredType = typeUtils.createBooleanType();
      } else if (node.kind === 'number') {
        node.inferredType = typeUtils.createNumberType();
      } else if (node.kind === 'string') {
        node.inferredType = typeUtils.createStringType();
      } else {
        throw new errors.InternalError('Unexpected literal kind');
      }
    } else {
      throw new errors.InternalError('Unexpected node type');
    }
  }

  // Initialize types from all expression roots
  initializeNodeTypesRecursive(func.body.yield);
  for (var k in func.body.bindings) {
    initializeNodeTypesRecursive(func.body.bindings[k]);
  }
}

function typeProgram(topFunc) {
  initializeFuncTypesRecursive(topFunc);
  typeFuncRecursive(topFunc);
}

module.exports = typeProgram;
