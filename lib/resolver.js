'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _graphql = require('graphql');

var _argsToFindOptions = require('./argsToFindOptions');

var _argsToFindOptions2 = _interopRequireDefault(_argsToFindOptions);

var _relay = require('./relay');

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _simplifyAST = require('./simplifyAST');

var _simplifyAST2 = _interopRequireDefault(_simplifyAST);

var _generateIncludes = require('./generateIncludes');

var _generateIncludes2 = _interopRequireDefault(_generateIncludes);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function inList(list, attribute) {
  return ~list.indexOf(attribute);
}

function validateOptions(options) {
  (0, _assert2.default)(!options.defaultAttributes || Array.isArray(options.defaultAttributes), 'options.defaultAttributes must be an array of field names.');
}

function resolverFactory(target, options) {
  var resolver,
      targetAttributes,
      isModel = !!target.getTableName,
      isAssociation = !!target.associationType,
      association = isAssociation && target,
      model = isAssociation && target.target || isModel && target;

  targetAttributes = Object.keys(model.rawAttributes);

  options = options || {};

  if (options.include === undefined) options.include = true;
  if (options.before === undefined) options.before = options => options;
  if (options.after === undefined) options.after = result => result;
  if (options.handleConnection === undefined) options.handleConnection = true;
  if (options.filterAttributes === undefined) options.filterAttributes = resolverFactory.filterAttributes;
  //build: for scoped associations
  if (isAssociation && model.scoped) options.required = false;

  validateOptions(options);

  resolver = function (source, args, context, info) {
    var ast = info.fieldASTs || info.fieldNodes,
        type = info.returnType,
        list = options.list || type instanceof _graphql.GraphQLList,
        simpleAST = (0, _simplifyAST2.default)(ast, info),
        fields = simpleAST.fields,
        findOptions = (0, _argsToFindOptions2.default)(args, targetAttributes);

    info = _extends({}, info, {
      type: type,
      source: source
    });

    context = context || {};

    if ((0, _relay.isConnection)(info.returnType)) {
      type = (0, _relay.nodeType)(type);
      simpleAST = (0, _relay.nodeAST)(simpleAST);
      fields = simpleAST.fields;
    }

    type = type.ofType || type;

    if (association && source.get(association.as) !== undefined) {
      if (options.handleConnection && (0, _relay.isConnection)(info.returnType)) {
        return (0, _relay.handleConnection)(source.get(association.as), args);
      }

      return options.after(source.get(association.as), args, context, _extends({}, info, {
        ast: simpleAST,
        type: type,
        source: source
      }));
    }

    if (options.filterAttributes) {
      findOptions.attributes = Object.keys(fields).map(key => fields[key].key || key).filter(inList.bind(null, targetAttributes));

      if (options.defaultAttributes) {
        findOptions.attributes = findOptions.attributes.concat(options.defaultAttributes);
      }
    } else {
      findOptions.attributes = targetAttributes;
    }

    if (model.primaryKeyAttribute) {
      findOptions.attributes.push(model.primaryKeyAttribute);
    }

    return (0, _generateIncludes2.default)(simpleAST, type, context, options).then(function (includeResult) {
      findOptions.include = includeResult.include;
      if (includeResult.order) {
        findOptions.order = (findOptions.order || []).concat(includeResult.order);
      }
      findOptions.attributes = _lodash2.default.uniq(findOptions.attributes.concat(includeResult.attributes));

      findOptions.root = context;
      findOptions.context = context;
      findOptions.logging = findOptions.logging || context.logging;

      return options.before(findOptions, args, context, _extends({}, info, {
        ast: simpleAST,
        type: type,
        source: source
      }));
    }).then(function (findOptions) {
      if (list && !findOptions.order) {
        findOptions.order = [model.primaryKeyAttribute, 'ASC'];
      }

      //build: deduplicate include associations
      if (Array.isArray(findOptions.include)) {
        findOptions.include = findOptions.include.reduce(function deduplicateInclude(result, value) {
          const existed = result.find(i => i.association == value.association && i.as == value.as);

          if (existed) {
            value = _lodash2.default.assignWith(existed, value, (a, b) => Array.isArray(a) ? a.concat(b) : a && b && typeof a == 'object' && typeof b == 'object' ? Object.assign(a, b) : b);
          } else {
            result.push(value);
          }

          if (value.include) value.include = value.include.reduce(deduplicateInclude, []);

          return result;
        }, []);
      }

      //build: context.findOptions
      context.findOptions = findOptions;

      if (association) {
        return source[association.accessors.get](findOptions).then(function (result) {
          if (options.handleConnection && (0, _relay.isConnection)(info.returnType)) {
            return (0, _relay.handleConnection)(result, args);
          }
          return result;
        });
      }

      return model[list ? 'findAll' : 'findOne'](findOptions);
    }).then(function (result) {
      return options.after(result, args, context, _extends({}, info, {
        ast: simpleAST,
        type: type,
        source: source
      }));
    });
  };

  if (association) {
    resolver.$association = association;
  }

  resolver.$before = options.before;
  resolver.$after = options.after;
  resolver.$options = options;

  return resolver;
}

resolverFactory.filterAttributes = true;

exports.default = resolverFactory;