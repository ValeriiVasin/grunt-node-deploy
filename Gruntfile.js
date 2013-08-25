/*
 * grunt-node-deploy
 * https://github.com/ValeriiVasin/grunt-node-deploy
 *
 * Copyright (c) 2013 Valerii Vasin
 * Licensed under the MIT license.
 */

'use strict';
var path = require('path');

module.exports = function(grunt) {
  grunt.loadNpmTasks('grunt-contrib-jasmine-node');
  grunt.loadNpmTasks('grunt-contrib-jshint');

  // Actually load this plugin's task(s).
  grunt.loadTasks('tasks');

  // Project configuration.
  grunt.initConfig({
    jshint: {
      all: [
        'Gruntfile.js',
        'tasks/*.js',
        'specs/**/*.js'
      ],
      options: {
        jshintrc: '.jshintrc',
      },
    },

    'jasmine-node': {
      run: {
        spec: 'spec'
      },
      executable: './node_modules/.bin/jasmine-node'
    }
  });

  grunt.registerTask('test', ['jasmine-node']);

  // By default, lint and run all tests.
  grunt.registerTask('default', ['jshint', 'test']);

};
