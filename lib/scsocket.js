var SCEmitter = require('sc-emitter').SCEmitter;
var SCChannel = require('sc-channel').SCChannel;
var Response = require('./response').Response;
var AuthEngine = require('./auth').AuthEngine;
var SCTransport = require('./sctransport').SCTransport;
var querystring = require('querystring');
var LinkedList = require('linked-list');

if (!Object.create) {
  Object.create = require('./objectcreate');
}

var isBrowser = typeof window != 'undefined';


var SCSocket = function (options) {
  var self = this;
  
  SCEmitter.call(this);
  
  var opts = {
    port: null,
    autoReconnect: true,
    autoProcessSubscriptions: true,
    ackTimeout: 10000,
    hostname: global.location && location.hostname,
    path: '/socketcluster/',
    secure: global.location && location.protocol == 'https:',
    timestampRequests: false,
    timestampParam: 't',
    authEngine: null,
    authTokenName: 'socketCluster.authToken',
    binaryType: 'arraybuffer'
  };
  for (var i in options) {
    if (options.hasOwnProperty(i)) {
      opts[i] = options[i];
    }
  }
  
  this.id = null;
  this.state = this.CLOSED;
  
  this.ackTimeout = opts.ackTimeout;
  
  // pingTimeout will be ackTimeout at the start, but it will
  // be updated with values provided by the 'connect' event
  this.pingTimeout = this.ackTimeout;
  
  var maxTimeout = Math.pow(2, 31) - 1;
  
  var verifyDuration = function (propertyName) {
    if (self[propertyName] > maxTimeout) {
      throw new Error('The ' + propertyName +
        ' value provided exceeded the maximum amount allowed');
    }
  };
  
  verifyDuration('ackTimeout');
  verifyDuration('pingTimeout');
  
  this._localEvents = {
    'connect': 1,
    'connectAbort': 1,
    'disconnect': 1,
    'message': 1,
    'error': 1,
    'raw': 1,
    'fail': 1,
    'kickOut': 1,
    'subscribe': 1,
    'unsubscribe': 1,
    'authenticate': 1,
    'removeAuthToken': 1
  };
  
  this._connectAttempts = 0;
  
  this._emitBuffer = new LinkedList();
  this._channels = {};
  
  this.options = opts;
  
  if (this.options.autoReconnect) {
    if (this.options.autoReconnectOptions == null) {
      this.options.autoReconnectOptions = {};
    }
    
    var reconnectOptions = this.options.autoReconnectOptions;
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

  this.options.path = this.options.path.replace(/\/$/, '') + '/';
  
  this.options.query = opts.query || {};
  if (typeof this.options.query == 'string') {
    this.options.query = querystring.parse(this.options.query);
  }

  this.options.port = opts.port || (global.location && location.port ?
    location.port : (this.options.secure ? 443 : 80));
  
  this.connect();
  
  this._channelEmitter = new SCEmitter();
  
  if (isBrowser) {
    var unloadHandler = function () {
      self.disconnect();
    };

    if (global.attachEvent) {
      global.attachEvent('onunload', unloadHandler);
    } else if (global.addEventListener) {
      global.addEventListener('beforeunload', unloadHandler, false);
    }
  }
};

SCSocket.prototype = Object.create(SCEmitter.prototype);

SCSocket.CONNECTING = SCSocket.prototype.CONNECTING = SCTransport.prototype.CONNECTING;
SCSocket.OPEN = SCSocket.prototype.OPEN = SCTransport.prototype.OPEN;
SCSocket.CLOSED = SCSocket.prototype.CLOSED = SCTransport.prototype.CLOSED;

SCSocket.ignoreStatuses = {
  1000: 'Socket closed normally',
  1001: 'Socket hung up'
};

SCSocket.errorStatuses = {
  1001: 'Socket was disconnected',
  1002: 'A WebSocket protocol error was encountered',
  1003: 'Server terminated socket because it received invalid data',
  1005: 'Socket closed without status code',
  1006: 'Socket hung up',
  1007: 'Message format was incorrect',
  1008: 'Encountered a policy violation',
  1009: 'Message was too big to process',
  1010: 'Client ended the connection because the server did not comply with extension requirements',
  1011: 'Server encountered an unexpected fatal condition',
  4000: 'Server ping timed out',
  4001: 'Client pong timed out',
  4002: 'Server failed to sign auth token',
  4003: 'Failed to complete handshake',
  4004: 'Client failed to save auth token'
};

SCSocket.prototype._privateEventHandlerMap = {
  '#fail': function (data) {
    this._onSCError(data);
  },
  '#publish': function (data) {
    var isSubscribed = this.isSubscribed(data.channel, true);
    
    if (isSubscribed) {
      this._channelEmitter.emit(data.channel, data.data);
    }
  },
  '#kickOut': function (data) {
    var channelName = data.channel;
    var channel = this._channels[channelName];
    if (channel) {
      SCEmitter.prototype.emit.call(this, 'kickOut', data.message, channelName);
      channel.emit('kickOut', data.message, channelName);
      this._triggerChannelUnsubscribe(channel);
    }
  },
  '#setAuthToken': function (data, response) {
    var self = this;
    
    if (data) {
      var triggerAuthenticate = function (err) {
        if (err) {
          // This is a non-fatal error, we don't want to close the connection 
          // because of this but we do want to notify the server and throw an error
          // on the client.
          response.error(err.message || err);
          self._onSCError(err);
        } else {
          SCEmitter.prototype.emit.call(self, 'authenticate', data.token);
          response.end();
        }
      };
      
      this.auth.saveToken(this.options.authTokenName, data.token, {}, triggerAuthenticate);
    } else {
      response.error('No token data provided by #setAuthToken event');
    }
  },
  '#removeAuthToken': function (data, response) {
    var self = this;
    
    this.auth.removeToken(this.options.authTokenName, function (err) {
      if (err) {
        // Non-fatal error - Do not close the connection
        response.error(err.message || err);
        self._onSCError(err);
      } else {
        SCEmitter.prototype.emit.call(self, 'removeAuthToken');
        response.end();
      }
    });
  },
  '#disconnect': function (data) {
    this.transport.close(data.code, data.data);
  }
};

SCSocket.prototype.getState = function () {
  return this.state;
};

SCSocket.prototype.getBytesReceived = function () {
  return this.transport.getBytesReceived();
};

SCSocket.prototype.removeAuthToken = function (callback) {
  var self = this;
  
  this.auth.removeToken(this.options.authTokenName, function (err) {
    callback && callback(err);
    if (err) {
      // Non-fatal error - Do not close the connection
      self._onSCError(err);
    } else {
      SCEmitter.prototype.emit.call(self, 'removeAuthToken');
    }
  });
};

SCSocket.prototype.connect = SCSocket.prototype.open = function () {
  var self = this;
  
  if (this.state == this.CLOSED) {
    clearTimeout(this._reconnectTimeout);
    
    this.state = this.CONNECTING;
    
    if (this.transport) {
      this.transport.off();
    }
    
    this.transport = new SCTransport(this.auth, this.options);

    this.transport.on('open', function (status) {
      self.state = self.OPEN;
      self._onSCOpen(status);
    });
    
    this.transport.on('error', function (err) {
      self._onSCError(err);
    });
    
    this.transport.on('close', function (code, data) {
      self.state = self.CLOSED;
      self._onSCClose(code, data);
    });
    
    this.transport.on('openAbort', function (code, data) {
      self.state = self.CLOSED;
      self._onSCClose(code, data, true);
    });
    
    this.transport.on('event', function (event, data, res) {
      self._onSCEvent(event, data, res);
    });
  }
};

SCSocket.prototype.reconnect = function () {
  this.disconnect();
  this.connect();
};

SCSocket.prototype.disconnect = function (code, data) {
  code = code || 1000;
  
  if (this.state == this.OPEN) {
    var packet = {
      code: code,
      data: data
    };
    this.transport.emit('#disconnect', packet);
    this.transport.close(code);
    
  } else if (this.state == this.CONNECTING) {
    this.transport.close(code);
  }
};

// Perform client-initiated authentication by providing an encrypted token string
SCSocket.prototype.authenticate = function (encryptedAuthToken, callback) {
  var self = this;
  
  this.emit('#authenticate', encryptedAuthToken, function (err, authStatus) {
    if (err) {
      callback && callback(err, authStatus);
    } else {
      self.auth.saveToken(self.options.authTokenName, encryptedAuthToken, {}, function (err) {
        callback && callback(err, authStatus);
        if (err) {
          self._onSCError(err);
        } else if (authStatus.isAuthenticated) {
          SCEmitter.prototype.emit.call(self, 'authenticate', encryptedAuthToken);
        }
      });
    }
  });
};

SCSocket.prototype._tryReconnect = function (initialDelay) {
  var self = this;
  
  var exponent = this._connectAttempts++;
  var reconnectOptions = this.options.autoReconnectOptions;
  var timeout;
  
  if (initialDelay == null || exponent > 0) {
    var initialTimeout = Math.round(reconnectOptions.initialDelay + (reconnectOptions.randomness || 0) * Math.random());
    
    timeout = Math.round(initialTimeout * Math.pow(reconnectOptions.multiplier, exponent));
  } else {
    timeout = initialDelay;
  }
  
  if (timeout > reconnectOptions.maxDelay) {
    timeout = reconnectOptions.maxDelay;
  }
  
  clearTimeout(this._reconnectTimeout);
  
  this._reconnectTimeout = setTimeout(function () {
    self.connect();
  }, timeout);
};

SCSocket.prototype._onSCOpen = function (status) {
  var self = this;
  
  if (status) {
    this.id = status.id;
    this.pingTimeout = status.pingTimeout;
    this.transport.pingTimeout = this.pingTimeout;
  }
  
  this._connectAttempts = 0;
  if (this.options.autoProcessSubscriptions) {
    this.processPendingSubscriptions();
  }
  
  // If the user invokes the callback while in autoProcessSubscriptions mode, it
  // won't break anything - The processPendingSubscriptions() call will be a no-op.
  SCEmitter.prototype.emit.call(this, 'connect', status, function () {
    self.processPendingSubscriptions();
  });
  
  this._flushEmitBuffer();
};

SCSocket.prototype._onSCError = function (err) {
  var self = this;
  
  // Throw error in different stack frame so that error handling
  // cannot interfere with a reconnect action.
  setTimeout(function () {
    if (self.listeners('error').length < 1) {
        throw err;
    } else {
      SCEmitter.prototype.emit.call(self, 'error', err);
    }
  }, 0);
};

SCSocket.prototype._suspendSubscriptions = function () {
  var channel, newState;
  for (var channelName in this._channels) {
    if (this._channels.hasOwnProperty(channelName)) {
      channel = this._channels[channelName];
      if (channel.state == channel.SUBSCRIBED ||
        channel.state == channel.PENDING) {
        
        newState = channel.PENDING;
      } else {
        newState = channel.UNSUBSCRIBED;
      }
      
      this._triggerChannelUnsubscribe(channel, newState);
    }
  }
};

SCSocket.prototype._onSCClose = function (code, data, openAbort) {
  var self = this;
  
  this.id = null;
  
  if (this.transport) {
    this.transport.off();
  }
  clearTimeout(this._reconnectTimeout);

  this._suspendSubscriptions();
  
  if (openAbort) {
    SCEmitter.prototype.emit.call(self, 'connectAbort', code, data);
  } else {
    SCEmitter.prototype.emit.call(self, 'disconnect', code, data);
  }
  
  // Try to reconnect
  // on server ping timeout (4000)
  // or on client pong timeout (4001)
  // or on close without status (1005)
  // or on handshake failure (4003)
  // or on socket hung up (1006)
  if (this.options.autoReconnect) {
    if (code == 4000 || code == 4001 || code == 1005) {
      // If there is a ping or pong timeout or socket closes without
      // status, don't wait before trying to reconnect - These could happen
      // if the client wakes up after a period of inactivity and in this case we
      // want to re-establish the connection as soon as possible.
      this._tryReconnect(0);
      
    } else if (code == 1006 || code == 4003) {
      this._tryReconnect();
    }
  }
  
  if (!SCSocket.ignoreStatuses[code]) {
    var err = new Error(SCSocket.errorStatuses[code] || 'Socket connection failed for unknown reasons');
    err.code = code;
    this._onSCError(err);
  }
};

SCSocket.prototype._onSCEvent = function (event, data, res) {
  var handler = this._privateEventHandlerMap[event];
  if (handler) {
    handler.call(this, data, res);
  } else {
    SCEmitter.prototype.emit.call(this, event, data, res);
  }
};

SCSocket.prototype.parse = function (message) {
  return this.transport.parse(message);
};

SCSocket.prototype.stringify = function (object) {
  return this.transport.stringify(object);
};

SCSocket.prototype._flushEmitBuffer = function () {
  var currentNode = this._emitBuffer.head;
  var nextNode;

  while (currentNode) {
    nextNode = currentNode.next;
    var eventObject = currentNode.data;
    currentNode.detach();
    this.transport.emitRaw(eventObject);
    currentNode = nextNode;
  }
};

SCSocket.prototype._handleEventAckTimeout = function (eventObject, eventNode) {
  var errorMessage = "Event response for '" + eventObject.event + "' timed out";
  var error = new Error(errorMessage);
  error.type = 'timeout';
  
  var callback = eventObject.callback;
  delete eventObject.callback;
  if (eventNode) {
    eventNode.detach();
  }
  callback.call(eventObject, error, eventObject);
  this._onSCError(error);
};

SCSocket.prototype._emit = function (event, data, callback) {
  var self = this;
  
  if (this.state == this.CLOSED) {
    this.connect();
  }
  var eventObject = {
    event: event,
    data: data,
    callback: callback
  };
  
  var eventNode = new LinkedList.Item();
  eventNode.data = eventObject;
  
  // Events which do not have a callback will be treated as volatile
  if (callback) {
    eventObject.timeout = setTimeout(function () {
      self._handleEventAckTimeout(eventObject, eventNode);
    }, this.ackTimeout);
  }
  this._emitBuffer.append(eventNode);
  
  if (this.state == this.OPEN) {
    this._flushEmitBuffer();
  }
};

SCSocket.prototype.emit = function (event, data, callback) {
  if (this._localEvents[event] == null) {
    this._emit(event, data, callback);
  } else {
    SCEmitter.prototype.emit.call(this, event, data);
  }
};

SCSocket.prototype.publish = function (channelName, data, callback) {
  var pubData = {
    channel: channelName,
    data: data
  };
  this.emit('#publish', pubData, function (err) {
    callback && callback(err);
  });
};

SCSocket.prototype._triggerChannelSubscribe = function (channel) {
  var channelName = channel.name;
  
  if (channel.state != channel.SUBSCRIBED) {
    channel.state = channel.SUBSCRIBED;
    
    channel.emit('subscribe', channelName);
    SCEmitter.prototype.emit.call(this, 'subscribe', channelName);
  }
};

SCSocket.prototype._triggerChannelSubscribeFail = function (err, channel) {
  var channelName = channel.name;
  
  if (channel.state != channel.UNSUBSCRIBED) {
    channel.state = channel.UNSUBSCRIBED;
    
    channel.emit('subscribeFail', err, channelName);
    SCEmitter.prototype.emit.call(this, 'subscribeFail', err, channelName);
  }
};

// Cancel any pending subscribe callback
SCSocket.prototype._cancelPendingSubscribeCallback = function (channel) {
  if (channel._pendingSubscriptionCid != null) {
    this.transport.cancelPendingResponse(channel._pendingSubscriptionCid);
    delete channel._pendingSubscriptionCid;
  }
};

SCSocket.prototype._trySubscribe = function (channel) {
  var self = this;
  
  // We can only ever have one pending subscribe action at any given time on a channel
  if (this.state == this.OPEN && channel._pendingSubscriptionCid == null) {
    var options = {
      noTimeout: true
    };

    channel._pendingSubscriptionCid = this.transport.emit(
      '#subscribe', channel.name, options,
      function (err) {
        delete channel._pendingSubscriptionCid;
        if (err) {
          self._triggerChannelSubscribeFail(err, channel);
        } else {
          self._triggerChannelSubscribe(channel);
        }
      }
    );
  }
};

SCSocket.prototype.subscribe = function (channelName) {
  var channel = this._channels[channelName];
  
  if (!channel) {
    channel = new SCChannel(channelName, this);
    this._channels[channelName] = channel;
  }

  if (channel.state == channel.UNSUBSCRIBED) {
    channel.state = channel.PENDING;
    this._trySubscribe(channel);
  }
  
  return channel;
};

SCSocket.prototype._triggerChannelUnsubscribe = function (channel, newState) {
  var channelName = channel.name;
  var oldState = channel.state;
  
  if (newState) {
    channel.state = newState;
  } else {
    channel.state = channel.UNSUBSCRIBED;
  }
  this._cancelPendingSubscribeCallback(channel);
  
  if (oldState == channel.SUBSCRIBED) {
    channel.emit('unsubscribe', channelName);
    SCEmitter.prototype.emit.call(this, 'unsubscribe', channelName);
  }
};

SCSocket.prototype._tryUnsubscribe = function (channel) {
  var self = this;
  
  if (this.state == this.OPEN) {
    var options = {
      noTimeout: true
    };
    // If there is a pending subscribe action, cancel the callback
    this._cancelPendingSubscribeCallback(channel);
    
    // This operation cannot fail because the TCP protocol guarantees delivery
    // so long as the connection remains open. If the connection closes,
    // the server will automatically unsubscribe the socket and thus complete
    // the operation on the server side.
    this.transport.emit('#unsubscribe', channel.name, options);
  }
};

SCSocket.prototype.unsubscribe = function (channelName) {

  var channel = this._channels[channelName];
  
  if (channel) {
    if (channel.state != channel.UNSUBSCRIBED) {
    
      this._triggerChannelUnsubscribe(channel);
      this._tryUnsubscribe(channel);
    }
  }
};

SCSocket.prototype.channel = function (channelName) {
  var currentChannel = this._channels[channelName];
  
  if (!currentChannel) {
    currentChannel = new SCChannel(channelName, this);
    this._channels[channelName] = currentChannel;
  }
  return currentChannel;
};

SCSocket.prototype.destroyChannel = function (channelName) {
  var channel = this._channels[channelName];
  channel.unwatch();
  channel.unsubscribe();
  delete this._channels[channelName];
};

SCSocket.prototype.subscriptions = function (includePending) {
  var subs = [];
  var channel, includeChannel;
  for (var channelName in this._channels) {
    if (this._channels.hasOwnProperty(channelName)) {
      channel = this._channels[channelName];
      
      if (includePending) {
        includeChannel = channel && (channel.state == channel.SUBSCRIBED || 
          channel.state == channel.PENDING);
      } else {
        includeChannel = channel && channel.state == channel.SUBSCRIBED;
      }
      
      if (includeChannel) {
        subs.push(channelName);
      }
    }
  }
  return subs;
};

SCSocket.prototype.isSubscribed = function (channel, includePending) {
  var channel = this._channels[channel];
  if (includePending) {
    return !!channel && (channel.state == channel.SUBSCRIBED ||
      channel.state == channel.PENDING);
  }
  return !!channel && channel.state == channel.SUBSCRIBED;
};

SCSocket.prototype.processPendingSubscriptions = function () {
  var self = this;
  
  var channels = [];
  for (var channelName in this._channels) {
    if (this._channels.hasOwnProperty(channelName)) {
      channels.push(channelName);
    }
  }
  
  for (var i in this._channels) {
    if (this._channels.hasOwnProperty(i)) {
      (function (channel) {
        if (channel.state == channel.PENDING) {
          self._trySubscribe(channel);
        }
      })(this._channels[i]);
    }
  }
};

SCSocket.prototype.watch = function (channelName, handler) {
  this._channelEmitter.on(channelName, handler);
};

SCSocket.prototype.unwatch = function (channelName, handler) {
  if (handler) {
    this._channelEmitter.removeListener(channelName, handler);
  } else {
    this._channelEmitter.removeAllListeners(channelName);
  }
};

SCSocket.prototype.watchers = function (channelName) {
  return this._channelEmitter.listeners(channelName);
};

module.exports = SCSocket;
