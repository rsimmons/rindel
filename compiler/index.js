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

  // build explicit graph of two types of nodes:
  // - nodes corresponding to streams in the lexical environment
  // - nodes corresponding to local "register" streams we will create

  // create node tree for yield expression
  var outputNode = createNodesRefs(yieldObj.expr);

  // create node trees for each binding
  var locallyBoundNames = {}; // names bound in this function body mapped to refs (parameters are not considered bindings)
  for (var i = 0; i < bodyParts.length; i++) {
    var bp = bodyParts[i];
    if (bp.type === 'binding') {
      if (paramNamesSet.hasOwnProperty(bp.ident)) {
        throw new Error('Can\'t bind name to same name as a parameter');
      }
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
  codeFragments.push('(function(runtime, startTime, argStreams, outputStream, baseTopoOrder, lexEnv) {\n');
  codeFragments.push('  if (argStreams.length !== ' + paramNames.length + ') { throw new Error(\'called with wrong number of arguments\'); }\n');

  function getNodeStreamExpr(node) {
    if ((node.type === NODE_OP) || (node.type === NODE_LITERAL)) {
      return '$_reg' + node.topoOrder;
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

      var argStreamExprs = [];
      for (var j = 0; j < node.argRefs.length; j++) {
        argStreamExprs.push(getNodeStreamExpr(node.argRefs[j].node));
      }

      var opFuncName = 'runtime.opFuncs.' + node.op;

      // TODO: MUST zero-pad topoOrder before adding to baseTopoOrder or bad bad things will happen in larger functions
      codeFragments.push('  var $_act' + node.topoOrder + ' = ' + opFuncName + '(runtime, startTime, [' + argStreamExprs.join(', ') + '], null, baseTopoOrder+\'' + node.topoOrder + '\', lexEnv); var $_reg' + node.topoOrder + ' = $_act' + node.topoOrder + '.outputStream\n');

      deactivatorCalls.push('$_act' + node.topoOrder + '.deactivator()');
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
      } else if (node.kind === 'function') {
        var subFuncCode = compileFunction(node.value.params, node.value.body);
        var lines = subFuncCode.trim().split('\n');
        for (var j = 1; j < lines.length; j++) {
          lines[j] = '  ' + lines[j];
        }
        litValueExpr = lines.join('\n');
      } else {
        throw new Error('unexpected literal kind');
      }

      codeFragments.push('  var $_reg' + node.topoOrder + ' = runtime.createConstStream(' + litValueExpr + ', startTime);\n');
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }
  // I don't think these actually need to be reversed for things to work correctly,
  //  but it just seems appropriate.
  deactivatorCalls.reverse();

  // we might need to copy "inner" output to real output stream, if outputStream arg was provided
  var innerOutputExpr = getNodeStreamExpr(sortedNodes[sortedNodes.length-1]);
  codeFragments.push('  var deactivateCopyTrigger;\n');
  codeFragments.push('  if (outputStream) {\n');
  codeFragments.push('    deactivateCopyTrigger = runtime.addCopyTrigger(' + innerOutputExpr + ', outputStream);\n');
  codeFragments.push('  } else {\n');
  codeFragments.push('    outputStream = ' + innerOutputExpr + ';\n');
  codeFragments.push('  }\n');

  // generate return statement
  var outputStreamExpr = getNodeStreamExpr(sortedNodes[sortedNodes.length-1]);
  codeFragments.push('  return {\n');
  codeFragments.push('    outputStream: outputStream,\n');
  codeFragments.push('    deactivator: function() {\n');

  codeFragments.push('      if (deactivateCopyTrigger) { deactivateCopyTrigger(); }\n');
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
