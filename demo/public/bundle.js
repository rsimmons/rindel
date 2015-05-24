(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var parser = require('./parser.js');

var NODE_APP = 1;
var NODE_LEXENV = 2;

var REF_UNRESOLVED = 1;
var REF_RESOLVING = 2;
var REF_RESOLVED = 3;

// returns a 'ref' object
function createNodesRefs(exprObj) {
  if (exprObj.type == 'app') {
    var funcRef = createNodesRefs(exprObj.funcExpr);
    var argRefs = [];
    for (var i = 0; i < exprObj.argList.length; i++) {
      argRefs.push(createNodesRefs(exprObj.argList[i]));
    }
    return {
      state: REF_RESOLVED,
      node: {
        type: NODE_APP,
        funcRef: funcRef,
        argRefs: argRefs,
      },
    };
  } else if (exprObj.type == 'varIdent') {
    return {
      state: REF_UNRESOLVED,
      ident: exprObj.ident,
    };
  } else {
    throw new Error('Unexpected object found in AST');
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
    if (ref.node.type === NODE_APP) {
      resolveRefRecursive(ref.node.funcRef);
      for (var i = 0; i < ref.node.argRefs.length; i++) {
        resolveRefRecursive(ref.node.argRefs[i]);
      }
    } else if (ref.node.type === NODE_LEXENV) {
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
    if (node.type === NODE_APP) {
      toposortVisit(node.funcRef.node);
      for (var i = 0; i < node.argRefs.length; i++) {
        toposortVisit(node.argRefs[i].node);
      }
    } else if (node.type === NODE_LEXENV) {
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
    if (node.type === NODE_APP) {
      return '$_' + node.topoOrder + '.outputSlot';
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
    if (node.type === NODE_APP) {
      node.topoOrder = nextTopoIdx;
      nextTopoIdx++;

      var funcSlotExpr = getNodeSlotExpr(node.funcRef.node);
      var argSlotExprs = [];
      for (var j = 0; j < node.argRefs.length; j++) {
        argSlotExprs.push(getNodeSlotExpr(node.argRefs[j].node));
      }

      // TODO: MUST zero-pad topoOrder before adding to baseTopoOrder or bad bad things will happen in larger functions
      codeFragments.push('  var $_' + node.topoOrder + ' = runtime.addApplication(startTime, ' + funcSlotExpr + ', [' + argSlotExprs.join(', ') + '], baseTopoOrder+\'' + node.topoOrder + '\');\n');

      deactivatorCalls.push('$_' + node.topoOrder + '.deactivator()');
    } else if (node.type === NODE_LEXENV) {
      // do nothing
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
        peg$c10 = function() { return parseFloat(text()); },
        peg$c11 = ".",
        peg$c12 = { type: "literal", value: ".", description: "\".\"" },
        peg$c13 = /^[_a-z]/i,
        peg$c14 = { type: "class", value: "[_a-z]i", description: "[_a-z]i" },
        peg$c15 = /^[_a-z0-9]/i,
        peg$c16 = { type: "class", value: "[_a-z0-9]i", description: "[_a-z0-9]i" },
        peg$c17 = function(first, rest) { return first + rest.join(''); },
        peg$c18 = "yield",
        peg$c19 = { type: "literal", value: "yield", description: "\"yield\"" },
        peg$c20 = ",",
        peg$c21 = { type: "literal", value: ",", description: "\",\"" },
        peg$c22 = "=",
        peg$c23 = { type: "literal", value: "=", description: "\"=\"" },
        peg$c24 = "(",
        peg$c25 = { type: "literal", value: "(", description: "\"(\"" },
        peg$c26 = ")",
        peg$c27 = { type: "literal", value: ")", description: "\")\"" },
        peg$c28 = function(topBody) { return topBody; },
        peg$c29 = function(parts) { return parts; },
        peg$c30 = function(expr) { return {type: 'yield', expr: expr}; },
        peg$c31 = function(ident, expr) { return {type: 'binding', ident: ident, expr: expr}; },
        peg$c32 = function(initialExpr, argLists) { return nestAnyApplications(initialExpr, argLists); },
        peg$c33 = function(expr) { return expr; },
        peg$c34 = function(ident) { return {type: 'varIdent', ident: ident}; },
        peg$c35 = function(argList) { return argList; },
        peg$c36 = function(first, rest) { return [first].concat(rest); },
        peg$c37 = function(expr) { return [expr]; },

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
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c10();
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
            if (s3 === peg$FAILED) {
              s3 = peg$c7;
            }
            if (s3 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 46) {
                s4 = peg$c11;
                peg$currPos++;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c12); }
              }
              if (s4 !== peg$FAILED) {
                s5 = peg$parsedecimal();
                if (s5 !== peg$FAILED) {
                  s6 = peg$parse_();
                  if (s6 !== peg$FAILED) {
                    peg$reportedPos = s0;
                    s1 = peg$c10();
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

    function peg$parsecomma() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c20;
          peg$currPos++;
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

    function peg$parseequal() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 61) {
          s2 = peg$c22;
          peg$currPos++;
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

    function peg$parseopen_paren() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 40) {
          s2 = peg$c24;
          peg$currPos++;
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

    function peg$parseclose_paren() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 41) {
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

    function peg$parseprogram() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsefunction_body();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c28(s1);
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
        s1 = peg$c29(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsefunction_body_part() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parsekw_yield();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseexpression();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c30(s2);
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
            s3 = peg$parseexpression();
            if (s3 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c31(s1, s3);
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

    function peg$parseexpression() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parsenonapp_expression();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseparenth_arg_list();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseparenth_arg_list();
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c32(s1, s2);
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

    function peg$parsenonapp_expression() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseopen_paren();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseexpression();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseclose_paren();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c33(s2);
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
          s1 = peg$c34(s1);
        }
        s0 = s1;
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
            s1 = peg$c35(s2);
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
      s1 = peg$parseexpression();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecomma();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsearg_list();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c36(s1, s3);
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
        s1 = peg$parseexpression();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c37(s1);
        }
        s0 = s1;
      }

      return s0;
    }



      function nestAnyApplications(initialExpr, argLists) {
        var result = initialExpr;

        for (var i = 0; i < argLists.length; i++) {
          result = {type: 'app', funcExpr: result, argList: argLists[i]};
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

function main(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  return {
    outputSlot: lexEnv.mousePos,
    deactivator: function() {
      // nothing to deactivate
    },
  };
}

module.exports = {
  code: 'yield mousePos',
  main: main,
  commentary: '<p>This program simply yields the mouse position unchanged, causing the square to be at the same position as the mouse.</p>',
};

},{}],4:[function(require,module,exports){
'use strict';

function main(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  // add application for final output
  var $_outResult = runtime.addApplication(startTime, lexEnv.delay1, [lexEnv.mousePos], baseTopoOrder+'1');

  return {
    outputSlot: $_outResult.outputSlot,
    deactivator: function() {
      $_outResult.deactivator();
    },
  };
}

module.exports = {
  code: 'yield delay1(mousePos)',
  main: main,
  commentary: '<p>This program yields the mouse position delayed by 1 second. Note the behavior of the "JS timeout outstanding" value on the left, as you alternately move the mouse and stop moving it for a bit. If there are "buffered" mouse movements still to be played out, there is a timeout set for those. If the mouse has been still for a least one second, no changes will be buffered and so no timeout will be set.</p><p>Also note, if you quickly move the pointer and click to start this same program again, the square jumps to match the mouse position. This is because the delay1 function relays its initial input as its output for the first second.</p>',
};

},{}],5:[function(require,module,exports){
'use strict';

function main(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  var $_0Result = runtime.addApplication(startTime, lexEnv.delay1, [lexEnv.mousePos], baseTopoOrder+'0');
  var $_outResult = runtime.addApplication(startTime, lexEnv.ifte, [lexEnv.mouseDown, lexEnv.mousePos, $_0Result.outputSlot], baseTopoOrder+'1');

  return {
    outputSlot: $_outResult.outputSlot,
    deactivator: function() {
      $_0Result.deactivator();
      $_outResult.deactivator();
    },
  };
}

module.exports = {
  code: 'yield if mouseDown then mousePos else delay1(mousePos)',
  main: main,
  commentary: '<p>This program switches between yielding the current mouse position and the delayed mouse position, based on whether the mouse button is down. The if/then/else syntax is an expression (like the ternary operator "?:"), not a statement.</p><p>Note that even if the mouse button is held down, the delayed position is computed. This is necessary to avoid "time leaks", i.e. we don\'t know when we\'ll need the value when the mouse button is released, so we must keep it up to date.</p>',
};

},{}],6:[function(require,module,exports){
'use strict';

function main(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {
  if (argSlots.length !== 0) {
    throw new Error('called with wrong number of arguments');
  }

  var $_0Result = runtime.addApplication(startTime, lexEnv.ifte, [lexEnv.mouseDown, lexEnv.id, lexEnv.delay1], baseTopoOrder+'0');
  var $_outResult = runtime.addApplication(startTime, $_0Result.outputSlot, [lexEnv.mousePos], baseTopoOrder+'1');

  return {
    outputSlot: $_outResult.outputSlot,
    deactivator: function() {
      $_0Result.deactivator();
      $_outResult.deactivator();
    },
  };
}

module.exports = {
  code: 'yield (if mouseDown then id else delay1)(mousePos)',
  main: main,
  commentary: '<p>This program illustrates a subtle and important detail, when compared to the previous program. In this program, we apply a function to the mouse position, but the value of that function we apply is itself dynamic. It switches from the value "id" (identity function) to the value "delay1". This is similar to the previous program, except when the mouse is released, the square stays at the current mouse position. This is because when id or delay1 are switched into action, they always start "from scratch". Only one is running at a time. And when delay1 starts, it mirrors its input for the first second. In the previous program, delay1 is always running.</p>',
};

},{}],7:[function(require,module,exports){
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

Runtime.prototype.addApplication = function(startTime, func, args, baseTopoOrder, lexEnv) {
  // make closure for updating activation
  var deactivator;
  var runtime = this;
  var outputSlot = runtime.createSlot();

  function updateActivator(atTime) {
    // deactivate old activation, if this isn't first time
    if (deactivator !== undefined) {
      deactivator();
    }

    // get activator function from slot
    var activator = runtime.getSlotValue(func);

    // call new activator
    var result = activator(runtime, atTime, args, baseTopoOrder, lexEnv);

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
  runtime.addTrigger(func, updateActivator);

  return {
    outputSlot: outputSlot,
    deactivator: function() {
      runtime.removeTrigger(func, updateActivator);
      deactivator();
    },
  };
};

Runtime.prototype.primitives = require('./prims');

module.exports = Runtime;

},{"./pq":10,"./prims":11}],8:[function(require,module,exports){
module.exports = require('./lib/heap');

},{"./lib/heap":9}],9:[function(require,module,exports){
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

},{}],10:[function(require,module,exports){
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

},{"heap":8}],11:[function(require,module,exports){
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
  add: liftN(function(a, b) { return a+b; }, 2),
  sub: liftN(function(a, b) { return a-b; }, 2),
  ifte: liftN(function(a, b, c) { return a ? b : c; }, 3),
  id: liftN(function(a) { return a; }, 1),

  delay1: delay1,
};

},{}],12:[function(require,module,exports){
'use strict';

var Runtime = require('../runtime');
var Compiler = require('../compiler/compiler.js');

var demoProgs = {
  'same position': require('./progs/prog0'),
  'delayed position': require('./progs/prog1'),
  'switch on button': require('./progs/prog2'),
  'dynamic application': require('./progs/prog3'),
};

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

function startCompiledMain(mainFunc) {
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

  rootLexEnv = runtime.createLexEnv({
    add: runtime.createSlot(),
    delay1: runtime.createSlot(),
    ifte: runtime.createSlot(),
    id: runtime.createSlot(),

    mouseX: runtime.createSlot(),
    mouseY: runtime.createSlot(),
    mousePos: runtime.createSlot(),
    mouseDown: runtime.createSlot(),
  });

  // builtin functions
  runtime.setSlotValue(rootLexEnv.add, runtime.primitives.add, 0);
  runtime.setSlotValue(rootLexEnv.delay1, runtime.primitives.delay1, 0);
  runtime.setSlotValue(rootLexEnv.ifte, runtime.primitives.ifte, 0);
  runtime.setSlotValue(rootLexEnv.id, runtime.primitives.id, 0);

  // inputs
  runtime.setSlotValue(rootLexEnv.mouseX, inputValues.mouseX, 0);
  runtime.setSlotValue(rootLexEnv.mouseY, inputValues.mouseY, 0);
  runtime.setSlotValue(rootLexEnv.mousePos, {x: inputValues.mouseX, y: inputValues.mouseY}, 0);
  runtime.setSlotValue(rootLexEnv.mouseDown, inputValues.mouseDown, 0);

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

function startDemoProg(prog) {
  document.getElementById('code-column-editor').value = prog.code;
  document.getElementById('code-column-commentary').innerHTML = prog.commentary || '';
  startCompiledMain(prog.main);
}

function createDemoControls() {
  var demosListElem = document.getElementById('demos-list');

  for (var name in demoProgs) {
    var li = document.createElement('LI');
    li.setAttribute('class', 'demo-choice');
    li.appendChild(document.createTextNode(name));
    demosListElem.appendChild(li);

/*
    var ce = document.createElement('CODE');
    ce.className = 'language-javascript';
    var extractedCode = /\/\/SHOWBEGIN([^]*)\/\/SHOWEND/gm.exec(demos[name].code)[1].trim();
    ce.appendChild(document.createTextNode(extractedCode));

    var pe = document.createElement('PRE');
    pe.className = 'code-wrapper';
    pe.style.display = 'none';
    pe.appendChild(ce);

    codeColumnElem.appendChild(pe);

    demos[k].preElem = pe;
*/
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
      var name = e.target.textContent;
      var prog = demoProgs[name];
      startDemoProg(prog);
    }
  }, false);

  document.getElementById('compile-button').addEventListener('click', function(e) {
    var mainFuncSrc = Compiler.compile(document.getElementById('code-column-editor').value);
    console.log('compiled to JS:');
    console.log(mainFuncSrc);
    var mainFunc = eval(mainFuncSrc);
    startCompiledMain(mainFunc);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  createDemoControls();

  startDemoProg(demoProgs['same position']);
});

},{"../compiler/compiler.js":1,"../runtime":7,"./progs/prog0":3,"./progs/prog1":4,"./progs/prog2":5,"./progs/prog3":6}]},{},[12]);
