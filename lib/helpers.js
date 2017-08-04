'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.assignWithArray = undefined;

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const assignWithArrayCustomizer = (a, b) => Array.isArray(a) ? a.concat(b) : b;

const assignWithArray = exports.assignWithArray = (...sources) => _lodash2.default.assignWith(...sources, assignWithArrayCustomizer);