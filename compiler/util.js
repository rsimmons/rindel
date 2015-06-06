'use strict';

function indentFuncExpr(code) {
  var lines = code.trim().split('\n');
  for (var j = 1; j < lines.length; j++) {
    lines[j] = '  ' + lines[j];
  }
  return lines.join('\n');
}

module.exports = {
  indentFuncExpr: indentFuncExpr,
};
