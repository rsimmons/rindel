var util = require('util');
var parser = require('./parser.js');

// testProgram = 'yield asdf'
testProgram = 'yield if foo then bar else baz'

console.log('\nPARSE:\n', util.inspect(parser.parse(testProgram), {depth: null}));
