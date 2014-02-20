/**
 * Module dependencies.
 */

var util = require('./util');
var Emitter = require('./emitter');
var Socket = require('./socket');

/**
 * Module exports.
 */

if (!Object.create) {
	Object.create = (function () {
		function F() {};

		return function (o) {
			if (arguments.length != 1) {
				throw new Error('Object.create implementation only accepts one parameter.');
			}
			F.prototype = o;
			return new F();
		}
	})();
}

var Response = function (socket, id) {
	this.socket = socket;
	this.id = id;
};

Response.prototype._respond = function (responseData) {
	this.socket.send(this.socket.JSON.stringify(responseData));
};

Response.prototype.end = function (data) {
	if (this.id) {
		var responseData = {
			cid: this.id
		};
		if (data !== undefined) {
			responseData.data = data;
		}
		this._respond(responseData);
	}
};

Response.prototype.error = function (error, data) {
	if (this.id) {
		var err;
		if(error instanceof Error) {
			err = {name: error.name, message: error.message, stack: error.stack};			
		} else {
			err = error;
		}
		
		var responseData = {
			cid: this.id,
			error: err
		};
		if (data !== undefined) {
			responseData.data = data;
		}
		
		this._respond(responseData);
	}
};

var isBrowser = typeof window != 'undefined';

if (isBrowser) {
	var ActivityManager = function () {
		var self = this;
		
		this._interval = null;
		this._intervalDuration = 1000;
		this._counter = null;
		
		if (window.addEventListener) {
			window.addEventListener('blur', function () {
				self._triggerBlur();
			});
			window.addEventListener('focus', function () {
				self._triggerFocus();
			});
		} else if (window.attachEvent) {
			window.attachEvent('onblur', function () {
				self._triggerBlur();
			});
			window.attachEvent('onfocus', function () {
				self._triggerFocus();
			});
		} else {
			throw new Error('The browser does not support proper event handling');
		}
	};

	ActivityManager.prototype = Object.create(Emitter.prototype);

	ActivityManager.prototype._triggerBlur = function () {
		var self = this;
		
		var now = (new Date()).getTime();
		this._counter = now;
		
		// If interval skips 2 turns, then client is sleeping
		this._interval = setInterval(function () {
			var newCount = (new Date()).getTime();
			if (newCount - self._counter < self._intervalDuration * 3) {
				self._counter = newCount;
			}
		}, this._intervalDuration);
		
		this.emit('deactivate');
	};

	ActivityManager.prototype._triggerFocus = function () {
		clearInterval(this._interval);
		var now = (new Date()).getTime();
		if (this._counter != null && now - this._counter >= this._intervalDuration * 3) {
			this.emit('wakeup');
		}
		
		this.emit('activate');
	};

	var activityManager = new ActivityManager();
}

var ClusterSocket = function (options, namespace) {
	var self = this;
	
	options = options || {};
	
	Socket.call(this, options);
	
	this._sessionDestRegex = /^([^_]*)_([^_]*)_([^_]*)_([^_]*)_/;
	
	this._localEvents = {
		'connect': 1,
		'disconnect': 1,
		'upgrading': 1,
		'upgrade': 1,
		'open': 1,
		'error': 1,
		'packet': 1,
		'heartbeat': 1,
		'data': 1,
		'message': 1,
		'handshake': 1,
		'drain': 1,
		'flush': 1,
		'packetCreate': 1,
		'close': 1
	};
	
	if (options.autoReconnect && options.autoReconnectOptions == null) {
		options.autoReconnectOptions = {
			delay: 10,
			randomness: 10
		}
	}
	
	this.options = options;
	this.namespace = namespace || '__';
	this.connected = false;
	this.connecting = true;
	
	this._cid = 1;
	this._callbackMap = {};
	this._destId = null;
	this._emitBuffer = [];
	
	Socket.prototype.on.call(this, 'error', function (err) {
		self.connecting = false;
		self._emitBuffer = [];
	});
	
	Socket.prototype.on.call(this, 'close', function () {
		self.connected = false;
		self.connecting = false;
		self._emitBuffer = [];
		Emitter.prototype.emit.call(self, 'disconnect');
		
		if (self.options.autoReconnect) {
			var reconnectOptions = self.options.autoReconnectOptions;
			var timeout = Math.round((reconnectOptions.delay + (reconnectOptions.randomness || 0) * Math.random()) * 1000);
			setTimeout(function () {
				if (!self.connected && !self.connecting) {
					self.connect();
				}
			}, timeout);
		}
	});
	
	Socket.prototype.on.call(this, 'message', function (message) {
		var e = self.JSON.parse(message);
		if(e.event) {
			if (e.event == 'connect') {
				self.connected = true;
				self.connecting = false;
				var ev;
				for (var i in self._emitBuffer) {
					ev = self._emitBuffer[i];
					self._emit(ev.ns, ev.event, ev.data, ev.callback);
				}
				self._emitBuffer = [];
				self.ssid = self._setSessionCookie(e.data.appName, self.id);
				Emitter.prototype.emit.call(self, 'connect', e.data.soid);	
			} else if (e.event == 'disconnect') {
				self.connected = false;
				self.connecting = false;
				Emitter.prototype.emit.call(self, 'disconnect');
			} else {
				var eventName = e.ns + '.' + e.event;
				var response = new Response(self, e.cid);
				Emitter.prototype.emit.call(self, eventName, e.data, response);
			}
		} else if (e.cid != null) {
			var ret = self._callbackMap[e.cid];
			if (ret) {
				clearTimeout(ret.timeout);
				delete self._callbackMap[e.cid];
				ret.callback(e.error, e.data);
			}
		}
	});
	
	if (isBrowser) {
		activityManager.on('wakeup', function () {
			self.close();
			self.connect();
		});
	}
};

ClusterSocket.prototype = Object.create(Socket.prototype);

ClusterSocket.prototype._setCookie = function (name, value, expirySeconds) {
	var exdate = null;
	if (expirySeconds) {
		exdate = new Date();
		exdate.setTime(exdate.getTime() + Math.round(expirySeconds * 1000));
	}
	var value = escape(value) + '; path=/;' + ((exdate == null) ? '' : ' expires=' + exdate.toUTCString() + ';');
	document.cookie = name + '=' + value;
};

ClusterSocket.prototype._getCookie = function (name) {
	var i, x, y, ARRcookies = document.cookie.split(';');
	for (i = 0; i < ARRcookies.length; i++) {
		x = ARRcookies[i].substr(0, ARRcookies[i].indexOf('='));
		y = ARRcookies[i].substr(ARRcookies[i].indexOf('=') + 1);
		x = x.replace(/^\s+|\s+$/g, '');
		if (x == name) {
			return unescape(y);
		}
	}
};

ClusterSocket.prototype._setSessionCookie = function (appName, socketId) {
	var sessionSegments = socketId.match(this._sessionDestRegex);
	var soidDest = sessionSegments ? sessionSegments[0] : null;
	var sessionCookieName = 'n/' + appName + '/ssid';
	
	var ssid = this._getCookie(sessionCookieName);
	var ssidDest = null;
	if (ssid) {
		ssidDest = ssid.match(this._sessionDestRegex);
		ssidDest = ssidDest ? ssidDest[0] : null;
	}
	if (!ssid || soidDest != ssidDest) {
		ssid = socketId;
		this._setCookie(sessionCookieName, ssid);
	}
	return ssid;
};

ClusterSocket.prototype.ns = function (namespace) {
	return new NS(namespace, this);
};

ClusterSocket.prototype.connect = ClusterSocket.prototype.open = function () {
	if (!this.connected && !this.connecting) {
		this.connected = false;
		this.connecting = true;
		Socket.prototype.open.apply(this, arguments);
	}
};

ClusterSocket.prototype._nextCallId = function () {
	return this.namespace + '-' + this._cid++;
};

ClusterSocket.prototype.createTransport = function () {
	return Socket.prototype.createTransport.apply(this, arguments);
};

ClusterSocket.prototype._emit = function (ns, event, data, callback) {
	var eventObject = {
		ns: ns,
		event: event
	};
	if (data !== undefined) {
		eventObject.data = data;
	}
	if (callback) {
		var self = this;
		var cid = this._nextCallId();
		eventObject.cid = cid;
		
		var timeout = setTimeout(function () {
			delete self._callbackMap[cid];
			callback('Event response timed out', eventObject);
		}, this.pingTimeout);
		
		this._callbackMap[cid] = {callback: callback, timeout: timeout};
	}
	Socket.prototype.send.call(this, this.JSON.stringify(eventObject));
};

ClusterSocket.prototype.emit = function (event, data, callback) {
	if (this._localEvents[event] == null) {
		if (this.connected) {
			this._emit(this.namespace, event, data, callback);
		} else {
			this._emitBuffer.push({ns: this.namespace, event: event, data: data, callback: callback});
			if (!this.connecting) {
				this.connect();
			}
		}
	} else {
		Emitter.prototype.emit.call(this, event, data);
	}
};

ClusterSocket.prototype.on = function (event, listener) {
	if (this._localEvents[event] == null) {
		var eventName = this.namespace + '.' + event;
		Emitter.prototype.on.call(this, eventName, listener);
	} else {
		Emitter.prototype.on.apply(this, arguments);
	}
};

ClusterSocket.prototype.once = function (event, listener) {
	if (this._localEvents[event] == null) {
		var eventName = this.namespace + '.' + event;
		Emitter.prototype.once.call(this, eventName, listener);
	} else {
		Emitter.prototype.once.apply(this, arguments);
	}
};

ClusterSocket.prototype.removeListener = function (event, listener) {
	if (this._localEvents[event] == null) {
		var eventName = this.namespace + '.' + event;
		Emitter.prototype.removeListener.call(this, eventName, listener);
	} else {
		Emitter.prototype.removeListener.apply(this, arguments);
	}
};

ClusterSocket.prototype.removeAllListeners = function (event) {
	if (event) {
		event = this.namespace + '.' + event;
	}
	Emitter.prototype.removeAllListeners.call(this, event);
};

ClusterSocket.prototype.listeners = function (event) {
	event = this.namespace + '.' + event;
	Emitter.prototype.listeners.call(this, event);
};

ClusterSocket.JSON = ClusterSocket.prototype.JSON = require('./json').JSON;

var NS = function (namespace, socket) {
	var self = this;
	
	// Generate methods which will apply the namespace to all calls on the underlying socket.
	for (var i in socket) {
		if (socket[i] instanceof Function) {
			(function (j) {
				self[j] = function () {
					var prevNS = socket.namespace;
					socket.namespace = namespace;
					socket[j].apply(socket, arguments);
					socket.namespace = prevNS;
				};
			})(i);
		} else {
			this[i] = socket[i];
		}
	}
	
	this.ns = function () {
		return socket.ns.apply(socket, arguments);
	};
};

module.exports = ClusterSocket;