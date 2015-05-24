'use strict';

var compiler = require('./compiler');

var testProgram = 'yield foo(bar, baz(quux))';
// var testProgram = 'yield foo';

console.log(compiler.compile(testProgram));
