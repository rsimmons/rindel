# Rindel ([Demo/Examples](http://www.rindel-lang.org/))

**Warning: Rindel is not yet ready for public consumption!**

Rindel is a [functional reactive programming](http://en.wikipedia.org/wiki/Functional_reactive_programming) language that compiles to Javascript.

Like other functional reactive programming languages, Rindel lets you manipulate time-varying values and event streams as first-class entities, without needing callbacks, generators, or iterators. In other words, it excels at composing dynamic stateful behaviors.

_Unlike_ most FRP languages, Rindel is implicitly lifted. It also uses a syntax that appears similar to imperative languages, despite being purely functional.

## Technical Features

- Declarative and [purely functional](http://en.wikipedia.org/wiki/Purely_functional) - No imperative mutations. Output of a function depends solely on its inputs. Functions are free of "side-effects".
- Implicitly lifted - All expressions are automatically lifted into the time domain
- Imperative-style syntax for function application - E.g. `f(a,b)`, not `f a b`
- _Not_ an embedded language of a normal functional language
- Free of time and space leaks by design
- Multi-kinded - The 3 kinds of streams (aka signals) distinguished: constant, event, and step (piecewise constant)
- Strictly "push" model ([push vs. pull explained](http://conal.net/papers/push-pull-frp/))
- _Not_ based on a continuous-time conceptual model
- Type system tied to Javascript's
- **Coming Soon** Custom syntax for switching, that resembles tail recursive calls
- **Planned** Statically typed with type inference
- **Planned** Optimized using [lowering transformations](http://cs.brown.edu/~sk/Publications/Papers/Published/bck-lowering-opt-trans-frp/paper.pdf)

## Demo/Examples

Check out some live example programs [here](http://www.rindel-lang.org/).

## Further Info

Some sparse, imcomplete notes can be found on the [wiki](https://github.com/rsimmons/rindel/wiki).
