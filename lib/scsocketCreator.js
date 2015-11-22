var SCSocket = require('./scsocket');

var _connections = {};
module.exports = function (options) {
  var self = this;
  options = options || {};
  var isSecure = global.location && location.protocol == 'https:';
  var opts = {
    port: options.port || global.location && location.port ? location.port : isSecure ? 443 : 80,
    autoReconnect: true,
    autoProcessSubscriptions: true,
    ackTimeout: 10000,
    hostname: global.location && location.hostname,
    path: '/socketcluster/',
    secure: isSecure,
    timestampRequests: false,
    timestampParam: 't',
    authEngine: null,
    authTokenName: 'socketCluster.authToken',
    binaryType: 'arraybuffer',
    multiplex: true

  };
  for (var i in options) {
    if (options.hasOwnProperty(i)) {
      opts[i] = options[i];
    }
  }
  var multiplexId = opts.hostname + ':' + opts.port + opts.path;
  if (opts.multiplex === false) {
    return new SCSocket(opts);
  }
  if (!_connections[multiplexId]) {
    _connections[multiplexId] = new SCSocket(opts);
  }
  return _connections[multiplexId];
}
