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
    var prog = compile('x = y()\ny = func() { yield z + 1 }\nz = 5\nyield x');
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
      compile('f = func() { yield 1 + x }\ng = if true then f else f\nx = g()\nyield x');
    }).toThrowError(errors.CycleError);
  });

  it('Application depth test, depth 0', function() {
    compile('f = func() { yield g }\ng = func() { yield h }\nh = func() { yield x }\nx = f\nyield x');
    // should compile fine
  });

  it('Application depth test, depth 1', function() {
    compile('f = func() { yield g }\ng = func() { yield h }\nh = func() { yield x }\nx = f()\nyield x');
    // should compile fine
  });

  it('Application depth test, depth 2', function() {
    compile('f = func() { yield g }\ng = func() { yield h }\nh = func() { yield x }\nx = f()()\nyield x');
    // should compile fine
  });

  it('Application depth test, depth 3', function() {
    expect(function() {
      compile('f = func() { yield g }\ng = func() { yield h }\nh = func() { yield x }\nx = f()()()\nyield x');
    }).toThrowError(errors.CycleError);
  });

  it('Closure-esque test', function() {
    var prog = compile('makeAdder = func(y) { yield func(x) { yield x + y } }\nadd10 = makeAdder(10)\nyield add10(1)');
    // TOOD: run program and verify that return value is 11
  });

  it('Non-terminating recursive function', function() {
    var prog = compile('f = func(x) { yield 1 + f(x) }\nyield f(0)');
    // TODO: expect to throw RangeError when run
  });

  it('Factorial function', function() {
    var prog = compile('factorial = func(n) { yield if n == 1 then 1 else n*factorial(n-1) }\nyield factorial(5)');
    // TODO: expect to throw RangeError when run. this doesn't actually terminate, because if-then-else always constructs its "else" clause
  });
});
