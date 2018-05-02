var SCClient = require('./lib/scclient');
var factory = require('./lib/factory');

module.exports.factory = factory;
module.exports.SCClient = SCClient;

module.exports.Emitter = require('component-emitter');

module.exports.create = function (options) {
  return factory.create(options);
};

module.exports.connect = module.exports.create;

module.exports.destroy = function (socket) {
  return factory.destroy(socket);
};

module.exports.clients = factory.clients;

module.exports.version = '12.0.0';
