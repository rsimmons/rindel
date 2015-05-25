'use strict';

var primUtils = require('./primUtils');
var liftN = primUtils.liftN;

module.exports = {
  ifte: liftN(function(a, b, c) { return a ? b : c; }, 3),
};
