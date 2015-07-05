'use strict';

var errors = require('./errors.js');
var typeUtils = require('./typeUtils.js');

// These ops take numbers as arguments and return a number.
var NUMERIC_OPS = {
  uplus: null,
  uminus: null,
  bitnot: null,
  mul: null,
  div: null,
  add: null,
  sub: null,
  lshift: null,
  srshift: null,
  zrshift: null,
  bitand: null,
  bitxor: null,
  bitor: null,
}

// These ops take booleans as arguments and return a boolean.
var BOOLEAN_OPS = {
  not: null,
  and: null,
  xor: null,
  or: null,
}

var COMPARISON_OPS = {
  lt: null,
  lte: null,
  gt: null,
  gte: null,
  eq: null,
  neq: null,
}

function initializeFuncTypesRecursive(func) {
  if (func.inferredType) {
    return;
  }

  var params = [];
  for (var i = 0; i < func.params.length; i++) {
    if (func.params[i].inferredType) {
      continue;
    }

    var pt = typeUtils.createVariableType();
    func.params[i].inferredType = pt;
    params.push({
      type: pt,
    });
  }
  var yieldType = typeUtils.createVariableType();
  func.inferredType = typeUtils.createFunctionType(params, yieldType);

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
        node.inferredType = typeUtils.BOOLEAN;
      } else if (node.kind === 'number') {
        node.inferredType = typeUtils.NUMBER;
      } else if (node.kind === 'string') {
        node.inferredType = typeUtils.STRING;
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
  for (var i = 0; i < func.body.onBecomes.length; i++) {
    var ob = func.body.onBecomes[i];
    initializeNodeTypesRecursive(ob.conditionExpr);
    initializeFuncTypesRecursive(ob.consequentFunc);
  }
}

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
        var expectedParams = [];
        for (var i = 1; i < node.args.length; i++) {
          expectedParams.push({
            type: node.args[i].inferredType,
          });
        }
        var expectedYieldType = node.inferredType;
        var expectedFuncType = typeUtils.createFunctionType(expectedParams, expectedYieldType);
        typeUtils.unifyTypes(expectedFuncType, node.args[0].inferredType);
      } else if (NUMERIC_OPS.hasOwnProperty(node.op)) {
        typeUtils.unifyTypes(node.inferredType, typeUtils.NUMBER);
        for (var i = 0; i < node.args.length; i++) {
          typeUtils.unifyTypes(node.args[i].inferredType, typeUtils.NUMBER);
        }
      } else if (BOOLEAN_OPS.hasOwnProperty(node.op)) {
        typeUtils.unifyTypes(node.inferredType, typeUtils.BOOLEAN);
        for (var i = 0; i < node.args.length; i++) {
          typeUtils.unifyTypes(node.args[i].inferredType, typeUtils.BOOLEAN);
        }
      } else if (COMPARISON_OPS.hasOwnProperty(node.op)) {
        typeUtils.unifyTypes(node.inferredType, typeUtils.BOOLEAN);
        typeUtils.unifyTypes(node.args[0].inferredType, node.args[1].inferredType);
        // TODO: We ensure that left and right are of same type, but nothing about what those types might be
      } else if (node.op === 'ifte') {
        typeUtils.unifyTypes(node.args[0].inferredType, typeUtils.BOOLEAN);
        typeUtils.unifyTypes(node.args[1].inferredType, node.args[2].inferredType);
        typeUtils.unifyTypes(node.inferredType, node.args[1].inferredType);
      } else if (node.op === 'prop') {
        // TODO: implement
      } else if (node.op === 'in') {
        // TODO: implement
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
  for (var i = 0; i < func.body.onBecomes.length; i++) {
    var ob = func.body.onBecomes[i];
    // TODO: enforce constraints on types of conditionExpr and consequentFunc
    typeNodeRecursive(ob.conditionExpr);
    typeFuncRecursive(ob.consequentFunc);
  }
}

function typeProgram(topFunc) {
  initializeFuncTypesRecursive(topFunc);
  typeFuncRecursive(topFunc);
}

module.exports = typeProgram;
