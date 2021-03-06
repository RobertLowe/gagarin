var cleanError = require('../tools').cleanError;
var either     = require('../tools').either;
var logs       = require('../logs');
var fs         = require('fs');

// for loadChai, load once
var path       = require('path');

module.exports = {};

module.exports.execute = function (code, args) {

  var originalError = new Error();
  var self =  this;

  if (args === undefined) {
    args = [];
  }

  if (typeof code !== 'string' && typeof code !== 'function') {
    throw new Error('`code` has to be either string or a function')
  }

  if (!Array.isArray(args)) {
    throw new Error('`args` has to be an array');
  }


  return self.__custom__(function (operand, done) {
    
    var context = this;

    if(gagarinOptions.logJs){
      var debugPath = `${gagarinOptions.pathToApp}/.gagarin/tmp/code/execute-${Math.random().toString().split(".")[1]}.js`;
      fs.writeFileSync(debugPath, code.toString());
      logs.client(`Execute: ${debugPath}`)
    }

    operand.browser.execute(
      `
      either = function (first) {
        return {
          or: function (second) {
            return function (arg1, arg2) {
              return arg1 ? first(arg1) : second(arg2);
            };
          }
        };
      };

      return ( 
        ${wrapSourceCode(codeToString(code, originalError), args.map(stringify), context, originalError) }
      ).apply(null, arguments)
      `,
      feedbackProcessor(
        getSetter({}), 
        done,
        originalError
      )
    );

  }, function (err, retry) {
    throw err;
  });
};

module.exports.import = function (library, code, args) {

  var originalError = new Error();
  var self =  this;

  if (args === undefined) {
    args = [];
  }

  if (typeof code !== 'string' && typeof code !== 'function') {
    throw new Error('`code` has to be either string or a function')
  }

  if (!Array.isArray(args)) {
    throw new Error('`args` has to be an array');
  }

  return self.__custom__(function (operand, done) {

    var context = this;

    if(gagarinOptions.logJs){
      var debugPath = `${gagarinOptions.pathToApp}/.gagarin/tmp/code/import-${Math.random().toString().split(".")[1]}.js`;
      fs.writeFileSync(debugPath, code.toString());
      logs.client(`Import: ${debugPath}`)
    }

    operand.browser.execute(
      `
      either = function (first) {
        return {
          or: function (second) {
            return function (arg1, arg2) {
              return arg1 ? first(arg1) : second(arg2);
            };
          }
        };
      };

      return ( 
        ${wrapSourceCode(codeToString(code, originalError), args.map(stringify), context, originalError, library) }
      ).apply(null, arguments)
      `,
      feedbackProcessor(
        getSetter({}), 
        done,
        originalError
      )
    );

  }, function (err, retry) {
    if (err.message.match(/chai not found/) && retry.count === 0) {
      // console.log("Retrying to load Chai2");
      // retry after repairing the problem
      // return retry(function (operand, done) { loadChai(operand.browser, done) });
    }
    throw err;
  });
};


module.exports.timeout = function (ms) {
  this._timeout = ms;
  return this;
};



module.exports.timeout = function (ms) {
  this._timeout = ms;
  return this;
};

module.exports.promise = function (code, args) {
  var self = this;
  var originalError = new Error();

  if (args === undefined) {
    args = [];
  }

  if (typeof code !== 'string' && typeof code !== 'function') {
    throw new Error('`code` has to be either string or a function')
  }

  if (!Array.isArray(args)) {
    throw new Error('`args` has to be an array');
  }


  // we could set this 5000 globally, right?

  return self.__custom__(function (operand, done) {

    done()
    // operand.browser.setAsyncScriptTimeout(self._timeout || 10000, done);

  }).__custom__(function (operand, done) {

    let wat = `
      either = function (first) {
        return {
          or: function (second) {
            return function (arg1, arg2) {
              return arg1 ? first(arg1) : second(arg2);
            };
          }
        };
      };

      var expect;
      var assert;
      var spy;

      var args = Array.prototype.slice.call(arguments); // make array
      var reportValue = args.pop(); // pop off wd callback
      var resolve = function (value) { 
        reportValue({ value: value });
        return { value: value };
      };
      var reject  = function (error) { 
        reportValue({ 
          error: (error && typeof error === 'object') ? error.message : error.toString()
        })
        return { 
          error: (error && typeof error === 'object') ? error.message : error.toString()
        }
      };
      args.unshift(reject); // add promise callbacks (resolve, reject, ...args)
      args.unshift(resolve); 

      return (
        function(){
          try {
            expect = chai.expect;
            assert = chai.assert;
            spy = chai.spy;
            return (${codeToString(code, originalError)}).apply(null, arguments)
          } catch (error) {
            reject(error);
          }
        }
      ).apply(null, args)
      `;

    if(gagarinOptions.logJs){
      var debugPath = `${gagarinOptions.pathToApp}/.gagarin/tmp/code/promise-${Math.random().toString().split(".")[1]}.js`;
      fs.writeFileSync(debugPath, wat.toString());
      logs.client(`Promise: ${debugPath}`)
    }

    operand.browser.executeAsync(
      wat,
      args,
      feedbackProcessor(
        getSetter({}), done, originalError
      )
    );

  }, function (err, retry) {
    throw err;
  });

};


module.exports.wait = function (timeout, message, code, args) {
  var self = this;
  var originalError = new Error();

  if (args === undefined) {
    args = [];
  }

  if (typeof code !== 'string' && typeof code !== 'function') {
    throw new Error('`code` has to be either string or a function')
  }

  if (!Array.isArray(args)) {
    throw new Error('`args` has to be an array');
  }


  // we could set this 5000 globally, right?

  return self.__custom__(function (operand, done) {

    done()
    // operand.browser.setAsyncScriptTimeout( (self._timeout || 10000)*2, done );

  }).__custom__(function (operand, done) {

    let wat = `
      either = function (first) {
        return {
          or: function (second) {
            return function (arg1, arg2) {
              return arg1 ? first(arg1) : second(arg2);
            };
          }
        };
      };

      var timeoutId, intervalId;
      var expect;
      var assert;
      var spy;

      var args = Array.prototype.slice.call(arguments); // make array
      var reportValue = args.pop(); // pop off wd callback
      var resolve = function (value) { 
        Meteor.clearTimeout(timeoutId);
        Meteor.clearInterval(intervalId);
        reportValue({ value: value });
        return { value: value };
      };
      var reject  = function (error) { 
        Meteor.clearTimeout(timeoutId);
        Meteor.clearInterval(intervalId);
        reportValue({ 
          error: (error && typeof error === 'object') ? error.message : error.toString()
        })
        return { 
          error: (error && typeof error === 'object') ? error.message : error.toString()
        }
      };

      return (
        function(){
          try {
            expect = chai.expect;
            assert = chai.assert;
            spy = chai.spy;
            timeoutId = Meteor.setTimeout(function () {
              Meteor.clearInterval(intervalId);
              reject(\`I have been waiting for ${timeout} ms '${message}', but it did not happen.\`)
            }, ${timeout});
            intervalId = Meteor.setInterval(function () {
              try {
                var result = (${codeToString(code, originalError)}).apply(null, args);
                if ( result ) {
                  resolve(result);
                }
              } catch(failure){
                reject(failure)
              }
            }, 50);
          } catch (error) {
            reject(error);
          }
        }
      ).apply(null, args)
      `;

    if(gagarinOptions.logJs){
      var debugPath = `${gagarinOptions.pathToApp}/.gagarin/tmp/code/wait-${Math.random().toString().split(".")[1]}.js`;
      fs.writeFileSync(debugPath, wat.toString());
      logs.client(`Wait: ${debugPath}`)
    }

    operand.browser.executeAsync(
      wat,
      args,
      feedbackProcessor(
        getSetter({}), done, originalError
      )
    );

  }, function (err, retry) {
    throw err;
  });

};


function stringify(value) {
  if (typeof value === 'function') {
    return value.toString();
  }
  return value !== undefined ? JSON.stringify(value) : "undefined";
}

function codeToString(code, originalError) {
  var test;

  if (typeof code === 'string' && !/^function\s+\(/.test(code)) {
    return 'function () {\n' + code + '\n}';
  }
  if (typeof code === 'function') {
    var code = code.toString();
    if(code[0] == "f"){
      return code;
    } else {
      originalError.message = "Sorry, non `function` functions are not supported yet.";
      throw originalError;
    }
  }

  eval("test = " + code); // XXX it may throw on syntax error

  return code;
}

function feedbackProcessor(context, done, originalError) {
  return function (err, feedback) {
    if (err) {
      return done(err);
    }
    if (feedback && feedback.error) {
      originalError.message = feedback.error;
      return done(originalError);
    }
    return done(null, ((feedback && feedback.hasOwnProperty('value')) ? feedback.value : feedback));
  }
}

function wrapSourceCode(code, args, context, originalError, library) {

  var chunks = [];

  chunks.push(
    "function () {",
    "  var expect;",
    "  var assert;",
    "  var spy;",
    "  var functionArgs;",
    "  return (function (action, cb) {",
    "    try {",
    "      expect = chai.expect;",
    "      assert = chai.assert;",
    "      spy = chai.spy;",
    "      if(`" + library +"` && `" + library +"` != 'undefined'){",
    "        var loadedLibrary = require('" + library + "').default || require('" + library + "');",
    "        functionArgs = [loadedLibrary].concat([" + args.join(", ") + "]);",
    "      } else {",
    "        functionArgs = [" + args.join(", ") + "];",
    "      };",
    "      return { value: action.apply(null, functionArgs) };",
    "    } catch (err) {",
    "      return { error: err.message };",
    "    }",
    "  })(" + codeToString(code, originalError) + ", function () {",
    "    return;", // keys?
    "  });",
    "}"
  );
  
  return chunks.join('\n');
}

function getSetter(object) {
  return function setter (updates) {
    Object.keys(updates).forEach(function (key) {
      object[key] = updates[key];
    });
  }
}

