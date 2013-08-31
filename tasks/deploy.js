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
        tasksToInvoke,
        deploy;

    tasksToInvoke = grunt.option('invoke');
    if (tasksToInvoke) {
      tasksToInvoke = tasksToInvoke.split(',');
    }

    /**
     * @todo Check params
     */
    deploy = new Deploy({
      user: data.user,
      domain: data.domain,
      deployTo: data.deployTo,
      deployFrom: data.deployFrom,
      repository: data.repository,
      branch: data.branch,
      keepReleases: data.keepReleases,
      hooks: data.hooks
    }, function init() {

      if (tasksToInvoke) {
        deploy.invokeTasks(tasksToInvoke, done);
      } else if ( args.indexOf('setup') !== -1 ) {
        // grunt deploy:<env>:setup
        deploy.invokeTask('setup', done);
      } else if ( args.indexOf('rollback') !== -1 ) {
        // grunt deploy:<env>:rollback
        deploy.invokeTask('rollback', done);
      } else {
        deploy.invokeTask('deploy', done);
      }
    });
  });
};

