import {
  fromGlobalId,
  connectionFromArray,
  nodeDefinitions,
  connectionDefinitions,
  connectionArgs
} from 'graphql-relay';

import {
  GraphQLList,
  GraphQLEnumType
} from 'graphql';

import {
  base64,
  unbase64,
} from './base64.js';

import _ from 'lodash';
import simplifyAST from './simplifyAST';
import resolverFactory from './resolver.js';
import JSONType from './types/jsonType.js';

export class NodeTypeMapper {
  constructor() {
    this.map = { };
  }

  mapTypes(types) {
    Object.keys(types).forEach((k) => {
      let v = types[k];
      this.map[k] = v.type
        ? v
        : { type: v };
    });
  }

  item(type) {
    return this.map[type];
  }
}

export function idFetcher(sequelize, nodeTypeMapper) {
  return async (globalId, context) => {
    const {type, id} = fromGlobalId(globalId);

    const nodeType = nodeTypeMapper.item(type);
    if (nodeType && typeof nodeType.resolve === 'function') {
      const res = await Promise.resolve(nodeType.resolve(globalId, context));
      if (res) res.__graphqlType__ = type;
      return res;
    }

    const model = Object.keys(sequelize.models).find(model => model === type);
    return model
      ? sequelize.models[model].findById(id)
      : nodeType
        ? nodeType.type
        : null;
  };
}

export function typeResolver(nodeTypeMapper) {
  return obj => {
    var type = obj.__graphqlType__
               || (obj.Model
                 ? obj.Model.options.name.singular
                 : obj.name);

    if (!type) {
      throw new Error(`Unable to determine type of ${ typeof obj }. ` +
        `Either specify a resolve function in 'NodeTypeMapper' object, or specify '__graphqlType__' property on object.`);
    }

    const nodeType = nodeTypeMapper.item(type);
    return nodeType && nodeType.type || null;
  };
}

export function isConnection(type) {
  return typeof type.name !== 'undefined' && type.name.endsWith('Connection');
}

export function handleConnection(values, args) {
  return connectionFromArray(values, args);
}

export function sequelizeNodeInterface(sequelize) {
  let nodeTypeMapper = new NodeTypeMapper();
  const nodeObjects = nodeDefinitions(
    idFetcher(sequelize, nodeTypeMapper),
    typeResolver(nodeTypeMapper)
  );

  return {
    nodeTypeMapper,
    ...nodeObjects
  };
}

export function nodeAST(connectionAST) {
  return connectionAST.fields.edges &&
    connectionAST.fields.edges.fields.node;
}

export function nodeType(connectionType) {
  return connectionType._fields.edges.type.ofType._fields.node.type;
}

export function sequelizeConnection({
  name,
  nodeType,
  target,
  orderBy: orderByType,//build: orderByType
  before,
  handleResult,//build: handleResult
  after,
  connectionFields,
  edgeFields,
  where
}) {
  const {
    edgeType,
    connectionType
  } = connectionDefinitions({
    name,
    nodeType,
    connectionFields,
    edgeFields
  });

  const model = target.target ? target.target : target;
  const SEPERATOR = '$';
  const PREFIX = 'arrayconnection' + SEPERATOR;

  //build: orderByType
  if (orderByType === undefined) {
    orderByType = JSONType;
  }

  before = before || ((options) => options);
  after = after || ((result) => result);
  handleResult = handleResult || ((result) => result);

  let $connectionArgs = {
    ...connectionArgs,
    orderBy: {
      type: orderByType//build: orderByType
    }
  };

  let orderByAttribute = function (orderAttr, {source, args, context, info}) {
    return typeof orderAttr === 'function' ? orderAttr(source, args, context, info) : orderAttr;
  };

  let orderByDirection = function (orderDirection, args) {
    if (args.last) {
      return orderDirection.indexOf('ASC') >= 0
              ? orderDirection.replace('ASC', 'DESC')
              : orderDirection.replace('DESC', 'ASC');
    }
    return orderDirection;
  };

  /**
   * Creates a cursor given a item returned from the Database
   * @param  {Object}   item   sequelize model instance
   * @param  {Integer}  index  the index of this item within the results, 0 indexed
   * @return {String}          The Base64 encoded cursor string
   */
  let toCursor = function (item, index) {
    let id = item.get(model.primaryKeyAttribute);
    return base64(PREFIX + id + SEPERATOR + index);
  };

  /**
   * Decode a cursor into its component parts
   * @param  {String} cursor Base64 encoded cursor
   * @return {Object}        Object containing ID and index
   */
  let fromCursor = function (cursor) {
    cursor = unbase64(cursor);
    cursor = cursor.substring(PREFIX.length, cursor.length);
    let [id, index] = cursor.split(SEPERATOR);

    return {
      id,
      index
    };
  };

  let argsToWhere = function (args) {
    let result = {};

    _.each(args, (value, key) => {
      if (key in $connectionArgs) return;
      _.assign(result, where(key, value, result));
    });

    return result;
  };

  //build: argsToWhereWithIncludeAssociations
  let argsToWhereWithIncludeAssociations = function (args) {
    const result = {
      where: {},
      include: []
    };

    _.each(args, (value, key) => {
      if (key in $connectionArgs) return;
      const res = where(key, value, result);

      if (Array.isArray(res)) {
        _.mergeWith(result.where, res[0], (a, b) => Array.isArray(a) ? a.concat(b) : undefined);
        if (Array.isArray(res[1])) result.include.push(...res[1]);
      } else {
        _.assign(result.where, res);
      }
    });

    return result;
  };

  let resolveEdge = function (item, index, queriedCursor, args = {}, source) {
    let startIndex = null;
    if (queriedCursor) startIndex = Number(queriedCursor.index);
    if (startIndex !== null) {
      startIndex++;
    } else {
      startIndex = 0;
    }

    return {
      cursor: toCursor(item, index + startIndex),
      node: item,
      source: source
    };
  };

  //build: buildFindOptions
  let buildFindOptions = function (options = {}, args, context, info) {
    if (args.first || args.last) {
      options.limit = parseInt(args.first || args.last, 10);
    }

    //build: orderBy with associations

    if (!Array.isArray(args.orderBy)) args.orderBy = [];

    args.orderBy.push([model.primaryKeyAttribute, 'ASC']);//todo: remove if other fields

    _.assignWith(options, args.orderBy.reduce(function (result, orderBy) {
      if (!Array.isArray(orderBy)) throw Error('orderBy');
      if (!orderBy.length) throw Error('orderBy');

      let orderAttribute;
      let orderDirection;
      let orderAssociations;

      var last = orderBy[orderBy.length - 1];
      var _last = last.toUpperCase();

      if (_last == 'ASC' || _last == 'DESC') {
        orderAttribute = orderBy[orderBy.length - 2];
        orderDirection = _last;
        orderAssociations = orderBy.slice(0, -2);
      } else {
        orderAttribute = last;
        orderDirection = 'ASC';
        orderAssociations = orderBy.slice(0, -1);
      }

      if (!orderAttribute) throw Error('orderBy');
      if (!orderDirection) throw Error('orderBy');

      if (args.last) orderDirection = orderDirection === 'ASC' ? 'DESC' : 'ASC';

      if (!options.attributes) options.attributes = [];

      if (!orderAssociations.length) options.attributes.push(orderAttribute);

      return _.assignWith(result, orderAssociations.reduce(function ({order, include}, associationName, index) {
        const source = !index ? model : order[0][index - 1].model;

        //todo: if !as
        const association = Object.values(source.associations).find(association => association.as == associationName);
        if (!association) throw Error('orderBy');

        order[0].splice(-2, 0, {model: association.target, as: association.as});

        let associationInclude = include;

        for (let i = index; i--;) {
          associationInclude = include[0].include;
        }

        associationInclude.push({association, include: []});

        return {order, include};
      }, {order: [[orderAttribute, orderDirection]], include: []}), (a, b) => Array.isArray(a) ? a.concat(b) : b);
    }, {order: [], include: []}), (a, b) => Array.isArray(a) ? a.concat(b) : b);

    if (options.limit && !options.attributes.some(attribute => attribute.length === 2 && attribute[1] === 'full_count')) {
      if (model.sequelize.dialect.name === 'postgres') {
        options.attributes.push([
          model.sequelize.literal('COUNT(*) OVER()'),
          'full_count'
        ]);
      } else if (model.sequelize.dialect.name === 'mssql') {
        options.attributes.push([
          model.sequelize.literal('COUNT(1) OVER()'),
          'full_count'
        ]);
      }
    }

    //build: argsToWhereWithIncludeAssociations
    _.assignWith(options, argsToWhereWithIncludeAssociations(args), (a, b) => Array.isArray(a) ? a.concat(b) : b);
    options.required = false;

    if (args.after || args.before) {
      let cursor = fromCursor(args.after || args.before);
      let startIndex = Number(cursor.index);

      if (startIndex >= 0) options.offset = startIndex + 1;
    }
    options.attributes = _.uniq(options.attributes);

    return options;
  };

  //build: resolverFactory
  let $resolver = resolverFactory(target, {
    handleConnection: false,
    include: true,
    list: true,
    before: function (options, args, context, info) {
      options = buildFindOptions(options, args, context, info);

      return before(options, args, context, info);
    },
    after: async function (values, args, context, info) {
      //build: handleResult
      values = await Promise.resolve(handleResult(values, args, context, info));

      const {
        source,
      } = info;

      var cursor = null;

      if (args.after || args.before) {
        cursor = fromCursor(args.after || args.before);
      }

      let edges = values.map((value, idx) => {
        return resolveEdge(value, idx, cursor, args, source);
      });

      let firstEdge = edges[0];
      let lastEdge = edges[edges.length - 1];
      let fullCount = values[0] && values[0].dataValues.full_count && parseInt(values[0].dataValues.full_count, 10);

      if (!values[0]) {
        fullCount = 0;
      }

      if ((args.first || args.last) && (fullCount === null || fullCount === undefined)) {
        // In case of `OVER()` is not available, we need to get the full count from a second query.
        //build: context.findOptions
        const options = context.findOptions;

        if (target.count) {
          if (target.associationType) {
            fullCount = await target.count(source, options);
          } else {
            fullCount = await target.count(options);
          }
        } else {
          fullCount = await target.manyFromSource.count(source, options);
        }
      }

      let hasNextPage = false;
      let hasPreviousPage = false;
      if (args.first || args.last) {
        const count = parseInt(args.first || args.last, 10);
        let index = cursor ? Number(cursor.index) : null;
        if (index !== null) {
          index++;
        } else {
          index = 0;
        }

        hasNextPage = index + 1 + count <= fullCount;
        hasPreviousPage = index - count >= 0;

        if (args.last) {
          [hasNextPage, hasPreviousPage] = [hasPreviousPage, hasNextPage];
        }
      }

      return after({
        source,
        args,
        ...context.findOptions,//build: context.findOptions
        edges,
        fullCount,//build: fullCount
        pageInfo: {
          startCursor: firstEdge ? firstEdge.cursor : null,
          endCursor: lastEdge ? lastEdge.cursor : null,
          hasNextPage: hasNextPage,
          hasPreviousPage: hasPreviousPage
        }
      });
    }
  });

  let resolver = (source, args, context, info) => {
    var fieldNodes = info.fieldASTs || info.fieldNodes;
    if (simplifyAST(fieldNodes[0], info).fields.edges) {
      return $resolver(source, args, context, info);
    }

    return {
      source,
      args,
      ...buildFindOptions({}, args, context, info)//build: buildFindOptions
    };
  };

  resolver.$association = $resolver.$association;
  resolver.$before = $resolver.$before;
  resolver.$after = $resolver.$after;
  resolver.$options = $resolver.$options;

  return {
    connectionType,
    edgeType,
    nodeType,
    resolveEdge,
    connectionArgs: $connectionArgs,
    resolve: resolver
  };
}
