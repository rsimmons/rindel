'use strict';

var errors = require('./errors.js');
var typeUtils = require('./typeUtils.js');

function typeFuncRecursive(func) {
  function typeNodeRecursive(node) {
    // Recursively type any children.
    if (node.type === 'op') {
      for (var i = 0; i < node.args.length; i++) {
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
    paramTypes.push(typeUtils.createVariableType());
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
      node.inferredType = typeUtils.createVariableType();
    } else if (node.type === 'literal') {
      if (node.kind === 'function') {
        initializeFuncTypesRecursive(node.value);
        node.inferredType = node.value.inferredType;
      } else if (node.kind === 'number') {
        node.inferredType = typeUtils.createNumberType();
      } else if (node.kind === 'string') {
        node.inferredType = typeUtils.createStringType();
      } else {
        throw new error.InternalError('Unexpected literal kind');
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
  // typeFuncRecursive(topFunc);
}

module.exports = typeProgram;
