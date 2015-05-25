'use strict';

var compiler = require('./index');

var testProgram = 'yield 5 + 2 * 3 * 4';
// var testProgram = 'yield foo';

console.log(compiler.compile(testProgram));
