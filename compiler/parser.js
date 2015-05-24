module.exports = (function() {
  /*
   * Generated by PEG.js 0.8.0.
   *
   * http://pegjs.majda.cz/
   */

  function peg$subclass(child, parent) {
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
  }

  function SyntaxError(message, expected, found, offset, line, column) {
    this.message  = message;
    this.expected = expected;
    this.found    = found;
    this.offset   = offset;
    this.line     = line;
    this.column   = column;

    this.name     = "SyntaxError";
  }

  peg$subclass(SyntaxError, Error);

  function parse(input) {
    var options = arguments.length > 1 ? arguments[1] : {},

        peg$FAILED = {},

        peg$startRuleFunctions = { start: peg$parsestart },
        peg$startRuleFunction  = peg$parsestart,

        peg$c0 = /^[ \t\n\r]/,
        peg$c1 = { type: "class", value: "[ \\t\\n\\r]", description: "[ \\t\\n\\r]" },
        peg$c2 = { type: "other", description: "whitespace" },
        peg$c3 = [],
        peg$c4 = peg$FAILED,
        peg$c5 = /^[0-9]/,
        peg$c6 = { type: "class", value: "[0-9]", description: "[0-9]" },
        peg$c7 = null,
        peg$c8 = "-",
        peg$c9 = { type: "literal", value: "-", description: "\"-\"" },
        peg$c10 = function() { return parseFloat(text()); },
        peg$c11 = ".",
        peg$c12 = { type: "literal", value: ".", description: "\".\"" },
        peg$c13 = /^[_a-z]/i,
        peg$c14 = { type: "class", value: "[_a-z]i", description: "[_a-z]i" },
        peg$c15 = /^[_a-z0-9]/i,
        peg$c16 = { type: "class", value: "[_a-z0-9]i", description: "[_a-z0-9]i" },
        peg$c17 = function(first, rest) { return first + rest.join(''); },
        peg$c18 = "yield",
        peg$c19 = { type: "literal", value: "yield", description: "\"yield\"" },
        peg$c20 = ",",
        peg$c21 = { type: "literal", value: ",", description: "\",\"" },
        peg$c22 = "(",
        peg$c23 = { type: "literal", value: "(", description: "\"(\"" },
        peg$c24 = ")",
        peg$c25 = { type: "literal", value: ")", description: "\")\"" },
        peg$c26 = function(topBody) { return topBody; },
        peg$c27 = function(parts) { return parts; },
        peg$c28 = function(expr) { return {type: 'yield', expr: expr}; },
        peg$c29 = function(initialExpr, argLists) { return nestAnyApplications(initialExpr, argLists); },
        peg$c30 = function(expr) { return expr; },
        peg$c31 = function(ident) { return {type: 'varIdent', ident: ident}; },
        peg$c32 = function(argList) { return argList; },
        peg$c33 = function(first, rest) { return [first].concat(rest); },
        peg$c34 = function(expr) { return [expr]; },

        peg$currPos          = 0,
        peg$reportedPos      = 0,
        peg$cachedPos        = 0,
        peg$cachedPosDetails = { line: 1, column: 1, seenCR: false },
        peg$maxFailPos       = 0,
        peg$maxFailExpected  = [],
        peg$silentFails      = 0,

        peg$result;

    if ("startRule" in options) {
      if (!(options.startRule in peg$startRuleFunctions)) {
        throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
      }

      peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
    }

    function text() {
      return input.substring(peg$reportedPos, peg$currPos);
    }

    function offset() {
      return peg$reportedPos;
    }

    function line() {
      return peg$computePosDetails(peg$reportedPos).line;
    }

    function column() {
      return peg$computePosDetails(peg$reportedPos).column;
    }

    function expected(description) {
      throw peg$buildException(
        null,
        [{ type: "other", description: description }],
        peg$reportedPos
      );
    }

    function error(message) {
      throw peg$buildException(message, null, peg$reportedPos);
    }

    function peg$computePosDetails(pos) {
      function advance(details, startPos, endPos) {
        var p, ch;

        for (p = startPos; p < endPos; p++) {
          ch = input.charAt(p);
          if (ch === "\n") {
            if (!details.seenCR) { details.line++; }
            details.column = 1;
            details.seenCR = false;
          } else if (ch === "\r" || ch === "\u2028" || ch === "\u2029") {
            details.line++;
            details.column = 1;
            details.seenCR = true;
          } else {
            details.column++;
            details.seenCR = false;
          }
        }
      }

      if (peg$cachedPos !== pos) {
        if (peg$cachedPos > pos) {
          peg$cachedPos = 0;
          peg$cachedPosDetails = { line: 1, column: 1, seenCR: false };
        }
        advance(peg$cachedPosDetails, peg$cachedPos, pos);
        peg$cachedPos = pos;
      }

      return peg$cachedPosDetails;
    }

    function peg$fail(expected) {
      if (peg$currPos < peg$maxFailPos) { return; }

      if (peg$currPos > peg$maxFailPos) {
        peg$maxFailPos = peg$currPos;
        peg$maxFailExpected = [];
      }

      peg$maxFailExpected.push(expected);
    }

    function peg$buildException(message, expected, pos) {
      function cleanupExpected(expected) {
        var i = 1;

        expected.sort(function(a, b) {
          if (a.description < b.description) {
            return -1;
          } else if (a.description > b.description) {
            return 1;
          } else {
            return 0;
          }
        });

        while (i < expected.length) {
          if (expected[i - 1] === expected[i]) {
            expected.splice(i, 1);
          } else {
            i++;
          }
        }
      }

      function buildMessage(expected, found) {
        function stringEscape(s) {
          function hex(ch) { return ch.charCodeAt(0).toString(16).toUpperCase(); }

          return s
            .replace(/\\/g,   '\\\\')
            .replace(/"/g,    '\\"')
            .replace(/\x08/g, '\\b')
            .replace(/\t/g,   '\\t')
            .replace(/\n/g,   '\\n')
            .replace(/\f/g,   '\\f')
            .replace(/\r/g,   '\\r')
            .replace(/[\x00-\x07\x0B\x0E\x0F]/g, function(ch) { return '\\x0' + hex(ch); })
            .replace(/[\x10-\x1F\x80-\xFF]/g,    function(ch) { return '\\x'  + hex(ch); })
            .replace(/[\u0180-\u0FFF]/g,         function(ch) { return '\\u0' + hex(ch); })
            .replace(/[\u1080-\uFFFF]/g,         function(ch) { return '\\u'  + hex(ch); });
        }

        var expectedDescs = new Array(expected.length),
            expectedDesc, foundDesc, i;

        for (i = 0; i < expected.length; i++) {
          expectedDescs[i] = expected[i].description;
        }

        expectedDesc = expected.length > 1
          ? expectedDescs.slice(0, -1).join(", ")
              + " or "
              + expectedDescs[expected.length - 1]
          : expectedDescs[0];

        foundDesc = found ? "\"" + stringEscape(found) + "\"" : "end of input";

        return "Expected " + expectedDesc + " but " + foundDesc + " found.";
      }

      var posDetails = peg$computePosDetails(pos),
          found      = pos < input.length ? input.charAt(pos) : null;

      if (expected !== null) {
        cleanupExpected(expected);
      }

      return new SyntaxError(
        message !== null ? message : buildMessage(expected, found),
        expected,
        found,
        pos,
        posDetails.line,
        posDetails.column
      );
    }

    function peg$parsestart() {
      var s0;

      s0 = peg$parseprogram();

      return s0;
    }

    function peg$parsewhitechar() {
      var s0;

      if (peg$c0.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c1); }
      }

      return s0;
    }

    function peg$parse_() {
      var s0, s1;

      peg$silentFails++;
      s0 = [];
      s1 = peg$parsewhitechar();
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$parsewhitechar();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c2); }
      }

      return s0;
    }

    function peg$parsedecimal() {
      var s0, s1;

      s0 = [];
      if (peg$c5.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c6); }
      }
      if (s1 !== peg$FAILED) {
        while (s1 !== peg$FAILED) {
          s0.push(s1);
          if (peg$c5.test(input.charAt(peg$currPos))) {
            s1 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c6); }
          }
        }
      } else {
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsenumber() {
      var s0, s1, s2, s3, s4, s5, s6;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 45) {
          s2 = peg$c8;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c9); }
        }
        if (s2 === peg$FAILED) {
          s2 = peg$c7;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsedecimal();
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c10();
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parse_();
        if (s1 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 45) {
            s2 = peg$c8;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c9); }
          }
          if (s2 === peg$FAILED) {
            s2 = peg$c7;
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parsedecimal();
            if (s3 === peg$FAILED) {
              s3 = peg$c7;
            }
            if (s3 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 46) {
                s4 = peg$c11;
                peg$currPos++;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c12); }
              }
              if (s4 !== peg$FAILED) {
                s5 = peg$parsedecimal();
                if (s5 !== peg$FAILED) {
                  s6 = peg$parse_();
                  if (s6 !== peg$FAILED) {
                    peg$reportedPos = s0;
                    s1 = peg$c10();
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$c4;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$c4;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$c4;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      }

      return s0;
    }

    function peg$parseidentifier() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (peg$c13.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c14); }
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          if (peg$c15.test(input.charAt(peg$currPos))) {
            s4 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c16); }
          }
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            if (peg$c15.test(input.charAt(peg$currPos))) {
              s4 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c16); }
            }
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c17(s2, s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c4;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsekw_yield() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c18) {
          s2 = peg$c18;
          peg$currPos += 5;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c19); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsecomma() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c20;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c21); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseopen_paren() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 40) {
          s2 = peg$c22;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c23); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseclose_paren() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 41) {
          s2 = peg$c24;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c25); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseprogram() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsefunction_body();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c26(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsefunction_body() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parsefunction_body_part();
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parsefunction_body_part();
        }
      } else {
        s1 = peg$c4;
      }
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c27(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsefunction_body_part() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$parsekw_yield();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseexpression();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c28(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parseexpression() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parsenonapp_expression();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseparenth_arg_list();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseparenth_arg_list();
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c29(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsenonapp_expression() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseopen_paren();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseexpression();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseclose_paren();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c30(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseidentifier();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c31(s1);
        }
        s0 = s1;
      }

      return s0;
    }

    function peg$parseparenth_arg_list() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseopen_paren();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsearg_list();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseclose_paren();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c32(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }

      return s0;
    }

    function peg$parsearg_list() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseexpression();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecomma();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsearg_list();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c33(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c4;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c4;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c4;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseexpression();
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c34(s1);
        }
        s0 = s1;
      }

      return s0;
    }



      function nestAnyApplications(initialExpr, argLists) {
        var result = initialExpr;

        for (var i = 0; i < argLists.length; i++) {
          result = {type: 'app', funcExpr: result, argList: argLists[i]};
        }

        return result;
      }



    peg$result = peg$startRuleFunction();

    if (peg$result !== peg$FAILED && peg$currPos === input.length) {
      return peg$result;
    } else {
      if (peg$result !== peg$FAILED && peg$currPos < input.length) {
        peg$fail({ type: "end", description: "end of input" });
      }

      throw peg$buildException(null, peg$maxFailExpected, peg$maxFailPos);
    }
  }

  return {
    SyntaxError: SyntaxError,
    parse:       parse
  };
})();
