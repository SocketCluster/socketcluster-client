var SCSocket = require('./scsocket');

var _connections = {};

function getMultiplexId(isSecure, hostname, port, path) {
  var protocolPrefix = isSecure ? 'https://' : 'http://';
  return protocolPrefix + hostname + ':' + port + path;
}

function connect(options) {
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
  var multiplexId = getMultiplexId(isSecure, opts.hostname, opts.port, opts.path);
  if (opts.multiplex === false) {
    return new SCSocket(opts);
  }
  if (!_connections[multiplexId]) {
    _connections[multiplexId] = new SCSocket(opts);
  }
  return _connections[multiplexId];
}

function destroy(options) {
  var self = this;
  options = options || {};
  var isSecure = global.location && location.protocol == 'https:';
  var opts = {
    port: options.port || global.location && location.port ? location.port : isSecure ? 443 : 80,
    hostname: global.location && location.hostname,
    path: '/socketcluster/'
  };
  for (var i in options) {
    if (options.hasOwnProperty(i)) {
      opts[i] = options[i];
    }
  }
  var multiplexId = getMultiplexId(isSecure, opts.hostname, opts.port, opts.path);
  delete _connections[multiplexId];
}

module.exports = {
  connect: connect,
  destroy: destroy
};
