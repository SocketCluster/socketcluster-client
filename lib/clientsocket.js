const StreamDemux = require('stream-demux');
const AsyncStreamEmitter = require('async-stream-emitter');
const AGChannel = require('ag-channel');
const AuthEngine = require('./auth');
const formatter = require('sc-formatter');
const AGTransport = require('./transport');
const querystring = require('querystring');
const LinkedList = require('linked-list');
const cloneDeep = require('clone-deep');
const Buffer = require('buffer/').Buffer;
const wait = require('./wait');

const scErrors = require('sc-errors');
const InvalidArgumentsError = scErrors.InvalidArgumentsError;
const InvalidMessageError = scErrors.InvalidMessageError;
const InvalidActionError = scErrors.InvalidActionError;
const SocketProtocolError = scErrors.SocketProtocolError;
const TimeoutError = scErrors.TimeoutError;
const BadConnectionError = scErrors.BadConnectionError;

const isBrowser = typeof window !== 'undefined';

function AGClientSocket(socketOptions) {
  AsyncStreamEmitter.call(this);

  let defaultOptions = {
    path: '/socketcluster/',
    secure: false,
    protocolScheme: null,
    socketPath: null,
    autoConnect: true,
    autoReconnect: true,
    autoSubscribeOnConnect: true,
    connectTimeout: 20000,
    ackTimeout: 10000,
    timestampRequests: false,
    timestampParam: 't',
    authTokenName: 'socketcluster.authToken',
    binaryType: 'arraybuffer',
    batchOnHandshake: false,
    batchOnHandshakeDuration: 100,
    batchInterval: 50,
    protocolVersion: 2,
    wsOptions: {},
    cloneData: false
  };
  let opts = Object.assign(defaultOptions, socketOptions);

  this.id = null;
  this.version = opts.version || null;
  this.protocolVersion = opts.protocolVersion;
  this.state = this.CLOSED;
  this.authState = this.UNAUTHENTICATED;
  this.signedAuthToken = null;
  this.authToken = null;
  this.pendingReconnect = false;
  this.pendingReconnectTimeout = null;
  this.preparingPendingSubscriptions = false;
  this.clientId = opts.clientId;
  this.wsOptions = opts.wsOptions;

  this.connectTimeout = opts.connectTimeout;
  this.ackTimeout = opts.ackTimeout;
  this.channelPrefix = opts.channelPrefix || null;
  this.disconnectOnUnload = opts.disconnectOnUnload == null ? true : opts.disconnectOnUnload;
  this.authTokenName = opts.authTokenName;

  // pingTimeout will be connectTimeout at the start, but it will
  // be updated with values provided by the 'connect' event
  opts.pingTimeout = opts.connectTimeout;
  this.pingTimeout = opts.pingTimeout;
  this.pingTimeoutDisabled = !!opts.pingTimeoutDisabled;

  let maxTimeout = Math.pow(2, 31) - 1;

  let verifyDuration = (propertyName) => {
    if (this[propertyName] > maxTimeout) {
      throw new InvalidArgumentsError(
        `The ${propertyName} value provided exceeded the maximum amount allowed`
      );
    }
  };

  verifyDuration('connectTimeout');
  verifyDuration('ackTimeout');
  verifyDuration('pingTimeout');

  this.connectAttempts = 0;

  this.isBatching = false;
  this.batchOnHandshake = opts.batchOnHandshake;
  this.batchOnHandshakeDuration = opts.batchOnHandshakeDuration;

  this._batchingIntervalId = null;
  this._outboundBuffer = new LinkedList();
  this._channelMap = {};

  this._channelEventDemux = new StreamDemux();
  this._channelDataDemux = new StreamDemux();

  this._receiverDemux = new StreamDemux();
  this._procedureDemux = new StreamDemux();

  this.options = opts;

  this._cid = 1;

  this.options.callIdGenerator = () => {
    return this._cid++;
  };

  if (this.options.autoReconnect) {
    if (this.options.autoReconnectOptions == null) {
      this.options.autoReconnectOptions = {};
    }

    // Add properties to the this.options.autoReconnectOptions object.
    // We assign the reference to a reconnectOptions variable to avoid repetition.
    let reconnectOptions = this.options.autoReconnectOptions;
    if (reconnectOptions.initialDelay == null) {
      reconnectOptions.initialDelay = 10000;
    }
    if (reconnectOptions.randomness == null) {
      reconnectOptions.randomness = 10000;
    }
    if (reconnectOptions.multiplier == null) {
      reconnectOptions.multiplier = 1.5;
    }
    if (reconnectOptions.maxDelay == null) {
      reconnectOptions.maxDelay = 60000;
    }
  }

  if (this.options.subscriptionRetryOptions == null) {
    this.options.subscriptionRetryOptions = {};
  }

  if (this.options.authEngine) {
    this.auth = this.options.authEngine;
  } else {
    this.auth = new AuthEngine();
  }

  if (this.options.codecEngine) {
    this.codec = this.options.codecEngine;
  } else {
    // Default codec engine
    this.codec = formatter;
  }

  if (this.options.protocol) {
    let protocolOptionError = new InvalidArgumentsError(
      'The "protocol" option does not affect socketcluster-client - ' +
      'If you want to utilize SSL/TLS, use "secure" option instead'
    );
    this._onError(protocolOptionError);
  }

  this.options.query = opts.query || {};
  if (typeof this.options.query === 'string') {
    this.options.query = querystring.parse(this.options.query);
  }

  if (isBrowser && this.disconnectOnUnload && global.addEventListener && global.removeEventListener) {
    this._handleBrowserUnload();
  }

  if (this.options.autoConnect) {
    this.connect();
  }
}

AGClientSocket.prototype = Object.create(AsyncStreamEmitter.prototype);

AGClientSocket.CONNECTING = AGClientSocket.prototype.CONNECTING = AGTransport.prototype.CONNECTING;
AGClientSocket.OPEN = AGClientSocket.prototype.OPEN = AGTransport.prototype.OPEN;
AGClientSocket.CLOSED = AGClientSocket.prototype.CLOSED = AGTransport.prototype.CLOSED;

AGClientSocket.AUTHENTICATED = AGClientSocket.prototype.AUTHENTICATED = 'authenticated';
AGClientSocket.UNAUTHENTICATED = AGClientSocket.prototype.UNAUTHENTICATED = 'unauthenticated';

AGClientSocket.SUBSCRIBED = AGClientSocket.prototype.SUBSCRIBED = AGChannel.SUBSCRIBED;
AGClientSocket.PENDING = AGClientSocket.prototype.PENDING = AGChannel.PENDING;
AGClientSocket.UNSUBSCRIBED = AGClientSocket.prototype.UNSUBSCRIBED = AGChannel.UNSUBSCRIBED;

AGClientSocket.ignoreStatuses = scErrors.socketProtocolIgnoreStatuses;
AGClientSocket.errorStatuses = scErrors.socketProtocolErrorStatuses;

Object.defineProperty(AGClientSocket.prototype, 'isBufferingBatch', {
  get: function () {
    return this.transport.isBufferingBatch;
  }
});

AGClientSocket.prototype.getBackpressure = function () {
  return Math.max(
    this.getAllListenersBackpressure(),
    this.getAllReceiversBackpressure(),
    this.getAllProceduresBackpressure(),
    this.getAllChannelsBackpressure()
  );
};

AGClientSocket.prototype._handleBrowserUnload = async function () {
  let unloadHandler = () => {
    this.disconnect();
  };
  let isUnloadHandlerAttached = false;

  let attachUnloadHandler = () => {
    if (!isUnloadHandlerAttached) {
      isUnloadHandlerAttached = true;
      global.addEventListener('beforeunload', unloadHandler, false);
    }
  };

  let detachUnloadHandler = () => {
    if (isUnloadHandlerAttached) {
      isUnloadHandlerAttached = false;
      global.removeEventListener('beforeunload', unloadHandler, false);
    }
  };

  (async () => {
    let consumer = this.listener('connecting').createConsumer();
    while (true) {
      let packet = await consumer.next();
      if (packet.done) break;
      attachUnloadHandler();
    }
  })();

  (async () => {
    let consumer = this.listener('close').createConsumer();
    while (true) {
      let packet = await consumer.next();
      if (packet.done) break;
      detachUnloadHandler();
    }
  })();
};

AGClientSocket.prototype._setAuthToken = function (data) {
  this._changeToAuthenticatedState(data.token);

  (async () => {
    try {
      await this.auth.saveToken(this.authTokenName, data.token, {});
    } catch (err) {
      this._onError(err);
    }
  })();
};

AGClientSocket.prototype._removeAuthToken = function (data) {
  (async () => {
    let oldAuthToken;
    try {
      oldAuthToken = await this.auth.removeToken(this.authTokenName);
    } catch (err) {
      // Non-fatal error - Do not close the connection
      this._onError(err);
      return;
    }
    this.emit('removeAuthToken', {oldAuthToken});
  })();

  this._changeToUnauthenticatedStateAndClearTokens();
};

AGClientSocket.prototype._privateDataHandlerMap = {
  '#publish': function (data) {
    let undecoratedChannelName = this._undecorateChannelName(data.channel);
    let isSubscribed = this.isSubscribed(undecoratedChannelName, true);

    if (isSubscribed) {
      this._channelDataDemux.write(undecoratedChannelName, data.data);
    }
  },
  '#kickOut': function (data) {
    let undecoratedChannelName = this._undecorateChannelName(data.channel);
    let channel = this._channelMap[undecoratedChannelName];
    if (channel) {
      this.emit('kickOut', {
        channel: undecoratedChannelName,
        message: data.message
      });
      this._channelEventDemux.write(`${undecoratedChannelName}/kickOut`, {message: data.message});
      this._triggerChannelUnsubscribe(channel);
    }
  },
  '#setAuthToken': function (data) {
    if (data) {
      this._setAuthToken(data);
    }
  },
  '#removeAuthToken': function (data) {
    this._removeAuthToken(data);
  }
};

AGClientSocket.prototype._privateRPCHandlerMap = {
  '#setAuthToken': function (data, request) {
    if (data) {
      this._setAuthToken(data);

      request.end();
    } else {
      request.error(new InvalidMessageError('No token data provided by #setAuthToken event'));
    }
  },
  '#removeAuthToken': function (data, request) {
    this._removeAuthToken(data);
    request.end();
  }
};

AGClientSocket.prototype.getState = function () {
  return this.state;
};

AGClientSocket.prototype.getBytesReceived = function () {
  return this.transport.getBytesReceived();
};

AGClientSocket.prototype.deauthenticate = async function () {
  (async () => {
    let oldAuthToken;
    try {
      oldAuthToken = await this.auth.removeToken(this.authTokenName);
    } catch (err) {
      this._onError(err);
      return;
    }
    this.emit('removeAuthToken', {oldAuthToken});
  })();

  if (this.state !== this.CLOSED) {
    this.transmit('#removeAuthToken');
  }
  this._changeToUnauthenticatedStateAndClearTokens();
  await wait(0);
};

AGClientSocket.prototype.connect = function () {
  if (this.state === this.CLOSED) {
    this.pendingReconnect = false;
    this.pendingReconnectTimeout = null;
    clearTimeout(this._reconnectTimeoutRef);

    this.state = this.CONNECTING;
    this.emit('connecting', {});

    if (this.transport) {
      this.transport.clearAllListeners();
    }

    let transportHandlers = {
      onOpen: (value) => {
        this.state = this.OPEN;
        this._onOpen(value);
      },
      onOpenAbort: (value) => {
        if (this.state !== this.CLOSED) {
          this.state = this.CLOSED;
          this._destroy(value.code, value.reason, true);
        }
      },
      onClose: (value) => {
        if (this.state !== this.CLOSED) {
          this.state = this.CLOSED;
          this._destroy(value.code, value.reason);
        }
      },
      onEvent: (value) => {
        this.emit(value.event, value.data);
      },
      onError: (value) => {
        this._onError(value.error);
      },
      onInboundInvoke: (value) => {
        this._onInboundInvoke(value);
      },
      onInboundTransmit: (value) => {
        this._onInboundTransmit(value.event, value.data);
      }
    };

    this.transport = new AGTransport(this.auth, this.codec, this.options, this.wsOptions, transportHandlers);
  }
};

AGClientSocket.prototype.reconnect = function (code, reason) {
  this.disconnect(code, reason);
  this.connect();
};

AGClientSocket.prototype.disconnect = function (code, reason) {
  code = code || 1000;

  if (typeof code !== 'number') {
    throw new InvalidArgumentsError('If specified, the code argument must be a number');
  }

  let isConnecting = this.state === this.CONNECTING;
  if (isConnecting || this.state === this.OPEN) {
    this.state = this.CLOSED;
    this._destroy(code, reason, isConnecting);
    this.transport.close(code, reason);
  } else {
    this.pendingReconnect = false;
    this.pendingReconnectTimeout = null;
    clearTimeout(this._reconnectTimeoutRef);
  }
};

AGClientSocket.prototype._changeToUnauthenticatedStateAndClearTokens = function () {
  if (this.authState !== this.UNAUTHENTICATED) {
    let oldAuthState = this.authState;
    let oldAuthToken = this.authToken;
    let oldSignedAuthToken = this.signedAuthToken;
    this.authState = this.UNAUTHENTICATED;
    this.signedAuthToken = null;
    this.authToken = null;

    let stateChangeData = {
      oldAuthState,
      newAuthState: this.authState
    };
    this.emit('authStateChange', stateChangeData);
    this.emit('deauthenticate', {oldSignedAuthToken, oldAuthToken});
  }
};

AGClientSocket.prototype._changeToAuthenticatedState = function (signedAuthToken) {
  this.signedAuthToken = signedAuthToken;
  this.authToken = this._extractAuthTokenData(signedAuthToken);

  if (this.authState !== this.AUTHENTICATED) {
    let oldAuthState = this.authState;
    this.authState = this.AUTHENTICATED;
    let stateChangeData = {
      oldAuthState,
      newAuthState: this.authState,
      signedAuthToken: signedAuthToken,
      authToken: this.authToken
    };
    if (!this.preparingPendingSubscriptions) {
      this.processPendingSubscriptions();
    }

    this.emit('authStateChange', stateChangeData);
  }
  this.emit('authenticate', {signedAuthToken, authToken: this.authToken});
};

AGClientSocket.prototype.decodeBase64 = function (encodedString) {
  return Buffer.from(encodedString, 'base64').toString('utf8');
};

AGClientSocket.prototype.encodeBase64 = function (decodedString) {
  return Buffer.from(decodedString, 'utf8').toString('base64');
};

AGClientSocket.prototype._extractAuthTokenData = function (signedAuthToken) {
  let tokenParts = (signedAuthToken || '').split('.');
  let encodedTokenData = tokenParts[1];
  if (encodedTokenData != null) {
    let tokenData = encodedTokenData;
    try {
      tokenData = this.decodeBase64(tokenData);
      return JSON.parse(tokenData);
    } catch (e) {
      return tokenData;
    }
  }
  return null;
};

AGClientSocket.prototype.getAuthToken = function () {
  return this.authToken;
};

AGClientSocket.prototype.getSignedAuthToken = function () {
  return this.signedAuthToken;
};

// Perform client-initiated authentication by providing an encrypted token string.
AGClientSocket.prototype.authenticate = async function (signedAuthToken) {
  let authStatus;

  try {
    authStatus = await this.invoke('#authenticate', signedAuthToken);
  } catch (err) {
    if (err.name !== 'BadConnectionError' && err.name !== 'TimeoutError') {
      // In case of a bad/closed connection or a timeout, we maintain the last
      // known auth state since those errors don't mean that the token is invalid.
      this._changeToUnauthenticatedStateAndClearTokens();
    }
    await wait(0);
    throw err;
  }

  if (authStatus && authStatus.isAuthenticated != null) {
    // If authStatus is correctly formatted (has an isAuthenticated property),
    // then we will rehydrate the authError.
    if (authStatus.authError) {
      authStatus.authError = scErrors.hydrateError(authStatus.authError);
    }
  } else {
    // Some errors like BadConnectionError and TimeoutError will not pass a valid
    // authStatus object to the current function, so we need to create it ourselves.
    authStatus = {
      isAuthenticated: this.authState,
      authError: null
    };
  }

  if (authStatus.isAuthenticated) {
    this._changeToAuthenticatedState(signedAuthToken);
  } else {
    this._changeToUnauthenticatedStateAndClearTokens();
  }

  (async () => {
    try {
      await this.auth.saveToken(this.authTokenName, signedAuthToken, {});
    } catch (err) {
      this._onError(err);
    }
  })();

  await wait(0);
  return authStatus;
};

AGClientSocket.prototype._tryReconnect = function (initialDelay) {
  let exponent = this.connectAttempts++;
  let reconnectOptions = this.options.autoReconnectOptions;
  let timeout;

  if (initialDelay == null || exponent > 0) {
    let initialTimeout = Math.round(reconnectOptions.initialDelay + (reconnectOptions.randomness || 0) * Math.random());

    timeout = Math.round(initialTimeout * Math.pow(reconnectOptions.multiplier, exponent));
  } else {
    timeout = initialDelay;
  }

  if (timeout > reconnectOptions.maxDelay) {
    timeout = reconnectOptions.maxDelay;
  }

  clearTimeout(this._reconnectTimeoutRef);

  this.pendingReconnect = true;
  this.pendingReconnectTimeout = timeout;
  this._reconnectTimeoutRef = setTimeout(() => {
    this.connect();
  }, timeout);
};

AGClientSocket.prototype._onOpen = function (status) {
  if (this.isBatching) {
    this._startBatching();
  } else if (this.batchOnHandshake) {
    this._startBatching();
    setTimeout(() => {
      if (!this.isBatching) {
        this._stopBatching();
      }
    }, this.batchOnHandshakeDuration);
  }
  this.preparingPendingSubscriptions = true;

  if (status) {
    this.id = status.id;
    this.pingTimeout = status.pingTimeout;
    if (status.isAuthenticated) {
      this._changeToAuthenticatedState(status.authToken);
    } else {
      this._changeToUnauthenticatedStateAndClearTokens();
    }
  } else {
    // This can happen if auth.loadToken (in transport.js) fails with
    // an error - This means that the signedAuthToken cannot be loaded by
    // the auth engine and therefore, we need to unauthenticate the client.
    this._changeToUnauthenticatedStateAndClearTokens();
  }

  this.connectAttempts = 0;

  if (this.options.autoSubscribeOnConnect) {
    this.processPendingSubscriptions();
  }

  // If the user invokes the callback while in autoSubscribeOnConnect mode, it
  // won't break anything.
  this.emit('connect', {
    ...status,
    processPendingSubscriptions: () => {
      this.processPendingSubscriptions();
    }
  });

  if (this.state === this.OPEN) {
    this._flushOutboundBuffer();
  }
};

AGClientSocket.prototype._onError = function (error) {
  this.emit('error', {error});
};

AGClientSocket.prototype._suspendSubscriptions = function () {
  Object.keys(this._channelMap).forEach((channelName) => {
    let channel = this._channelMap[channelName];
    this._triggerChannelUnsubscribe(channel, true);
  });
};

AGClientSocket.prototype._abortAllPendingEventsDueToBadConnection = function (failureType) {
  let currentNode = this._outboundBuffer.head;
  let nextNode;

  while (currentNode) {
    nextNode = currentNode.next;
    let eventObject = currentNode.data;
    clearTimeout(eventObject.timeout);
    delete eventObject.timeout;
    currentNode.detach();
    currentNode = nextNode;

    let callback = eventObject.callback;

    if (callback) {
      delete eventObject.callback;
      let errorMessage = `Event "${eventObject.event}" was aborted due to a bad connection`;
      let error = new BadConnectionError(errorMessage, failureType);

      callback.call(eventObject, error, eventObject);
    }
    // Cleanup any pending response callback in the transport layer too.
    if (eventObject.cid) {
      this.transport.cancelPendingResponse(eventObject.cid);
    }
  }
};

AGClientSocket.prototype._destroy = function (code, reason, openAbort) {
  this.id = null;
  this._cancelBatching();

  if (this.transport) {
    this.transport.clearAllListeners();
  }

  this.pendingReconnect = false;
  this.pendingReconnectTimeout = null;
  clearTimeout(this._reconnectTimeoutRef);

  this._suspendSubscriptions();

  if (openAbort) {
    this.emit('connectAbort', {code, reason});
  } else {
    this.emit('disconnect', {code, reason});
  }
  this.emit('close', {code, reason});

  if (!AGClientSocket.ignoreStatuses[code]) {
    let closeMessage;
    if (reason) {
      closeMessage = 'Socket connection closed with status code ' + code + ' and reason: ' + reason;
    } else {
      closeMessage = 'Socket connection closed with status code ' + code;
    }
    let err = new SocketProtocolError(AGClientSocket.errorStatuses[code] || closeMessage, code);
    this._onError(err);
  }

  this._abortAllPendingEventsDueToBadConnection(openAbort ? 'connectAbort' : 'disconnect');

  // Try to reconnect
  // on server ping timeout (4000)
  // or on client pong timeout (4001)
  // or on close without status (1005)
  // or on handshake failure (4003)
  // or on handshake rejection (4008)
  // or on socket hung up (1006)
  if (this.options.autoReconnect) {
    if (code === 4000 || code === 4001 || code === 1005) {
      // If there is a ping or pong timeout or socket closes without
      // status, don't wait before trying to reconnect - These could happen
      // if the client wakes up after a period of inactivity and in this case we
      // want to re-establish the connection as soon as possible.
      this._tryReconnect(0);

      // Codes 4500 and above will be treated as permanent disconnects.
      // Socket will not try to auto-reconnect.
    } else if (code !== 1000 && code < 4500) {
      this._tryReconnect();
    }
  }
};

AGClientSocket.prototype._onInboundTransmit = function (event, data) {
  let handler = this._privateDataHandlerMap[event];
  if (handler) {
    handler.call(this, data);
  } else {
    this._receiverDemux.write(event, data);
  }
};

AGClientSocket.prototype._onInboundInvoke = function (request) {
  let {procedure, data} = request;
  let handler = this._privateRPCHandlerMap[procedure];
  if (handler) {
    handler.call(this, data, request);
  } else {
    this._procedureDemux.write(procedure, request);
  }
};

AGClientSocket.prototype.decode = function (message) {
  return this.transport.decode(message);
};

AGClientSocket.prototype.encode = function (object) {
  return this.transport.encode(object);
};

AGClientSocket.prototype._flushOutboundBuffer = function () {
  let currentNode = this._outboundBuffer.head;
  let nextNode;

  while (currentNode) {
    nextNode = currentNode.next;
    let eventObject = currentNode.data;
    currentNode.detach();
    this.transport.transmitObject(eventObject);
    currentNode = nextNode;
  }
};

AGClientSocket.prototype._handleEventAckTimeout = function (eventObject, eventNode) {
  if (eventNode) {
    eventNode.detach();
  }
  delete eventObject.timeout;

  let callback = eventObject.callback;
  if (callback) {
    delete eventObject.callback;
    let error = new TimeoutError(`Event response for "${eventObject.event}" timed out`);
    callback.call(eventObject, error, eventObject);
  }
  // Cleanup any pending response callback in the transport layer too.
  if (eventObject.cid) {
    this.transport.cancelPendingResponse(eventObject.cid);
  }
};

AGClientSocket.prototype._processOutboundEvent = function (event, data, options, expectResponse) {
  options = options || {};

  if (this.state === this.CLOSED) {
    this.connect();
  }
  let eventObject = {
    event
  };

  let promise;

  if (expectResponse) {
    promise = new Promise((resolve, reject) => {
      eventObject.callback = (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      };
    });
  } else {
    promise = Promise.resolve();
  }

  let eventNode = new LinkedList.Item();

  if (this.options.cloneData) {
    eventObject.data = cloneDeep(data);
  } else {
    eventObject.data = data;
  }
  eventNode.data = eventObject;

  let ackTimeout = options.ackTimeout == null ? this.ackTimeout : options.ackTimeout;

  eventObject.timeout = setTimeout(() => {
    this._handleEventAckTimeout(eventObject, eventNode);
  }, ackTimeout);

  this._outboundBuffer.append(eventNode);
  if (this.state === this.OPEN) {
    this._flushOutboundBuffer();
  }
  return promise;
};

AGClientSocket.prototype.send = function (data) {
  this.transport.send(data);
};

AGClientSocket.prototype.transmit = function (event, data, options) {
  return this._processOutboundEvent(event, data, options);
};

AGClientSocket.prototype.invoke = function (event, data, options) {
  return this._processOutboundEvent(event, data, options, true);
};

AGClientSocket.prototype.transmitPublish = function (channelName, data) {
  let pubData = {
    channel: this._decorateChannelName(channelName),
    data
  };
  return this.transmit('#publish', pubData);
};

AGClientSocket.prototype.invokePublish = function (channelName, data) {
  let pubData = {
    channel: this._decorateChannelName(channelName),
    data
  };
  return this.invoke('#publish', pubData);
};

AGClientSocket.prototype._triggerChannelSubscribe = function (channel, subscriptionOptions) {
  let channelName = channel.name;

  if (channel.state !== AGChannel.SUBSCRIBED) {
    let oldChannelState = channel.state;
    channel.state = AGChannel.SUBSCRIBED;

    let stateChangeData = {
      oldChannelState,
      newChannelState: channel.state,
      subscriptionOptions
    };
    this._channelEventDemux.write(`${channelName}/subscribeStateChange`, stateChangeData);
    this._channelEventDemux.write(`${channelName}/subscribe`, {
      subscriptionOptions
    });
    this.emit('subscribeStateChange', {
      channel: channelName,
      ...stateChangeData
    });
    this.emit('subscribe', {
      channel: channelName,
      subscriptionOptions
    });
  }
};

AGClientSocket.prototype._triggerChannelSubscribeFail = function (err, channel, subscriptionOptions) {
  let channelName = channel.name;
  let meetsAuthRequirements = !channel.options.waitForAuth || this.authState === this.AUTHENTICATED;
  let hasChannel = !!this._channelMap[channelName];

  if (hasChannel && meetsAuthRequirements) {
    delete this._channelMap[channelName];

    this._channelEventDemux.write(`${channelName}/subscribeFail`, {
      error: err,
      subscriptionOptions
    });
    this.emit('subscribeFail', {
      error: err,
      channel: channelName,
      subscriptionOptions: subscriptionOptions
    });
  }
};

// Cancel any pending subscribe callback
AGClientSocket.prototype._cancelPendingSubscribeCallback = function (channel) {
  if (channel._pendingSubscriptionCid != null) {
    this.transport.cancelPendingResponse(channel._pendingSubscriptionCid);
    delete channel._pendingSubscriptionCid;
  }
};

AGClientSocket.prototype._decorateChannelName = function (channelName) {
  if (this.channelPrefix) {
    channelName = this.channelPrefix + channelName;
  }
  return channelName;
};

AGClientSocket.prototype._undecorateChannelName = function (decoratedChannelName) {
  if (this.channelPrefix && decoratedChannelName.indexOf(this.channelPrefix) === 0) {
    return decoratedChannelName.replace(this.channelPrefix, '');
  }
  return decoratedChannelName;
};

AGClientSocket.prototype.startBatch = function () {
  this.transport.startBatch();
};

AGClientSocket.prototype.flushBatch = function () {
  this.transport.flushBatch();
};

AGClientSocket.prototype.cancelBatch = function () {
  this.transport.cancelBatch();
};

AGClientSocket.prototype._startBatching = function () {
  if (this._batchingIntervalId != null) {
    return;
  }
  this.startBatch();
  this._batchingIntervalId = setInterval(() => {
    this.flushBatch();
    this.startBatch();
  }, this.options.batchInterval);
};

AGClientSocket.prototype.startBatching = function () {
  this.isBatching = true;
  this._startBatching();
};

AGClientSocket.prototype._stopBatching = function () {
  if (this._batchingIntervalId != null) {
    clearInterval(this._batchingIntervalId);
  }
  this._batchingIntervalId = null;
  this.flushBatch();
};

AGClientSocket.prototype.stopBatching = function () {
  this.isBatching = false;
  this._stopBatching();
};

AGClientSocket.prototype._cancelBatching = function () {
  if (this._batchingIntervalId != null) {
    clearInterval(this._batchingIntervalId);
  }
  this._batchingIntervalId = null;
  this.cancelBatch();
};

AGClientSocket.prototype.cancelBatching = function () {
  this.isBatching = false;
  this._cancelBatching();
};

AGClientSocket.prototype._trySubscribe = function (channel) {
  let meetsAuthRequirements = !channel.options.waitForAuth || this.authState === this.AUTHENTICATED;

  // We can only ever have one pending subscribe action at any given time on a channel
  if (
    this.state === this.OPEN &&
    !this.preparingPendingSubscriptions &&
    channel._pendingSubscriptionCid == null &&
    meetsAuthRequirements
  ) {

    let options = {
      noTimeout: true
    };

    let subscriptionOptions = {};
    if (channel.options.waitForAuth) {
      options.waitForAuth = true;
      subscriptionOptions.waitForAuth = options.waitForAuth;
    }
    if (channel.options.data) {
      subscriptionOptions.data = channel.options.data;
    }

    channel._pendingSubscriptionCid = this.transport.invokeRaw(
      '#subscribe',
      {
        channel: this._decorateChannelName(channel.name),
        ...subscriptionOptions
      },
      options,
      (err) => {
        if (err) {
          if (err.name === 'BadConnectionError') {
            // In case of a failed connection, keep the subscription
            // as pending; it will try again on reconnect.
            return;
          }
          delete channel._pendingSubscriptionCid;
          this._triggerChannelSubscribeFail(err, channel, subscriptionOptions);
        } else {
          delete channel._pendingSubscriptionCid;
          this._triggerChannelSubscribe(channel, subscriptionOptions);
        }
      }
    );
    this.emit('subscribeRequest', {
      channel: channel.name,
      subscriptionOptions
    });
  }
};

AGClientSocket.prototype.subscribe = function (channelName, options) {
  options = options || {};
  let channel = this._channelMap[channelName];

  let sanitizedOptions = {
    waitForAuth: !!options.waitForAuth
  };

  if (options.priority != null) {
    sanitizedOptions.priority = options.priority;
  }
  if (options.data !== undefined) {
    sanitizedOptions.data = options.data;
  }

  if (!channel) {
    channel = {
      name: channelName,
      state: AGChannel.PENDING,
      options: sanitizedOptions
    };
    this._channelMap[channelName] = channel;
    this._trySubscribe(channel);
  } else if (options) {
    channel.options = sanitizedOptions;
  }

  let channelIterable = new AGChannel(
    channelName,
    this,
    this._channelEventDemux,
    this._channelDataDemux
  );

  return channelIterable;
};

AGClientSocket.prototype._triggerChannelUnsubscribe = function (channel, setAsPending) {
  let channelName = channel.name;

  this._cancelPendingSubscribeCallback(channel);

  if (channel.state === AGChannel.SUBSCRIBED) {
    let stateChangeData = {
      oldChannelState: channel.state,
      newChannelState: setAsPending ? AGChannel.PENDING : AGChannel.UNSUBSCRIBED
    };
    this._channelEventDemux.write(`${channelName}/subscribeStateChange`, stateChangeData);
    this._channelEventDemux.write(`${channelName}/unsubscribe`, {});
    this.emit('subscribeStateChange', {
      channel: channelName,
      ...stateChangeData
    });
    this.emit('unsubscribe', {channel: channelName});
  }

  if (setAsPending) {
    channel.state = AGChannel.PENDING;
  } else {
    delete this._channelMap[channelName];
  }
};

AGClientSocket.prototype._tryUnsubscribe = function (channel) {
  if (this.state === this.OPEN) {
    let options = {
      noTimeout: true
    };
    // If there is a pending subscribe action, cancel the callback
    this._cancelPendingSubscribeCallback(channel);

    // This operation cannot fail because the TCP protocol guarantees delivery
    // so long as the connection remains open. If the connection closes,
    // the server will automatically unsubscribe the client and thus complete
    // the operation on the server side.
    let decoratedChannelName = this._decorateChannelName(channel.name);
    this.transport.transmit('#unsubscribe', decoratedChannelName, options);
  }
};

AGClientSocket.prototype.unsubscribe = function (channelName) {
  let channel = this._channelMap[channelName];

  if (channel) {
    this._triggerChannelUnsubscribe(channel);
    this._tryUnsubscribe(channel);
  }
};

// ---- Receiver logic ----

AGClientSocket.prototype.receiver = function (receiverName) {
  return this._receiverDemux.stream(receiverName);
};

AGClientSocket.prototype.closeReceiver = function (receiverName) {
  this._receiverDemux.close(receiverName);
};

AGClientSocket.prototype.closeAllReceivers = function () {
  this._receiverDemux.closeAll();
};

AGClientSocket.prototype.killReceiver = function (receiverName) {
  this._receiverDemux.kill(receiverName);
};

AGClientSocket.prototype.killAllReceivers = function () {
  this._receiverDemux.killAll();
};

AGClientSocket.prototype.killReceiverConsumer = function (consumerId) {
  this._receiverDemux.killConsumer(consumerId);
};

AGClientSocket.prototype.getReceiverConsumerStats = function (consumerId) {
  return this._receiverDemux.getConsumerStats(consumerId);
};

AGClientSocket.prototype.getReceiverConsumerStatsList = function (receiverName) {
  return this._receiverDemux.getConsumerStatsList(receiverName);
};

AGClientSocket.prototype.getAllReceiversConsumerStatsList = function () {
  return this._receiverDemux.getConsumerStatsListAll();
};

AGClientSocket.prototype.getReceiverBackpressure = function (receiverName) {
  return this._receiverDemux.getBackpressure(receiverName);
};

AGClientSocket.prototype.getAllReceiversBackpressure = function () {
  return this._receiverDemux.getBackpressureAll();
};

AGClientSocket.prototype.getReceiverConsumerBackpressure = function (consumerId) {
  return this._receiverDemux.getConsumerBackpressure(consumerId);
};

AGClientSocket.prototype.hasReceiverConsumer = function (receiverName, consumerId) {
  return this._receiverDemux.hasConsumer(receiverName, consumerId);
};

AGClientSocket.prototype.hasAnyReceiverConsumer = function (consumerId) {
  return this._receiverDemux.hasConsumerAll(consumerId);
};

// ---- Procedure logic ----

AGClientSocket.prototype.procedure = function (procedureName) {
  return this._procedureDemux.stream(procedureName);
};

AGClientSocket.prototype.closeProcedure = function (procedureName) {
  this._procedureDemux.close(procedureName);
};

AGClientSocket.prototype.closeAllProcedures = function () {
  this._procedureDemux.closeAll();
};

AGClientSocket.prototype.killProcedure = function (procedureName) {
  this._procedureDemux.kill(procedureName);
};

AGClientSocket.prototype.killAllProcedures = function () {
  this._procedureDemux.killAll();
};

AGClientSocket.prototype.killProcedureConsumer = function (consumerId) {
  this._procedureDemux.killConsumer(consumerId);
};

AGClientSocket.prototype.getProcedureConsumerStats = function (consumerId) {
  return this._procedureDemux.getConsumerStats(consumerId);
};

AGClientSocket.prototype.getProcedureConsumerStatsList = function (procedureName) {
  return this._procedureDemux.getConsumerStatsList(procedureName);
};

AGClientSocket.prototype.getAllProceduresConsumerStatsList = function () {
  return this._procedureDemux.getConsumerStatsListAll();
};

AGClientSocket.prototype.getProcedureBackpressure = function (procedureName) {
  return this._procedureDemux.getBackpressure(procedureName);
};

AGClientSocket.prototype.getAllProceduresBackpressure = function () {
  return this._procedureDemux.getBackpressureAll();
};

AGClientSocket.prototype.getProcedureConsumerBackpressure = function (consumerId) {
  return this._procedureDemux.getConsumerBackpressure(consumerId);
};

AGClientSocket.prototype.hasProcedureConsumer = function (procedureName, consumerId) {
  return this._procedureDemux.hasConsumer(procedureName, consumerId);
};

AGClientSocket.prototype.hasAnyProcedureConsumer = function (consumerId) {
  return this._procedureDemux.hasConsumerAll(consumerId);
};

// ---- Channel logic ----

AGClientSocket.prototype.channel = function (channelName) {
  let currentChannel = this._channelMap[channelName];

  let channelIterable = new AGChannel(
    channelName,
    this,
    this._channelEventDemux,
    this._channelDataDemux
  );

  return channelIterable;
};

AGClientSocket.prototype.closeChannel = function (channelName) {
  this.channelCloseOutput(channelName);
  this.channelCloseAllListeners(channelName);
};

AGClientSocket.prototype.closeAllChannelOutputs = function () {
  this._channelDataDemux.closeAll();
};

AGClientSocket.prototype.closeAllChannelListeners = function () {
  this._channelEventDemux.closeAll();
};

AGClientSocket.prototype.closeAllChannels = function () {
  this.closeAllChannelOutputs();
  this.closeAllChannelListeners();
};

AGClientSocket.prototype.killChannel = function (channelName) {
  this.channelKillOutput(channelName);
  this.channelKillAllListeners(channelName);
};

AGClientSocket.prototype.killAllChannelOutputs = function () {
  this._channelDataDemux.killAll();
};

AGClientSocket.prototype.killAllChannelListeners = function () {
  this._channelEventDemux.killAll();
};

AGClientSocket.prototype.killAllChannels = function () {
  this.killAllChannelOutputs();
  this.killAllChannelListeners();
};

AGClientSocket.prototype.killChannelOutputConsumer = function (consumerId) {
  this._channelDataDemux.killConsumer(consumerId);
};

AGClientSocket.prototype.killChannelListenerConsumer = function (consumerId) {
  this._channelEventDemux.killConsumer(consumerId);
};

AGClientSocket.prototype.getChannelOutputConsumerStats = function (consumerId) {
  return this._channelDataDemux.getConsumerStats(consumerId);
};

AGClientSocket.prototype.getChannelListenerConsumerStats = function (consumerId) {
  return this._channelEventDemux.getConsumerStats(consumerId);
};

AGClientSocket.prototype.getAllChannelOutputsConsumerStatsList = function () {
  return this._channelDataDemux.getConsumerStatsListAll();
};

AGClientSocket.prototype.getAllChannelListenersConsumerStatsList = function () {
  return this._channelEventDemux.getConsumerStatsListAll();
};

AGClientSocket.prototype.getChannelBackpressure = function (channelName) {
  return Math.max(
    this.channelGetOutputBackpressure(channelName),
    this.channelGetAllListenersBackpressure(channelName)
  );
};

AGClientSocket.prototype.getAllChannelOutputsBackpressure = function () {
  return this._channelDataDemux.getBackpressureAll();
};

AGClientSocket.prototype.getAllChannelListenersBackpressure = function () {
  return this._channelEventDemux.getBackpressureAll();
};

AGClientSocket.prototype.getAllChannelsBackpressure = function () {
  return Math.max(
    this.getAllChannelOutputsBackpressure(),
    this.getAllChannelListenersBackpressure()
  );
};

AGClientSocket.prototype.getChannelListenerConsumerBackpressure = function (consumerId) {
  return this._channelEventDemux.getConsumerBackpressure(consumerId);
};

AGClientSocket.prototype.getChannelOutputConsumerBackpressure = function (consumerId) {
  return this._channelDataDemux.getConsumerBackpressure(consumerId);
};

AGClientSocket.prototype.hasAnyChannelOutputConsumer = function (consumerId) {
  return this._channelDataDemux.hasConsumerAll(consumerId);
};

AGClientSocket.prototype.hasAnyChannelListenerConsumer = function (consumerId) {
  return this._channelEventDemux.hasConsumerAll(consumerId);
};

AGClientSocket.prototype.getChannelState = function (channelName) {
  let channel = this._channelMap[channelName];
  if (channel) {
    return channel.state;
  }
  return AGChannel.UNSUBSCRIBED;
};

AGClientSocket.prototype.getChannelOptions = function (channelName) {
  let channel = this._channelMap[channelName];
  if (channel) {
    return {...channel.options};
  }
  return {};
};

AGClientSocket.prototype._getAllChannelStreamNames = function (channelName) {
  let streamNamesLookup = this._channelEventDemux.getConsumerStatsListAll()
  .filter((stats) => {
    return stats.stream.indexOf(`${channelName}/`) === 0;
  })
  .reduce((accumulator, stats) => {
    accumulator[stats.stream] = true;
    return accumulator;
  }, {});
  return Object.keys(streamNamesLookup);
};

AGClientSocket.prototype.channelCloseOutput = function (channelName) {
  this._channelDataDemux.close(channelName);
};

AGClientSocket.prototype.channelCloseListener = function (channelName, eventName) {
  this._channelEventDemux.close(`${channelName}/${eventName}`);
};

AGClientSocket.prototype.channelCloseAllListeners = function (channelName) {
  let listenerStreams = this._getAllChannelStreamNames(channelName)
  .forEach((streamName) => {
    this._channelEventDemux.close(streamName);
  });
};

AGClientSocket.prototype.channelKillOutput = function (channelName) {
  this._channelDataDemux.kill(channelName);
};

AGClientSocket.prototype.channelKillListener = function (channelName, eventName) {
  this._channelEventDemux.kill(`${channelName}/${eventName}`);
};

AGClientSocket.prototype.channelKillAllListeners = function (channelName) {
  let listenerStreams = this._getAllChannelStreamNames(channelName)
  .forEach((streamName) => {
    this._channelEventDemux.kill(streamName);
  });
};

AGClientSocket.prototype.channelGetOutputConsumerStatsList = function (channelName) {
  return this._channelDataDemux.getConsumerStatsList(channelName);
};

AGClientSocket.prototype.channelGetListenerConsumerStatsList = function (channelName, eventName) {
  return this._channelEventDemux.getConsumerStatsList(`${channelName}/${eventName}`);
};

AGClientSocket.prototype.channelGetAllListenersConsumerStatsList = function (channelName) {
  return this._getAllChannelStreamNames(channelName)
  .map((streamName) => {
    return this._channelEventDemux.getConsumerStatsList(streamName);
  })
  .reduce((accumulator, statsList) => {
    statsList.forEach((stats) => {
      accumulator.push(stats);
    });
    return accumulator;
  }, []);
};

AGClientSocket.prototype.channelGetOutputBackpressure = function (channelName) {
  return this._channelDataDemux.getBackpressure(channelName);
};

AGClientSocket.prototype.channelGetListenerBackpressure = function (channelName, eventName) {
  return this._channelEventDemux.getBackpressure(`${channelName}/${eventName}`);
};

AGClientSocket.prototype.channelGetAllListenersBackpressure = function (channelName) {
  let listenerStreamBackpressures = this._getAllChannelStreamNames(channelName)
  .map((streamName) => {
    return this._channelEventDemux.getBackpressure(streamName);
  });
  return Math.max(...listenerStreamBackpressures.concat(0));
};

AGClientSocket.prototype.channelHasOutputConsumer = function (channelName, consumerId) {
  return this._channelDataDemux.hasConsumer(channelName, consumerId);
};

AGClientSocket.prototype.channelHasListenerConsumer = function (channelName, eventName, consumerId) {
  return this._channelEventDemux.hasConsumer(`${channelName}/${eventName}`, consumerId);
};

AGClientSocket.prototype.channelHasAnyListenerConsumer = function (channelName, consumerId) {
  return this._getAllChannelStreamNames(channelName)
  .some((streamName) => {
    return this._channelEventDemux.hasConsumer(streamName, consumerId);
  });
};

AGClientSocket.prototype.subscriptions = function (includePending) {
  let subs = [];
  Object.keys(this._channelMap).forEach((channelName) => {
    if (includePending || this._channelMap[channelName].state === AGChannel.SUBSCRIBED) {
      subs.push(channelName);
    }
  });
  return subs;
};

AGClientSocket.prototype.isSubscribed = function (channelName, includePending) {
  let channel = this._channelMap[channelName];
  if (includePending) {
    return !!channel;
  }
  return !!channel && channel.state === AGChannel.SUBSCRIBED;
};

AGClientSocket.prototype.processPendingSubscriptions = function () {
  this.preparingPendingSubscriptions = false;
  let pendingChannels = [];

  Object.keys(this._channelMap).forEach((channelName) => {
    let channel = this._channelMap[channelName];
    if (channel.state === AGChannel.PENDING) {
      pendingChannels.push(channel);
    }
  });

  pendingChannels.sort((a, b) => {
    let ap = a.options.priority || 0;
    let bp = b.options.priority || 0;
    if (ap > bp) {
      return -1;
    }
    if (ap < bp) {
      return 1;
    }
    return 0;
  });

  pendingChannels.forEach((channel) => {
    this._trySubscribe(channel);
  });
};

module.exports = AGClientSocket;
