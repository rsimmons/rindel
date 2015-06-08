'use strict';

var parser = require('./parser.js');
var errors = require('./errors.js');
var phaseExpand = require('./phaseExpand.js');
var phaseResolveNames = require('./phaseResolveNames.js');
var phaseTyping = require('./phaseTyping.js');
var phaseToposort = require('./phaseToposort.js');
var phaseCodegen = require('./phaseCodegen.js');
var util = require('./util.js');

function compile(sourceCode, rootLexEnvNames) {
  // put these into an arbitrary but fixed order for later use
  var orderedRootLexEnvNames = [];
  for (var n in rootLexEnvNames) {
    orderedRootLexEnvNames.push(n);
  }

  // parse source code, to get our top-level AST structure, which is a list of "function body parts"
  try {
    var topFuncBody = parser.parse(sourceCode);
  } catch (e) {
    if (e instanceof parser.SyntaxError) {
      throw new errors.SyntaxError('At line ' + e.line + ' column ' + e.column + ': ' + e.message);
    } else {
      throw e;
    }
  }

  // wrap top-level code in implicit function
  var topFunc = {
    params: [],
    body: topFuncBody,
  }

  // make top-level func take all root lexenv names as arguments
  for (var i = 0; i < orderedRootLexEnvNames.length; i++) {
    topFunc.params.push({
      type: 'param',
      ident: orderedRootLexEnvNames[i],
    });
  }

  // expand (do various bookkeeping)
  phaseExpand(topFunc);

  // resolve names
  phaseResolveNames(topFunc);

  // infer and check types
  phaseTyping(topFunc);

  // toposort
  phaseToposort(topFunc);

  // generate code
  var topFuncCode = phaseCodegen(topFunc);

  // wrap the top-level function code in another function to break out root lexenv and put into args array
  var codeFragments = [];
  codeFragments.push('(function(runtime, rootLexEnv) {\n');
  codeFragments.push('  \'use strict\';\n');
  codeFragments.push('  var topArgStreams = [];\n');

  for (var i = 0; i < orderedRootLexEnvNames.length; i++) {
    codeFragments.push('  topArgStreams.push(rootLexEnv[\'' + orderedRootLexEnvNames[i] + '\']);\n'); // TODO: string-escape properly just in case?
  }

  codeFragments.push('  return ' + util.indentFuncExpr(topFuncCode) + '(runtime, 0, topArgStreams, null, \'\');\n');
  codeFragments.push('})');
  return codeFragments.join('');
}

module.exports = {
  compile: compile,
  errors: errors,
};
