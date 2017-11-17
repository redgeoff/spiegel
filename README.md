# spiegel

[![Greenkeeper badge](https://badges.greenkeeper.io/redgeoff/spiegel.svg)](https://greenkeeper.io/) [![Circle CI](https://circleci.com/gh/redgeoff/spiegel.svg?style=svg&circle-token=71ef4a94aae37c96dde8268b3ed094f5fb73dd7f)](https://circleci.com/gh/redgeoff/spiegel)

Scalable replication and change listening for CouchDB

## Inspiration
Spiegel was designed to provide scalable replication and change listening for [Quizster](https://quizster.co), a photo-based feedback and submission system. Without Spiegel, a lot of complicated logic would need to exist in the Quizster application layer.

## Problems Spiegel Solves:
1. **Scalable Replication:** The _replicator database is a powerful tool, but in certain cases it does not scale well. Consider the example where we have users posting blog entries. Let's assume that we want to use PouchDB to sync data between the client and CouchDB. Let's also assume a design of a DB per user and an all_blog_posts database that stores the blog posts from all the users. In this design, we'd want to replicate all our user DBs to the all_blog_posts DB. At first glance, the obvious choice would be to use the _replicator database to perform these replications, but the big gotcha is that continuous replications via the _replicator database require a dedicated DB connection. Therefore, if we have say 10,000 users then we would need 10,000 concurrent database connections for these replications even though at any given time there may be at most 100 users making changes to their posts simultaneously. We can prevent this greedy use of resources by only replicating databases when a change occurs.
2. **Real-time Replication Between Clusters**: The built-in clustering in CouchDB 2 isn't designed to be used across different regions of the world. Spiegel tracks changes in real-time and then only schedules replications for databases that have changed. You can therefore use Spiegel to efficiently keep clusters, located in different regions of the world, in sync.
3. **Scalable Change Listening:** Let's assume that we have some routine that we want to run whenever there are changes, e.g. we want to calculate metrics using a series of views and then store these metrics in a database doc for quick retrieval later. We'd need to write a lot of boilerplate code to listen to _changes feeds for many databases, handle fault tolerance and support true scalability. Instead, we can provide a simple way of configuring a backend to use a user-defined API to execute these routines.

## Key Aspects
1. Supports any number of instances of each process for scalability. This way, you can add instances (e.g. via docker) to support any load
2. Is fault tolerant and gracefully handles network issues, crashed database instances or other transient issues.

## Spiegel Diagram
![Spiegel](spiegel.svg)

## Installation
**We recommend that you install Spiegel via Docker**, especially Docker Swarm, as this will allow you to easily scale up or down as your needs change. Moreover, Docker will take care of automatically restarting the processes in the event of a permanent error. You can of course run Spiegel via npm, but then the scaling and auto restarting will be up to you to implement.

### Install via Docker Swarm
1. Install Docker Swarm: see the [official Docker documentation](https://docs.docker.com/engine/swarm/swarm-tutorial/) or [Installing Docker Swarm on Ubuntu](https://github.com/redgeoff/docker-ce-vagrant/blob/master/docker.sh)
2. Create a passwords file for your change_listeners, e.g. change-listener-passwords.json:
    ```
    {
      "yourapi.com": {
        "apiuser": "apipassword"
      }
    }
    ```
3. Create a passwords file for your replicators, e.g. replicator-passwords.json:
    ```
    {
      "yourcouchdb.com": {
        "user": "password"
      }
    }
    ```
4. Install Spiegel:
    ```
    $ docker run -it \
      -e TYPE='install' \
      -e URL='http://user:password@yourcouchdb.com:5984' \
      redgeoff/spiegel
    ```
5. Create the Update Listener Service:
    ```
    $ docker service create \
      --name update-listener \
      --detach=true \
      --replicas 2 \
      -e TYPE='update-listener' \
      -e URL='http://user:password@yourcouchdb.com:5984' \
      redgeoff/spiegel
    ```
6. Create the Change Listener Service:
    ```
    $ docker service create \
      --name change-listener \
      --detach=true \
      --replicas 2 \
      -e TYPE='change-listener' \
      -e URL='http://user:password@yourcouchdb.com:5984' \
      --mount type=bind,source=change-listener-passwords.json,destination=/usr/src/app/passwords.json \
      -e PASSWORDS_FILE=/usr/src/app/passwords.json \
      redgeoff/spiegel
    ```
7. Create the Replicator Service:
    ```
    $ docker service create \
      --name replicator \
      --detach=true \
      --replicas 2 \
      -e TYPE='replicator' \
      -e URL='http://user:password@yourcouchdb.com:5984' \
      --mount type=bind,source=replicator-passwords.json,destination=/usr/src/app/passwords.json \
      -e PASSWORDS_FILE=/usr/src/app/passwords.json \
      redgeoff/spiegel
    ```
8. [Create your `on_change` docs](https://github.com/redgeoff/spiegel/blob/master/DESIGN.md#on_change) in the `spiegel` DB
9. [Create your `replicator` docs](https://github.com/redgeoff/spiegel/blob/master/DESIGN.md#replicator) in the `spiegel` DB

Notes:
- `yourapi.com` and `yourcouchdb.com` cannot be equal to `localhost` as you will be running the Spiegel processes from within docker containers, which means that localhost will refer to the VM's localhost. If you don't have a domain name to use then you can use the IP address of your host machine. Alternatively, you can also use defined entries in your host's hosts file if you use the `--network=host` when running `docker service create`.
- For extra security, use the [Docker Secrets](https://docs.docker.com/engine/swarm/secrets/#advanced-example-use-secrets-with-a-wordpress-service) to encrypt the URL parameter.

You can then scale up (or down), e.g.:

    $ docker service scale update-listener=3
    $ docker service scale change-listener=3
    $ docker service scale replicator=3

### Install via NPM
1. Install via NPM
    ```
    $ npm install -g spiegel
    ```
2. Create a passwords file for your change_listeners, e.g. change-listener-passwords.json:
    ```
    {
      "yourapi.com": {
        "apiuser": "apipassword"
      }
    }
    ```
3. Create a passwords file for your replicators, e.g. replicator-passwords.json:
    ```
    {
      "yourcouchdb.com": {
        "user": "password"
      }
    }
    ```
4. Install Spiegel:
    ```
    $ spiegel \
      --type='install' \
      --url='http://user:password@yourcouchdb.com:5984'
    ```
5. Run the Update Listener Process:
    ```
    $ spiegel \
      --type='update-listener' \
      --url='http://user:password@yourcouchdb.com:5984'
    ```
6. Run the Change Listener Process:
    ```
    $ spiegel \
      --type='change-listener' \
      --url='http://user:password@yourcouchdb.com:5984' \
      --passwords-file=change-listener-passwords.json
    ```
7. Run the Replicator Process:
    ```
    $ spiegel \
      --type='replicator' \
      --url='http://user:password@yourcouchdb.com:5984' \
      --passwords-file=replicator-passwords.json
    ```
8. [Create your `on_change` docs](https://github.com/redgeoff/spiegel/blob/master/DESIGN.md#on_change) in the `spiegel` DB
9. [Create your `replicator` docs](https://github.com/redgeoff/spiegel/blob/master/DESIGN.md#replicator) in the `spiegel` DB

## [Usage](bin/usage.txt)
```
Usage: spiegel --type=type --url=couchdb-url options

  --type=type             The type of the process: update-listener, change-listener, replicator,
                          install or uninstall. The install and uninstall processes run and then
                          exit, but the update-listener, change-listener and replicator will run
                          indefinitely. You can run as many update-listeners, change-listeners and
                          replicators as your DB setup can handle. In most cases you'll want to run
                          at least 2 of each of these processes for redundancy. In general, if you
                          need to listen to more changes or respond to these changes faster, add a
                          change-listener. Similarly, if you need to perform more replications or
                          replicate faster, add a replicator.

                          install           Creates the spiegel DB and sieve

                          uninstall         Destroys the spiegel DB and sieve

                          update-listener   The update-listener listens for all DB updates and then
                                            schedules on_changes and replications accordingly.

                          change-listener   The change-listener runs on_change rules for all
                                            matching changes

                          replicator        The replicator performs replications

  --url=couchdb-url       The URL to the CouchDB instance
```

For a complete list of options see [Usage](bin/usage.txt)

Note: the Docker image's environment variables are equal to the uppercase snake case of the options available on the command line, e.g. use LOG_LEVEL instead of --log-level

## Human-Readable Logs

Spiegel uses bunyan for logging and by default outputs entries in JSON, something that is useful when digesting log data programmatically, but not very readable for a human. Instead, you can pipe the output to bunyan for human-readable logs.

Example with Docker:

    $ sudo npm install -g bunyan
    $ docker ps # to view list of containers
    $ docker logs -f <container> | bunyan

Example with NPM:

    $ sudo npm install -g bunyan
    $ spiegel --url=http://admin:admin@localhost:5984 --type=update-listener --log-level=debug | bunyan

## [Spiegel Design](DESIGN.md)

## [Building](BUILDING.md)
