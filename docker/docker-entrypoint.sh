#!/bin/bash

set -e

# All command line params in alpha order without the starting --
declare -a params=(
  "batch-size"
  "batch-timeout"
  "change-listener-passwords"
  "db-name"
  "log-level"
  "namespace"
  "replicator-passwords"
  "type"
  "url"
)

if [ "$1" = '/usr/local/bin/spiegel' ]; then

  cmdParams=''

  for i in "${params[@]}"
  do

    # Make uppercase
    dockerParam=${i^^}

    # Replace hyphens with underscores as linux doesn't allow hyphens in env var names
    dockerParam=${dockerParam//-/_}

    # Append to the list of params and values
    if [ "${!dockerParam}" != "" ]; then
      cmdParams="$cmdParams --$i=${!dockerParam}"
    fi

  done

  $@ $cmdParams

else

  $@

fi
