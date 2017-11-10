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
We recommend that you install Spiegel via Docker, especially Docker Swarm, as this will allow you to easily scale up or down as your needs change. Moreover, Docker will take care of automatically restarting the processes in the event of a permanent error. You can of course run Spiegel via npm, but then the scaling and auto restarting will be up to you to implement.

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
Note: for extra security, use the [Docker Secrets](https://docs.docker.com/engine/swarm/secrets/#advanced-example-use-secrets-with-a-wordpress-service) to encrypt the URL parameter.

You can then scale up (or down), e.g.:
    $ docker service scale update-listener=3
    $ docker service scale change-listener=3
    $ docker service scale replicator=3

TODO: npm install

TODO: usage and explain docker option names

## [Design](DESIGN.md)
