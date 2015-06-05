'use strict';

function RindelError() {
  // not to be called directly, just base class for instanceof
}
RindelError.prototype = Object.create(Error.prototype);
RindelError.prototype.constructor = RindelError;

function deriveErrorClass(base, name, init) {
  function E(message) {
    this.name = name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error()).stack;
    }
    this.message = message;
    if (init) { init.apply(this, arguments); }
  }
  E.prototype = Object.create(base.prototype);
  E.prototype.constructor = E;
  return E;
}

var InternalError = deriveErrorClass(RindelError, 'InternalError');
var ParseError = deriveErrorClass(RindelError, 'ParseError');
var NameResolutionError = deriveErrorClass(RindelError, 'NameResolutionError');
var CycleError = deriveErrorClass(RindelError, 'CycleError');

module.exports = {
  RindelError: RindelError,
  deriveErrorClass: deriveErrorClass,
  InternalError: InternalError,
  ParseError: ParseError,
  NameResolutionError: NameResolutionError,
  CycleError: CycleError,
};
