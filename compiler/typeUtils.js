'use strict';

var errors = require('./errors.js');

// Note: We use tags instead of classes because we need to modify the tags
//  of types in-place during unification ("union-find" style algorithm).

function createNumberType() {
  return {
    tag: 'number',
    fields: null,
  };
}

function createStringType() {
  return {
    tag: 'string',
    fields: null,
  };
}

function createFunctionType(paramTypes, yieldType) {
  return {
    tag: 'function',
    fields: {
      params: paramTypes,
      yield: yieldType,
    },
  };
}

var nextVariableUid = 1;
function createVariableType() {
  var result = {
    tag: 'variable',
    fields: {
      uid: nextVariableUid,
      instances: []
    },
  };

  nextVariableUid += 1;
  result.fields.instances.push(result);

  return result;
}

function assignVariableType(targetType, sourceType) {
  if (targetType.tag !== 'variable') {
    throw new errors.InternalError('Can only assign to variable type');
  }

  if ((sourceType.tag === 'variable') && (targetType.fields.uid === sourceType.fields.uid)) {
    // already the same, don't need to do anything
    return;
  }

  var targetUid = targetType.fields.uid;
  var instancesToModify = targetType.fields.instances;
  for (var i = 0; i < instancesToModify.length; i++) {
    var inst = instancesToModify[i];
    inst.tag = sourceType.tag;
    inst.fields = sourceType.fields;
    if (sourceType.tag === 'variable') {
      sourceType.fields.instances.push(inst);
    }
  }
}

function unifyTypes(a, b) {
  if ((a.tag === 'variable') && (b.tag === 'variable')) {
    // assign to whichever has fewer instances
    if (b.fields.instances.length <= a.fields.instances.length) {
      assignVariableType(b, a);
    } else {
      assignVariableType(a, b);
    }
  } else if (a.tag === 'variable') {
    assignVariableType(a, b);
  } else if (b.tag === 'variable') {
    assignVariableType(b, a);
  } else {
    if ((a.tag === 'number') && (b.tag === 'number')) {
      // nothing to do
    } else if ((a.tag === 'string') && (b.tag === 'string')) {
      // nothing to do
    } else if ((a.tag === 'function') && (b.tag === 'function')) {
      // unify child types
      if (a.fields.params.length != b.fields.params.length) {
        throw new errors.TypeError('Types ' + a + ' and ' + b + ' can\'t be unified, mismatching number of params');
      }
      for (var i = 0; i < a.fields.params.length; i++) {
        unifyTypes(a.fields.params[i], b.fields.params[i]);
      }
      unifyTypes(a.fields.yield, b.fields.yield);
    } else {
      throw new errors.TypeError('Types ' + a + ' and ' + b + ' can\'t be unified');
    }
  }
}

module.exports = {
  createNumberType: createNumberType,
  createStringType: createStringType,
  createFunctionType: createFunctionType,
  createVariableType: createVariableType,
  unifyTypes: unifyTypes,
}
