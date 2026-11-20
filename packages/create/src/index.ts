#!/usr/bin/env node

'use strict';

var currentNodeVersion = process.versions.node;
var semver = currentNodeVersion.split('.');
var major = semver[0];

if (parseInt(major) < 20) {
  console.error(
    'You are running Node ' +
    currentNodeVersion +
    '.\n' +
    'Creating a Lambada project requires Node 20 or higher. \n' +
    'Please update your version of Node.'
  );
  process.exit(1);
}

require('./prepare');