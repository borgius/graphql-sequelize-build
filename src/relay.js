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

const assignWithArrayCustomizer = (a, b) => Array.isArray(a) ? a.concat(b) : b;
const assignWithArray = (...sources) => _.assignWith(...sources, assignWithArrayCustomizer);

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
  const argsToWhereWithIncludeAssociations = (args) => {
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
  const buildFindOptions = (options = {}, args, context, info) => {
    const modelName = model.options.name.singular || model.name;

    if (!Array.isArray(options.attributes)) options.attributes = [];

    if (args.first || args.last) {
      options.limit = parseInt(args.first || args.last, 10);
    }

    //build: orderBy with associations

    if (!Array.isArray(args.orderBy)) args.orderBy = [];

    if (!args.orderBy.length) args.orderBy.push([model.primaryKeyAttribute, 'ASC']);

    assignWithArray(options, args.orderBy.reduce((result, orderBy) => {
      if (!Array.isArray(orderBy)) throw Error(`ORDER_BY`);
      if (!orderBy.length) throw Error(`ORDER_BY`);

      let orderAttribute;
      let orderDirection;
      let orderAssociationsOrJson;

      const last = orderBy[orderBy.length - 1];

      if (typeof last == 'boolean' || ['ASC', 'DESC'].includes(last.toUpperCase())) {
        orderAttribute = orderBy[orderBy.length - 2];
        orderDirection = typeof last == 'boolean' ? (last ? 'ASC' : 'DESC') : last.toUpperCase();
        orderAssociationsOrJson = orderBy.slice(0, -2);
      } else {
        orderAttribute = last;
        orderDirection = 'ASC';
        orderAssociationsOrJson = orderBy.slice(0, -1);
      }

      if (!orderAttribute) throw Error(`ORDER_BY`);
      if (!orderDirection) throw Error(`ORDER_BY`);

      if (args.last) orderDirection = orderDirection === 'ASC' ? 'DESC' : 'ASC';

      //const order = [orderAttribute, orderDirection];
      const order = [], include = [];
      let source = model;

      for (const [key, value] of orderAssociationsOrJson.entries()) {
        const association = source && Object.values(source.associations).find(association => association.as == value);//todo: if !as

        if (association) {
          source = association.target;

          order.push({model: association.target, as: association.as});

          let associationInclude = include;

          for (let i = key; i--;) {
              associationInclude = include[0].include;
          }

          associationInclude.push({association, include: []});
        } else {
          if (source) {
            if (!(value in source.attributes)) throw Error(`ORDER_BY`);

            source = null;
          }

          order.push(value);
        }
      }

      const orderAttributeContainsMatch = orderAttribute.match(/^(\w+)\s*(@>|<@)\s*\[([\w\s,]+)\]$/);

      if (orderAttributeContainsMatch) {
        const orderAttributeContainsName = orderAttributeContainsMatch[1];
        const orderAttributeContainsOperator = orderAttributeContainsMatch[2];
        const orderAttributeContainsValues = orderAttributeContainsMatch[3].split(/,\s*/).map(i => `'${i}'`).join(',');

        orderAttribute =
          `"${orderAttributeContainsName}"${orderAttributeContainsOperator}ARRAY[${orderAttributeContainsValues}]::varchar[]`;

        if (order.every(i => typeof i == 'string')) orderAttribute = `"${modelName}".${orderAttribute}`;

        orderAttribute = model.sequelize.literal(orderAttribute);
      }

      const orderAttributeJsonFields = order.filter(i => typeof i == 'string');

      order.push(orderAttribute);

      if (orderAttributeJsonFields.length) {
        orderAttributeJsonFields.push(orderAttribute);

        const orderAttributeJsonName = orderAttributeJsonFields[0];
        const orderAttributeJsonValues = orderAttributeJsonFields.slice(1).join(',');

        orderAttribute = `"${orderAttributeJsonName}"#>>'{${orderAttributeJsonValues}}'`;//todo: fix sequelize.json

        if (orderAttributeJsonFields.length == order.length) orderAttribute = `"${modelName}".${orderAttribute}`;

        orderAttribute = model.sequelize.literal(orderAttribute);

        order.splice(- orderAttributeJsonFields.length, orderAttributeJsonFields.length, orderAttribute);
      }

      order.push(orderDirection);

      return assignWithArray(result, {order: [order], include});
    }, {order: [], include: []}));

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
    assignWithArray(options, argsToWhereWithIncludeAssociations(args));
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
