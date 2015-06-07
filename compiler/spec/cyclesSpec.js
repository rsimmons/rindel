'use strict';

var compiler = require('..');
var compile = compiler.compile;
var errors = compiler.errors;

describe('Cycles suite:', function() {
  it('Circular name binding', function() {
    expect(function() {
      compile('a = a\nyield 0');
    }).toThrowError(errors.CircularBindingError);
  });

  it('Circular name bindings', function() {
    expect(function() {
      compile('a = b\nb = a\nyield 0');
    }).toThrowError(errors.CircularBindingError);
  });

  it('Initialization cycle, var applying itself', function() {
    // TODO: also this wouldn't typecheck
    expect(function() {
      compile('x = x(0)\nyield x');
    }).toThrowError(errors.CycleError);
  });

  it('Initialization cycle', function() {
    expect(function() {
      compile('x = y + 1\ny = x\nyield 0');
    }).toThrowError(errors.CycleError);
  });

  it('Inner function referring to outer binding', function() {
    var prog = compile('a = func() { yield b + 1 }\nb = 2\nyield a()');
    // TODO: run program and verify return value
  });

  it('Inner function referring to outer binding', function() {
    var prog = compile('x = y()\ny = func() { yield z }\nz = 5\nyield x');
    // TODO: run program and verify return value
  });

  it('Initialization cycle with IIFE', function() {
    expect(function() {
      compile('x = (func() { yield x })()\nyield x');
    }).toThrowError(errors.CycleError);
  });

  it('Initialization cycle with IIFE', function() {
    expect(function() {
      compile('x = (func() { yield 1 + x })()\nyield x');
    }).toThrowError(errors.CycleError);
  });

  it('Initialization cycle, more complicated', function() {
    expect(function() {
      compile('f = func() { yield 1 + x }\ng = if 0 then f else f\nx = g()\nyield x');
    }).toThrowError(errors.CycleError);
  });

  it('Non-terminating recursive function', function() {
    // pending('Compiler does not yet allow recursive definitions, thinks they are cycles. This one should compile, but throw RangeError on running.');
    var program = compile('f = func(x) { yield 1 + f(x) }\nyield f(0)');
    // TODO: expect to throw RangeError when run
  });

  it('Factorial function', function() {
    // pending('Compiler does not yet allow recursive definitions, thinks they are cycles');
    var prog = compile('factorial = func(n) { yield if n == 1 then 1 else n*factorial(n-1) }\nyield factorial(5)');
    // TODO: run program and verify return value
  });
});
