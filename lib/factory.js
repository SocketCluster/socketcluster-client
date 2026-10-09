const AGClientSocket = require('./clientsocket');
const uuid = require('uuid');
const scErrors = require('sc-errors');
const InvalidArgumentsError = scErrors.InvalidArgumentsError;

// Anchored, otherwise a string which merely contains a hostname:port pair -
// such as 'trusted.com:443@attacker.com:443' - would connect elsewhere.
const validHostRegex = /^(\[[0-9A-Fa-f:.]+\]|[^:/?#@[\]]+):(\d{1,5})$/;

function isValidHost(host) {
  let matches = `${host}`.match(validHostRegex);
  return !!matches && Number(matches[2]) <= 65535;
}

function isUrlSecure() {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}

function getPort(options, isSecureDefault) {
  let isSecure = options.secure == null ? isSecureDefault : options.secure;
  return options.port || (typeof location !== 'undefined' && location.port ? location.port : isSecure ? 443 : 80);
}

function create(options) {
  options = options || {};

  if (options.host && !isValidHost(options.host)) {
    throw new InvalidArgumentsError(
      'The host option should include both' +
      ' the hostname and the port number in the hostname:port format' +
      ' and must not contain any other characters'
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
