var Emitter = require('emitter');

if (!Object.create) {
  Object.create = require('./objectcreate');
}

var ActivityManager = function () {
  var self = this;
  
  this._interval = null;
  this._intervalDuration = 1000;
  this._counter = null;
  
  if (global.addEventListener) {
    global.addEventListener('blur', function () {
      self._triggerBlur();
    });
    global.addEventListener('focus', function () {
      self._triggerFocus();
    });
  } else if (global.attachEvent) {
    global.attachEvent('onblur', function () {
      self._triggerBlur();
    });
    global.attachEvent('onfocus', function () {
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

module.exports.ActivityManager = ActivityManager;
