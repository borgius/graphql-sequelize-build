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

var _simplifyAST = require('./simplifyAST');

var _simplifyAST2 = _interopRequireDefault(_simplifyAST);

var _generateIncludes = require('./generateIncludes');

var _generateIncludes2 = _interopRequireDefault(_generateIncludes);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function whereQueryVarsToValues(o, vals) {
  _lodash2.default.forEach(o, (v, k) => {
    if (typeof v === 'function') {
      o[k] = o[k](vals);
    } else if (v && typeof v === 'object') {
      whereQueryVarsToValues(v, vals);
    }
  });
}

const deduplicateInclude = (result, value) => {
  const existed = result.find(i => i.association === value.association && i.as == value.as);

  if (existed) {
    value = _lodash2.default.assignWith(existed, value, (a, b) => Array.isArray(a) ? a.concat(b) : a && b && typeof a === 'object' && typeof b === 'object' ? Object.assign(a, b) : b);
  } else {
    result.push(value);
  }

  if (Array.isArray(value.include)) value.include = value.include.reduce(deduplicateInclude, []);

  return result;
};

const fixIncludeOffset = include => {
  if (include.offset === undefined) include.offset = null;

  if (Array.isArray(include.include)) include.include.forEach(fixIncludeOffset);
};

function resolverFactory(target, options = {}) {
  var resolver,
      targetAttributes,
      isModel = !!target.getTableName,
      isAssociation = !!target.associationType,
      association = isAssociation && target,
      model = isAssociation && target.target || isModel && target;

  targetAttributes = Object.keys(model.rawAttributes);

  if (options.include === undefined) options.include = false;
  if (options.before === undefined) options.before = options => options;
  if (options.after === undefined) options.after = result => result;
  if (options.handleConnection === undefined) options.handleConnection = true;
  if (isAssociation && model.scoped) options.required = false; //build: for scoped associations

  resolver = async function (source, args, context, info) {
    var ast = info.fieldASTs || info.fieldNodes,
        simpleAST = (0, _simplifyAST2.default)(ast, info),
        type = info.returnType,
        list = options.list || type instanceof _graphql.GraphQLList || type instanceof _graphql.GraphQLNonNull && type.ofType instanceof _graphql.GraphQLList,
        findOptions = (0, _argsToFindOptions2.default)(args, targetAttributes);

    if ((0, _relay.isConnection)(type)) {
      type = (0, _relay.nodeType)(type);
      simpleAST = (0, _relay.nodeAST)(simpleAST);
    }

    info = _extends({}, info, {
      ast: simpleAST,
      type: type,
      source: source,
      target: target
    });

    context = context || {};

    type = type.ofType || type;

    findOptions.attributes = targetAttributes;
    findOptions.logging = findOptions.logging || context.logging;
    findOptions.graphqlContext = context;
    if (model.primaryKeyAttribute) findOptions.attributes.push(model.primaryKeyAttribute);

    if (options.include && !(isAssociation && options.separate)) {
      const includeResult = await (0, _generateIncludes2.default)(simpleAST, type, context, options);
      findOptions.include = (findOptions.include || []).concat(includeResult.include);
      if (includeResult.order) findOptions.order = (findOptions.order || []).concat(includeResult.order);
      findOptions.attributes = _lodash2.default.uniq(findOptions.attributes.concat(includeResult.attributes));
    }

    return Promise.resolve(options.before(findOptions, args, context, info)).then(function (findOptions) {
      if (args.where && !_lodash2.default.isEmpty(info.variableValues)) {
        whereQueryVarsToValues(args.where, info.variableValues);
        whereQueryVarsToValues(findOptions.where, info.variableValues);
      }

      if (list && !findOptions.order) {
        findOptions.order = [[model.primaryKeyAttribute, 'ASC']];
      }

      if (Array.isArray(findOptions.include)) {
        findOptions.include = findOptions.include.reduce(deduplicateInclude, []); //build: deduplicate include associations

        findOptions.include.forEach(fixIncludeOffset); //build: fix include offset bug

        if (!findOptions.include.length) delete findOptions.include;
      }

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
          return source[association.accessors.get](findOptions).then(function (result) {
            if (options.handleConnection && (0, _relay.isConnection)(info.returnType)) {
              return (0, _relay.handleConnection)(result, args);
            }
            return result;
          });
        }
      }

      return model[list ? 'findAll' : 'findOne'](findOptions);
    }).then(function (result) {
      return options.after(result, args, context, info);
    });
  };

  if (association) resolver.$association = association;
  resolver.$before = options.before;
  resolver.$after = options.after;
  resolver.$options = options;

  return resolver;
}

exports.default = resolverFactory;