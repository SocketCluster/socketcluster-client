var SCSocket = require('./lib/scsocket');
var SCSocketCreator = require('./lib/scsocketCreator');

module.exports.SCSocketCreator = SCSocketCreator;
module.exports.SCSocket = SCSocket;

module.exports.SCEmitter = require('sc-emitter').SCEmitter;

module.exports.connect = function (options) {
  return SCSocketCreator(options);
};

module.exports.version = '3.2.0';
