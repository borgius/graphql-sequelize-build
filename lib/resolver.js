'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _graphql = require('graphql');

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _argsToFindOptions = require('./argsToFindOptions');

var _argsToFindOptions2 = _interopRequireDefault(_argsToFindOptions);

var _relay = require('./relay');

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _simplifyAST = require('./simplifyAST');

var _simplifyAST2 = _interopRequireDefault(_simplifyAST);

var _generateIncludes = require('./generateIncludes');

var _generateIncludes2 = _interopRequireDefault(_generateIncludes);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const deduplicateInclude = (result, value) => {
  const existed = result.find(i => i.association == value.association && i.as == value.as);

  if (existed) {
    value = _lodash2.default.assignWith(existed, value, (a, b) => Array.isArray(a) ? a.concat(b) : a && b && typeof a == 'object' && typeof b == 'object' ? Object.assign(a, b) : b);
  } else {
    result.push(value);
  }

  if (Array.isArray(value.include)) value.include = value.include.reduce(deduplicateInclude, []);

  return result;
};

function resolverFactory(target, options) {
  var resolver,
      targetAttributes,
      isModel = !!target.getTableName,
      isAssociation = !!target.associationType,
      association = isAssociation && target,
      model = isAssociation && target.target || isModel && target;

  targetAttributes = Object.keys(model.rawAttributes);

  options = options || {};

  if (options.include === undefined) options.include = false;
  if (options.before === undefined) options.before = options => options;
  if (options.after === undefined) options.after = result => result;
  if (options.handleConnection === undefined) options.handleConnection = true;
  if (isAssociation && model.scoped) options.required = false; //build: for scoped associations

  resolver = async (source, args, context, info) => {
    var ast = info.fieldASTs || info.fieldNodes,
        type = info.returnType,
        list = options.list || type instanceof _graphql.GraphQLList,
        simpleAST = (0, _simplifyAST2.default)(ast, info),
        findOptions = (0, _argsToFindOptions2.default)(args, targetAttributes);

    info = _extends({}, info, {
      type: type,
      source: source
    });

    context = context || {};

    if ((0, _relay.isConnection)(type)) {
      type = (0, _relay.nodeType)(type);
      simpleAST = (0, _relay.nodeAST)(simpleAST);
    }

    type = type.ofType || type;

    if (association && source.get(association.as) !== undefined) {
      if (options.handleConnection && (0, _relay.isConnection)(info.returnType)) {
        return (0, _relay.handleConnection)(source.get(association.as), args);
      } else {
        return options.after(source.get(association.as), args, context, _extends({}, info, {
          ast: simpleAST,
          type: type,
          source: source
        }));
      }
    }

    findOptions.attributes = targetAttributes;
    findOptions.logging = findOptions.logging || context.logging;

    if (model.primaryKeyAttribute) findOptions.attributes.push(model.primaryKeyAttribute);

    const includeResult = await (0, _generateIncludes2.default)(simpleAST, type, context, options);

    findOptions.include = includeResult.include;
    if (includeResult.order) findOptions.order = (findOptions.order || []).concat(includeResult.order);
    findOptions.attributes = _lodash2.default.uniq(findOptions.attributes.concat(includeResult.attributes));
    findOptions.root = context;
    findOptions.context = context;
    findOptions.logging = findOptions.logging || context.logging;

    const result = await Promise.resolve(options.before(findOptions, args, context, _extends({}, info, {
      ast: simpleAST,
      type: type,
      source: source
    }))).then(findOptions => {
      if (list && !findOptions.order) {
        findOptions.order = [[model.primaryKeyAttribute, 'ASC']];
      }

      if (Array.isArray(findOptions.include)) findOptions.include = findOptions.include.reduce(deduplicateInclude, []); //build: deduplicate include associations

      context.findOptions = findOptions; //build: context.findOptions

      if (association) {
        if (source.get(association.as) !== undefined) {
          // The user did a manual include
          const result = source.get(association.as);
          if (options.handleConnection && (0, _relay.isConnection)(info.returnType)) {
            return (0, _relay.handleConnection)(result, args);
          }

          return result;
        } else {
          return source[association.accessors.get](findOptions).then(result => {
            if (options.handleConnection && (0, _relay.isConnection)(info.returnType)) {
              return (0, _relay.handleConnection)(result, args);
            }
            return result;
          });
        }
      }

      return model[list ? 'findAll' : 'findOne'](findOptions);
    });

    return options.after(result, args, context, _extends({}, info, {
      ast: simpleAST,
      type: type,
      source: source
    }));
  };

  if (association) resolver.$association = association;
  resolver.$before = options.before;
  resolver.$after = options.after;
  resolver.$options = options;

  return resolver;
}

exports.default = resolverFactory;