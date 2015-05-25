'use strict';

module.exports = {
  code: 'yield delay1(mousePos)',
  main: main,
  commentary: '<p>This program yields the mouse position delayed by 1 second. Note the behavior of the "JS timeout outstanding" value on the left, as you alternately move the mouse and stop moving it for a bit. If there are "buffered" mouse movements still to be played out, there is a timeout set for those. If the mouse has been still for a least one second, no changes will be buffered and so no timeout will be set.</p><p>Also note, if you quickly move the pointer and click to start this same program again, the square jumps to match the mouse position. This is because the delay1 function relays its initial input as its output for the first second.</p>',
};
