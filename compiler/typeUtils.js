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
    throw new errors.InternalError('Unexpected tag');
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
    throw new errors.InternalError('Can\'t unify yet');
  }
}

module.exports = {
  createNumberType: createNumberType,
  createFunctionType: createFunctionType,
  createVariableType: createVariableType,
  unifyTypes: unifyTypes,
}
