import { GraphQLList } from 'graphql';
import _ from 'lodash';
import argsToFindOptions from './argsToFindOptions';
import { isConnection, handleConnection, nodeType, nodeAST } from './relay';
import invariant from 'assert';
import simplifyAST from './simplifyAST';
import generateIncludes from './generateIncludes';

const deduplicateInclude = (result, value) => {
  const existed = result.find((i) => i.association == value.association && i.as == value.as);

  if (existed) {
    value = _.assignWith(existed, value, (a, b) =>
      Array.isArray(a) ?
        a.concat(b) :
        (a && b && typeof a == 'object' && typeof b == 'object' ? Object.assign(a, b) : b)
    );
  } else {
    result.push(value);
  }

  if (Array.isArray(value.include)) value.include = value.include.reduce(deduplicateInclude, []);

  return result;
};

function resolverFactory(target, options) {
  var resolver
    , targetAttributes
    , isModel = !!target.getTableName
    , isAssociation = !!target.associationType
    , association = isAssociation && target
    , model = isAssociation && target.target || isModel && target;

  targetAttributes = Object.keys(model.rawAttributes);

  options = options || {};

  if (options.include === undefined) options.include = false;
  if (options.before === undefined) options.before = (options) => options;
  if (options.after === undefined) options.after = (result) => result;
  if (options.handleConnection === undefined) options.handleConnection = true;
  if (isAssociation && model.scoped) options.required = false; //build: for scoped associations

  resolver = function (source, args, context, info) {
    var ast = info.fieldASTs || info.fieldNodes
      , type = info.returnType
      , list = options.list || type instanceof GraphQLList
      , simpleAST = simplifyAST(ast, info)
      , findOptions = argsToFindOptions(args, targetAttributes);

    info = {
      ...info,
      type: type,
      source: source
    };

    context = context || {};

    if (isConnection(type)) {
      type = nodeType(type);
      simpleAST = nodeAST(simpleAST);
    }

    type = type.ofType || type;

    if (association && source.get(association.as) !== undefined) {
      if (options.handleConnection && isConnection(info.returnType)) {
        return handleConnection(source.get(association.as), args);
      } else {
        return options.after(source.get(association.as), args, context, {
          ...info,
          ast: simpleAST,
          type: type,
          source: source
        });
      }
    }

    findOptions.attributes = targetAttributes;
    findOptions.logging = findOptions.logging || context.logging;

    if (model.primaryKeyAttribute) findOptions.attributes.push(model.primaryKeyAttribute);

    return generateIncludes(
      simpleAST,
      type,
      context,
      options
    ).then((includeResult) => {
      findOptions.include = includeResult.include;
      if (includeResult.order) {
        findOptions.order = (findOptions.order || []).concat(includeResult.order);
      }
      findOptions.attributes = _.uniq(findOptions.attributes.concat(includeResult.attributes));
      findOptions.root = context;
      findOptions.context = context;
      findOptions.logging = findOptions.logging || context.logging;

      return options.before(findOptions, args, context, {
        ...info,
        ast: simpleAST,
        type: type,
        source: source
      });
    }).then((findOptions) => {
      if (list && !findOptions.order) {
        findOptions.order = [[model.primaryKeyAttribute, 'ASC']];
      }

      if (Array.isArray(findOptions.include)) findOptions.include = findOptions.include.reduce(deduplicateInclude, []); //build: deduplicate include associations

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
          return source[association.accessors.get](findOptions).then((result) => {
            if (options.handleConnection && isConnection(info.returnType)) {
              return handleConnection(result, args);
            }
            return result;
          });
        }
      }

      return model[list ? 'findAll' : 'findOne'](findOptions);
    }).then((result) =>
      options.after(result, args, context, {
        ...info,
        ast: simpleAST,
        type: type,
        source: source
      })
    );
  };

  if (association) resolver.$association = association;
  resolver.$before = options.before;
  resolver.$after = options.after;
  resolver.$options = options;

  return resolver;
}

export default resolverFactory;
