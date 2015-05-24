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
