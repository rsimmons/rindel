'use strict';

var compiler = require('..');
var compile = compiler.compile;
var errors = compiler.errors;

describe('Cycles suite:', function() {
  it('Cannot apply number', function() {
    expect(function() {
      compile('yield (2)(3)');
    }).toThrowError(errors.TypeError);
  });

  it('Too many function arguments', function() {
    expect(function() {
      compile('f = func() { yield 1 }\nyield f(2)');
    }).toThrowError(errors.TypeError);
  });

  it('Too many function arguments again', function() {
    expect(function() {
      compile('f = func(x) { yield x + 1 }\nyield f(2, 3)');
    }).toThrowError(errors.TypeError);
  });

  it('Not enough function arguments', function() {
    expect(function() {
      compile('f = func(x) { yield x + 1 }\nyield f()');
    }).toThrowError(errors.TypeError);
  });

  it('Cannot apply number, via function', function() {
    expect(function() {
      compile('apply = func(f, x) { yield f(x) }\nyield apply(1, 2)');
    }).toThrowError(errors.TypeError);
  });

  it('If-then-else OK', function() {
    compile('yield if true then 3 else 4');
    // TODO: check output
  });

  it('If-then-else non-boolean condition', function() {
    expect(function() {
      compile('yield if 2 then 3 else 4');
    }).toThrowError(errors.TypeError);
  });

  it('If-then-else non-matching alternatives', function() {
    expect(function() {
      compile('yield if true then false else 4');
    }).toThrowError(errors.TypeError);
  });

  it('Nested if-then-else OK', function() {
    compile('x = true\nyield if (if x then false else true) then 3 else 4');
    // TODO: check output
  });

  it('Nested if-then-else, result doesn\'t match context', function() {
    expect(function() {
      compile('x = true\nyield if (if x then 5 else 6) then 3 else 4');
    }).toThrowError(errors.TypeError);
  });

  it('Comparison works fine', function() {
    compile('yield if (1 < 2) then 3 else 4');
    // TODO: check output
  });

  it('Comparison sides must be same type', function() {
    expect(function() {
      compile('yield true == 2');
    }).toThrowError(errors.TypeError);
  });

  it('Comparison result can\'t be number', function() {
    expect(function() {
      compile('yield (1 < 2) + 3');
    }).toThrowError(errors.TypeError);
  });
});
