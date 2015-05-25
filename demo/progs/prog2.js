'use strict';

module.exports = {
  code: 'yield if mouseDown then mousePos else delay1(mousePos)',
  main: main,
  commentary: '<p>This program switches between yielding the current mouse position and the delayed mouse position, based on whether the mouse button is down. The if/then/else syntax is an expression (like the ternary operator "?:"), not a statement.</p><p>Note that even if the mouse button is held down, the delayed position is computed. This is necessary to avoid "time leaks", i.e. we don\'t know when we\'ll need the value when the mouse button is released, so we must keep it up to date.</p>',
};
