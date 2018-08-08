import { GraphQLList, GraphQLNonNull } from 'graphql';
import _ from 'lodash';
import argsToFindOptions from './argsToFindOptions';
import { isConnection, handleConnection, nodeType, nodeAST } from './relay';
import simplifyAST from './simplifyAST';
import generateIncludes from './generateIncludes';

function whereQueryVarsToValues(o, vals) {
  [
    ...Object.getOwnPropertyNames(o),
    ...Object.getOwnPropertySymbols(o)
  ].forEach(k => {
    if (_.isFunction(o[k])) {
      o[k] = o[k](vals);
      return;
    }
    if (_.isObject(o[k])) {
      whereQueryVarsToValues(o[k], vals);
    }
  });
}

const deduplicateInclude = (result, value) => {
  const existed = result.find((i) => i.association === value.association && i.as == value.as);

  if (existed) {
    value = _.assignWith(existed, value, (a, b) =>
      Array.isArray(a) ?
        a.concat(b) :
        (a && b && typeof a === 'object' && typeof b === 'object' ? Object.assign(a, b) : b)
    );
  } else {
    result.push(value);
  }

  if (Array.isArray(value.include)) value.include = value.include.reduce(deduplicateInclude, []);

  return result;
};

const fixIncludeOffset = (include) => {
  if (include.offset === undefined) include.offset = null;

  if (Array.isArray(include.include)) include.include.forEach(fixIncludeOffset);
};

function resolverFactory(target, options = {}) {
  const contextToOptions = _.assign({}, resolverFactory.contextToOptions, options.contextToOptions);

  var resolver
    , targetAttributes
    , isModel = !!target.getTableName
    , isAssociation = !!target.associationType
    , association = isAssociation && target
    , model = isAssociation && target.target || isModel && target;

  targetAttributes = Object.keys(model.rawAttributes);

  if (options.include === undefined) options.include = false;
  if (options.before === undefined) options.before = (options) => options;
  if (options.after === undefined) options.after = (result) => result;
  if (options.handleConnection === undefined) options.handleConnection = true;
  if (isAssociation && model.scoped) options.required = false; //build: for scoped associations

  resolver = async function (source, args, context, info) {
    var ast = info.fieldASTs || info.fieldNodes
      , simpleAST = simplifyAST(ast, info)
      , type = info.returnType
      , list = options.list ||
        type instanceof GraphQLList ||
        type instanceof GraphQLNonNull && type.ofType instanceof GraphQLList
      , findOptions = argsToFindOptions(args, targetAttributes);

    if (isConnection(type)) {
      type = nodeType(type);
      simpleAST = nodeAST(simpleAST);
    }

    info = {
      ...info,
      ast: simpleAST,
      type: type,
      source: source,
      target: target
    };

    context = context || {};

    type = type.ofType || type;

    findOptions.attributes = targetAttributes;
    findOptions.logging = findOptions.logging || context.logging;
    findOptions.graphqlContext = context;
    if (model.primaryKeyAttribute) findOptions.attributes.push(model.primaryKeyAttribute);

    if (options.include && !(isAssociation && options.separate)) {
      const includeResult = await generateIncludes(simpleAST, type, context, options);
      findOptions.include = (findOptions.include || []).concat(includeResult.include);
      if (includeResult.order) findOptions.order = (findOptions.order || []).concat(includeResult.order);
      findOptions.attributes = _.uniq(findOptions.attributes.concat(includeResult.attributes));
    }

    _.each(contextToOptions, (as, key) => {
      findOptions[as] = context[key];
    });

    return Promise.resolve(options.before(findOptions, args, context, info)).then(function (findOptions) {
      if (args.where && !_.isEmpty(info.variableValues)) {
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
          if (options.handleConnection && isConnection(info.returnType)) {
            return handleConnection(result, args);
          }

          return result;
        } else {
          return source[association.accessors.get](findOptions).then(function (result) {
            if (options.handleConnection && isConnection(info.returnType)) {
              return handleConnection(result, args);
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

resolverFactory.contextToOptions = {};

export default resolverFactory;
