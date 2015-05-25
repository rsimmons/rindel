'use strict';

module.exports = {
  code: 'yield (if mouseDown then id else delay1)(mousePos)',
  main: main,
  commentary: '<p>This program illustrates a subtle and important detail, when compared to the previous program. In this program, we apply a function to the mouse position, but the value of that function we apply is itself dynamic. It switches from the value "id" (identity function) to the value "delay1". This is similar to the previous program, except when the mouse is released, the square stays at the current mouse position. This is because when id or delay1 are switched into action, they always start "from scratch". Only one is running at a time. And when delay1 starts, it mirrors its input for the first second. In the previous program, delay1 is always running.</p>',
};
