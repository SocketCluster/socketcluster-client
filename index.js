const AGClientSocket = require('./lib/clientsocket');
const factory = require('./lib/factory');
const version = '19.2.5';

module.exports.factory = factory;
module.exports.AGClientSocket = AGClientSocket;

module.exports.create = function (options) {
  return factory.create({...options, version});
};

module.exports.version = version;
