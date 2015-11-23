var SCSocket = require('./lib/scsocket');
var SCSocketCreator = require('./lib/scsocketCreator');

module.exports.SCSocketCreator = SCSocketCreator;
module.exports.SCSocket = SCSocket;

module.exports.SCEmitter = require('sc-emitter').SCEmitter;

module.exports.connect = function (options) {
  return SCSocketCreator.connect(options);
};

module.exports.destroy = function (options) {
  return SCSocketCreator.destroy(options);
};

module.exports.version = '3.2.0';
