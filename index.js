var pkg = require('./package.json');
var SCSocket = require('./lib/scsocket');
module.exports.SCSocket = SCSocket;

module.exports.SCEmitter = require('sc-emitter').SCEmitter;

module.exports.connect = function (options) {
  return new SCSocket(options);
};

module.exports.version = pkg.version;
