(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var parser = require('./parser.js');

var NODE_OP = 1;
var NODE_LEXENV = 2;
var NODE_LITERAL = 3;

var REF_UNRESOLVED = 1;
var REF_RESOLVING = 2;
var REF_RESOLVED = 3;

// takes AST expression node and returns a 'ref' object
function createNodesRefs(exprNode) {
  if (exprNode.type === 'op') {
    var argRefs = [];
    for (var i = 0; i < exprNode.args.length; i++) {
      argRefs.push(createNodesRefs(exprNode.args[i]));
    }
    return {
      state: REF_RESOLVED,
      node: {
        type: NODE_OP,
        op: exprNode.op,
        argRefs: argRefs,
      },
    };
  } else if (exprNode.type === 'varIdent') {
    return {
      state: REF_UNRESOLVED,
      ident: exprNode.ident,
    };
  } else if (exprNode.type === 'literal') {
    return {
      state: REF_RESOLVED,
      node: {
        type: NODE_LITERAL,
        kind: exprNode.kind,
        value: exprNode.value,
      },
    };
  } else {
    throw new Error('Unexpected node type found in AST');
  }
}

function compileFunction(paramNames, bodyParts) {
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

  // build explicit graph of two types of nodes:
  // - nodes corresponding to slots in the lexical environment
  // - nodes corresponding to local "register" slots we will create

  // create node tree for yield expression
  var outputNode = createNodesRefs(yieldObj.expr);

  // create node trees for each binding
  var locallyBoundNames = {}; // names bound in this function body mapped to refs (parameters are not considered bindings)
  for (var i = 0; i < bodyParts.length; i++) {
    var bp = bodyParts[i];
    if (bp.type === 'binding') {
      if (locallyBoundNames.hasOwnProperty(bp.ident)) {
        throw new Error('Same name bound more than once');
      }
      locallyBoundNames[bp.ident] = createNodesRefs(bp.expr);
    }
  }

  var usedLexEnvNames = {}; // mapping from names referred to in lexical environment to their nodes (NOT refs)

  // resolve identifier to a node, and make sure any downstream refs are also resolved. returns node
  function resolveIdentRecursive(ident) {
    if (locallyBoundNames.hasOwnProperty(ident)) {
      resolveRefRecursive(locallyBoundNames[ident]);
      return locallyBoundNames[ident].node;
    } else {
      // assume name must refer to something defined in lexical environment
      if (usedLexEnvNames.hasOwnProperty(ident)) {
        // resolve to already-created lexenv node
        return usedLexEnvNames[ident];
      } else {
        // TODO: check that this is a legitimate reference, i.e. ident is actually in lexical environment

        var newNode = {
          type: NODE_LEXENV,
          ident: ident,
        };
        usedLexEnvNames[ident] = newNode;
        return newNode;
      }
    }
  }

  // resolve given ref, and recursively resolve any refs found in downstream nodes. returns nothing
  function resolveRefRecursive(ref) {
    if (ref.state === REF_RESOLVED) {
      // do nothing
    } else if (ref.state === REF_RESOLVING) {
      throw new Error('Circular binding');
    } else if (ref.state === REF_UNRESOLVED) {
      ref.state = REF_RESOLVING;
      ref.node = resolveIdentRecursive(ref.ident);
      ref.state = REF_RESOLVED;
    } else {
      throw new Error('Invalid ref state');
    }

    // now that node is ensured to be resolved, recursively make sure everything downstream from it is resolved
    // TODO: it seems like there's duplicate work happening here. we could put flag on nodes to say that anything
    //  downstream of it was already resolved?
    if (ref.node.type === NODE_OP) {
      for (var i = 0; i < ref.node.argRefs.length; i++) {
        resolveRefRecursive(ref.node.argRefs[i]);
      }
    } else if (ref.node.type === NODE_LEXENV) {
      // nothing to resolve
    } else if (ref.node.type === NODE_LITERAL) {
      // nothing to resolve
    } else {
      throw new Error('Invalid node type');
    }
  }

  // resolve references to either lexical environment or local bindings
  resolveRefRecursive(outputNode);
  for (var k in locallyBoundNames) {
    resolveRefRecursive(locallyBoundNames[k]);
  }

  // DFS from outputNode to get toposorted list of nodes
  var STATE_ENTERED = 1; // node has been entered in traversal, but not yet added to ordering
  var STATE_ADDED = 2; // node has been added to ordering, and is "done"
  var sortedNodes = [];
  function toposortVisit(node) {
    if (node.state === STATE_ENTERED) {
      throw new Error('Cycle in binding/reference graph, can\'t toposort');
    } else if (node.state === STATE_ADDED) {
      // already taken care of
      return;
    }

    node.state = STATE_ENTERED;

    // visit any nodes this node depends on
    if (node.type === NODE_OP) {
      for (var i = 0; i < node.argRefs.length; i++) {
        toposortVisit(node.argRefs[i].node);
      }
    } else if (node.type === NODE_LEXENV) {
      // nothing to do since leaf
    } else if (node.type === NODE_LITERAL) {
      // nothing to do since leaf
    } else {
      throw new Error('Unexpected node type found during toposort');
    }

    // finally, add this node to sort order and update its state
    sortedNodes.push(node);
    node.state = STATE_ADDED;
  }
  toposortVisit(outputNode.node);

  // begin code generation
  var codeFragments = [];

  // this is sort of ghetto but will do for now
  codeFragments.push('(function(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {\n');
  codeFragments.push('  if (argSlots.length !== ' + paramNames.length + ') { throw new Error(\'called with wrong number of arguments\'); }\n');

  function getNodeSlotExpr(node) {
    if ((node.type === NODE_OP) || (node.type === NODE_LITERAL)) {
      return '$_' + node.topoOrder;
    } else if (node.type === NODE_LEXENV) {
      return 'lexEnv.' + node.ident;
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }

  // iterate sorted nodes, doing some code generation
  var deactivatorCalls = [];
  var nextTopoIdx = 0;
  for (var i = 0; i < sortedNodes.length; i++) {
    var node = sortedNodes[i];
    if (node.type === NODE_OP) {
      node.topoOrder = nextTopoIdx;
      nextTopoIdx++;

      var argSlotExprs = [];
      for (var j = 0; j < node.argRefs.length; j++) {
        argSlotExprs.push(getNodeSlotExpr(node.argRefs[j].node));
      }

      var opFuncName = 'runtime.opFuncs.' + node.op;

      // TODO: MUST zero-pad topoOrder before adding to baseTopoOrder or bad bad things will happen in larger functions
      codeFragments.push('  var $_' + node.topoOrder + 'act = ' + opFuncName + '(runtime, startTime, [' + argSlotExprs.join(', ') + '], baseTopoOrder+\'' + node.topoOrder + '\'); var $_' + node.topoOrder + ' = $_' + node.topoOrder + 'act.outputSlot\n');

      deactivatorCalls.push('$_' + node.topoOrder + 'act.deactivator()');
    } else if (node.type === NODE_LEXENV) {
      // do nothing
    } else if (node.type === NODE_LITERAL) {
      node.topoOrder = nextTopoIdx;
      nextTopoIdx++;

      var litValueExpr;
      if (node.kind === 'string') {
        // TODO: we might want to call a proper repr()-style escape on the value, but it should only be safe characters anyways
        litValueExpr = '\'' + node.value + '\'';
      } else if (node.kind === 'number') {
        litValueExpr = node.value.toString();
      } else {
        throw new Error('unexpected literal kind');
      }

      codeFragments.push('  var $_' + node.topoOrder + ' = runtime.createSlot(); runtime.setSlotValue($_' + node.topoOrder + ', ' + litValueExpr + ', startTime);\n');
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }
  // I don't think these actually need to be reversed for things to work correctly,
  //  but it just seems appropriate.
  deactivatorCalls.reverse();

  // generate return statement
  var outputSlotExpr = getNodeSlotExpr(sortedNodes[sortedNodes.length-1]);
  codeFragments.push('  return {\n');
  codeFragments.push('    outputSlot: ' + outputSlotExpr + ',\n');
  codeFragments.push('    deactivator: function() {\n');

  for (var i = 0; i < deactivatorCalls.length; i++) {
    codeFragments.push('      ' + deactivatorCalls[i] + ';\n');
  }

  codeFragments.push('    }\n');
  codeFragments.push('  };\n');
  codeFragments.push('})');

  // join generated code fragments and return
  return codeFragments.join('');
}

function compile(sourceCode) {
  // parse source code, to get our top-level AST structure, which is a list of "function body parts"
  var topFuncBodyParts = parser.parse(sourceCode);

  // compile the top-level parts, treating them as implicitly wrapped in no-parameter "main" definition
  var targetCode = compileFunction([], topFuncBodyParts);

  return targetCode;
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
        peg$c18 = "yield",
        peg$c19 = { type: "literal", value: "yield", description: "\"yield\"" },
        peg$c20 = "if",
        peg$c21 = { type: "literal", value: "if", description: "\"if\"" },
        peg$c22 = "then",
        peg$c23 = { type: "literal", value: "then", description: "\"then\"" },
        peg$c24 = "else",
        peg$c25 = { type: "literal", value: "else", description: "\"else\"" },
        peg$c26 = ",",
        peg$c27 = { type: "literal", value: ",", description: "\",\"" },
        peg$c28 = "=",
        peg$c29 = { type: "literal", value: "=", description: "\"=\"" },
        peg$c30 = void 0,
        peg$c31 = "(",
        peg$c32 = { type: "literal", value: "(", description: "\"(\"" },
        peg$c33 = ")",
        peg$c34 = { type: "literal", value: ")", description: "\")\"" },
        peg$c35 = "+",
        peg$c36 = { type: "literal", value: "+", description: "\"+\"" },
        peg$c37 = "~",
        peg$c38 = { type: "literal", value: "~", description: "\"~\"" },
        peg$c39 = "*",
        peg$c40 = { type: "literal", value: "*", description: "\"*\"" },
        peg$c41 = "/",
        peg$c42 = { type: "literal", value: "/", description: "\"/\"" },
        peg$c43 = "<<",
        peg$c44 = { type: "literal", value: "<<", description: "\"<<\"" },
        peg$c45 = ">>",
        peg$c46 = { type: "literal", value: ">>", description: "\">>\"" },
        peg$c47 = ">",
        peg$c48 = { type: "literal", value: ">", description: "\">\"" },
        peg$c49 = ">>>",
        peg$c50 = { type: "literal", value: ">>>", description: "\">>>\"" },
        peg$c51 = function(topBody) { return topBody; },
        peg$c52 = function(parts) { return parts; },
        peg$c53 = function(expr) { return {type: 'yield', expr: expr}; },
        peg$c54 = function(ident, expr) { return {type: 'binding', ident: ident, expr: expr}; },
        peg$c55 = function(expr) { return expr; },
        peg$c56 = function(number) { return {type: 'literal', kind: 'number', value: number}; },
        peg$c57 = function(condition, consequent, alternative) { return {type: 'op', op: 'ifte', args: [condition, consequent, alternative]}; },
        peg$c58 = function(ident) { return {type: 'varIdent', ident: ident}; },
        peg$c59 = function(argList) { return {internal: 'app', argList: argList}; },
        peg$c60 = function(ident) { return {internal: 'dot', ident: ident}; },
        peg$c61 = function(first, rest) {
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
        peg$c62 = function() { return 'uplus'; },
        peg$c63 = function() { return 'uminus'; },
        peg$c64 = function() { return 'bitnot'; },
        peg$c65 = function(ops, expr) { return nestPrefixOps(ops, expr); },
        peg$c66 = function() { return 'mul'; },
        peg$c67 = function() { return 'div'; },
        peg$c68 = function(first, rest) { return nestBinOps(first, rest); },
        peg$c69 = function() { return 'add'; },
        peg$c70 = function() { return 'sub'; },
        peg$c71 = function() { return 'lshift'; },
        peg$c72 = function() { return 'srshift'; },
        peg$c73 = function() { return 'zrshift'; },
        peg$c74 = function(ident) { return ident; },
        peg$c75 = function(argList) { return argList; },
        peg$c76 = function(first, rest) { return [first].concat(rest); },
        peg$c77 = function(expr) { return [expr]; },

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

      s0 = peg$parseprogram();

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

    function peg$parsekw_yield() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c18) {
          s2 = peg$c18;
          peg$currPos += 5;
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

    function peg$parsekw_if() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c20) {
          s2 = peg$c20;
          peg$currPos += 2;
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

    function peg$parsekw_then() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c22) {
          s2 = peg$c22;
          peg$currPos += 4;
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

    function peg$parsekw_else() {
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

    function peg$parsecomma() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c26;
          peg$currPos++;
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

    function peg$parseequal() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 61) {
          s2 = peg$c28;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c29); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$currPos;
          peg$silentFails++;
          if (input.charCodeAt(peg$currPos) === 61) {
            s4 = peg$c28;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c29); }
          }
          peg$silentFails--;
          if (s4 === peg$FAILED) {
            s3 = peg$c30;
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
          s2 = peg$c31;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c32); }
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
          s2 = peg$c33;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c34); }
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
          s2 = peg$c35;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c36); }
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
          s2 = peg$c37;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c38); }
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
          s2 = peg$c39;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c40); }
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
          s2 = peg$c41;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c42); }
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
          s2 = peg$c35;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c36); }
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
        if (input.substr(peg$currPos, 2) === peg$c43) {
          s2 = peg$c43;
          peg$currPos += 2;
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

    function peg$parseop_srshift() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c45) {
          s2 = peg$c45;
          peg$currPos += 2;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c46); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$currPos;
          peg$silentFails++;
          if (input.charCodeAt(peg$currPos) === 62) {
            s4 = peg$c47;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c48); }
          }
          peg$silentFails--;
          if (s4 === peg$FAILED) {
            s3 = peg$c30;
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
        if (input.substr(peg$currPos, 3) === peg$c49) {
          s2 = peg$c49;
          peg$currPos += 3;
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

    function peg$parseprogram() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsefunction_body();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c51(s1);
      }
      s0 = s1;

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
        s1 = peg$c52(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsefunction_body_part() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parsekw_yield();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseshift_expr();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c53(s2);
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
            s3 = peg$parseshift_expr();
            if (s3 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c54(s1, s3);
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
        s2 = peg$parseshift_expr();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseclose_paren();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c55(s2);
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
        s1 = peg$parsenumber();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c56(s1);
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parsekw_if();
          if (s1 !== peg$FAILED) {
            s2 = peg$parseshift_expr();
            if (s2 !== peg$FAILED) {
              s3 = peg$parsekw_then();
              if (s3 !== peg$FAILED) {
                s4 = peg$parseshift_expr();
                if (s4 !== peg$FAILED) {
                  s5 = peg$parsekw_else();
                  if (s5 !== peg$FAILED) {
                    s6 = peg$parseshift_expr();
                    if (s6 !== peg$FAILED) {
                      peg$reportedPos = s0;
                      s1 = peg$c57(s2, s4, s6);
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
              s1 = peg$c58(s1);
            }
            s0 = s1;
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
          s4 = peg$c59(s4);
        }
        s3 = s4;
        if (s3 === peg$FAILED) {
          s3 = peg$currPos;
          s4 = peg$parsedot_access();
          if (s4 !== peg$FAILED) {
            peg$reportedPos = s3;
            s4 = peg$c60(s4);
          }
          s3 = s4;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseparenth_arg_list();
          if (s4 !== peg$FAILED) {
            peg$reportedPos = s3;
            s4 = peg$c59(s4);
          }
          s3 = s4;
          if (s3 === peg$FAILED) {
            s3 = peg$currPos;
            s4 = peg$parsedot_access();
            if (s4 !== peg$FAILED) {
              peg$reportedPos = s3;
              s4 = peg$c60(s4);
            }
            s3 = s4;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c61(s1, s2);
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
        s1 = peg$c62();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_uminus();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c63();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseop_bitnot();
          if (s1 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c64();
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
          s1 = peg$c65(s1, s2);
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
        s1 = peg$c66();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_div();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c67();
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
          s1 = peg$c68(s1, s2);
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
        s1 = peg$c69();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_sub();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c70();
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
          s1 = peg$c68(s1, s2);
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
        s1 = peg$c71();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseop_srshift();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c72();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseop_zrshift();
          if (s1 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c73();
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
          s1 = peg$c68(s1, s2);
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
          s1 = peg$c74(s2);
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
        s2 = peg$parsearg_list();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseclose_paren();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c75(s2);
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

    function peg$parsearg_list() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseshift_expr();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecomma();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsearg_list();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c76(s1, s3);
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
        s1 = peg$parseshift_expr();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c77(s1);
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
var liftN = primUtils.liftN;

function delay1(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 1) {
    throw new Error('got wrong number of arguments');
  }

  var outputSlot = runtime.createSlot();

  var argSlot = argSlots[0];
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

    runtime.setSlotValue(outputSlot, nextChange.value, atTime);

    pendingOutputChangeTask = null;
    updateTasks();
  };

  var argChangedTask = function(atTime) {
    var argVal = runtime.getSlotValue(argSlot);
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

  // set initial output to be initial input
  var argVal = runtime.getSlotValue(argSlot);
  runtime.setSlotValue(outputSlot, argVal, startTime);

  // add trigger on argument
  runtime.addTrigger(argSlot, argChangedTrigger);

  return {
    outputSlot: outputSlot,
    deactivator: function() {
      runtime.removeTrigger(argSlot, argChangedTrigger);
      if (pendingOutputChangeTask) {
        runtime.priorityQueue.remove(pendingOutputChangeTask);
      }
    },
  };
};

module.exports = {
  id: liftN(function(a) { return a; }, 1),
  Vec2: liftN(function(x, y) { return {x: x, y: y}; }, 2),

  delay1: delay1,
};

},{"./primUtils":9}],4:[function(require,module,exports){
'use strict';

var PriorityQueue = require('./pq');

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

Runtime.prototype.createSlot = function() {
  return {
    currentValue: undefined,
    triggers: [],
  };
};

Runtime.prototype.getSlotValue = function(slot) {
  return slot.value;
};

Runtime.prototype.setSlotValue = function(slot, value, atTime) {
  slot.value = value;
  for (var i = 0; i < slot.triggers.length; i++) {
    slot.triggers[i](atTime);
  }
};

Runtime.prototype.addTrigger = function(slot, closure) {
  slot.triggers.push(closure);
};

Runtime.prototype.removeTrigger = function(slot, closure) {
  var idx;

  for (var i = 0; i < slot.triggers.length; i++) {
    if (slot.triggers[i] === closure) {
      if (idx !== undefined) {
        throw new Error('found two identical triggers');
      }
      idx = i;
    }
  }

  if (idx === undefined) {
    throw new Error('no matching trigger found');
  }

  // remove matched trigger from slot triggers list
  slot.triggers.splice(idx, 1);
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

},{"./builtins":3,"./opFuncs":7,"./pq":8}],5:[function(require,module,exports){
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
var liftN = primUtils.liftN;

function dynamicApplication(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  // make closure for updating activation
  var deactivator;
  var outputSlot = runtime.createSlot();
  var funcSlot = argSlots[0];
  var actualArgSlots = argSlots.slice(1);

  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (deactivator !== undefined) {
      deactivator();
    }

    // get activator function from slot
    var activator = runtime.getSlotValue(funcSlot);

    // call new activator
    var result = activator(runtime, atTime, actualArgSlots, baseTopoOrder, lexEnv);

    if (result === undefined) {
      throw new Error('activator did not return result');
    }

    // update current deactivator
    deactivator = result.deactivator;

    // do first copy of 'internal' output to 'external' output
    runtime.setSlotValue(outputSlot, runtime.getSlotValue(result.outputSlot), atTime);

    // set trigger to copy output of current activation to output of this application
    runtime.addTrigger(result.outputSlot, function(atTime) {
      // copy value from 'internal' output to 'external' output
      runtime.setSlotValue(outputSlot, runtime.getSlotValue(result.outputSlot), atTime);
    });
  }

  // do first update
  updateActivator(startTime);

  // add trigger to update activator
  runtime.addTrigger(funcSlot, updateActivator);

  return {
    outputSlot: outputSlot,
    deactivator: function() {
      runtime.removeTrigger(funcSlot, updateActivator);
      deactivator();
    },
  };
};

module.exports = {
  ifte: liftN(function(a, b, c) { return a ? b : c; }, 3),

  app: dynamicApplication,
  prop: liftN(function(a, b) { return a[b]; }, 2),

  uplus: liftN(function(a) { return +a; }, 1),
  uminus: liftN(function(a) { return -a; }, 1),
  bitnot: liftN(function(a) { return ~a; }, 1),

  mul: liftN(function(a, b) { return a*b; }, 2),
  div: liftN(function(a, b) { return a/b; }, 2),

  add: liftN(function(a, b) { return a+b; }, 2),
  sub: liftN(function(a, b) { return a-b; }, 2),

  lshift: liftN(function(a, b) { return a<<b; }, 2),
  srshift: liftN(function(a, b) { return a>>b; }, 2),
  zrshift: liftN(function(a, b) { return a>>>b; }, 2),
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

function liftN(func, arity) {
  return function(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
    if (argSlots.length !== arity) {
      throw new Error('got wrong number of arguments');
    }

    var outputSlot = runtime.createSlot();

    var updateTask = function(atTime) {
      var argVals = [];
      for (var i = 0; i < arity; i++) {
        argVals.push(runtime.getSlotValue(argSlots[i]));
      }
      var outVal = func.apply(null, argVals);
      runtime.setSlotValue(outputSlot, outVal, atTime);
    };

    // make closure that queues task to update value in outputSlot
    var updateTrigger = function(atTime) {
      runtime.priorityQueue.insert({
        time: atTime,
        topoOrder: baseTopoOrder,
        closure: updateTask,
      });
    }

    // set initial output
    updateTask(startTime);

    // add triggers
    for (var i = 0; i < arity; i++) {
      runtime.addTrigger(argSlots[i], updateTrigger);
    }

    return {
      outputSlot: outputSlot,
      deactivator: function() {
        for (var i = 0; i < arity; i++) {
          runtime.removeTrigger(argSlots[i], updateTrigger);
        }
      },
    };
  };
};

module.exports = {
  liftN: liftN,
};

},{}],10:[function(require,module,exports){
'use strict';

 // for loading demos
var Runtime = require('../runtime');
var Compiler = require('../compiler');

var demoProgsMap = {};
var demoProgsList = [];

var demoProgsData = "same position\n---\nyield mousePos\n---\n<p>This program simply yields the mouse position unchanged, causing the square to be at the same position as the mouse.</p>\n\n=====\n\ndelayed position\n---\nyield delay1(mousePos)\n---\n<p>This program yields the mouse position delayed by 1 second. Note the behavior of the \"JS timeout outstanding\" value on the left, as you alternately move the mouse and stop moving it for a bit. If there are \"buffered\" mouse movements still to be played out, there is a timeout set for those. If the mouse has been still for a least one second, no changes will be buffered and so no timeout will be set.</p><p>Also note, if you quickly move the pointer and click to start this same program again, the square jumps to match the mouse position. This is because the delay1 function relays its initial input as its output for the first second.</p>\n\n=====\n\nswitch on button\n---\nyield if mouseDown then mousePos else delay1(mousePos)\n---\n<p>This program switches between yielding the current mouse position and the delayed mouse position, based on whether the mouse button is down. The if/then/else syntax is an expression (like the ternary operator \"?:\"), not a statement.</p><p>Note that even if the mouse button is held down, the delayed position is computed. This is necessary to avoid \"time leaks\", i.e. we don\\'t know when we\\'ll need the value when the mouse button is released, so we must keep it up to date.</p>\n\n=====\n\ndynamic application\n---\nyield (if mouseDown then id else delay1)(mousePos)\n---\n<p>This program illustrates a subtle and important detail, when compared to the previous program. In this program, we apply a function to the mouse position, but the value of that function we apply is itself dynamic. It switches from the value \"id\" (identity function) to the value \"delay1\". This is similar to the previous program, except when the mouse is released, the square stays at the current mouse position. This is because when id or delay1 are switched into action, they always start \"from scratch\". Only one is running at a time. And when delay1 starts, it mirrors its input for the first second. In the previous program, delay1 is always running.</p>\n\n=====\n\nprops and ctor\n---\nyield Vec2(mousePos.y, mousePos.x)\n---\n<p>This program demonstrates property access with the dot operator, and calling a \"constructor\" function which is just a builtin in this case.</p>\n\n=====\n\nbasic math, bindings\n---\nx = 800 - 1.5*mousePos.x\ny = mousePos.y + 50\nyield Vec2(x, y)\n---\n<p>Here we demonstrate binding expressions to names and basic math operators. Note the precedence of multiplicative operators over additive operators.</p>\n\n=====\n\nstrange movement\n---\nx = 0.5*delay1(mousePos.x) + 0.5*mousePos.x\ny = 0.5*delay1(mousePos.y) + 0.5*mousePos.y\nyield Vec2(x, y)\n---\n<p>The output position is halfway between the current mouse position and the 1-second-delayed mouse position. This type of thing would be annoying to code in regular Javascript, but is easy in this language.</p>\n\n";

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

var initialDateNow = Date.now();
var runtime;
var rootLexEnv;
var timeoutID;
var currentResult;
var inputValues = {
  mouseX: 0,
  mouseY: 0,
  mouseDown: false,
}
var internals;

function getMasterTime() {
  return 0.001*(Date.now() - initialDateNow);
}

// "run" the runtime as necessary
function tryRunning() {
  if (!runtime.isRunnable()) {
    return;
  }

  var t = getMasterTime();
  var nextTime = runtime.runToTime(t);

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
  runtime.setSlotValue(rootLexEnv.mouseX, inputValues.mouseX, t);
  runtime.setSlotValue(rootLexEnv.mouseY, inputValues.mouseY, t);
  runtime.setSlotValue(rootLexEnv.mousePos, {x: inputValues.mouseX, y: inputValues.mouseY}, t);

  tryRunning();
}, false);

document.addEventListener('mousedown', function(e) {
  if (e.button === 0) {
    var t = getMasterTime();
    inputValues.mouseDown = true;
    runtime.setSlotValue(rootLexEnv.mouseDown, inputValues.mouseDown, t);
    tryRunning();
  }
}, false);

document.addEventListener('mouseup', function(e) {
  if (e.button === 0) {
    var t = getMasterTime();
    inputValues.mouseDown = false;
    runtime.setSlotValue(rootLexEnv.mouseDown, inputValues.mouseDown, t);
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
  var value = currentResult.outputSlot.value;

  internals.outputChanges += 1;
  updateInternalsDisplay();

  // console.log('output is', value, 'at master time', atTime);

  var squareElem = document.getElementById('square');
  // squareElem.style.left = (value - 17) + 'px';
  // squareElem.style.top = '100px';
  squareElem.style.left = (value.x + 1) + 'px';
  squareElem.style.top = (value.y + 1) + 'px';
}

function startCompiledProgram(mainFunc) {
  if (currentResult) {
    // deactivate current running program
    currentResult.deactivator();

    // remove trigger on output
    runtime.removeTrigger(currentResult.outputSlot, witnessOutput);

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

    // make sure there are no triggers on global slots
    for (var k in rootLexEnv) {
      if (rootLexEnv[k].triggers.length > 0) {
        throw new Error('something went wrong');
      }
    }

    // end sanity checking
  }

  runtime = new Runtime();

  // add some "global" inputs to root lexical environment
  rootLexEnv = runtime.createLexEnv({
    mouseX: runtime.createSlot(),
    mouseY: runtime.createSlot(),
    mousePos: runtime.createSlot(),
    mouseDown: runtime.createSlot(),
  });

  // inputs
  runtime.setSlotValue(rootLexEnv.mouseX, inputValues.mouseX, 0);
  runtime.setSlotValue(rootLexEnv.mouseY, inputValues.mouseY, 0);
  runtime.setSlotValue(rootLexEnv.mousePos, {x: inputValues.mouseX, y: inputValues.mouseY}, 0);
  runtime.setSlotValue(rootLexEnv.mouseDown, inputValues.mouseDown, 0);

  // add all builtins to root lexical environment
  for (var k in runtime.builtins) {
    rootLexEnv[k] = runtime.createSlot();
    runtime.setSlotValue(rootLexEnv[k], runtime.builtins[k], 0);
  }

  // initialize internals
  internals = {
    outputChanges: 0,
  };
  updateInternalsDisplay();

  // assume main activator definition has been generated by compiler
  currentResult = mainFunc(runtime, 0, [], '', rootLexEnv);

  witnessOutput(0);

  runtime.addTrigger(currentResult.outputSlot, witnessOutput);

  tryRunning();
}

function compileAndStartProgram(code) {
  var mainFuncSrc = Compiler.compile(code);
  console.log('compiled to JS:');
  console.log(mainFuncSrc);
  var mainFunc = eval(mainFuncSrc);
  startCompiledProgram(mainFunc);
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

},{"../compiler":1,"../runtime":4}]},{},[10]);