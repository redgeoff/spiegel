#!/usr/bin/env bash

# NOTE: the vagrant shared/synced folders construct occasionally causes ENOENT errrors with `npm
# install` even when enabling symlinks in Vagrantfile. Using the `no-bin-links` option leads to
# "Maximum call stack size exceeded" errors. The only way that I was able to reliably issue a `npm
# install` was by doing it in an unshared folder. Therefore, we download the source files in an
# unshared folder, issue `npm install`, and then move the files.

# Get the full path to the project
scripts=`dirname $0`
cd scripts/..
proj=`pwd`

# Path to tmp directory
d=/tmp/app

# Create tmp directory to house node_modules
mkdir -p $d

# Copy package.json to this tmp directory
cp package.json $d

# npm install
cd $d
npm install

# Remove any existing node_modules in the project directory
rm -rf $proj/node_modules

# Copy the node_modules and lock file from the tmp directory
mv $d/node_modules $proj
mv $d/package-lock.json $proj
