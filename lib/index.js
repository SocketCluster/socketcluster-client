module.exports.parser = require('engine.io-parser');

var ClusterSocket = require('./clustersocket');
module.exports.ClusterSocket = ClusterSocket;
module.exports.JSON = ClusterSocket.JSON;

module.exports.Transport = require('./transport');
module.exports.Emitter = require('./emitter');
module.exports.transports = require('./transports');
module.exports.util = require('./util');
module.exports.parser = require('engine.io-parser');

module.exports.connect = function (options) {
	return new ClusterSocket(options);
};