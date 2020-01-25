const AGRequest = require('ag-request');
const querystring = require('querystring');

let WebSocket;
let createWebSocket;

if (global.WebSocket) {
  WebSocket = global.WebSocket;
  createWebSocket = function (uri, options) {
    return new WebSocket(uri);
  };
} else {
  WebSocket = require('ws');
  createWebSocket = function (uri, options) {
    return new WebSocket(uri, null, options);
  };
}

const scErrors = require('sc-errors');
const TimeoutError = scErrors.TimeoutError;
const BadConnectionError = scErrors.BadConnectionError;

function AGTransport(authEngine, codecEngine, options, wsOptions, handlers) {
  this.state = this.CLOSED;
  this.auth = authEngine;
  this.codec = codecEngine;
  this.options = options;
  this.wsOptions = wsOptions;
  this.protocolVersion = options.protocolVersion;
  this.connectTimeout = options.connectTimeout;
  this.pingTimeout = options.pingTimeout;
  this.pingTimeoutDisabled = !!options.pingTimeoutDisabled;
  this.callIdGenerator = options.callIdGenerator;
  this.authTokenName = options.authTokenName;
  this.isBufferingBatch = false;

  this._pingTimeoutTicker = null;
  this._callbackMap = {};
  this._batchBuffer = [];

  if (!handlers) {
    handlers = {};
  }

  this._onOpenHandler = handlers.onOpen || function () {};
  this._onOpenAbortHandler = handlers.onOpenAbort || function () {};
  this._onCloseHandler = handlers.onClose || function () {};
  this._onEventHandler = handlers.onEvent || function () {};
  this._onErrorHandler = handlers.onError || function () {};
  this._onInboundInvokeHandler  = handlers.onInboundInvoke || function () {};
  this._onInboundTransmitHandler = handlers.onInboundTransmit || function () {};

  // Open the connection.

  this.state = this.CONNECTING;
  let uri = this.uri();

  let wsSocket = createWebSocket(uri, wsOptions);
  wsSocket.binaryType = this.options.binaryType;

  this.socket = wsSocket;

  wsSocket.onopen = () => {
    this._onOpen();
  };

  wsSocket.onclose = async (event) => {
    let code;
    if (event.code == null) {
      // This is to handle an edge case in React Native whereby
      // event.code is undefined when the mobile device is locked.
      // TODO: This is not ideal since this condition could also apply to
      // an abnormal close (no close control frame) which would be a 1006.
      code = 1005;
    } else {
      code = event.code;
    }
    this._destroy(code, event.reason);
  };

  wsSocket.onmessage = (message, flags) => {
    this._onMessage(message.data);
  };

  wsSocket.onerror = (error) => {
    // The onclose event will be called automatically after the onerror event
    // if the socket is connected - Otherwise, if it's in the middle of
    // connecting, we want to close it manually with a 1006 - This is necessary
    // to prevent inconsistent behavior when running the client in Node.js
    // vs in a browser.
    if (this.state === this.CONNECTING) {
      this._destroy(1006);
    }
  };

  this._connectTimeoutRef = setTimeout(() => {
    this._destroy(4007);
    this.socket.close(4007);
  }, this.connectTimeout);

  if (this.protocolVersion === 1) {
    this._handlePing = (message) => {
      if (message === '#1') {
        this._resetPingTimeout();
        if (this.socket.readyState === this.socket.OPEN) {
          this.send('#2');
        }
        return true;
      }
      return false;
    };
  } else {
    this._handlePing = (message) => {
      if (message === '') {
        this._resetPingTimeout();
        if (this.socket.readyState === this.socket.OPEN) {
          this.send('');
        }
        return true;
      }
      return false;
    };
  }
}

AGTransport.CONNECTING = AGTransport.prototype.CONNECTING = 'connecting';
AGTransport.OPEN = AGTransport.prototype.OPEN = 'open';
AGTransport.CLOSED = AGTransport.prototype.CLOSED = 'closed';

AGTransport.prototype.uri = function () {
  let query = this.options.query || {};
  let scheme;
  if (this.options.protocolScheme == null) {
    scheme = this.options.secure ? 'wss' : 'ws';
  } else {
    scheme = this.options.protocolScheme;
  }

  if (this.options.timestampRequests) {
    query[this.options.timestampParam] = (new Date()).getTime();
  }

  query = querystring.encode(query);

  if (query.length) {
    query = '?' + query;
  }

  let host;
  let path;
  if (this.options.socketPath == null) {
    if (this.options.host) {
      host = this.options.host;
    } else {
      let port = '';

      if (this.options.port && ((scheme === 'wss' && this.options.port !== 443)
        || (scheme === 'ws' && this.options.port !== 80))) {
        port = ':' + this.options.port;
      }
      host = this.options.hostname + port;
    }
    path = this.options.path;
  } else {
    host = this.options.socketPath;
    path = `:${this.options.path}`;
  }
  return scheme + '://' + host + path + query;
};

AGTransport.prototype._onOpen = async function () {
  clearTimeout(this._connectTimeoutRef);
  this._resetPingTimeout();

  let status;

  try {
    status = await this._handshake();
  } catch (err) {
    if (err.statusCode == null) {
      err.statusCode = 4003;
    }
    this._onError(err);
    this._destroy(err.statusCode, err.toString());
    this.socket.close(err.statusCode);
    return;
  }

  this.state = this.OPEN;
  if (status) {
    this.pingTimeout = status.pingTimeout;
  }
  this._resetPingTimeout();
  this._onOpenHandler(status);
};

AGTransport.prototype._handshake = async function () {
  let token = await this.auth.loadToken(this.authTokenName);
  // Don't wait for this.state to be 'open'.
  // The underlying WebSocket (this.socket) is already open.
  let options = {
    force: true
  };
  let status = await this.invoke('#handshake', {authToken: token}, options);
  if (status) {
    // Add the token which was used as part of authentication attempt
    // to the status object.
    status.authToken = token;
    if (status.authError) {
      status.authError = scErrors.hydrateError(status.authError);
    }
  }
  return status;
};

AGTransport.prototype._abortAllPendingEventsDueToBadConnection = function (failureType) {
  Object.keys(this._callbackMap || {}).forEach((i) => {
    let eventObject = this._callbackMap[i];
    delete this._callbackMap[i];

    clearTimeout(eventObject.timeout);
    delete eventObject.timeout;

    let errorMessage = `Event "${eventObject.event}" was aborted due to a bad connection`;
    let badConnectionError = new BadConnectionError(errorMessage, failureType);

    let callback = eventObject.callback;
    delete eventObject.callback;

    callback.call(eventObject, badConnectionError, eventObject);
  });
};

AGTransport.prototype._destroy = function (code, reason) {
  let protocolReason = scErrors.socketProtocolErrorStatuses[code];
  if (!reason && scErrors.socketProtocolErrorStatuses[code]) {
    reason = scErrors.socketProtocolErrorStatuses[code];
  }
  delete this.socket.onopen;
  delete this.socket.onclose;
  delete this.socket.onmessage;
  delete this.socket.onerror;

  clearTimeout(this._connectTimeoutRef);
  clearTimeout(this._pingTimeoutTicker);

  if (this.state === this.OPEN) {
    this.state = this.CLOSED;
    this._abortAllPendingEventsDueToBadConnection('disconnect');
    this._onCloseHandler({code, reason});
  } else if (this.state === this.CONNECTING) {
    this.state = this.CLOSED;
    this._abortAllPendingEventsDueToBadConnection('connectAbort');
    this._onOpenAbortHandler({code, reason});
  } else if (this.state === this.CLOSED) {
    this._abortAllPendingEventsDueToBadConnection('connectAbort');
  }
};

AGTransport.prototype._processInboundPacket = function (packet, message) {
  if (packet && packet.event != null) {
    if (packet.cid == null) {
      this._onInboundTransmitHandler({...packet});
    } else {
      let request = new AGRequest(this, packet.cid, packet.event, packet.data);
      this._onInboundInvokeHandler(request);
    }
  } else if (packet && packet.rid != null) {
    let eventObject = this._callbackMap[packet.rid];
    if (eventObject) {
      clearTimeout(eventObject.timeout);
      delete eventObject.timeout;
      delete this._callbackMap[packet.rid];

      if (eventObject.callback) {
        let rehydratedError = scErrors.hydrateError(packet.error);
        eventObject.callback(rehydratedError, packet.data);
      }
    }
  } else {
    this._onEventHandler({event: 'raw', data: {message}});
  }
};

AGTransport.prototype._onMessage = function (message) {
  this._onEventHandler({event: 'message', data: {message}});

  if (this._handlePing(message)) {
    return;
  }

  let packet = this.decode(message);

  if (Array.isArray(packet)) {
    let len = packet.length;
    for (let i = 0; i < len; i++) {
      this._processInboundPacket(packet[i], message);
    }
  } else {
    this._processInboundPacket(packet, message);
  }
};

AGTransport.prototype._onError = function (error) {
  this._onErrorHandler({error});
};

AGTransport.prototype._resetPingTimeout = function () {
  if (this.pingTimeoutDisabled) {
    return;
  }

  let now = (new Date()).getTime();
  clearTimeout(this._pingTimeoutTicker);
  this._pingTimeoutTicker = setTimeout(() => {
    this._destroy(4000);
    this.socket.close(4000);
  }, this.pingTimeout);
};

AGTransport.prototype.clearAllListeners = function () {
  this._onOpenHandler = function () {};
  this._onOpenAbortHandler = function () {};
  this._onCloseHandler = function () {};
  this._onEventHandler = function () {};
  this._onErrorHandler = function () {};
  this._onInboundInvokeHandler  = function () {};
  this._onInboundTransmitHandler = function () {};
};

AGTransport.prototype.startBatch = function () {
  this.isBufferingBatch = true;
  this._batchBuffer = [];
};

AGTransport.prototype.flushBatch = function () {
  this.isBufferingBatch = false;
  if (!this._batchBuffer.length) {
    return;
  }
  let serializedBatch = this.serializeObject(this._batchBuffer);
  this._batchBuffer = [];
  this.send(serializedBatch);
};

AGTransport.prototype.cancelBatch = function () {
  this.isBufferingBatch = false;
  this._batchBuffer = [];
};

AGTransport.prototype.getBytesReceived = function () {
  return this.socket.bytesReceived;
};

AGTransport.prototype.close = function (code, reason) {
  if (this.state === this.OPEN || this.state === this.CONNECTING) {
    code = code || 1000;
    this._destroy(code, reason);
    this.socket.close(code, reason);
  }
};

AGTransport.prototype.transmitObject = function (eventObject) {
  let simpleEventObject = {
    event: eventObject.event,
    data: eventObject.data
  };

  if (eventObject.callback) {
    simpleEventObject.cid = eventObject.cid = this.callIdGenerator();
    this._callbackMap[eventObject.cid] = eventObject;
  }

  this.sendObject(simpleEventObject);

  return eventObject.cid || null;
};

AGTransport.prototype._handleEventAckTimeout = function (eventObject) {
  if (eventObject.cid) {
    delete this._callbackMap[eventObject.cid];
  }
  delete eventObject.timeout;

  let callback = eventObject.callback;
  if (callback) {
    delete eventObject.callback;
    let error = new TimeoutError(`Event response for "${eventObject.event}" timed out`);
    callback.call(eventObject, error, eventObject);
  }
};

AGTransport.prototype.transmit = function (event, data, options) {
  let eventObject = {
    event,
    data
  };

  if (this.state === this.OPEN || options.force) {
    this.transmitObject(eventObject);
  }
  return Promise.resolve();
};

AGTransport.prototype.invokeRaw = function (event, data, options, callback) {
  let eventObject = {
    event,
    data,
    callback
  };

  if (!options.noTimeout) {
    eventObject.timeout = setTimeout(() => {
      this._handleEventAckTimeout(eventObject);
    }, this.options.ackTimeout);
  }
  let cid = null;
  if (this.state === this.OPEN || options.force) {
    cid = this.transmitObject(eventObject);
  }
  return cid;
};

AGTransport.prototype.invoke = function (event, data, options) {
  return new Promise((resolve, reject) => {
    this.invokeRaw(event, data, options, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
};

AGTransport.prototype.cancelPendingResponse = function (cid) {
  delete this._callbackMap[cid];
};

AGTransport.prototype.decode = function (message) {
  return this.codec.decode(message);
};

AGTransport.prototype.encode = function (object) {
  return this.codec.encode(object);
};

AGTransport.prototype.send = function (data) {
  if (this.socket.readyState !== this.socket.OPEN) {
    this._destroy(1005);
  } else {
    this.socket.send(data);
  }
};

AGTransport.prototype.serializeObject = function (object) {
  let str;
  try {
    str = this.encode(object);
  } catch (error) {
    this._onError(error);
    return null;
  }
  return str;
};

AGTransport.prototype.sendObject = function (object) {
  if (this.isBufferingBatch) {
    this._batchBuffer.push(object);
    return;
  }
  let str = this.serializeObject(object);
  if (str != null) {
    this.send(str);
  }
};

module.exports = AGTransport;
