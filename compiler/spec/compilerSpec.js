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

  it('Inner function referring to outer binding', function() {
    var prog = compile('a = func() { yield b + 1 }\nb = 2\nyield a()');
    // TODO: run program and verify return value
  });

  it('Computation cycle involving function def', function() {
    expect(function() {
      compile('x = (func() { yield x })()\nyield x');
    }).toThrowError(errors.CycleError);
  });

  it('Non-terminating recursive function', function() {
    pending('Compiler does not yet allow recursive definitions, thinks they are cycles. This one should compile, but throw RangeError on running.');
    var program = compile('f = (func(x) { yield f(x) })\nyield f(0)');
    // TODO: expect to throw RangeError when run
  });

  it('Factorial function', function() {
    pending('Compiler does not yet allow recursive definitions, thinks they are cycles');
    var prog = compile('factorial = func(n) { yield if n == 1 then 1 else n*factorial(n-1) }\nyield factorial(5)');
    // TODO: run program and verify return value
  });
});
