var SCSocket = require('./lib/scsocket');
var SCSocketCreator = require('./lib/scsocketcreator');

module.exports.SCSocketCreator = SCSocketCreator;
module.exports.SCSocket = SCSocket;

module.exports.Emitter = require('component-emitter');

module.exports.create = function (options) {
  return SCSocketCreator.create(options);
};

module.exports.connect = module.exports.create;

module.exports.destroy = function (options) {
  return SCSocketCreator.destroy(options);
};

module.exports.clients = SCSocketCreator.clients;

module.exports.version = '10.1.1';
