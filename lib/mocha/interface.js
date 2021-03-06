
/**
 * Module dependencies.
 */

var Promise = require('es6-promise').Promise;
var helpers = require('../browser/helpers');
var Meteor  = require('../meteor');
var tools   = require('../tools');
var Mocha   = require('mocha');
var Fiber   = require('fibers');
var Future  = require('fibers/future');
var url     = require('url');
var mkdirp  = require('mkdirp');
var logs    = require('../logs');
var fs      = require('fs');

var istanbul = require('istanbul-lib-coverage');

var deleteFolderRecursive = function(path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function(file, index){
      var curPath = path + "/" + file;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

var path = require('path');

Mocha.prototype.loadFiles = function (fn) {
  var self = this;
  var suite = this.suite;
  this.files.forEach(function (file) {
    new Fiber(function(){
      file = path.resolve(file);
      suite.emit('pre-require', global, file, self);
      suite.emit('require', require(file), file, self);
      suite.emit('post-require', global, file, self);
    }).run()
  });
  fn && fn();
};


/**
 * Custom Mocha interface.
 */
Mocha.interfaces['gagarin'] = function (suite) {
  // use the original bdd intrface
  Mocha.interfaces.bdd.apply(this, arguments);

  var gagarinOptions = global.gagarinOptions = global.options;
  var gagarinSettings = global.gagarinSettings = (global.options && global.options.settings) ? tools.getSettings(global.options.settings) : {}; // make sure it's not undefined

  // clean up on new runs
  // deleteFolderRecursive(`${gagarinOptions.pathToApp}/.gagarin/tmp`);
  // folders for gagarin
  // .gagarin is used as the build folder
  mkdirp.sync(`${gagarinOptions.pathToApp}/.gagarin`)
  // code is used to dump execute/promise etc code during a suite run for verbose debugging
  mkdirp.sync(`${gagarinOptions.pathToApp}/.gagarin/tmp/code`)
  // coverage is used for json reports of code coverage via babel-plugins-istanbul
  mkdirp.sync(`${gagarinOptions.pathToApp}/.gagarin/tmp/coverage`)

  suite.on('pre-require', function (context) {

    var chai       = require('chai');
    var before     = context.before;
    var after      = context.after;
    var beforeEach = context.beforeEach;
    var afterEach  = context.afterEach;
    var stack      = [];


    // adding Fiber support
    context.Fiber = Fiber;

    var originalIt = context.it;

    context.it = runInsideFiber(context.it, suite);
    context.it.skip = runInsideFiber(originalIt.skip, suite);
    context.it.only = runInsideFiber(originalIt.only, suite);
    context.specify = context.it;
    context.xspecify = context.xit = context.it.skip;

    context.before = runInsideFiber(context.before, suite);
    context.beforeEach = runInsideFiber(context.beforeEach, suite);
    context.after = runInsideFiber(context.after, suite);
    context.afterEach = runInsideFiber(context.afterEach, suite)

    // TODO: allow users to configure the default asserters
    chai.use(require('chai-things'));

    context.expect = chai.expect;

    context.inject = function(file, environments){
      var onClient = false;
      var onServer = false;

      if(environments == 'client')
        onClient = true;
      if(environments == 'server')
        onServer = true;
      
      if((environments && environments[0] == 'client') || (environments && environments[1] == 'client'))
        onClient = true;
      if((environments && environments[0] == 'server') || (environments && environments[1] == 'server'))
        onServer = true;

      if(onClient){
        var code = fs.readFileSync(file, 'utf8');
        code = "function(){\n\n" + code.toString() + "\n\n}";
        process.browser.execute(code, [], true);
      }
      if(onServer){
        var code = fs.readFileSync(file, 'utf8');
        code = "function(){\n\n" + code.toString() + "\n\n}";
        process.server.execute(code, [], true);
      }
    }

    context.meteor = function (options, onStart) {

      var myHelpers = {};

      options = options || {};
      options.flavor = options.flavor || gagarinOptions.flavor || "promise";

      if (typeof options === 'function') {
        onStart = options; options = {};
      }

      if (typeof options === 'string') {
        options = { pathToApp: options };
      }

      tools.mergeHelpers(myHelpers, options.helpers);
      var meteor = new Meteor({
        pathToApp             : options.pathToApp || gagarinOptions.pathToApp,
        helpers               : myHelpers,
        settings              : tools.getSettings(options.settings) || gagarinSettings,
        verbose               : options.verbose !== undefined ? options.verbose : gagarinOptions.verbose,
        remoteServer          : options.remoteServer || gagarinOptions.remoteServer,
        skipBuild             : options.skipBuild !== undefined ? options.skipBuild : gagarinOptions.skipBuild,
        startupTimeout        : options.startupTimeout !== undefined ? options.startupTimeout : gagarinOptions.startupTimeout,
        startupTimeout2       : options.startupTimeout2, // this one is only used for internal tests
      });

      if (!options.noAutoStart) {
        before(function () {
          logs.test("starting meteor instance");
          return meteor.init().startup(onStart).then(function () {
            logs.test("meteor instance ready");
          }).catch(function(err){
            throw err
          });
        });

        after(function () {
          logs.test("stopping meteor instance");

          if(gagarinOptions.coverage){
            return meteor.execute(function(){
              return JSON.stringify(global.__coverage__);
            }).then(function(coverage){
              fs.writeFileSync(`${gagarinOptions.pathToApp}/.gagarin/tmp/coverage/server.json`, coverage);
            }).stop().then(function () {
              logs.test("meteor instance terminated");
            });
          }
        });

      } else {
        if (onStart) {
          console.warn('onStart will not work with noAutoStart option set to true');
        }
      }

      if (options.flavor == "fiber") {
        var proxy = wrapPromisesForFiber(meteor, meteor.methods);
        proxy.getDDPSetup = meteor.getDDPSetup;
        return proxy;
      } else {
        return meteor;
      }
    }

    context.browser = function (location, options, initialize) {
      var createBrowser = require('../browser');

      var myHelpers = {};

      if (arguments.length === 2) {
        if (typeof options === 'function') {
          initialize = options; options = location; location = undefined;
        }
      }

      if (arguments.length === 1) {
        if (typeof location === 'function') {
          initialize = location; options = {}; location = undefined;
        } else {
          options = location; location = undefined;  
        }
      }

      if (arguments.length === 0) {
        options = {};
      }

      if (location && typeof options !== 'object') {
        throw new Error("if 'location' is provided, argument 'options' must be an object");
      }

      if (!options || (typeof options !== 'object' && typeof options !== 'string')) {
        throw new Error("argument 'options' must be an object or a string");
      }

      if (location && typeof location !== 'string' && location.getDDPSetup === undefined) {
        throw new TypeError("argument 'location' must be a string or an instance of meteor server");
      }

      if (location && options.getDDPSetup) {
        throw new TypeError("if 'location' is provided, argument 'options' must not be an instance of meteor server");
      }

      if (location) {
        options.location = location;
      }

      if (typeof options === 'string') {
        options = { location: options };
      }

      if (options && options.getDDPSetup) {
        options = { location: options };
      }

      if (!options.location) {
        options.location = 'http://gagarin.meteor.com';
      }

      options.flavor = options.flavor || gagarinOptions.flavor || "promise";

      tools.mergeHelpers(myHelpers, options.helpers);

      logs.system("WebDriver capabilities: " + JSON.stringify(options.capabilities));
      var browser = createBrowser({
        helpers           : myHelpers,
        verbose           : options.verbose !== undefined ? options.verbose : gagarinOptions.verbose,
        location          : options.location,
        webdriver         : options.webdriver || gagarinOptions.webdriver,
        windowSize        : options.windowSize,
        capabilities      : options.capabilities,
        dontWaitForMeteor : options.dontWaitForMeteor !== undefined ? options.dontWaitForMeteor : gagarinOptions.dontWaitForMeteor,
        meteorLoadTimeout : options.meteorLoadTimeout !== undefined ? options.meteorLoadTimeout : gagarinOptions.meteorLoadTimeout,
      });

      before(function () {

        logs.test("starting browser instance");

        return browser.init().then(function () {
          logs.test("browser instance ready");
          if (typeof initialize === 'function') {
            return initialize.length ? browser.promise(initialize) : browser.execute(initialize);
          }
        });

      });

      // after(function () {
      //   logs.test("stopping browser instance");
      //
      //   return browser.execute(function(){
      //     return {};
      //   }).then(function () {
      //     return new Promise((resolve, reject)=>{
      //
      //       resolve()
      //       logs.test("browser instance terminated");
      //
      //     })
      //   });
      // });

      if(gagarinOptions.coverage){
        afterEach(function () {
          // logs.test("browser coverage collecting");
          return browser.promise(function(done){
            try {
              done(JSON.stringify( (window || global || this) ? (window || global || this).__coverage__ : {}));
            } catch (err){
              console.log("No coverage available", err);
              done(JSON.stringify({}));
            }
          })
          .then(function(coverage){
            coverage = JSON.parse(coverage);
            var previous = fs.existsSync(`${gagarinOptions.pathToApp}/.gagarin/tmp/coverage/client.json`) ? JSON.parse(fs.readFileSync(`${gagarinOptions.pathToApp}/.gagarin/tmp/coverage/client.json`).toString()) : {};
            var coverageMap = istanbul.createCoverageMap(previous);
            coverageMap.merge(coverage);
            fs.writeFileSync(`${gagarinOptions.pathToApp}/.gagarin/tmp/coverage/client.json`, JSON.stringify(coverageMap, null, 2));
            // logs.test("browser coverage updated");
          });
        });
      }

      return (options.flavor == "fiber")? wrapPromisesForFiber(browser, browser.methods) : browser;
    }

    context.ddp = function (server, options) {

      var makeDDPClient = require('../ddp');
      var getDDPSetup = null;

      options = options || {};
      options.flavor = options.flavor || gagarinOptions.flavor || "promise";

      if (server.getDDPSetup) {
        getDDPSetup = server.getDDPSetup;
      }

      if (typeof server === 'string') {
        getDDPSetup = function () {
          var parsed = url.parse(server);
          return Promise.resolve({
            host: parsed.hostname,
            port: parsed.port || 443,
          });
        };
      }

      if (!getDDPSetup) {
        throw new Error('DDP: no server connection provided');
      }

      var ddp = makeDDPClient(getDDPSetup, options.helpers);

      return (options.flavor === 'fiber') ? wrapPromisesForFiber(ddp, ddp.methods) : ddp;

    }

    context.mongo = function (options) {

      var makeMongoDB = require('../mongo');

      options = options || {};
      options.flavor = options.flavor || gagarinOptions.flavor || "promise";

      if (typeof options === 'function') {
        initialize = options; options = {};
      }

      if (typeof options === 'string') {
        options = { pathToApp: options };
      }

      var mongo = makeMongoDB({
        pathToApp : options.pathToApp || gagarinOptions.pathToApp,
        dbPath    : options.dbPath,
        dbName    : options.dbName,
        mongoUrl  : options.mongoUrl,
      }, options.helpers);

      before(function () {
        console.log("MONGO START");
        return mongo.start();
      });

      after(function () {
        return mongo.stop();
      });

      return mongo;
    }

    context.settings = JSON.parse(JSON.stringify(gagarinSettings)); // deep copy :P
  });
}

function stringify(value) {
  if (typeof value === 'function') {
    throw new Error('cannot use function as a variable');
  }
  return value !== undefined ? JSON.stringify(value) : "undefined";
}

function wrapPromisesForFiber(obj, methodList) {
  var proxy = {};

  methodList.forEach(function(method) {
    var original = obj[method];
    try {
      proxy[method] = function() {
        var f = new Future();

        var promise = original.apply(obj, arguments);
        promiseAsThunk(promise)(function(error, value) {
          if (error) {
            f.throw(error);
          } else {
            f.return(value);
          }
        });
        return f.wait();
      };
    } catch (error){
      throw error;
    }
  });

  return proxy;
}

function promiseAsThunk(promise, done) {
  return function(done) {
    promise.then(function(value) {
      done(null, value);
    }).catch(function(error) {
      done(error);
    });
  };
}

function runInsideFiber (originalFunction, suite) {
  originalFunction = originalFunction.bind(suite)

  var fiberizeFunction = function(name, fn) {
    
    if (typeof name == "function") {
      fn = name;
      name = null;
    }

    if (fn) {
      return originalFunction(name, function(done) {
        new Fiber(
          function() {
            if (fn.length > 0) {
              fn.apply(suite, [done]);
            } else {
              var promise = fn();
              if (promise) {
                promiseAsThunk(promise)(done);
              } else {
                done();
              }
            }
          }.bind(suite)
      ).run();
      });
    }
    return originalFunction(name);
  };


  return fiberizeFunction.bind(suite);
}
