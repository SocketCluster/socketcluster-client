var gulp = require('gulp');
var eslint = require('gulp-eslint');
var browserify = require('browserify');
var babel = require('gulp-babel');
var derequire = require('gulp-derequire');
var insert = require('gulp-insert');
var rename = require('gulp-rename');
var source = require('vinyl-source-stream');
var uglify = require('gulp-uglify');
var convertNewline = require('gulp-convert-newline');

var DIST = './';
var VERSION = require('./package.json').version;

var FULL_HEADER = (
  '/**\n' +
  ' * SocketCluster JavaScript client v' + VERSION + '\n' +
  ' */\n');

gulp.task('lint', function() {
  return gulp.src(['lib/*.js', '!node_modules/**'])
    .pipe(eslint({
      configFile: '.eslintrc'
    }))
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
});

gulp.task('browserify', ['lint'], function() {
  var stream = browserify({
    builtins: ['_process', 'events', 'buffer', 'querystring'],
    entries: 'index.js',
    standalone: 'socketCluster'
  })
    .ignore('_process')
    .bundle()
  return stream.pipe(source('socketcluster.js'))
    .pipe(convertNewline({
      newline: 'lf',
      encoding: 'utf8'
    }))
    .pipe(derequire())
    .pipe(insert.prepend(FULL_HEADER))
    .pipe(gulp.dest(DIST))
});

gulp.task('minify', ['lint'], function() {
  return gulp.src(DIST + 'socketcluster.js')
    .pipe(babel({
      comments: false
    }))
    .pipe(babel({
      plugins: ['minify-dead-code-elimination']
    }))
    .pipe(uglify())
    .pipe(insert.prepend(FULL_HEADER))
    .pipe(rename({
      extname: '.min.js'
    }))
    .pipe(gulp.dest(DIST))
});
