var Emitter = require('emitter');

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

var SCChannel = function (name, socket) {
  var self = this;
  
  Emitter.call(this);
  
  this.name = name;
  this.active = socket.isSubscribed(this.name);
  this.socket = socket;
  
  var subscribeEvent = 'subscribe';
  var subscribeFailEvent = 'subscribeFail';
  
  var unsubscribeEvent = 'unsubscribe';
  
  this.socket.on(subscribeEvent + ':' + this.name, function () {
    if (!self.active) {
      self.active = true;
      self.emit(subscribeEvent, self.name);
    }
  });
  this.socket.on(subscribeFailEvent + ':' + this.name, function (err) {
    self.emit(subscribeFailEvent, err, self.name);
  });
  
  this.socket.on(unsubscribeEvent + ':' + this.name, function () {
    self.active = false;
    self.emit(unsubscribeEvent);
  });
};

SCChannel.prototype = Object.create(Emitter.prototype);

SCChannel.prototype.publish = function (data, callback) {
  this.socket.publish(this.name, data, callback);
};

SCChannel.prototype.watch = function (handler) {
  this.socket.watch(this.name, handler);
};

SCChannel.prototype.unwatch = function (handler) {
  this.socket.unwatch(this.name, handler);
};

module.exports = SCChannel;