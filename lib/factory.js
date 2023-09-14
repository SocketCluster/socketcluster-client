const AGClientSocket = require('./clientsocket');
const uuid = require('uuid');
const scErrors = require('sc-errors');
const InvalidArgumentsError = scErrors.InvalidArgumentsError;

function isUrlSecure() {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}

function getPort(options, isSecureDefault) {
  let isSecure = options.secure == null ? isSecureDefault : options.secure;
  return options.port || (typeof location !== 'undefined' && location.port ? location.port : isSecure ? 443 : 80);
}

function create(options) {
  options = options || {};

  if (options.host && !options.host.match(/[^:]+:\d{2,5}/)) {
    throw new InvalidArgumentsError(
      'The host option should include both' +
      ' the hostname and the port number in the hostname:port format'
    );
  }

  if (options.host && options.hostname) {
    throw new InvalidArgumentsError(
      'The host option should already include' +
      ' the hostname and the port number in the hostname:port format' +
      ' - Because of this, you should never use host and hostname options together'
    );
  }

  if (options.host && options.port) {
    throw new InvalidArgumentsError(
      'The host option should already include' +
      ' the hostname and the port number in the hostname:port format' +
      ' - Because of this, you should never use host and port options together'
    );
  }

  let isSecureDefault = isUrlSecure();

  let opts = {
    clientId: uuid.v4(),
    port: getPort(options, isSecureDefault),
    hostname: typeof location !== 'undefined' && location.hostname || 'localhost',
    secure: isSecureDefault
  };

  Object.assign(opts, options);

  return new AGClientSocket(opts);
}

module.exports = {
  create
};
