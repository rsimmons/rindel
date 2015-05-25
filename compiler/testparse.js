var util = require('util');
var parser = require('./parser.js');

// testProgram = 'yield asdf'
testProgram = 'yield 5'

console.log('\nPARSE:\n', util.inspect(parser.parse(testProgram), {depth: null}));
