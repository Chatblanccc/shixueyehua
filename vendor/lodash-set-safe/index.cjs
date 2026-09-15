'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- This package preserves the CommonJS lodash.set API. */

// Keep the standalone package's callable export; never substitute the lodash object.
const set = require('lodash/set');
module.exports = set;
// @cloudbase/database 1.4.3's realtime adapter uses require('lodash.set').default.
module.exports.default = set;
