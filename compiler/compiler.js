'use strict';

var parser = require('./parser.js');

var NODE_NEEDS_RESOLUTION = -1;
var NODE_APP = 1;
var NODE_LEXENV = 2;

function createNodeTree(exprObj) {
  if (exprObj.type == 'app') {
    var argTrees = [];
    for (var i = 0; i < exprObj.argList.length; i++) {
      argTrees.push(createNodeTree(exprObj.argList[i]));
    }
    return {
      type: NODE_APP,
      func: createNodeTree(exprObj.funcExpr),
      args: argTrees,
    }
  } else if (exprObj.type == 'varIdent') {
    return {
      type: NODE_NEEDS_RESOLUTION,
      ident: exprObj.ident,
    }
  } else {
    throw new Error('Unexpected object found in AST');
  }
}

function compileFunction(paramNames, bodyParts, jsName) {
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
  var locallyBoundNames = {}; // names bound in this function body (parameters are not considered bindings)
  var usedLexEnvNames = {}; // mapping from names referred to in lexical environment to their nodes

  console.log('yieldObj.expr', yieldObj.expr);
  var outputNode = createNodeTree(yieldObj.expr);
  console.log('outputNode', outputNode);

  // TODO: call createNodeTree for each binding, putting result in locallyBoundNames

  // this function returns a node reference, which could be a new node
  function resolveNameRefs(node) {
    if (node.type === NODE_APP) {
      node.func = resolveNameRefs(node.func);
      for (var i = 0; i < node.args.length; i++) {
        node.args[i] = resolveNameRefs(node.args[i]);
      }
      return node;
    } else if (node.type === NODE_NEEDS_RESOLUTION) {
      if (locallyBoundNames.hasOwnProperty(node.ident)) {
        // resolve to already-created node
        return locallyBoundNames[node.ident];
      } else {
        // assume name must refer to something defined in lexical environment
        if (usedLexEnvNames.hasOwnProperty(node.ident)) {
          // resolve to already-created node
          return usedLexEnvNames[node.ident];
        } else {
          // TODO: check that this is a legitimate reference, i.e. ident is actually in lexical environment

          var newNode = {
            type: NODE_LEXENV,
            ident: node.ident,
          };
          console.log('created new', newNode);
          usedLexEnvNames[node.ident] = newNode;
          return newNode
        }
      }
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }

  // resolve name references to either lexical environment or local bindings
  outputNode = resolveNameRefs(outputNode);
  for (var k in locallyBoundNames) {
    locallyBoundNames[k] = resolveNameRefs(locallyBoundNames[k]);
  }

  console.log('after name resolution, outputNode', outputNode);

  // TODO: DFS from outputNode to get toposorted list of nodes
  // FIXME: this is a temporary hack for now
  var sortedNodes = [];
  function addToSorted(node) {
    if (node.type === NODE_APP) {
      addToSorted(node.func);
      for (var i = 0; i < node.args.length; i++) {
        addToSorted(node.args[i]);
      }
      sortedNodes.push(node);
    } else if (node.type === NODE_LEXENV) {
      sortedNodes.push(node);
    } else {
      throw new Error('Unexpected node type found in tree');
    }
  }
  addToSorted(outputNode);
  // END FIXME
  console.log('sortedNodes', sortedNodes);

  // begin code generation
  var codeFragments = [];

  // this is sort of ghetto but will do for now
  codeFragments.push('function ' + jsName + '(runtime, startTime, argSlots, baseTopoOrder, lexEnv) {\n');
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
    console.log(i, node);
    if (node.type === NODE_APP) {
      node.topoOrder = nextTopoIdx;
      nextTopoIdx++;

      var funcSlotExpr = getNodeSlotExpr(node.func);
      var argSlotExprs = [];
      for (var j = 0; j < node.args.length; j++) {
        argSlotExprs.push(getNodeSlotExpr(node.args[j]));
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
  deactivatorCalls.reverse();

  // generate return statement
  var outputSlotExpr = getNodeSlotExpr(sortedNodes[sortedNodes.length-1]);
  console.log(outputSlotExpr);
  codeFragments.push('  return {\n');
  codeFragments.push('    outputSlot: ' + outputSlotExpr + ',\n');
  codeFragments.push('    deactivator: function() {\n');

  for (var i = 0; i < deactivatorCalls.length; i++) {
    codeFragments.push('      ' + deactivatorCalls[i] + ';\n');
  }

  codeFragments.push('    }\n');
  codeFragments.push('  };\n');
  codeFragments.push('}');

  // join generated code fragments and return
  return codeFragments.join('');
}

function compile(sourceCode) {
  // parse source code, to get our top-level AST structure, which is a list of "function body parts"
  var topFuncBodyParts = parser.parse(sourceCode);

  // compile the top-level parts, treating them as implicitly wrapped in no-parameter "main" definition
  var targetCode = compileFunction([], topFuncBodyParts, 'main');

  return targetCode;
}

module.exports = {
  compile: compile,
};
