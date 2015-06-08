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

  it('Cannot apply number, via function', function() {
    expect(function() {
      compile('apply = func(f, x) { yield f(x) }\nyield apply(1, 2)');
    }).toThrowError(errors.TypeError);
  });
});
