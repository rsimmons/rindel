var util = require('util');
var parser = require('./parser.js');

testProgram = 'yield foo(bar)'

console.log('\nPARSE:\n', util.inspect(parser.parse(testProgram), {depth: null}));
