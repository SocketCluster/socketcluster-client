var SCSocket = require('./lib/scsocket');
var SCSocketCreator = require('./lib/scsocketcreator');

module.exports.SCSocketCreator = SCSocketCreator;
module.exports.SCSocket = SCSocket;

module.exports.Emitter = require('component-emitter');

module.exports.connect = function (options) {
  return SCSocketCreator.connect(options);
};

module.exports.destroy = function (options) {
  return SCSocketCreator.destroy(options);
};

module.exports.connections = SCSocketCreator.connections;

module.exports.version = '9.0.2';
