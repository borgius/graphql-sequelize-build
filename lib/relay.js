'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.sequelizeConnection = exports.NodeTypeMapper = undefined;

var _bluebird = require('bluebird');

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

exports.idFetcher = idFetcher;
exports.typeResolver = typeResolver;
exports.isConnection = isConnection;
exports.handleConnection = handleConnection;
exports.sequelizeNodeInterface = sequelizeNodeInterface;
exports.nodeAST = nodeAST;
exports.nodeType = nodeType;

var _graphqlRelay = require('graphql-relay');

var _graphql = require('graphql');

var _base = require('./base64.js');

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _simplifyAST = require('./simplifyAST');

var _simplifyAST2 = _interopRequireDefault(_simplifyAST);

var _resolver = require('./resolver.js');

var _resolver2 = _interopRequireDefault(_resolver);

var _jsonType = require('./types/jsonType.js');

var _jsonType2 = _interopRequireDefault(_jsonType);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

class NodeTypeMapper {
  constructor() {
    this.map = {};
  }

  mapTypes(types) {
    Object.keys(types).forEach(k => {
      let v = types[k];
      this.map[k] = v.type ? v : { type: v };
    });
  }

  item(type) {
    return this.map[type];
  }
}

exports.NodeTypeMapper = NodeTypeMapper;
function idFetcher(sequelize, nodeTypeMapper) {
  return (() => {
    var _ref = (0, _bluebird.coroutine)(function* (globalId, context) {
      var _fromGlobalId = (0, _graphqlRelay.fromGlobalId)(globalId);

      const type = _fromGlobalId.type,
            id = _fromGlobalId.id;


      const nodeType = nodeTypeMapper.item(type);
      if (nodeType && typeof nodeType.resolve === 'function') {
        const res = yield Promise.resolve(nodeType.resolve(globalId, context));
        if (res) res.__graphqlType__ = type;
        return res;
      }

      const model = Object.keys(sequelize.models).find(function (model) {
        return model === type;
      });
      return model ? sequelize.models[model].findById(id) : nodeType ? nodeType.type : null;
    });

    return function (_x, _x2) {
      return _ref.apply(this, arguments);
    };
  })();
}

function typeResolver(nodeTypeMapper) {
  return obj => {
    var type = obj.__graphqlType__ || (obj.Model ? obj.Model.options.name.singular : obj.name);

    if (!type) {
      throw new Error(`Unable to determine type of ${ typeof obj }. ` + `Either specify a resolve function in 'NodeTypeMapper' object, or specify '__graphqlType__' property on object.`);
    }

    const nodeType = nodeTypeMapper.item(type);
    return nodeType && nodeType.type || null;
  };
}

function isConnection(type) {
  return typeof type.name !== 'undefined' && type.name.endsWith('Connection');
}

function handleConnection(values, args) {
  return (0, _graphqlRelay.connectionFromArray)(values, args);
}

function sequelizeNodeInterface(sequelize) {
  let nodeTypeMapper = new NodeTypeMapper();
  const nodeObjects = (0, _graphqlRelay.nodeDefinitions)(idFetcher(sequelize, nodeTypeMapper), typeResolver(nodeTypeMapper));

  return _extends({
    nodeTypeMapper: nodeTypeMapper
  }, nodeObjects);
}

function nodeAST(connectionAST) {
  return connectionAST.fields.edges && connectionAST.fields.edges.fields.node;
}

function nodeType(connectionType) {
  return connectionType._fields.edges.type.ofType._fields.node.type;
}

const assignWithArrayCustomizer = (a, b) => Array.isArray(a) ? a.concat(b) : b;
const assignWithArray = function assignWithArray() {
  for (var _len = arguments.length, sources = Array(_len), _key = 0; _key < _len; _key++) {
    sources[_key] = arguments[_key];
  }

  return _lodash2.default.assignWith.apply(_lodash2.default, sources.concat([assignWithArrayCustomizer]));
};

function sequelizeConnection(_ref2) {
  let name = _ref2.name,
      nodeType = _ref2.nodeType,
      target = _ref2.target,
      orderByType = _ref2.orderBy,
      _before = _ref2.before,
      handleResult = _ref2.handleResult,
      _after = _ref2.after,
      connectionFields = _ref2.connectionFields,
      edgeFields = _ref2.edgeFields,
      where = _ref2.where;

  var _connectionDefinition = (0, _graphqlRelay.connectionDefinitions)({
    name: name,
    nodeType: nodeType,
    connectionFields: connectionFields,
    edgeFields: edgeFields
  });

  const edgeType = _connectionDefinition.edgeType,
        connectionType = _connectionDefinition.connectionType;


  const model = target.target ? target.target : target;
  const SEPERATOR = '$';
  const PREFIX = 'arrayconnection' + SEPERATOR;

  //build: orderByType
  if (orderByType === undefined) {
    orderByType = _jsonType2.default;
  }

  _before = _before || (options => options);
  _after = _after || (result => result);
  handleResult = handleResult || (result => result);

  let $connectionArgs = _extends({}, _graphqlRelay.connectionArgs, {
    orderBy: {
      type: orderByType //build: orderByType
    }
  });

  let orderByAttribute = function orderByAttribute(orderAttr, _ref3) {
    let source = _ref3.source,
        args = _ref3.args,
        context = _ref3.context,
        info = _ref3.info;

    return typeof orderAttr === 'function' ? orderAttr(source, args, context, info) : orderAttr;
  };

  let orderByDirection = function orderByDirection(orderDirection, args) {
    if (args.last) {
      return orderDirection.indexOf('ASC') >= 0 ? orderDirection.replace('ASC', 'DESC') : orderDirection.replace('DESC', 'ASC');
    }
    return orderDirection;
  };

  /**
   * Creates a cursor given a item returned from the Database
   * @param  {Object}   item   sequelize model instance
   * @param  {Integer}  index  the index of this item within the results, 0 indexed
   * @return {String}          The Base64 encoded cursor string
   */
  let toCursor = function toCursor(item, index) {
    let id = item.get(model.primaryKeyAttribute);
    return (0, _base.base64)(PREFIX + id + SEPERATOR + index);
  };

  /**
   * Decode a cursor into its component parts
   * @param  {String} cursor Base64 encoded cursor
   * @return {Object}        Object containing ID and index
   */
  let fromCursor = function fromCursor(cursor) {
    cursor = (0, _base.unbase64)(cursor);
    cursor = cursor.substring(PREFIX.length, cursor.length);

    var _cursor$split = cursor.split(SEPERATOR),
        _cursor$split2 = _slicedToArray(_cursor$split, 2);

    let id = _cursor$split2[0],
        index = _cursor$split2[1];


    return {
      id: id,
      index: index
    };
  };

  let argsToWhere = function argsToWhere(args) {
    let result = {};

    _lodash2.default.each(args, (value, key) => {
      if (key in $connectionArgs) return;
      _lodash2.default.assign(result, where(key, value, result));
    });

    return result;
  };

  //build: argsToWhereWithIncludeAssociations
  const argsToWhereWithIncludeAssociations = args => {
    const result = {
      where: {},
      include: []
    };

    _lodash2.default.each(args, (value, key) => {
      if (key in $connectionArgs) return;
      const res = where(key, value, result);

      if (Array.isArray(res)) {
        var _result$include;

        _lodash2.default.mergeWith(result.where, res[0], (a, b) => Array.isArray(a) ? a.concat(b) : undefined);
        if (Array.isArray(res[1])) (_result$include = result.include).push.apply(_result$include, _toConsumableArray(res[1]));
      } else {
        _lodash2.default.assign(result.where, res);
      }
    });

    return result;
  };

  let resolveEdge = function resolveEdge(item, index, queriedCursor) {
    let args = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};
    let source = arguments[4];

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
  const buildFindOptions = function buildFindOptions() {
    let options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    let args = arguments[1];
    let context = arguments[2];
    let info = arguments[3];

    const modelName = model.options.name.singular || model.name;

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
        orderDirection = typeof last == 'boolean' ? last ? 'ASC' : 'DESC' : last.toUpperCase();
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
      const order = [],
            include = [];
      let source = model;

      for (const _ref4 of orderAssociationsOrJson.entries()) {
        var _ref5 = _slicedToArray(_ref4, 2);

        const key = _ref5[0];
        const value = _ref5[1];

        const association = source && Object.values(source.associations).find(association => association.as == value); //todo: if !as

        if (association) {
          source = association.target;

          order.push({ model: association.target, as: association.as });

          let associationInclude = include;

          for (let i = key; i--;) {
            associationInclude = include[0].include;
          }

          associationInclude.push({ association: association, include: [] });
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
        const orderAttributeContainsValues = orderAttributeContainsMatch[3].split(/,\s*/).map(i => `'${ i }'`).join(',');

        orderAttribute = `"${ orderAttributeContainsName }"${ orderAttributeContainsOperator }ARRAY[${ orderAttributeContainsValues }]::varchar[]`;

        if (order.every(i => typeof i == 'string')) orderAttribute = `"${ modelName }".${ orderAttribute }`;

        orderAttribute = model.sequelize.literal(orderAttribute);
      }

      const orderAttributeJsonFields = order.filter(i => typeof i == 'string');

      order.push(orderAttribute);

      if (orderAttributeJsonFields.length) {
        orderAttributeJsonFields.push(orderAttribute);

        const orderAttributeJsonName = orderAttributeJsonFields[0];
        const orderAttributeJsonValues = orderAttributeJsonFields.slice(1).join(',');

        orderAttribute = `"${ orderAttributeJsonName }"#>>'{${ orderAttributeJsonValues }}'`; //todo: fix sequelize.json

        if (orderAttributeJsonFields.length == order.length) orderAttribute = `"${ modelName }".${ orderAttribute }`;

        orderAttribute = model.sequelize.literal(orderAttribute);

        order.splice(-orderAttributeJsonFields.length, orderAttributeJsonFields.length, orderAttribute);
      }

      order.push(orderDirection);

      return assignWithArray(result, { order: [order], include: include });
    }, { order: [], include: [] }));

    if (options.limit && !options.attributes.some(attribute => attribute.length === 2 && attribute[1] === 'full_count')) {
      if (model.sequelize.dialect.name === 'postgres') {
        options.attributes.push([model.sequelize.literal('COUNT(*) OVER()'), 'full_count']);
      } else if (model.sequelize.dialect.name === 'mssql') {
        options.attributes.push([model.sequelize.literal('COUNT(1) OVER()'), 'full_count']);
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
    options.attributes = _lodash2.default.uniq(options.attributes);

    return options;
  };

  //build: resolverFactory
  let $resolver = (0, _resolver2.default)(target, {
    handleConnection: false,
    include: true,
    list: true,
    before: function before(options, args, context, info) {
      options = buildFindOptions(options, args, context, info);

      return _before(options, args, context, info);
    },
    after: (() => {
      var _ref6 = (0, _bluebird.coroutine)(function* (values, args, context, info) {
        //build: handleResult
        values = yield Promise.resolve(handleResult(values, args, context, info));

        const source = info.source;


        var cursor = null;

        if (args.after || args.before) {
          cursor = fromCursor(args.after || args.before);
        }

        let edges = values.map(function (value, idx) {
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
              fullCount = yield target.count(source, options);
            } else {
              fullCount = yield target.count(options);
            }
          } else {
            fullCount = yield target.manyFromSource.count(source, options);
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
            var _ref7 = [hasPreviousPage, hasNextPage];
            hasNextPage = _ref7[0];
            hasPreviousPage = _ref7[1];
          }
        }

        return _after(_extends({
          source: source,
          args: args
        }, context.findOptions, { //build: context.findOptions
          edges: edges,
          fullCount: fullCount, //build: fullCount
          pageInfo: {
            startCursor: firstEdge ? firstEdge.cursor : null,
            endCursor: lastEdge ? lastEdge.cursor : null,
            hasNextPage: hasNextPage,
            hasPreviousPage: hasPreviousPage
          }
        }));
      });

      function after(_x5, _x6, _x7, _x8) {
        return _ref6.apply(this, arguments);
      }

      return after;
    })()
  });

  let resolver = (source, args, context, info) => {
    var fieldNodes = info.fieldASTs || info.fieldNodes;
    if ((0, _simplifyAST2.default)(fieldNodes[0], info).fields.edges) {
      return $resolver(source, args, context, info);
    }

    return _extends({
      source: source,
      args: args
    }, buildFindOptions({}, args, context, info));
  };

  resolver.$association = $resolver.$association;
  resolver.$before = $resolver.$before;
  resolver.$after = $resolver.$after;
  resolver.$options = $resolver.$options;

  return {
    connectionType: connectionType,
    edgeType: edgeType,
    nodeType: nodeType,
    resolveEdge: resolveEdge,
    connectionArgs: $connectionArgs,
    resolve: resolver
  };
}
exports.sequelizeConnection = sequelizeConnection;