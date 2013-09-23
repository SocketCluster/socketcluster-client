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

var ClusterSocket = function (options, namespace) {
	var self = this;
	
	options = options || {};
	
	Socket.call(this, options);
	
	this._localEvents = {
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
	
	this.options = options;
	this.namespace = namespace || '__';
	this.connected = false;
	
	this._cid = 1;
	this._callbackMap = {};
	this._destId = null;
	
	Socket.prototype.on.call(this, 'message', function (message) {
		var e = self.JSON.parse(message);
		
		if(e.event) {
			if (e.event == 'connect') {
				self.connected = true;
			} else if (e.event == 'close') {
				self.connected = false;
			}
			var eventName = e.ns + '.' + e.event;
			var response = new Response(self, e.cid);
			Emitter.prototype.emit.call(self, eventName, e.data, response);
		} else if (e.cid != null) {
			var ret = self._callbackMap[e.cid];
			if (ret) {
				clearTimeout(ret.timeout);
				delete self._callbackMap[e.cid];
				ret.callback(e.error, e.data);
			}
		}
	});
};

ClusterSocket.prototype = Object.create(Socket.prototype);

ClusterSocket.prototype.ns = function (namespace) {
	return new NS(namespace, this);
};

ClusterSocket.prototype._nextCallId = function () {
	return this.namespace + '-' + this._cid++;
};

ClusterSocket.prototype.createTransport = function () {
	return Socket.prototype.createTransport.apply(this, arguments);
};

ClusterSocket.prototype.emit = function (event, data, callback) {
	if (this._localEvents[event] == null) {
		var eventObject = {
			ns: this.namespace,
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