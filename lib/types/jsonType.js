'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _graphql = require('graphql');

var _language = require('graphql/language');

const astToJson = {
  [_language.Kind.INT](ast) {
    return _graphql.GraphQLInt.parseLiteral(ast);
  },
  [_language.Kind.FLOAT](ast) {
    return _graphql.GraphQLFloat.parseLiteral(ast);
  },
  [_language.Kind.BOOLEAN](ast) {
    return _graphql.GraphQLBoolean.parseLiteral(ast);
  },
  [_language.Kind.STRING](ast) {
    return _graphql.GraphQLString.parseLiteral(ast);
  },
  [_language.Kind.ENUM](ast) {
    return String(ast.value);
  },
  [_language.Kind.LIST](ast) {
    return ast.values.map(astItem => {
      return JSONType.parseLiteral(astItem);
    });
  },
  [_language.Kind.OBJECT](ast) {
    let obj = {};
    ast.fields.forEach(field => {
      obj[field.name.value] = JSONType.parseLiteral(field.value);
    });
    return obj;
  }
};

const JSONType = new _graphql.GraphQLScalarType({
  name: 'SequelizeJSON',
  description: 'The `JSON` scalar type represents raw JSON as values.',
  serialize: value => value,
  parseValue: value => value,
  parseLiteral: ast => {
    const parser = astToJson[ast.kind];
    return parser ? parser.call(undefined, ast) : null;
  }
});

exports.default = JSONType;