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

    /**
     * @todo Check params
     */
    deploy = new Deploy({
      user: data.user,
      domain: data.domain,
      deployTo: data.deployTo,
      repository: data.repository,
      branch: data.branch,
      keepReleases: data.keepReleases,
      tasks: data.tasks
    }, function init() {

      // grunt deploy:<env> --exec="ls -lah"
      if ( typeof grunt.option('exec') !== 'undefined' ) {
        deploy.run( grunt.option('exec') );
        deploy.exec(done);
        return;
      }

      // grunt deploy:<env> --invoke=task1,task2
      if ( typeof grunt.option('invoke') === 'string' ) {
        deploy.invokeTasks(grunt.option('invoke').split(','), done);
        return;
      }

      // grunt deploy:<env> --setup
      if ( grunt.option('setup') ) {
        deploy.invokeTask('setup', done);
        return;
      }

      // grunt deploy:<env> --rollback
      if ( grunt.option('rollback') ) {
        deploy.invokeTask('rollback', done);
        return;
      }

      // default task: deploy
      deploy.invokeTask('deploy', done);
    });
  });
};

