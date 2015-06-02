(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var parser = require('./parser.js');

function indentFuncExpr(code) {
  var lines = code.trim().split('\n');
  for (var j = 1; j < lines.length; j++) {
    lines[j] = '  ' + lines[j];
  }
  return lines.join('\n');
}

function compileFunction(paramNames, bodyParts, outerLexEnvNames) {
  // derive "set" of parameter names for easy lookup
  var paramNamesSet = {};
  for (var i = 0; i < paramNames.length; i++) {
    paramNamesSet[paramNames[i]] = null;
  }

  // verify that there is exactly one yield clause
  var yieldObj;
  for (var i = 0; i < bodyParts.length; i++) {
    var bp = bodyParts[i];
    if (bp.type === 'yield') {
      if (yieldObj) {
        throw new Error('Multiple yield clauses found in function body');
      }
      yieldObj = bp;
    }
  }

  if (!yieldObj) {
    throw new Error('No yield clause found in function body');
  }

  var yieldExpr = yieldObj.expr;

  var localBindingExprs = {}; // mapping of names bound in this function to their expressions
  for (var i = 0; i < bodyParts.length; i++) {
    var bp = bodyParts[i];
    if (bp.type === 'binding') {
      if (paramNamesSet.hasOwnProperty(bp.ident)) {
        throw new Error('Can\'t bind name to same name as a parameter');
      }
      if (localBindingExprs.hasOwnProperty(bp.ident)) {
        throw new Error('Same name bound more than once');
      }
      localBindingExprs[bp.ident] = bp.expr;
    }
  }

  // Determine names of new lexical environment created by this function
  var curLexEnvNames = {};
  // copy outer lex env
  for (var k in outerLexEnvNames) {
    curLexEnvNames[k] = null;
  }
  // add parameters
  for (var i = 0; i < paramNames.length; i++) {
    curLexEnvNames[paramNames[i]] = null;
  }
  // add bindings
  for (var k in localBindingExprs) {
    curLexEnvNames[k] = null;
  }

  // Name resolution and function literal compilation
  // Return value is a (possibly) new node ref that caller should use in place of argument node ref
  // We'll detect if there are any "name loops", like "a = b; b = a".
  var RES_IN_PROGRESS = 1;
  var RES_COMPLETE = 2;
  var freeVarNames = {}; // track names we reference in the outer lexical environment
  function resolveNamesRecursive(node) {
    if (node.type === 'op') {
      if (node.resState === RES_COMPLETE) {
        return node;
      }
      for (var i = 0; i < node.args.length; i++) {
        node.args[i] = resolveNamesRecursive(node.args[i]);
      }
      node.resState = RES_COMPLETE;
      return node;
    } else if (node.type === 'varIdent') {
      if (node.resState === undefined) {
        if (localBindingExprs.hasOwnProperty(node.ident)) {
          node.resState = RES_IN_PROGRESS;

          var n = localBindingExprs[node.ident];
          n = resolveNamesRecursive(n);

          node.resNode = n;
          node.resState = RES_COMPLETE;

          return n;
        } else {
          // check if node.ident is actually in lexical environment
          if (!curLexEnvNames.hasOwnProperty(node.ident)) {
            throw new Error('Name not found: ' + node.ident);
          }

          // change the type of this node to lexEnv. 'ident' property stays unchanged
          node.type = 'lexEnv';
          if (!paramNamesSet.hasOwnProperty(node.ident)) {
            freeVarNames[node.ident] = null;
          }
          return node;
        }
      } else if (node.resState === RES_IN_PROGRESS) {
        throw new Error('Circular bindings');
      } else if (node.resState === RES_COMPLETE) {
        return node.resNode;
      } else {
        throw new Error('Invalid resState');
      }
    } else if (node.type === 'literal') {
      if (node.resState === RES_COMPLETE) {
        return node;
      } else if (node.resState === RES_IN_PROGRESS) {
        throw new Error('Circular bindings involving function literal');
      }

      node.resState = RES_IN_PROGRESS;

      if (node.kind === 'function') {
        var subFuncResult = compileFunction(node.value.params, node.value.body, curLexEnvNames);
        node.code = subFuncResult.code;

        node.freeVarNodes = [];
        console.log('before', node.freeVarNodes);
        for (var k in subFuncResult.freeVarNames) {
          console.log(k);
          node.freeVarNodes.push(resolveNamesRecursive({
            type: 'varIdent',
            ident: k,
          }));
        }
        console.log('after', node.freeVarNodes);
      }

      node.resState = RES_COMPLETE;
      return node;
    } else if (node.type === 'lexEnv') {
      // nothing to do
      return node;
    } else {
      throw new Error('Unexpected node type');
    }
  }

  // Do name resolution from all expression roots
  yieldExpr = resolveNamesRecursive(yieldExpr);
  for (var k in localBindingExprs) {
    localBindingExprs[k] = resolveNamesRecursive(localBindingExprs[k]);
  }

  // Store bound names that resolve to a node with the node itself
  for (var k in localBindingExprs) {
    var n = localBindingExprs[k];
    if (!n.localBoundNames) {
      n.localBoundNames = [];
    }
    n.localBoundNames.push(k);
  }

  // Topological sorting to determine computation/update order
  var TOPOSTATE_ENTERED = 1; // node has been entered in traversal, but not yet added to ordering
  var TOPOSTATE_ADDED = 2; // node has been added to ordering, and is "done"
  var sortedNodes = [];
  function toposortVisit(node) {
    if (node.topoState === TOPOSTATE_ENTERED) {
      throw new Error('Cycle in computation graph, can\'t toposort');
    } else if (node.topoState === TOPOSTATE_ADDED) {
      // already taken care of
      return;
    }

    node.topoState = TOPOSTATE_ENTERED;

    // visit any nodes this node depends on
    if (node.type === 'op') {
      for (var i = 0; i < node.args.length; i++) {
        toposortVisit(node.args[i]);
      }
    } else if (node.type === 'lexEnv') {
      // nothing to do since leaf
    } else if (node.type === 'literal') {
      if (node.kind === 'function') {
        for (var i = 0; i < node.freeVarNodes.length; i++) {
          console.log('recursive visiting free var node', node.freeVarNodes[i]);
          toposortVisit(node.freeVarNodes[i]);
        }
      } else {
        // nothing to do since leaf
      }
    } else {
      throw new Error('Unexpected node type found during toposort');
    }

    // finally, add this node to sort order and update its state
    sortedNodes.push(node);
    node.topoState = TOPOSTATE_ADDED;
  }

  // Traverse from all expression roots, building sortedNodes array
  toposortVisit(yieldExpr);
  // NOTE: Nodes not already added to sortedNodes are not needed to compute output,
  //  but we might have inner functions that refer to names defined in this scope.
  for (var k in localBindingExprs) {
    toposortVisit(localBindingExprs[k]);
  }

  // We zero-pad ordering numbers to make lexicographically sortable topoOrder strings.
  // Here we determine the resulting length of string we need to make.
  var paddedOrderLength = (sortedNodes.length - 1).toString().length;
  var zeroStr = Array(paddedOrderLength).join('0');
  function padOrderNumber(n) {
    return (zeroStr + n.toString()).slice(-paddedOrderLength);
  }

  // Store the topographic sort order strings on nodes themselves.
  for (var i = 0; i < sortedNodes.length; i++) {
    sortedNodes[i].topoOrder = padOrderNumber(i);
  }

  // begin code generation
  var codeFragments = [];

  // this is sort of ghetto but will do for now
  codeFragments.push('(function(runtime, startTime, argStreams, baseTopoOrder, result) {\n');
  codeFragments.push('  if (argStreams.length !== ' + paramNames.length + ') { throw new Error(\'called with wrong number of arguments\'); }\n');

  for (var i = 0; i < paramNames.length; i++) {
    codeFragments.push('  var $_' + paramNames[i] + ' = argStreams[' + i + '];\n');
  }

  function getNodeStreamExpr(node) {
    if ((node.type === 'op') || (node.type === 'literal')) {
      return 'reg' + node.topoOrder;
    } else if (node.type === 'lexEnv') {
      return '$_' + node.ident;
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }

  // iterate sorted nodes, doing some code generation
  var deactivatorCalls = [];
  for (var i = 0; i < sortedNodes.length; i++) {
    var node = sortedNodes[i];
    if (node.type === 'op') {
      var argStreamExprs = [];
      for (var j = 0; j < node.args.length; j++) {
        argStreamExprs.push(getNodeStreamExpr(node.args[j]));
      }

      var opFuncName = 'runtime.opFuncs.' + node.op;

      codeFragments.push('  var act' + node.topoOrder + ' = ' + opFuncName + '(runtime, startTime, [' + argStreamExprs.join(', ') + '], baseTopoOrder+\'' + node.topoOrder + '\', null); var reg' + node.topoOrder + ' = act' + node.topoOrder + '.outputStream;\n');

      deactivatorCalls.push('act' + node.topoOrder + '.deactivator()');
    } else if (node.type === 'lexEnv') {
      // do nothing
    } else if (node.type === 'literal') {
      var litValueExpr;
      if (node.kind === 'string') {
        // TODO: we might want to call a proper repr()-style escape on the value, but it should only be safe characters anyways
        litValueExpr = '\'' + node.value + '\'';
      } else if (node.kind === 'number') {
        litValueExpr = node.value.toString();
      } else if (node.kind === 'function') {
        litValueExpr = indentFuncExpr(node.code);
      } else {
        throw new Error('unexpected literal kind');
      }

      codeFragments.push('  var reg' + node.topoOrder + ' = runtime.createConstStream(' + litValueExpr + ', startTime);\n');
    } else {
      throw new Error('Unexpected node type found in tree');
    }

    // For any local names bound to this node, emit declarations+assignments
    if (node.localBoundNames) {
      for (var j = 0; j < node.localBoundNames.length; j++) {
        codeFragments.push('  var $_' + node.localBoundNames[j] + ' = ' + getNodeStreamExpr(node) + ';\n');
      }
    }
  }

  // I don't think these actually need to be reversed for things to work correctly,
  //  but it just seems appropriate.
  deactivatorCalls.reverse();

  // we might need to copy "inner" output to real output stream, if outputStream arg was provided
  var innerOutputExpr = getNodeStreamExpr(yieldExpr);
  codeFragments.push('  var deactivateCopyTrigger;\n');
  codeFragments.push('  if (result) {\n');
  codeFragments.push('    deactivateCopyTrigger = runtime.addCopyTrigger(' + innerOutputExpr + ', result.outputStream);\n');
  codeFragments.push('  } else {\n');
  codeFragments.push('    result = {outputStream: ' + innerOutputExpr + ', deactivator: null};\n');
  codeFragments.push('  }\n');

  codeFragments.push('  if (result.deactivator) { throw new Error(\'deactivator should be null\'); }\n');

  codeFragments.push('  result.deactivator = function() {\n');
  codeFragments.push('    if (deactivateCopyTrigger) { deactivateCopyTrigger(); }\n');
  for (var i = 0; i < deactivatorCalls.length; i++) {
    codeFragments.push('    ' + deactivatorCalls[i] + ';\n');
  }
  codeFragments.push('  };\n');

  // generate return statement
  codeFragments.push('  return result;\n');
  codeFragments.push('})');

  // join generated code fragments and return
  return {
    code: codeFragments.join(''),
    freeVarNames: freeVarNames,
  };
}

function compile(sourceCode, rootLexEnvNames) {
  // parse source code, to get our top-level AST structure, which is a list of "function body parts"
  var topFuncBodyParts = parser.parse(sourceCode);

  // compile the top-level parts, treating them as implicitly wrapped in no-parameter "main" definition
  var topFuncResult = compileFunction([], topFuncBodyParts, rootLexEnvNames);

  // now wrap this in another function to make a scope to define 'globals'
  var codeFragments = [];
  codeFragments.push('(function(runtime, rootLexEnv) {\n');
  codeFragments.push('  \'use strict\';\n');

  for (var n in rootLexEnvNames) {
    codeFragments.push('  var $_' + n + ' = rootLexEnv[\'' + n + '\'];\n'); // TODO: we should string-escape n here
  }

  codeFragments.push('  return ' + indentFuncExpr(topFuncResult.code) + '(runtime, 0, [], null, \'\');\n');
  codeFragments.push('})');
  return codeFragments.join('');
}

module.exports = {
  compile: compile,
};

},{"./parser.js":2}],2:[function(require,module,exports){
module.exports = (function() {
  /*
   * Generated by PEG.js 0.8.0.
   *
   * http://pegjs.majda.cz/
   */

  function peg$subclass(child, parent) {
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
  }

  function SyntaxError(message, expected, found, offset, line, column) {
    this.message  = message;
    this.expected = expected;
    this.found    = found;
    this.offset   = offset;
    this.line     = line;
    this.column   = column;

    this.name     = "SyntaxError";
  }

  peg$subclass(SyntaxError, Error);

  function parse(input) {
    var options = arguments.length > 1 ? arguments[1] : {},

        peg$FAILED = {},

        peg$startRuleFunctions = { start: peg$parsestart },
        peg$startRuleFunction  = peg$parsestart,

        peg$c0 = /^[ \t\n\r]/,
        peg$c1 = { type: "class", value: "[ \\t\\n\\r]", description: "[ \\t\\n\\r]" },
        peg$c2 = { type: "other", description: "whitespace" },
        peg$c3 = [],
        peg$c4 = peg$FAILED,
        peg$c5 = /^[0-9]/,
        peg$c6 = { type: "class", value: "[0-9]", description: "[0-9]" },
        peg$c7 = null,
        peg$c8 = "-",
        peg$c9 = { type: "literal", value: "-", description: "\"-\"" },
        peg$c10 = ".",
        peg$c11 = { type: "literal", value: ".", description: "\".\"" },
        peg$c12 = function() { return parseFloat(text()); },
        peg$c13 = /^[_a-z]/i,
        peg$c14 = { type: "class", value: "[_a-z]i", description: "[_a-z]i" },
        peg$c15 = /^[_a-z0-9]/i,
        peg$c16 = { type: "class", value: "[_a-z0-9]i", description: "[_a-z0-9]i" },
        peg$c17 = function(first, rest) { return first + rest.join(''); },
        peg$c18 = "func",
        peg$c19 = { type: "literal", value: "func", description: "\"func\"" },
        peg$c20 = "yield",
        peg$c21 = { type: "literal", value: "yield", description: "\"yield\"" },
        peg$c22 = "if",
        peg$c23 = { type: "literal", value: "if", description: "\"if\"" },
        peg$c24 = "then",
        peg$c25 = { type: "literal", value: "then", description: "\"then\"" },
        peg$c26 = "else",
        peg$c27 = { type: "literal", value: "else", description: "\"else\"" },
        peg$c28 = "in",
        peg$c29 = { type: "literal", value: "in", description: "\"in\"" },
        peg$c30 = "not",
        peg$c31 = { type: "literal", value: "not", description: "\"not\"" },
        peg$c32 = "and",
        peg$c33 = { type: "literal", value: "and", description: "\"and\"" },
        peg$c34 = "xor",
        peg$c35 = { type: "literal", value: "xor", description: "\"xor\"" },
        peg$c36 = "or",
        peg$c37 = { type: "literal", value: "or", description: "\"or\"" },
        peg$c38 = ",",
        peg$c39 = { type: "literal", value: ",", description: "\",\"" },
        peg$c40 = "=",
        peg$c41 = { type: "literal", value: "=", description: "\"=\"" },
        peg$c42 = void 0,
        peg$c43 = "(",
        peg$c44 = { type: "literal", value: "(", description: "\"(\"" },
        peg$c45 = ")",
        peg$c46 = { type: "literal", value: ")", description: "\")\"" },
        peg$c47 = "{",
        peg$c48 = { type: "literal", value: "{", description: "\"{\"" },
        peg$c49 = "}",
        peg$c50 = { type: "literal", value: "}", description: "\"}\"" },
        peg$c51 = "+",
        peg$c52 = { type: "literal", value: "+", description: "\"+\"" },
        peg$c53 = "~",
        peg$c54 = { type: "literal", value: "~", description: "\"~\"" },
        peg$c55 = "*",
        peg$c56 = { type: "literal", value: "*", description: "\"*\"" },
        peg$c57 = "/",
        peg$c58 = { type: "literal", value: "/", description: "\"/\"" },
        peg$c59 = "<<",
        peg$c60 = { type: "literal", value: "<<", description: "\"<<\"" },
        peg$c61 = ">>",
        peg$c62 = { type: "literal", value: ">>", description: "\">>\"" },
        peg$c63 = ">",
        peg$c64 = { type: "literal", value: ">", description: "\">\"" },
        peg$c65 = ">>>",
        peg$c66 = { type: "literal", value: ">>>", description: "\">>>\"" },
        peg$c67 = "<",
        peg$c68 = { type: "literal", value: "<", description: "\"<\"" },
        peg$c69 = "<=",
        peg$c70 = { type: "literal", value: "<=", description: "\"<=\"" },
        peg$c71 = ">=",
        peg$c72 = { type: "literal", value: ">=", description: "\">=\"" },
        peg$c73 = "==",
        peg$c74 = { type: "literal", value: "==", description: "\"==\"" },
        peg$c75 = "!=",
        peg$c76 = { type: "literal", value: "!=", description: "\"!=\"" },
        peg$c77 = "&",
        peg$c78 = { type: "literal", value: "&", description: "\"&\"" },
        peg$c79 = "^",
        peg$c80 = { type: "literal", value: "^", description: "\"^\"" },
        peg$c81 = "|",
        peg$c82 = { type: "literal", value: "|", description: "\"|\"" },
        peg$c83 = function(first, rest) { return [first].concat(rest); },
        peg$c84 = function(ident) { return [ident]; },
        peg$c85 = function() { return []; },
        peg$c86 = function(params) { return params; },
        peg$c87 = function(params, body) { return {params: params, body: body}; },
        peg$c88 = function(parts) { return parts; },
        peg$c89 = function(expr) { return {type: 'yield', expr: expr}; },
        peg$c90 = function(ident, expr) { return {type: 'binding', ident: ident, expr: expr}; },
        peg$c91 = function(expr) { return expr; },
        peg$c92 = function(funcdef) { return {type: 'literal', kind: 'function', value: funcdef}; },
        peg$c93 = function(number) { return {type: 'literal', kind: 'number', value: number}; },
        peg$c94 = function(condition, consequent, alternative) { return {type: 'op', op: 'ifte', args: [condition, consequent, alternative]}; },
        peg$c95 = function(ident) { return {type: 'varIdent', ident: ident}; },
        peg$c96 = function(argList) { return {internal: 'app', argList: argList}; },
        peg$c97 = function(ident) { return {internal: 'dot', ident: ident}; },
        peg$c98 = function(first, rest) {
            var result = first;

            for (var i = 0; i < rest.length; i++) {
              if (rest[i].internal === 'app') {
                result = {
                  type: 'op',
                  op: 'app',
                  args: [result].concat(rest[i].argList),
                };
              } else if (rest[i].internal === 'dot') {
                result = {
                  type: 'op',
                  op: 'prop',
                  args: [
                    result,
                    {type: 'literal', kind: 'string', value: rest[i].ident},
                  ],
                };
              } else {
                throw new Error('internal error');
              }
            }

            return result;
          },
        peg$c99 = function() { return 'uplus'; },
        peg$c100 = function() { return 'uminus'; },
        peg$c101 = function() { return 'bitnot'; },
        peg$c102 = function(ops, expr) { return nestPrefixOps(ops, expr); },
        peg$c103 = function() { return 'mul'; },
        peg$c104 = function() { return 'div'; },
        peg$c105 = function(first, rest) { return nestBinOps(first, rest); },
        peg$c106 = function() { return 'add'; },
        peg$c107 = function() { return 'sub'; },
        peg$c108 = function() { return 'lshift'; },
        peg$c109 = function() { return 'srshift'; },
        peg$c110 = function() { return 'zrshift'; },
        peg$c111 = function() { return 'lt'; },
        peg$c112 = function() { return 'lte'; },
        peg$c113 = function() { return 'gt'; },
        peg$c114 = function() { return 'gte'; },
        peg$c115 = function() { return 'in'; },
        peg$c116 = function() { return 'eq'; },
        peg$c117 = function() { return 'neq'; },
        peg$c118 = function() { return 'bitand'; },
        peg$c119 = function() { return 'bitxor'; },
        peg$c120 = function() { return 'bitor'; },
        peg$c121 = function() { return 'not'; },
        peg$c122 = function() { return 'and'; },
        peg$c123 = function() { return 'xor'; },
        peg$c124 = function() { return 'or'; },
        peg$c125 = function(ident) { return ident; },
        peg$c126 = function(argList) { return argList; },
        peg$c127 = function(expr) { return [expr]; },

        peg$currPos          = 0,
        peg$reportedPos      = 0,
        peg$cachedPos        = 0,
        peg$cachedPosDetails = { line: 1, column: 1, seenCR: false },
        peg$maxFailPos       = 0,
        peg$maxFailExpected  = [],
        peg$silentFails      = 0,

        peg$result;

    if ("startRule" in options) {
      if (!(options.startRule in peg$startRuleFunctions)) {
        throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
      }

      peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
    }

    function text() {
      return input.substring(peg$reportedPos, peg$currPos);
    }

    function offset() {
      return peg$reportedPos;
    }

    function line() {
      return peg$computePosDetails(peg$reportedPos).line;
    }

    function column() {
      return peg$computePosDetails(peg$reportedPos).column;
    }

    function expected(description) {
      throw peg$buildException(
        null,
        [{ type: "other", description: description }],
        peg$reportedPos
      );
    }

    function error(message) {
      throw peg$buildException(message, null, peg$reportedPos);
    }

    function peg$computePosDetails(pos) {
      function advance(details, startPos, endPos) {
        var p, ch;

        for (p = startPos; p < endPos; p++) {
          ch = input.charAt(p);
          if (ch === "\n") {
            if (!details.seenCR) { details.line++; }
            details.column = 1;
            details.seenCR = false;
          } else if (ch === "\r" || ch === "\u2028" || ch === "\u2029") {
            details.line++;
            details.column = 1;
            details.seenCR = true;
          } else {
            details.column++;
            details.seenCR = false;
          }
        }
      }

      if (peg$cachedPos !== pos) {
        if (peg$cachedPos > pos) {
          peg$cachedPos = 0;
          peg$cachedPosDetails = { line: 1, column: 1, seenCR: false };
        }
        advance(peg$cachedPosDetails, peg$cachedPos, pos);
        peg$cachedPos = pos;
      }

      return peg$cachedPosDetails;
    }

    function peg$fail(expected) {
      if (peg$currPos < peg$maxFailPos) { return; }

      if (peg$currPos > peg$maxFailPos) {
        peg$maxFailPos = peg$currPos;
        peg$maxFailExpected = [];
      }

      peg$maxFailExpected.push(expected);
    }

    function peg$buildException(message, expected, pos) {
      function cleanupExpected(expected) {
        var i = 1;

        expected.sort(function(a, b) {
          if (a.description < b.description) {
            return -1;
          } else if (a.description > b.description) {
            return 1;
          } else {
            return 0;
          }
        });

        while (i < expected.length) {
          if (expected[i - 1] === expected[i]) {
            expected.splice(i, 1);
          } else {
            i++;
          }
        }
      }

      function buildMessage(expected, found) {
        function stringEscape(s) {
          function hex(ch) { return ch.charCodeAt(0).toString(16).toUpperCase(); }

          return s
            .replace(/\\/g,   '\\\\')
            .replace(/"/g,    '\\"')
            .replace(/\x08/g, '\\b')
            .replace(/\t/g,   '\\t')
            .replace(/\n/g,   '\\n')
            .replace(/\f/g,   '\\f')
            .replace(/\r/g,   '\\r')
            .replace(/[\x00-\x07\x0B\x0E\x0F]/g, function(ch) { return '\\x0' + hex(ch); })
            .replace(/[\x10-\x1F\x80-\xFF]/g,    function(ch) { return '\\x'  + hex(ch); })
            .replace(/[\u0180-\u0FFF]/g,         function(ch) { return '\\u0' + hex(ch); })
            .replace(/[\u1080-\uFFFF]/g,         function(ch) { return '\\u'  + hex(ch); });
        }

        var expectedDescs = new Array(expected.length),
            expectedDesc, foundDesc, i;

        for (i = 0; i < expected.length; i++) {
          expectedDescs[i] = expected[i].description;
        }

        expectedDesc = expected.length > 1
          ? expectedDescs.slice(0, -1).join(", ")
              + " or "
              + expectedDescs[expected.length - 1]
          : expectedDescs[0];

        foundDesc = found ? "\"" + stringEscape(found) + "\"" : "end of input";

        return "Expected " + expectedDesc + " but " + foundDesc + " found.";
      }

      var posDetails = peg$computePosDetails(pos),
          found      = pos < input.length ? input.charAt(pos) : null;

      if (expected !== null) {
        cleanupExpected(expected);
      }

      return new SyntaxError(
        message !== null ? message : buildMessage(expected, found),
        expected,
        found,
        pos,
        posDetails.line,
        posDetails.column
      );
    }

    function peg$parsestart() {
      var s0;

      s0 = peg$parsefunction_body();

      return s0;
    }

    function peg$parsewhitechar() {
      var s0;

      if (peg$c0.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c1); }
      }

      return s0;
    }

    function peg$parse_() {
      var s0, s1;

      peg$silentFails++;
      s0 = [];
      s1 = peg$parsewhitechar();
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$parsewhitechar();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c2); }
      }

      return s0;
    }

    function peg$parsedecimal() {
      var s0, s1;

      s0 = [];
      if (peg$c5.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c6); }
      }
      if (s1 !== peg$FAILED) {
        while (s1 !== peg$FAILED) {
          s0.push(s1);
          if (peg$c5.test(input.charAt(peg$currPos))) {
            s1 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c6); }
          }
        }
      } else {
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsenumber() {
      var s0, s1, s2, s3, s4, s5, s6;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 45) {
          s2 = peg$c8;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c9); }
        }
        if (s2 === peg$FAILED) {
          s2 = peg$c7;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsedecimal();
          if (s3 === peg$FAILED) {
            s3 = peg$c7;
          }
          if (s3 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 46) {
              s4 = peg$c10;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c11); }
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parsedecimal();
              if (s5 !== peg$FAILED) {
                s6 = peg$parse_();
                if (s6 !== peg$FAILED) {
                  peg$reportedPos = s0;
                  s1 = peg$c12();
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$c4;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$c4;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parse_();
        if (s1 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 45) {
            s2 = peg$c8;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c9); }
          }
          if (s2 === peg$FAILED) {
            s2 = peg$c7;
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parsedecimal();
            if (s3 !== peg$FAILED) {
              s4 = peg$parse_();
              if (s4 !== peg$FAILED) {
                peg$reportedPos = s0;
                s1 = peg$c12();
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$c4;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      }

      return s0;
    }

    function peg$parseidentifier() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (peg$c13.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c14); }
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          if (peg$c15.test(input.charAt(peg$currPos))) {
            s4 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c16); }
          }
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            if (peg$c15.test(input.charAt(peg$currPos))) {
              s4 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c16); }
            }
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c17(s2, s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_func() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c18) {
          s2 = peg$c18;
          peg$currPos += 4;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c19); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_yield() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c20) {
          s2 = peg$c20;
          peg$currPos += 5;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c21); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_if() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c22) {
          s2 = peg$c22;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c23); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_then() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c24) {
          s2 = peg$c24;
          peg$currPos += 4;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c25); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_else() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c26) {
          s2 = peg$c26;
          peg$currPos += 4;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c27); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_in() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c28) {
          s2 = peg$c28;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c29); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_not() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c30) {
          s2 = peg$c30;
          peg$currPos += 3;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c31); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_and() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c32) {
          s2 = peg$c32;
          peg$currPos += 3;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c33); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_xor() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c34) {
          s2 = peg$c34;
          peg$currPos += 3;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c35); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_or() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c36) {
          s2 = peg$c36;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c37); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsecomma() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c38;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c39); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseequal() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 61) {
          s2 = peg$c40;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c41); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$currPos;
          peg$silentFails++;
          if (input.charCodeAt(peg$currPos) === 61) {
            s4 = peg$c40;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c41); }
          }
          peg$silentFails--;
          if (s4 === peg$FAILED) {
            s3 = peg$c42;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              s1 = [s1, s2, s3, s4];
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseopen_paren() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 40) {
          s2 = peg$c43;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c44); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseclose_paren() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 41) {
          s2 = peg$c45;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c46); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseopen_curly() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 123) {
          s2 = peg$c47;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c48); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseclose_curly() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 125) {
          s2 = peg$c49;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c50); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsedot() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s2 = peg$c10;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c11); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_uplus() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 43) {
          s2 = peg$c51;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c52); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_uminus() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 45) {
          s2 = peg$c8;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c9); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_bitnot() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 126) {
          s2 = peg$c53;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c54); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_mul() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 42) {
          s2 = peg$c55;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c56); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_div() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 47) {
          s2 = peg$c57;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c58); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_add() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 43) {
          s2 = peg$c51;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c52); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_sub() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 45) {
          s2 = peg$c8;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c9); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_lshift() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c59) {
          s2 = peg$c59;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c60); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_srshift() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c61) {
          s2 = peg$c61;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c62); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$currPos;
          peg$silentFails++;
          if (input.charCodeAt(peg$currPos) === 62) {
            s4 = peg$c63;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c64); }
          }
          peg$silentFails--;
          if (s4 === peg$FAILED) {
            s3 = peg$c42;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              s1 = [s1, s2, s3, s4];
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_zrshift() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c65) {
          s2 = peg$c65;
          peg$currPos += 3;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c66); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_lt() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 60) {
          s2 = peg$c67;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c68); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$currPos;
          peg$silentFails++;
          if (input.charCodeAt(peg$currPos) === 60) {
            s4 = peg$c67;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c68); }
          }
          if (s4 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 61) {
              s4 = peg$c40;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c41); }
            }
          }
          peg$silentFails--;
          if (s4 === peg$FAILED) {
            s3 = peg$c42;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              s1 = [s1, s2, s3, s4];
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_lte() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c69) {
          s2 = peg$c69;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c70); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_gt() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 62) {
          s2 = peg$c63;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c64); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$currPos;
          peg$silentFails++;
          if (input.charCodeAt(peg$currPos) === 62) {
            s4 = peg$c63;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c64); }
          }
          if (s4 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 61) {
              s4 = peg$c40;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c41); }
            }
          }
          peg$silentFails--;
          if (s4 === peg$FAILED) {
            s3 = peg$c42;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              s1 = [s1, s2, s3, s4];
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_gte() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c71) {
          s2 = peg$c71;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c72); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_eq() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c73) {
          s2 = peg$c73;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c74); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_neq() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c75) {
          s2 = peg$c75;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c76); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_bitand() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 38) {
          s2 = peg$c77;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c78); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_bitxor() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 94) {
          s2 = peg$c79;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c80); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseop_bitor() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 124) {
          s2 = peg$c81;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c82); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsenonempty_param_list() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseidentifier();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecomma();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsenonempty_param_list();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c83(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseidentifier();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c84(s1);
        }
        s0 = s1;
      }

      return s0;
    }

    function peg$parseparenth_param_list() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseopen_paren();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseclose_paren();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c85();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseopen_paren();
        if (s1 !== peg$FAILED) {
          s2 = peg$parsenonempty_param_list();
          if (s2 !== peg$FAILED) {
            s3 = peg$parseclose_paren();
            if (s3 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c86(s2);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      }

      return s0;
    }

    function peg$parsefunction_def() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsekw_func();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseparenth_param_list();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseopen_curly();
          if (s3 !== peg$FAILED) {
            s4 = peg$parsefunction_body();
            if (s4 !== peg$FAILED) {
              s5 = peg$parseclose_curly();
              if (s5 !== peg$FAILED) {
                peg$reportedPos = s0;
                s1 = peg$c87(s2, s4);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$c4;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsefunction_body() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parsefunction_body_part();
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parsefunction_body_part();
        }
      } else {
        s1 = peg$c4;
      }
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c88(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsefunction_body_part() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parsekw_yield();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseor_expr();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c89(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseidentifier();
        if (s1 !== peg$FAILED) {
          s2 = peg$parseequal();
          if (s2 !== peg$FAILED) {
            s3 = peg$parseor_expr();
            if (s3 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c90(s1, s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      }

      return s0;
    }

    function peg$parseprimary_expr() {
      var s0, s1, s2, s3, s4, s5, s6;

      s0 = peg$currPos;
      s1 = peg$parseopen_paren();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseor_expr();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseclose_paren();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c91(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parsefunction_def();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c92(s1);
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parsenumber();
          if (s1 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c93(s1);
          }
          s0 = s1;
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parsekw_if();
            if (s1 !== peg$FAILED) {
              s2 = peg$parseor_expr();
              if (s2 !== peg$FAILED) {
                s3 = peg$parsekw_then();
                if (s3 !== peg$FAILED) {
                  s4 = peg$parseor_expr();
                  if (s4 !== peg$FAILED) {
                    s5 = peg$parsekw_else();
                    if (s5 !== peg$FAILED) {
                      s6 = peg$parseor_expr();
                      if (s6 !== peg$FAILED) {
                        peg$reportedPos = s0;
                        s1 = peg$c94(s2, s4, s6);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$c4;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$c4;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$c4;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$c4;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$c4;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parseidentifier();
              if (s1 !== peg$FAILED) {
                peg$reportedPos = s0;
                s1 = peg$c95(s1);
              }
              s0 = s1;
            }
          }
        }
      }

      return s0;
    }

    function peg$parseaccess_call_expr() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parseprimary_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseparenth_arg_list();
        if (s4 !== peg$FAILED) {
          peg$reportedPos = s3;
          s4 = peg$c96(s4);
        }
        s3 = s4;
        if (s3 === peg$FAILED) {
          s3 = peg$currPos;
          s4 = peg$parsedot_access();
          if (s4 !== peg$FAILED) {
            peg$reportedPos = s3;
            s4 = peg$c97(s4);
          }
          s3 = s4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseparenth_arg_list();
          if (s4 !== peg$FAILED) {
            peg$reportedPos = s3;
            s4 = peg$c96(s4);
          }
          s3 = s4;
          if (s3 === peg$FAILED) {
            s3 = peg$currPos;
            s4 = peg$parsedot_access();
            if (s4 !== peg$FAILED) {
              peg$reportedPos = s3;
              s4 = peg$c97(s4);
            }
            s3 = s4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c98(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsenumeric_prefix_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_uplus();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c99();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_uminus();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c100();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseop_bitnot();
          if (s1 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c101();
          }
          s0 = s1;
        }
      }

      return s0;
    }

    function peg$parsenumeric_prefix_expr() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parsenumeric_prefix_op();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parsenumeric_prefix_op();
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseaccess_call_expr();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c102(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsemultiplicative_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_mul();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c103();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_div();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c104();
        }
        s0 = s1;
      }

      return s0;
    }

    function peg$parsemultiplicative_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsenumeric_prefix_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parsemultiplicative_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsenumeric_prefix_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parsemultiplicative_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsenumeric_prefix_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseadditive_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_add();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c106();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_sub();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c107();
        }
        s0 = s1;
      }

      return s0;
    }

    function peg$parseadditive_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsemultiplicative_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseadditive_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsemultiplicative_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseadditive_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsemultiplicative_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseshift_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_lshift();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c108();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_srshift();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c109();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseop_zrshift();
          if (s1 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c110();
          }
          s0 = s1;
        }
      }

      return s0;
    }

    function peg$parseshift_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parseadditive_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseshift_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parseadditive_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseshift_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseadditive_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseineq_in_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_lt();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c111();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_lte();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c112();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseop_gt();
          if (s1 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c113();
          }
          s0 = s1;
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parseop_gte();
            if (s1 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c114();
            }
            s0 = s1;
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parsekw_in();
              if (s1 !== peg$FAILED) {
                peg$reportedPos = s0;
                s1 = peg$c115();
              }
              s0 = s1;
            }
          }
        }
      }

      return s0;
    }

    function peg$parseineq_in_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parseshift_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseineq_in_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parseshift_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseineq_in_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseshift_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseequality_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_eq();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c116();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_neq();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c117();
        }
        s0 = s1;
      }

      return s0;
    }

    function peg$parseequality_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parseineq_in_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseequality_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parseineq_in_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseequality_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseineq_in_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsebitand_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_bitand();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c118();
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebitand_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parseequality_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parsebitand_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parseequality_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parsebitand_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseequality_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsebitxor_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_bitxor();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c119();
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebitxor_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsebitand_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parsebitxor_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsebitand_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parsebitxor_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsebitand_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsebitor_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parseop_bitor();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c120();
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebitor_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsebitxor_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parsebitor_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsebitxor_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parsebitor_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsebitxor_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsenot_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsekw_not();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c121();
      }
      s0 = s1;

      return s0;
    }

    function peg$parsenot_expr() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parsenot_op();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parsenot_op();
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsebitor_expr();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c102(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseand_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsekw_and();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c122();
      }
      s0 = s1;

      return s0;
    }

    function peg$parseand_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsenot_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseand_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsenot_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseand_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsenot_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsexor_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsekw_xor();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c123();
      }
      s0 = s1;

      return s0;
    }

    function peg$parsexor_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parseand_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parsexor_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parseand_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parsexor_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseand_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseor_op() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsekw_or();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c124();
      }
      s0 = s1;

      return s0;
    }

    function peg$parseor_expr() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsexor_expr();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseor_op();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsexor_expr();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseor_op();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsexor_expr();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c4;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c105(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsedot_access() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$parsedot();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseidentifier();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c125(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseparenth_arg_list() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseopen_paren();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseclose_paren();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c85();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseopen_paren();
        if (s1 !== peg$FAILED) {
          s2 = peg$parsearg_list();
          if (s2 !== peg$FAILED) {
            s3 = peg$parseclose_paren();
            if (s3 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c126(s2);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      }

      return s0;
    }

    function peg$parsearg_list() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseor_expr();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecomma();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsearg_list();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c83(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseor_expr();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c127(s1);
        }
        s0 = s1;
      }

      return s0;
    }



      // first is an expression. rest is an array of two-element [op, expr] arrays
      function nestBinOps(first, rest) {
        var result = first;

        for (var i = 0; i < rest.length; i++) {
          result = {
            type: 'op',
            op: rest[i][0],
            args: [result].concat(rest[i][1]),
          };
        }

        return result;
      }

      // ops is an array of ops in order of appearance, to be applied to expr
      function nestPrefixOps(ops, expr) {
        var result = expr;

        for (var i = ops.length-1; i >= 0; i--) {
          result = {
            type: 'op',
            op: ops[i],
            args: [result],
          };
        }

        return result;
      }


    peg$result = peg$startRuleFunction();

    if (peg$result !== peg$FAILED && peg$currPos === input.length) {
      return peg$result;
    } else {
      if (peg$result !== peg$FAILED && peg$currPos < input.length) {
        peg$fail({ type: "end", description: "end of input" });
      }

      throw peg$buildException(null, peg$maxFailExpected, peg$maxFailPos);
    }
  }

  return {
    SyntaxError: SyntaxError,
    parse:       parse
  };
})();

},{}],3:[function(require,module,exports){
'use strict';

var primUtils = require('./primUtils');
var liftStep = primUtils.liftStep;

function delay1(runtime, startTime, argStreams, baseTopoOrder, result) {
  if (argStreams.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var argStream = argStreams[0];

  // create or validate outputStream, set initial value
  // initial output is just initial input
  var argVal = argStream.value;
  if (result) {
    if (result.outputStream.tempo !== 'step') {
      throw new Error('Incorrect output stream tempo');
    }
    result.outputStream.changeValue(argVal, startTime);
  } else {
    result = {
      outputStream: runtime.createStepStream(argVal, startTime),
      deactivator: null,
    };
  }

  if (result.deactivator) { throw new Error('Deactivator should be null'); }
  result.deactivator = function() {
    argStream.removeTrigger(argChangedTrigger);
    if (pendingOutputChangeTask) {
      runtime.priorityQueue.remove(pendingOutputChangeTask);
    }
  };

  var scheduledChanges = []; // ordered list of {time: ..., value: ...}
  var pendingOutputChangeTask = null;

  // if needed, add task for updating output, and update our bookeeping
  var updateTasks = function() {
    if ((scheduledChanges.length > 0) && !pendingOutputChangeTask) {
      var nextChange = scheduledChanges[0];
      // TODO: this should probably call a method of runtime instead of accessing priorityQueue directly
      // TODO: this call could get back a 'task handle' that we use to remove a pending task on deactivate
      var changeTask = {
        time: nextChange.time,
        topoOrder: baseTopoOrder,
        closure: changeOutput,
      };
      runtime.priorityQueue.insert(changeTask);
      pendingOutputChangeTask = changeTask;
    }
  };

  // closure to be called when time has come to change output value
  var changeOutput = function(atTime) {
    if (scheduledChanges.length === 0) {
      throw new Error('no changes to make');
    }

    // pull next change off 'front' of queue
    var nextChange = scheduledChanges.shift();

    // sanity check
    if (atTime !== nextChange.time) {
      throw new Error('times do not match');
    }

    result.outputStream.changeValue(nextChange.value, atTime);

    pendingOutputChangeTask = null;
    updateTasks();
  };

  var argChangedTask = function(atTime) {
    var argVal = argStream.value;
    scheduledChanges.push({
      time: atTime + 1.0, // here is the delay amount
      value: argVal,
    });

    updateTasks();
  };

  // make closure to add task when argument value changes
  var argChangedTrigger = function(atTime) {
    runtime.priorityQueue.insert({
      time: atTime,
      topoOrder: baseTopoOrder,
      closure: argChangedTask,
    });
  };

  // add trigger on argument
  argStream.addTrigger(argChangedTrigger);

  // create deactivator
  result.deactivator = function() {
    argStream.removeTrigger(argChangedTrigger);
    if (pendingOutputChangeTask) {
      runtime.priorityQueue.remove(pendingOutputChangeTask);
    }
  };

  return result;
};

function timeOfLatest(runtime, startTime, argStreams, baseTopoOrder, result) {
  if (argStreams.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var argStream = argStreams[0];
  if (argStream.tempo !== 'event') {
    throw new Error('Incorrect input stream tempo');
  }

  // create or validate result, set initial output value
  if (result) {
    if (result.outputStream.tempo !== 'step') {
      throw new Error('Incorrect output stream tempo');
    }
    result.outputStream.changeValue(0, startTime);
  } else {
    result = {
      outputStream: runtime.createStepStream(0, startTime),
      deactivator: null,
    };
  }

  if (result.deactivator) { throw new Error('Deactivator should be null'); }
  result.deactivator = function() {
    argStream.removeTrigger(argChangedTrigger);
  };

  // closure to update output value
  var argChangedTask = function(atTime) {
    result.outputStream.changeValue(atTime-startTime, atTime);
  };

  // make closure to add task when argument value changes
  var argChangedTrigger = function(atTime) {
    runtime.priorityQueue.insert({
      time: atTime,
      topoOrder: baseTopoOrder,
      closure: argChangedTask,
    });
  };

  // add trigger on argument
  argStream.addTrigger(argChangedTrigger);

  return result;
}

module.exports = {
  id: liftStep(function(a) { return a; }, 1),
  Vec2: liftStep(function(x, y) { return {x: x, y: y}; }, 2),
  sin: liftStep(function(x) { return Math.sin(x); }, 1),
  cos: liftStep(function(x) { return Math.cos(x); }, 1),

  delay1: delay1,
  timeOfLatest: timeOfLatest,
};

},{"./primUtils":9}],4:[function(require,module,exports){
'use strict';

var PriorityQueue = require('./pq');

var streams = require('./streams');
var ConstStream = streams.ConstStream;
var StepStream = streams.StepStream;
var EventStream = streams.EventStream;

var Runtime = function() {
  this.priorityQueue = new PriorityQueue();
};

Runtime.prototype.createLexEnv = function(addProps) {
  return this.deriveLexEnv(null, addProps);
};

Runtime.prototype.deriveLexEnv = function(parentLexEnv, addProps) {
  var propsObj = {};

  for (var k in addProps) {
    if (addProps.hasOwnProperty(k)) {
      propsObj[k] = {
        value: addProps[k],
        writeable: false,
        enumerable: true,
      };
    }
  }

  return Object.create(parentLexEnv, propsObj);
};

Runtime.prototype.createConstStream = function(value, startTime) {
  return new ConstStream(value, startTime);
};

Runtime.prototype.createStepStream = function(initialValue, startTime) {
  return new StepStream(initialValue, startTime);
};

Runtime.prototype.createEventStream = function(initialValue, startTime) {
  return new EventStream(initialValue, startTime);
};

// run until time of next task is _greater than_ toTime
Runtime.prototype.runToTime = function(toTime) {
  while (true) {
    if (this.priorityQueue.isEmpty()) {
      return null;
    }
    var nextTask = this.priorityQueue.peek();
    if (nextTask.time > toTime) {
      return nextTask.time;
    }
    this.runNextTask();
  }
};

Runtime.prototype.runNextTask = function() {
  var nextTask = this.priorityQueue.pull(); // gets most "urgent" task
  nextTask.closure(nextTask.time);
};

Runtime.prototype.isRunnable = function() {
  return !this.priorityQueue.isEmpty();
};

Runtime.prototype.builtins = require('./builtins');

Runtime.prototype.opFuncs = require('./opFuncs');

module.exports = Runtime;

},{"./builtins":3,"./opFuncs":7,"./pq":8,"./streams":10}],5:[function(require,module,exports){
module.exports = require('./lib/heap');

},{"./lib/heap":6}],6:[function(require,module,exports){
// Generated by CoffeeScript 1.8.0
(function() {
  var Heap, defaultCmp, floor, heapify, heappop, heappush, heappushpop, heapreplace, insort, min, nlargest, nsmallest, updateItem, _siftdown, _siftup;

  floor = Math.floor, min = Math.min;


  /*
  Default comparison function to be used
   */

  defaultCmp = function(x, y) {
    if (x < y) {
      return -1;
    }
    if (x > y) {
      return 1;
    }
    return 0;
  };


  /*
  Insert item x in list a, and keep it sorted assuming a is sorted.
  
  If x is already in a, insert it to the right of the rightmost x.
  
  Optional args lo (default 0) and hi (default a.length) bound the slice
  of a to be searched.
   */

  insort = function(a, x, lo, hi, cmp) {
    var mid;
    if (lo == null) {
      lo = 0;
    }
    if (cmp == null) {
      cmp = defaultCmp;
    }
    if (lo < 0) {
      throw new Error('lo must be non-negative');
    }
    if (hi == null) {
      hi = a.length;
    }
    while (lo < hi) {
      mid = floor((lo + hi) / 2);
      if (cmp(x, a[mid]) < 0) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return ([].splice.apply(a, [lo, lo - lo].concat(x)), x);
  };


  /*
  Push item onto heap, maintaining the heap invariant.
   */

  heappush = function(array, item, cmp) {
    if (cmp == null) {
      cmp = defaultCmp;
    }
    array.push(item);
    return _siftdown(array, 0, array.length - 1, cmp);
  };


  /*
  Pop the smallest item off the heap, maintaining the heap invariant.
   */

  heappop = function(array, cmp) {
    var lastelt, returnitem;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    lastelt = array.pop();
    if (array.length) {
      returnitem = array[0];
      array[0] = lastelt;
      _siftup(array, 0, cmp);
    } else {
      returnitem = lastelt;
    }
    return returnitem;
  };


  /*
  Pop and return the current smallest value, and add the new item.
  
  This is more efficient than heappop() followed by heappush(), and can be
  more appropriate when using a fixed size heap. Note that the value
  returned may be larger than item! That constrains reasonable use of
  this routine unless written as part of a conditional replacement:
      if item > array[0]
        item = heapreplace(array, item)
   */

  heapreplace = function(array, item, cmp) {
    var returnitem;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    returnitem = array[0];
    array[0] = item;
    _siftup(array, 0, cmp);
    return returnitem;
  };


  /*
  Fast version of a heappush followed by a heappop.
   */

  heappushpop = function(array, item, cmp) {
    var _ref;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    if (array.length && cmp(array[0], item) < 0) {
      _ref = [array[0], item], item = _ref[0], array[0] = _ref[1];
      _siftup(array, 0, cmp);
    }
    return item;
  };


  /*
  Transform list into a heap, in-place, in O(array.length) time.
   */

  heapify = function(array, cmp) {
    var i, _i, _j, _len, _ref, _ref1, _results, _results1;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    _ref1 = (function() {
      _results1 = [];
      for (var _j = 0, _ref = floor(array.length / 2); 0 <= _ref ? _j < _ref : _j > _ref; 0 <= _ref ? _j++ : _j--){ _results1.push(_j); }
      return _results1;
    }).apply(this).reverse();
    _results = [];
    for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
      i = _ref1[_i];
      _results.push(_siftup(array, i, cmp));
    }
    return _results;
  };


  /*
  Update the position of the given item in the heap.
  This function should be called every time the item is being modified.
   */

  updateItem = function(array, item, cmp) {
    var pos;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    pos = array.indexOf(item);
    if (pos === -1) {
      return;
    }
    _siftdown(array, 0, pos, cmp);
    return _siftup(array, pos, cmp);
  };


  /*
  Find the n largest elements in a dataset.
   */

  nlargest = function(array, n, cmp) {
    var elem, result, _i, _len, _ref;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    result = array.slice(0, n);
    if (!result.length) {
      return result;
    }
    heapify(result, cmp);
    _ref = array.slice(n);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      elem = _ref[_i];
      heappushpop(result, elem, cmp);
    }
    return result.sort(cmp).reverse();
  };


  /*
  Find the n smallest elements in a dataset.
   */

  nsmallest = function(array, n, cmp) {
    var elem, i, los, result, _i, _j, _len, _ref, _ref1, _results;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    if (n * 10 <= array.length) {
      result = array.slice(0, n).sort(cmp);
      if (!result.length) {
        return result;
      }
      los = result[result.length - 1];
      _ref = array.slice(n);
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        elem = _ref[_i];
        if (cmp(elem, los) < 0) {
          insort(result, elem, 0, null, cmp);
          result.pop();
          los = result[result.length - 1];
        }
      }
      return result;
    }
    heapify(array, cmp);
    _results = [];
    for (i = _j = 0, _ref1 = min(n, array.length); 0 <= _ref1 ? _j < _ref1 : _j > _ref1; i = 0 <= _ref1 ? ++_j : --_j) {
      _results.push(heappop(array, cmp));
    }
    return _results;
  };

  _siftdown = function(array, startpos, pos, cmp) {
    var newitem, parent, parentpos;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    newitem = array[pos];
    while (pos > startpos) {
      parentpos = (pos - 1) >> 1;
      parent = array[parentpos];
      if (cmp(newitem, parent) < 0) {
        array[pos] = parent;
        pos = parentpos;
        continue;
      }
      break;
    }
    return array[pos] = newitem;
  };

  _siftup = function(array, pos, cmp) {
    var childpos, endpos, newitem, rightpos, startpos;
    if (cmp == null) {
      cmp = defaultCmp;
    }
    endpos = array.length;
    startpos = pos;
    newitem = array[pos];
    childpos = 2 * pos + 1;
    while (childpos < endpos) {
      rightpos = childpos + 1;
      if (rightpos < endpos && !(cmp(array[childpos], array[rightpos]) < 0)) {
        childpos = rightpos;
      }
      array[pos] = array[childpos];
      pos = childpos;
      childpos = 2 * pos + 1;
    }
    array[pos] = newitem;
    return _siftdown(array, startpos, pos, cmp);
  };

  Heap = (function() {
    Heap.push = heappush;

    Heap.pop = heappop;

    Heap.replace = heapreplace;

    Heap.pushpop = heappushpop;

    Heap.heapify = heapify;

    Heap.updateItem = updateItem;

    Heap.nlargest = nlargest;

    Heap.nsmallest = nsmallest;

    function Heap(cmp) {
      this.cmp = cmp != null ? cmp : defaultCmp;
      this.nodes = [];
    }

    Heap.prototype.push = function(x) {
      return heappush(this.nodes, x, this.cmp);
    };

    Heap.prototype.pop = function() {
      return heappop(this.nodes, this.cmp);
    };

    Heap.prototype.peek = function() {
      return this.nodes[0];
    };

    Heap.prototype.contains = function(x) {
      return this.nodes.indexOf(x) !== -1;
    };

    Heap.prototype.replace = function(x) {
      return heapreplace(this.nodes, x, this.cmp);
    };

    Heap.prototype.pushpop = function(x) {
      return heappushpop(this.nodes, x, this.cmp);
    };

    Heap.prototype.heapify = function() {
      return heapify(this.nodes, this.cmp);
    };

    Heap.prototype.updateItem = function(x) {
      return updateItem(this.nodes, x, this.cmp);
    };

    Heap.prototype.clear = function() {
      return this.nodes = [];
    };

    Heap.prototype.empty = function() {
      return this.nodes.length === 0;
    };

    Heap.prototype.size = function() {
      return this.nodes.length;
    };

    Heap.prototype.clone = function() {
      var heap;
      heap = new Heap();
      heap.nodes = this.nodes.slice(0);
      return heap;
    };

    Heap.prototype.toArray = function() {
      return this.nodes.slice(0);
    };

    Heap.prototype.insert = Heap.prototype.push;

    Heap.prototype.top = Heap.prototype.peek;

    Heap.prototype.front = Heap.prototype.peek;

    Heap.prototype.has = Heap.prototype.contains;

    Heap.prototype.copy = Heap.prototype.clone;

    return Heap;

  })();

  (function(root, factory) {
    if (typeof define === 'function' && define.amd) {
      return define([], factory);
    } else if (typeof exports === 'object') {
      return module.exports = factory();
    } else {
      return root.Heap = factory();
    }
  })(this, function() {
    return Heap;
  });

}).call(this);

},{}],7:[function(require,module,exports){
'use strict';

var primUtils = require('./primUtils');
var liftStep = primUtils.liftStep;

function dynamicApplication(runtime, startTime, argStreams, baseTopoOrder, result) {
  var innerResult;
  var funcStream = argStreams[0];
  var actualArgStreams = argStreams.slice(1);

  // make closure for updating activation
  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (innerResult !== undefined) {
      innerResult.deactivator();
      innerResult.deactivator = null;
    }

    // get activator function from stream
    var activator = funcStream.value;

    // TODO: we could save the last activator, and check if the activator function _actually_ changed...

    // call new activator
    if (innerResult) {
      activator(runtime, atTime, actualArgStreams, baseTopoOrder, innerResult);
    } else {
      innerResult = activator(runtime, atTime, actualArgStreams, baseTopoOrder, null);
      // note that we save the outputStream from the first activator, even after it's deactivated. this seems OK
    }
  }

  // do first update
  updateActivator(startTime);

  // add trigger to update activator
  funcStream.addTrigger(updateActivator);

  return {
    outputStream: innerResult.outputStream,
    deactivator: function() {
      funcStream.removeTrigger(updateActivator);
      innerResult.deactivator();
    },
  };
};

module.exports = {
  ifte: liftStep(function(a, b, c) { return a ? b : c; }, 3),

  app: dynamicApplication,
  prop: liftStep(function(a, b) { return a[b]; }, 2),

  uplus: liftStep(function(a) { return +a; }, 1),
  uminus: liftStep(function(a) { return -a; }, 1),
  bitnot: liftStep(function(a) { return ~a; }, 1),

  mul: liftStep(function(a, b) { return a*b; }, 2),
  div: liftStep(function(a, b) { return a/b; }, 2),

  add: liftStep(function(a, b) { return a+b; }, 2),
  sub: liftStep(function(a, b) { return a-b; }, 2),

  lshift: liftStep(function(a, b) { return a<<b; }, 2),
  srshift: liftStep(function(a, b) { return a>>b; }, 2),
  zrshift: liftStep(function(a, b) { return a>>>b; }, 2),

  lt: liftStep(function(a, b) { return a<b; }, 2),
  lte: liftStep(function(a, b) { return a<=b; }, 2),
  gt: liftStep(function(a, b) { return a>b; }, 2),
  gte: liftStep(function(a, b) { return a>=b; }, 2),
  'in': liftStep(function(a, b) { return a in b; }, 2),

  eq: liftStep(function(a, b) { return a===b; }, 2),
  neq: liftStep(function(a, b) { return a!==b; }, 2),

  bitand: liftStep(function(a, b) { return a&b; }, 2),

  bitxor: liftStep(function(a, b) { return a^b; }, 2),

  bitor: liftStep(function(a, b) { return a|b; }, 2),

  not: liftStep(function(a, b) { return !a; }, 1),

  and: liftStep(function(a, b) { return a && b; }, 2),

  xor: liftStep(function(a, b) { return (!!a) ^ (!!b); }, 2),

  or: liftStep(function(a, b) { return a || b; }, 2),
};

},{"./primUtils":9}],8:[function(require,module,exports){
'use strict';

var Heap = require('heap');

var PriorityQueue = function() {
  this.heap = new Heap(function(a, b) {
    if (a.time === b.time) {
      return (a.topoOrder < b.topoOrder) ? -1 : ((b.topoOrder > a.topoOrder) ? 1 : 0);
    } else {
      return a.time - b.time;
    }
  });
};

PriorityQueue.prototype.isEmpty = function() {
  this.pullRemoved();
  return this.heap.empty();
};

PriorityQueue.prototype.insert = function(task) {
  this.heap.push(task);
};

PriorityQueue.prototype.peek = function() {
  this.pullRemoved();
  return this.heap.peek();
};

PriorityQueue.prototype.pull = function() {
  // We allow inserting tasks that are exactly identical to other tasks,
  //  but we want them to be coalesced (de-duplicated). Rather than do that
  //  at insert time, it seems easier to do it at pull time.

  this.pullRemoved();

  // pop next task
  var task = this.heap.pop();

  // As long as heap is not empty, keep popping off any tasks identical to this one.
  // They must all come in a row, so we can stop when we get a different one.
  while (true) {
    this.pullRemoved();

    if (this.heap.empty()) {
      break;
    }

    var nextTask = this.heap.peek();
    if ((nextTask.time === task.time) && (nextTask.topoOrder === task.topoOrder) && (nextTask.closure === task.closure)) {
      this.heap.pop();
    } else {
      break;
    }
  }

  return task;
};

PriorityQueue.prototype.remove = function(task) {
  // We don't actually remove it, we just set a flag so it will be ignored later.
  task.removed = true;
};

// keep pulling until queue is empty or next task is not flagged as removed
PriorityQueue.prototype.pullRemoved = function() {
  while (!this.heap.empty()) {
    var nextTask = this.heap.peek();
    if (nextTask.removed) {
      this.heap.pop();
    } else {
      break;
    }
  }
}

module.exports = PriorityQueue;

},{"heap":5}],9:[function(require,module,exports){
'use strict';

function liftStep(func, arity) {
  return function(runtime, startTime, argStreams, baseTopoOrder, result) {
    if (argStreams.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    // define function that computes output value from input stream values
    function computeOutput() {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(argStreams[i].value);
      }
      return func.apply(null, argVals);
    }

    // create or validate result, set initial output value
    if (result) {
      if (result.outputStream.tempo !== 'step') {
        throw new Error('Incorrect output stream tempo');
      }
      result.outputStream.changeValue(computeOutput(), startTime);
    } else {
      result = {
        outputStream: runtime.createStepStream(computeOutput(), startTime),
        deactivator: null,
      };
    }

    if (result.deactivator) { throw new Error('Deactivator should be null'); }
    result.deactivator = function() {
      for (var i = 0; i < arity; i++) {
        argStreams[i].removeTrigger(updateTrigger);
      }
    };

    // task closure that updates output value
    function updateTask(atTime) {
      result.outputStream.changeValue(computeOutput(), atTime);
    };

    // closure that queues updateTask
    function updateTrigger(atTime) {
      runtime.priorityQueue.insert({
        time: atTime,
        topoOrder: baseTopoOrder,
        closure: updateTask,
      });
    }

    // add triggers to input streams
    for (var i = 0; i < arity; i++) {
      argStreams[i].addTrigger(updateTrigger);
    }

    return result;
  };
};

module.exports = {
  liftStep: liftStep,
};

},{}],10:[function(require,module,exports){
'use strict';

var Stream = function() {
};

var ConstStream = function(value, startTime) {
  this.value = value;
  this.startTime = startTime;
  this.triggers = []; // TODO: remove this?
}

ConstStream.prototype = Object.create(Stream.prototype);
ConstStream.prototype.constructor = ConstStream;

ConstStream.prototype.tempo = 'const';

ConstStream.prototype.addTrigger = function(closure) {
  // ignore
};

ConstStream.prototype.removeTrigger = function(closure) {
  // ignore
};

ConstStream.prototype.hasTriggers = function() {
  return false;
}

var TriggerSet = function() {
  this.funcs = [];
}

TriggerSet.prototype.add = function(func) {
  this.funcs.push(func);
}

TriggerSet.prototype.remove = function(func) {
  var idx;

  // Remove first match. There could be more than one match, which is OK.
  //  For example in "yield Vec2(x, x)", Vec2 would put two triggers on x.
  //  The priority queue will make sure only one computation happens.
  for (var i = 0; i < this.funcs.length; i++) {
    if (this.funcs[i] === func) {
      idx = i;
      break;
    }
  }

  if (idx === undefined) {
    throw new Error('no matching func found');
  }

  // remove matched func from func list
  this.funcs.splice(idx, 1);
};

TriggerSet.prototype.fire = function(atTime) {
  for (var i = 0; i < this.funcs.length; i++) {
    this.funcs[i](atTime);
  }
}

TriggerSet.prototype.isEmpty = function() {
  return (this.funcs.length === 0);
}

var StepStream = function(initialValue, startTime) {
  this.value = initialValue;
  this.startTime = startTime;
  this.triggerSet = new TriggerSet();
};

StepStream.prototype = Object.create(Stream.prototype);
StepStream.prototype.constructor = StepStream;

StepStream.prototype.tempo = 'step';

StepStream.prototype.changeValue = function(value, atTime) {
  this.value = value;
  this.triggerSet.fire(atTime);
}

StepStream.prototype.addTrigger = function(closure) {
  this.triggerSet.add(closure);
};

StepStream.prototype.removeTrigger = function(closure) {
  this.triggerSet.remove(closure);
};

StepStream.prototype.hasTriggers = function() {
  return !this.triggerSet.isEmpty();
}

var EventStream = function(initialValue, startTime) {
  this.value = initialValue;
  this.startTime = startTime;
  this.triggerSet = new TriggerSet();
}

EventStream.prototype = Object.create(Stream.prototype);
EventStream.prototype.constructor = EventStream;

EventStream.prototype.tempo = 'event';

EventStream.prototype.emitValue = function(value, atTime) {
  this.value = value;
  this.triggerSet.fire(atTime);
}

EventStream.prototype.addTrigger = function(closure) {
  this.triggerSet.add(closure);
};

EventStream.prototype.removeTrigger = function(closure) {
  this.triggerSet.remove(closure);
};

EventStream.prototype.hasTriggers = function() {
  return !this.triggerSet.isEmpty();
}

module.exports = {
  ConstStream: ConstStream,
  StepStream: StepStream,
  EventStream: EventStream,
};

},{}],11:[function(require,module,exports){
'use strict';

 // for loading demos
var Runtime = require('../runtime');
var Compiler = require('../compiler');

var demoProgsMap = {};
var demoProgsList = [];

var demoProgsData = "same position\n---\nyield mousePos\n---\n<p>This program simply yields the mouse position unchanged, causing the square to be at the same position as the mouse.</p>\n\n=====\n\ndelayed position\n---\nyield delay1(mousePos)\n---\n<p>This program yields the mouse position delayed by 1 second. Note the behavior of the \"JS timeout outstanding\" value on the left, as you alternately move the mouse and stop moving it for a bit. If there are \"buffered\" mouse movements still to be played out, there is a timeout set for those. If the mouse has been still for a least one second, no changes will be buffered and so no timeout will be set.</p><p>Also note, if you quickly move the pointer and click to start this same program again, the square jumps to match the mouse position. This is because the delay1 function relays its initial input as its output for the first second.</p>\n\n=====\n\nswitch on button\n---\nyield if mouseDown then mousePos else delay1(mousePos)\n---\n<p>This program switches between yielding the current mouse position and the delayed mouse position, based on whether the mouse button is down. The if/then/else syntax is an expression (like the ternary operator \"?:\"), not a statement.</p><p>Note that even if the mouse button is held down, the delayed position is computed. This is necessary to avoid \"time leaks\", i.e. we don\\'t know when we\\'ll need the value when the mouse button is released, so we must keep it up to date.</p>\n\n=====\n\ndynamic application\n---\nyield (if mouseDown then id else delay1)(mousePos)\n---\n<p>This program illustrates a subtle and important detail, when compared to the previous program. In this program, we apply a function to the mouse position, but the value of that function we apply is itself dynamic. It switches from the value \"id\" (identity function) to the value \"delay1\". This is similar to the previous program, except when the mouse is released, the square stays at the current mouse position. This is because when id or delay1 are switched into action, they always start \"from scratch\". Only one is running at a time. And when delay1 starts, it mirrors its input for the first second. In the previous program, delay1 is always running.</p>\n\n=====\n\nprops and ctor\n---\nyield Vec2(mousePos.y, mousePos.x)\n---\n<p>This program demonstrates property access with the dot operator, and calling a \"constructor\" function which is just a builtin in this case.</p>\n\n=====\n\nbasic math, bindings\n---\nx = 800 - 1.5*mousePos.x\ny = mousePos.y + 50\nyield Vec2(x, y)\n---\n<p>Here we demonstrate binding expressions to names and basic math operators. Note the precedence of multiplicative operators over additive operators.</p>\n\n=====\n\nstrange movement\n---\nx = 0.5*delay1(mousePos.x) + 0.5*mousePos.x\ny = 0.5*delay1(mousePos.y) + 0.5*mousePos.y\nyield Vec2(x, y)\n---\n<p>The output position is halfway between the current mouse position and the 1-second-delayed mouse position. This type of thing would be annoying to code in regular Javascript, but is easy in this language.</p>\n\n=====\n\ntime dependence\n---\nt = timeOfLatest(redraw)\nyield Vec2(mousePos.x + 50*cos(10*t), mousePos.y + 50*sin(10*t))\n---\n<p></p>\n\n=====\n\nfunction definition\n---\ndelay1X = func(v) {\n  yield Vec2(delay1(v.x), v.y)\n}\nyield delay1X(mousePos)\n---\n<p>Anonymous functions can be declared with the func keyword, and bound to names like any other value. Lexical scoping allows them to access names bound in outer scopes.</p>\n";

var demoProgsDataList = demoProgsData.split('\n=====\n');
for (var i = 0; i < demoProgsDataList.length; i++) {
  var progFields = demoProgsDataList[i].split('\n---\n');
  if (progFields.length !== 3) {
    throw new Error('Problem loading demo programs');
  }
  var title = progFields[0].trim();
  var source = progFields[1].trim();
  var commentary = progFields[2].trim();

  var progInfo = {
    title: title,
    source: source,
    commentary: commentary,
  };

  demoProgsMap[title] = progInfo;
  demoProgsList.push(progInfo);
}

var initialDateNow;
var runtime;
var rootLexEnv;
var timeoutID;
var rafID; // requestAnimationFrame
var currentResult;
var inputValues = {
  mouseX: 0,
  mouseY: 0,
  mouseDown: false,
}
var internals;

function initializeMasterTime() {
  initialDateNow = Date.now();
}

function getMasterTime() {
  return 0.001*(Date.now() - initialDateNow);
}

// "run" the runtime as necessary
function tryRunning() {
  if (!runtime.isRunnable() && !rootLexEnv.redraw.hasTriggers()) {
    return;
  }

  var t = getMasterTime();

  rootLexEnv.redraw.emitValue(null, t);

  var nextTime = runtime.runToTime(t);

  // if program depends on redraw input, and no outstanding call to requestAnimationFrame already, make call
  if (rootLexEnv.redraw.hasTriggers() && !rafID) {
    rafID = window.requestAnimationFrame(function(highResTime) {
      rafID = null;
      tryRunning();
    });
  }

  if (nextTime && !timeoutID) {
    timeoutID = window.setTimeout(function() {
      timeoutID = null;
      updateInternalsDisplay();
      tryRunning();
    }, 1000*(nextTime-t));
    updateInternalsDisplay();
  }
}

document.addEventListener('mousemove', function(e) {
  var t = getMasterTime();
  inputValues.mouseX = e.clientX||e.pageX;
  inputValues.mouseY = e.clientY||e.pageY;
  // console.log('mouse', t, mouseX, mouseY);
  rootLexEnv.mouseX.changeValue(inputValues.mouseX, t);
  rootLexEnv.mouseY.changeValue(inputValues.mouseY, t);
  rootLexEnv.mousePos.changeValue({x: inputValues.mouseX, y: inputValues.mouseY}, t);

  tryRunning();
}, false);

document.addEventListener('mousedown', function(e) {
  if (e.button === 0) {
    var t = getMasterTime();
    inputValues.mouseDown = true;
    rootLexEnv.mouseDown.changeValue(inputValues.mouseDown, t);
    tryRunning();
  }
}, false);

document.addEventListener('mouseup', function(e) {
  if (e.button === 0) {
    var t = getMasterTime();
    inputValues.mouseDown = false;
    rootLexEnv.mouseDown.changeValue(inputValues.mouseDown, t);
    tryRunning();
  }
}, false);

function updateInternalsDisplay() {
  var internalsText = [];
  internalsText.push('Output changes: ' + internals.outputChanges);
  internalsText.push('JS timeout outstanding: ' + !!timeoutID);

  document.getElementById('internals-notes').innerHTML = internalsText.join('<br>');
}

function witnessOutput(atTime) {
  var value = currentResult.outputStream.value;

  internals.outputChanges += 1;
  updateInternalsDisplay();

  // console.log('output is', value, 'at master time', atTime);

  var squareElem = document.getElementById('square');
  // squareElem.style.left = (value - 17) + 'px';
  // squareElem.style.top = '100px';
  squareElem.style.left = (value.x + 1) + 'px';
  squareElem.style.top = (value.y + 1) + 'px';
}

function compileAndStartProgram(code) {
  if (currentResult) {
    // deactivate current running program
    currentResult.deactivator();

    // remove trigger on output
    currentResult.outputStream.removeTrigger(witnessOutput);

    // remove any timeout that's set
    if (timeoutID) {
      window.clearTimeout(timeoutID);
      timeoutID = null;

      updateInternalsDisplay();
    }

    // begin sanity checking

    // make sure its not runnable
    if (runtime.isRunnable()) {
      throw new Error('something went wrong');
    }

    // make sure there are no triggers on global streams
    for (var k in rootLexEnv) {
      if (rootLexEnv[k].hasTriggers()) {
        throw new Error('something went wrong');
      }
    }

    // end sanity checking
  }

  initializeMasterTime();
  runtime = new Runtime();

  // add some "global" inputs to root lexical environment
  rootLexEnv = runtime.createLexEnv({
    mouseX: runtime.createStepStream(inputValues.mouseX, 0),
    mouseY: runtime.createStepStream(inputValues.mouseY, 0),
    mousePos: runtime.createStepStream({x: inputValues.mouseX, y: inputValues.mouseY}, 0),
    mouseDown: runtime.createStepStream(inputValues.mouseDown, 0),
    redraw: runtime.createEventStream(undefined, 0),
  });

  // add all builtins to root lexical environment
  for (var k in runtime.builtins) {
    rootLexEnv[k] = runtime.createConstStream(runtime.builtins[k], 0);
  }

  var rootLexEnvNames = {};
  for (var k in rootLexEnv) {
    rootLexEnvNames[k] = null;
  }

  // compile code
  var mainFuncSrc = Compiler.compile(code, rootLexEnvNames);
  console.log('compiled to JS:');
  console.log(mainFuncSrc);
  var mainFunc = eval(mainFuncSrc);

  // initialize internals
  internals = {
    outputChanges: 0,
  };
  updateInternalsDisplay();

  // assume main activator definition has been generated by compiler
  currentResult = mainFunc(runtime, rootLexEnv);

  witnessOutput(0);

  currentResult.outputStream.addTrigger(witnessOutput);

  tryRunning();
}

function startDemoProg(progInfo) {
  document.getElementById('code-column-editor').value = progInfo.source;
  document.getElementById('code-column-commentary').innerHTML = progInfo.commentary || '';
  compileAndStartProgram(progInfo.source);
}

function createDemoControls() {
  var demosListElem = document.getElementById('demos-list');

  for (var i = 0; i < demoProgsList.length; i++) {
    var info = demoProgsList[i];
    var li = document.createElement('LI');
    li.setAttribute('class', 'demo-choice');
    li.appendChild(document.createTextNode(info.title));
    demosListElem.appendChild(li);
  }
  demosListElem.firstChild.classList.add('demo-active');

  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('demo-choice')) {
      // update UI
      for (var i = 0; i < demosListElem.childNodes.length; i++) {
        demosListElem.childNodes[i].classList.remove('demo-active');
      }
      e.target.classList.add('demo-active');

      // run program
      var title = e.target.textContent;
      var progInfo = demoProgsMap[title];
      startDemoProg(progInfo);
    }
  }, false);

  document.getElementById('compile-button').addEventListener('click', function(e) {
    compileAndStartProgram(document.getElementById('code-column-editor').value);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  createDemoControls();

  startDemoProg(demoProgsList[0]);
});

},{"../compiler":1,"../runtime":4}]},{},[11]);
