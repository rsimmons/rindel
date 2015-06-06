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
