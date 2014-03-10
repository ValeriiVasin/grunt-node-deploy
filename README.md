# grunt-node-deploy

> Deployment tool for grunt.

## Getting Started
This plugin requires Grunt `~0.4.1`

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install grunt-node-deploy --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('grunt-node-deploy');
```

## Documentation

###Example config

Basic configuration

```js
grunt.initConfig({
  deploy: {
    production: {
      // source git repository to fetch release from
      repository: 'git@github.com:BonsaiDen/JavaScript-Garden.git',
      // Repository branch. Default: 'master'
      branch: 'beta',

      // amount of releases to keep on the server. Default: 3
      keepReleases: 5,

      // server options
      user:     'test',
      domain:   'my.domain.com',
      deployTo: '/opt/www/my.domain.com',

      // your tasks
      tasks: {
        afterNpm: function (run) {
          run('cd {{latestRelease}}; node build');
          run('mv {{latestRelease}}/{site,public}');
        },

        restart: function (run) {
          run('/etc/init.d/nginx restart');
        }
      }
    }
  }
});

grunt.loadNpmTasks('grunt-node-deploy');
```

## Contributing
In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code using [Grunt](http://gruntjs.com/).

## Release History
_(Nothing yet)_

Inspired by [Capistrano](https://github.com/capistrano/capistrano)
