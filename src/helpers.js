import _ from 'lodash';

const assignWithArrayCustomizer = (a, b) => Array.isArray(a) ? a.concat(b) : b;

export const assignWithArray = (...sources) => _.assignWith(...sources, assignWithArrayCustomizer);
