'use strict';

var compiler = require('./index');

var testProgram = 'baz = baaaz\nbaaaz = bark\nyield foo(bar, baz(quux))';
// var testProgram = 'yield foo';

console.log(compiler.compile(testProgram));
