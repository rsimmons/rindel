var util = require('util');
var parser = require('./parser.js');

// testProgram = 'yield asdf'
testPrograms = [
  'yield a',
  'yield 5.2',
  'yield a(b)(c)',
  'yield a.b.c',
  'yield (a)(b)',
  'yield (a).b',
  'yield a.b(c)',
  'yield a(b).c',
  'yield a(b).c(d)',
  'yield func(x, y) { yield x }'
];

for (var i = 0; i < testPrograms.length; i++) {
  var prog = testPrograms[i];
  console.log('--------\n');
  console.log(prog + '\n');
  console.log('PARSE:\n', util.inspect(parser.parse(prog), {depth: null}), '\n');
}
