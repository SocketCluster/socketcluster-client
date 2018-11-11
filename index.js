const SCClientSocket = require('./lib/scclientsocket');
const factory = require('./lib/factory');
const version = '14.2.1';

module.exports.factory = factory;
module.exports.SCClientSocket = SCClientSocket;

module.exports.create = function (options) {
  return factory.create({...options, version});
};

module.exports.version = version;
