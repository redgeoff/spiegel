#!/usr/bin/env bash

# IMPORTANT: you must be on the master branch before running this script!

# 1. Sets package version
# 2. Commits to master
# 3. Creates new tag and pushes tag
# 4. Publishes to npm
# 5. Builds and pushes docker images

# Change to script directory
cd `dirname $0`
sd=`pwd`

version=$1

if [ "${version}" == "" ]; then
  echo "Usage: build.sh version"
  exit
fi

# Set package version. Note: -e option required for OSX
# (https://stackoverflow.com/a/19457213/2831606)
sed -i '' -e "s/\"version\": \"[^\"]*\"/\"version\": \"${version}\"/g" $sd/../package.json

# Commit to master
git add -A
git commit -m "chore(version): ${version}"
git push origin master

# Create new tag and push
git tag -a v${version} -m "${version}"
git push origin --tags

# Publish to npm
cd $sd/..
npm publish

# Build and push new docker images. We use the no-cache option as we want the latest package on npm
# to be used
cd $sd/../docker
docker build --no-cache -t redgeoff/spiegel:${version} .
docker tag redgeoff/spiegel:${version} redgeoff/spiegel:latest
docker push redgeoff/spiegel:${version}
docker push redgeoff/spiegel:latest
