var util = require('util');
var parser = require('./parser.js');

testProgram = 'foo(bar)(baz)'

console.log('\nPARSE:\n', util.inspect(parser.parse(testProgram), {depth: null}));
