'use strict';

var primUtils = require('./primUtils');
var liftN = primUtils.liftN;

module.exports = {
  ifte: liftN(function(a, b, c) { return a ? b : c; }, 3),
  dotAccess: function(propName) {
    return liftN(function(a) { return a[propName]; }, 1);
  },
};
