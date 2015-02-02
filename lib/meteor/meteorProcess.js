var spawn = require('child_process').spawn;

var processCounter = 0;

/**
 * Creates a smart meteor instance, suitable for usage with the testing framework.
 *
 * @param {string} path to node executable
 * @param {string} path to applciation main file
 * @param {object} environment variables for the new process
 * @param {object} prototype for the returned object
 * @param {object} options; may contain safetyTimeout value
 *
 * The prototype may implement the following methods
 * - onStart ()
 * - onExit ()
 * - onData (data, { isError: true/false })
 */
module.exports = function createMeteorProcess (node, main, env, myPrototype, options) {
  "use strict";

  options = options || {};

  var instance      = Object.create(myPrototype);
  var meteor        = null;
  var lastError     = "";
  var lastErrorAt   = "nowhere";
  var safetyTimeout = options.safetyTimeout !== undefined ? options.safetyTimeout : 5 * 1000;
  var safetyHandle  = null;

  instance.env = env;
  instance.pid = processCounter++; // the only requirement is that it stays unique "locally"

  instance.kill = kill;

  setTimeout(function () {
    try {
      meteor = spawn(node, [ main ], { env: env });
    } catch (err) {
      return instance.onStart && instance.onStart(err);
    }

    safetyHandle = setTimeout(function () {
      kill(function (err) {
        if (instance.onStart) {
          if (err) {
            instance.onStart(err);
          } else {
            instance.onStart(new Error('Gagarin is not there.' +
              ' Please make sure you have added it with: meteor add anti:gagarin.'));
          }
        }
      });
    }, safetyTimeout);

    meteor.stdout.on('data', function (data) {

      if (/Поехали!/.test(data.toString())) {
        clearTimeout(safetyHandle);
        //-------------------------------------
        instance.onStart && instance.onStart();
      }

      instance.onData && instance.onData(data);

    });

    // make sure we kill meteor on process exit
    process.once('exit', onProcessExit);

    meteor.stderr.on('data', function (data) { // look for errors

      instance.onData && instance.onData(data, { isError: true });

      data.toString().split('\n').forEach(function (line) {
        var hasMatch = [
          {
            regExp: /Error\:\s*(.*)/,
            action: function (match) {
              lastError   = match[1];
              lastErrorAt = '';
            },
          },
          {
            regExp: /at\s.*/,
            action: function (match) {
              if (!lastErrorAt) {
                lastErrorAt = match[0];
              }
            },
          },
        ].some(function (options) {
          var match = options.regExp.exec(line);
          if (match) {
            options.action.call(null, match);
            return true;
          }
        });
        if (lastError && !hasMatch) {
          lastError += '\n' + line;
        }
      });
    });

    meteor.on('exit', function (code) {
      clearTimeout(safetyHandle);
      //-------------------------
      if (instance.onExit) {
        instance.onExit(code, lastError, lastErrorAt);
      }
      meteor = null;
    });

  });

  /**
   * Kill the meteor process and cleanup.
   *
   * @param {Function} cb
   */
  function kill (cb) {
    if (!meteor) {
      return cb();
    }
    meteor.once('exit', function (code) {
      if (!code || code === 0 || code === 130) {
        cb();
      } else {
        cb(new Error('exited with code ' + code));
      }
    });
    meteor.kill('SIGINT');
    meteor = null;
    //--------------------------------------------
    process.removeListener('exit', onProcessExit);
  }

  function onProcessExit() {
    meteor && meteor.kill();
    meteor = null;
  }

  return instance;

}
