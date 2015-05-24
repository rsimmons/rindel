{

  function nestAnyApplications(initialExpr, argLists) {
    var result = initialExpr;

    for (var i = 0; i < argLists.length; i++) {
      result = {type: 'app', funcExpr: result, argList: argLists[i]};
    }

    return result;
  }

}

/*****************************************************************************
 * Start rule, which must be the first rule in the file.
 ****************************************************************************/

start
  = expression

// Rules for whitespace.

whitechar
  = [ \t\n\r]

_ "whitespace"
  = whitechar*

/*****************************************************************************
 * Other "utility" rules that are not lexemes in of themselves.
 ****************************************************************************/

decimal
  = [0-9]+

/*****************************************************************************
 * Rules starting here are lexemes wrapped in optional whitespace.
 * Rules in this section don't return AST constructs, they return nothing, or strings/numbers/etc.
 ****************************************************************************/

number
  = _ "-"? decimal _ { return parseFloat(text()); }
  / _ "-"? decimal? "." decimal _ { return parseFloat(text()); }

identifier
  = _ first:[_a-z]i rest:[_a-z0-9]i* _ { return first + rest.join(''); }

kw_yield
  = _ "yield" _

comma
  = _ "," _

open_paren
  = _ "(" _

close_paren
  = _ ")" _

/*****************************************************************************
 * From here on, whitespace is not dealt with, and we don't use any literals in parsing expressions.
 ****************************************************************************/

program
  = topBody:function_body { return topBody; }

function_body
  = parts:function_body_part+ { return parts; }

function_body_part
  = kw_yield expr:expression { return {type: 'yield', expr: expr}; }

// Expressions are weird, because we can't express function application expressions as we'd like to,
// which is left-recurisvely. This is a limitation of PEGs. So instead we have to view them in a "flat" way.
// This is counter-intuitive but works perfectly fine.
expression
  = initialExpr:nonapp_expression argLists:parenth_arg_list* { return nestAnyApplications(initialExpr, argLists); }

// This rule is for expressions that are _not_ function applications, since they are handled specially.
nonapp_expression
  = open_paren expr:expression close_paren { return expr; }
  // TODO: function definition
  / ident:identifier { return {type: 'varIdent', name: ident}; }

parenth_arg_list
  = open_paren argList:arg_list close_paren { return {type: 'argList', args: argList}; }

// This returns an array of expression objects.
arg_list
  = first:expression comma rest:arg_list { return [first].concat(rest); }
  / expr:expression { return [expr]; }
