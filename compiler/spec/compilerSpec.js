'use strict';

var compiler = require('..');
var compile = compiler.compile;
var errors = compiler.errors;

describe('Compiler suite:', function() {
  it('Empty program', function() {
    expect(function() {
      compile('');
    }).toThrowError(errors.SyntaxError);
  });

  it('Nonsense program', function() {
    expect(function() {
      compile('foo');
    }).toThrowError(errors.SyntaxError);
  });

  it('Binding but no yield', function() {
    expect(function() {
      compile('x = 5');
    }).toThrowError(errors.SyntaxError);
  });

  it('Conflicting bindings', function() {
    expect(function() {
      compile('x = 5\ny = 6\nx = 7\nyield 0');
    }).toThrowError(errors.SyntaxError);
  });

  it('Binding conflicting with parameter', function() {
    expect(function() {
      compile('x = func(y) {\ny = 5\nyield y\n}\nyield 0');
    }).toThrowError(errors.RebindingError);
  });

  it('Circular name bindings', function() {
    expect(function() {
      compile('a = b\nb = a\nyield 0');
    }).toThrowError(errors.CircularBindingError);
  });

  it('Computation cycle', function() {
    expect(function() {
      compile('x = y + 1\ny = x\nyield 0');
    }).toThrowError(errors.CycleError);
  });
});
