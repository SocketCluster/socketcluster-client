var ClusterSocket = require('./clustersocket');
module.exports.ClusterSocket = ClusterSocket;
module.exports.JSON = ClusterSocket.JSON;

module.exports.Emitter = require('emitter');

module.exports.connect = function (options) {
	return new ClusterSocket(options);
};