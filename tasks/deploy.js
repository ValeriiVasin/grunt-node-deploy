/*
 * grunt-node-deploy
 * https://github.com/ValeriiVasin/grunt-node-deploy
 *
 * Copyright (c) 2013 Valerii Vasin
 * Licensed under the MIT license.
 */

module.exports = function (grunt) {
  'use strict';

  var Deploy = require('./deployHelper').Deploy;

  grunt.registerMultiTask('deploy', 'Simplify your apps deploying', function () {
    var data = this.data,
        done = this.async(),
        args = this.args,
        deploy;

    // check data
    ['deployFrom', 'deployTo', 'domain', 'user'].forEach(function (key) {
      if ( !data[key] ) {
        throw new Error('You should define `'+ key +'`');
      }
    });

    deploy = new Deploy({
      user: data.user,
      domain: data.domain,
      deployTo: data.deployTo,
      deployFrom: data.deployFrom,
      hooks: data.hooks
    });

    if ( args.indexOf('setup') !== -1 ) {
      // grunt deploy:<env>:setup
      deploy.setup(done);
    } else if ( args.indexOf('rollback') !== -1 ) {
      // grunt deploy:<env>:rollback
      deploy.rollback(done);
    } else {
      deploy.start(done);
    }

  });
};

