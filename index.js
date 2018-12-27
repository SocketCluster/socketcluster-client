const ASClientSocket = require('./lib/asclientsocket');
const factory = require('./lib/factory');
const version = '1.0.1';

module.exports.factory = factory;
module.exports.ASClientSocket = ASClientSocket;

module.exports.create = function (options) {
  return factory.create({...options, version});
};

module.exports.version = version;
