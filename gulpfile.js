var babel = require('gulp-babel');
var browserify = require('browserify');
var derequire = require('gulp-derequire');
var gulp = require('gulp');
var insert = require('gulp-insert');
var path = require('path');
var rename = require('gulp-rename');
var replace = require('gulp-replace');
var source = require('vinyl-source-stream');
var uglify = require('gulp-uglify');
var umd = require('gulp-umd');

var BUILD = 'browser';
var DIST = './';
var VERSION = require('./package.json').version;

var PRESETS = {
	'browser': ['es2015', 'react', 'stage-2'],
};
var PLUGINS = {
	'browser': ['inline-package-json', 'transform-inline-environment-variables', 'transform-runtime'],
};

var DEV_HEADER = (
	'/**\n' +
	' * SocketCluster JavaScript client v' + VERSION + '\n' +
	' */\n');

var FULL_HEADER = (
	'/**\n' +
	' * SocketCluster JavaScript client v' + VERSION + '\n' +
	' */\n');

gulp.task('compile', function () {
	var packageJSON = {
		version: VERSION
	};
	return gulp.src('lib/*.js')
	.pipe(babel({
			comments: false,
			presets: PRESETS[BUILD],
			plugins: PLUGINS[BUILD],
		}))
	// Second pass to kill BUILD-switched code
	.pipe(babel({
			plugins: ['minify-dead-code-elimination'],
		}))
	.pipe(umd())
	.pipe(gulp.dest(BUILD));
});

gulp.task('browserify', function () {
	var stream = browserify({
			builtins: ['_process', 'events', 'buffer', 'querystring'],
			entries: 'index.js',
			standalone: 'socketCluster'
		})
		.ignore('_process')
		.bundle();
	return stream.pipe(source('socketcluster.js'))
		.pipe(derequire())
		.pipe(insert.prepend(DEV_HEADER))
		.pipe(gulp.dest(DIST));
});

gulp.task('minify', function () {
	return gulp.src(DIST + 'socketcluster.js')
		.pipe(uglify())
		.pipe(insert.prepend(FULL_HEADER))
		.pipe(rename({
				extname: '.min.js'
			}))
		.pipe(gulp.dest(DIST))
});
