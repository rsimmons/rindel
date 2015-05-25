/*****************************************************************************
 * PARSER
 *
 * The parser returns a Javascript object that is the root node of the
 * abstract syntax tree (AST). That node will typically contain references
 * to other AST nodes. Each node has a "type" property that indicates what
 * type of node it is. The value of "type" indicates what other properties
 * are also present in the node. The valid types and the additional fields
 * they come with are:
 *
 * - varIdent: variable identifier. field "ident" is string
 * - literal: fields "kind" (e.g. number, string) and "value"
 * - binding: a binding of expression to name. fields "ident" string and
 *   "expr" expression
 * - op: application of operator. fields are "op" string and "args" array
 *   of expressions. interpretation of "args" depends on "op" value.
 *   importantly, function application is considered an operator
 * - yield: field "expr" is expression
 *
 * An "expression" or "expression tree" is an AST (sub)tree rooted with a
 * node of type varIdent, literal, or op.
 *
 * Leaf nodes of expression trees are either "varIdent" or "literal" nodes,
 * and internal nodes of expression trees are always "op" nodes. In other
 * words, operators are used to make new expressions out of other expressions.
 ****************************************************************************/

{

}

/*****************************************************************************
 * START RULE
 *
 * This must be the first rule in the file.
 ****************************************************************************/

start
  = program

/*****************************************************************************
 * WHITESPACE RULES
 ****************************************************************************/

whitechar
  = [ \t\n\r]

_ "whitespace"
  = whitechar*

/*****************************************************************************
 * MISC/UTILITY RULES
 *
 * These rules are not whitespace or lexemes but are used to build lexemes.
 ****************************************************************************/

decimal
  = [0-9]+

/*****************************************************************************
 * (WRAPPED) LEXEME RULES
 *
 * Rules starting here are lexemes wrapped in optional whitespace.
 * Rules in this section and before correspond to the lexical analysis stage.
 * Rules in this section don't return AST objects. They return nothing, or strings/numbers/etc.
 ****************************************************************************/

number
  = _ "-"? decimal? "." decimal _ { return parseFloat(text()); }
  / _ "-"? decimal _ { return parseFloat(text()); }

identifier
  = _ first:[_a-z]i rest:[_a-z0-9]i* _ { return first + rest.join(''); }

var_identifier
  = identifier

kw_yield
  = _ "yield" _

kw_if
  = _ "if" _

kw_then
  = _ "then" _

kw_else
  = _ "else" _

comma
  = _ "," _

dot
  = _ "." _

equal
  = _ "=" _

open_paren
  = _ "(" _

close_paren
  = _ ")" _

/*****************************************************************************
 * PHRASE RULES
 *
 * Rules starting here don't deal with tokenization/lexical analysis.
 * Whitespace is not considered, and there are no literals in parsing expressions.
 * Rules are only written in terms of (wrapped) lexeme rules or other phrase rules.
 ****************************************************************************/

program
  = topBody:function_body { return topBody; }

function_body
  = parts:function_body_part+ { return parts; }

function_body_part
  = kw_yield expr:expression { return {type: 'yield', expr: expr}; }
  / ident:var_identifier equal expr:expression { return {type: 'binding', ident: ident, expr: expr}; }

primary_expr
  = open_paren expr:expression close_paren { return expr; }
  // TODO: function definition
  / number:number { return {type: 'literal', kind: 'number', value: number}; }
  / kw_if condition:expression kw_then consequent:expression kw_else alternative:expression { return {type: 'op', op: 'ifte', args: [condition, consequent, alternative]}; }
  / ident:var_identifier { return {type: 'varIdent', ident: ident}; }

access_call_expr
  = first:primary_expr rest:(argList:parenth_arg_list { return {internal: 'app', argList: argList}; } / ident:dot_access { return {internal: 'dot', ident: ident}; })* {
    var result = first;

    for (var i = 0; i < rest.length; i++) {
      if (rest[i].internal === 'app') {
        result = {
          type: 'op',
          op: 'app',
          args: [result].concat(rest[i].argList),
        };
      } else if (rest[i].internal === 'dot') {
        result = {
          type: 'op',
          op: 'prop',
          args: [
            result,
            {type: 'literal', kind: 'string', value: rest[i].ident},
          ],
        };
      } else {
        throw new Error('internal error');
      }
    }

    return result;
  }

expression = access_call_expr

// this the right hand of a property access via dot, e.g. ".length"
dot_access
  = dot ident:var_identifier { return ident; }

parenth_arg_list
  = open_paren argList:arg_list close_paren { return argList; }

// This returns an array of expression objects.
arg_list
  = first:expression comma rest:arg_list { return [first].concat(rest); }
  / expr:expression { return [expr]; }
