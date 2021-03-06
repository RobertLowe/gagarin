
var createBrowserManager = require('./browserManager');
var browserMethods       = require('./methods');
var browserHelpers       = require('./helpers');
var generic              = require('../tools/generic');
var chalk                = require('chalk');
var logs                 = require('../logs');

module.exports = function createBrowser (options) {
  var verbose = !!options.verbose;
  var helpers = options.helpers || {};

  var myPrototype = Object.create(helpers);

  myPrototype.init = function () {
    return this.branch().then(function () {
      // ...
    });
  }

  myPrototype.browser = function () {
    // logs.client("Quiting browser: " + JSON.stringify(options));
    return this._operand().then(function(operand){
      return operand.browser;
    })
  }
  myPrototype.quit = function () {
    logs.client("Quiting browser: " + JSON.stringify(options));
    return this._operand().then(function(operand){
      operand.browser['quit']();
    })
  }
  myPrototype.quit = function () {
    logs.client("Closing browser: " + JSON.stringify(options));
    return this._operand().then(function(operand){
      operand.browser['quit']();
    })
  }

  var methods = [
    // these methods are copy/pasted from wd
    'newWindow',
    'status',
    'get',
    'refresh',
    'maximize',
    'getWindowSize',
    'setWindowSize',
    'forward',
    'back',
    'takeScreenshot',
    'saveScreenshot',
    'title',
    'allCookies',
    'setCookie',
    'deleteAllCookies',
    'deleteCookie',
    'keys'
    // seems like it's not working well
    // 'getLocation',
  ];

  // TODO: early detect colisions

  Object.keys(browserMethods).forEach(function (name) {
    myPrototype[name] = browserMethods[name];
  });

  Object.keys(browserHelpers).forEach(function (name) {
    myPrototype[name] = browserHelpers[name];
  });

  var logsCache = [];

  myPrototype.getLogs = function () {
    if (verbose) {
      return this.then(function () {
        var listOfLogs = logsCache;
        logsCache = [];
        return listOfLogs;
      });
    } else {
      return this.__custom__(function (operand, done) {
        operand.browser.log('browser', done);
      });
    }
  }

  function getClientLogs (action) {
    return function (operand, done) {
      return action.call(this, operand, function (err) {
        var args = Array.prototype.slice.call(arguments, 0);
        if (err) {
          done(err);
        } else {
          operand.browser.log('browser', function (err, listOfLogs) {
            if (!err) {
              listOfLogs.forEach(function (logEntry) {
                logs.client(logEntry.message);
              });
              logsCache.push.apply(logsCache, listOfLogs);
            }

            // wat
            done.apply(this, args);
          });
        }
      });
    }
  }

  var BrowserGeneric = generic(methods, myPrototype, {
    action: function (operand, name, args, done) {
      if (!operand.browser) {
        done(new Error('operand.browser is undefined'));
      } else if (!operand.browser[name]) {
        done(new Error('operand.browser does not implement method: ' + name));
      } else {
        args.push(done);
        operand.browser[name].apply(operand.browser, args);
      }
    },
    // transform: options.verbose && getClientLogs
  });

  var Browser = function () {

    var getBrowser = createBrowserManager(options);
    function operand () {
      return getBrowser().then(function (browser) {
        return { browser: browser };
      });
    }


    BrowserGeneric.call(this, operand);

  };

  Browser.prototype = Object.create(new BrowserGeneric(), {
    methods: { value: [].concat(Object.keys(myPrototype), Object.keys(helpers), BrowserGeneric.prototype.methods) }
  });

  return new Browser();

}

