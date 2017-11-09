# spiegel

[![Greenkeeper badge](https://badges.greenkeeper.io/redgeoff/spiegel.svg)](https://greenkeeper.io/) [![Circle CI](https://circleci.com/gh/redgeoff/spiegel.svg?style=svg&circle-token=71ef4a94aae37c96dde8268b3ed094f5fb73dd7f)](https://circleci.com/gh/redgeoff/spiegel)

Scalable replication and change listening for CouchDB

## Inspiration
Spiegel was designed to provide scalable replication and change listening for [Quizster](https://quizster.co), a photo-based feedback and submission system. Without Spiegel, a lot of complicated logic would need to exist in the Quizster application layer.

## Problems Spiegel solve:
1. **Scalable Replication:** The _replicator database is a powerful tool, but in certain cases it does not scale well. Consider the example where we have users posting blog entries. Let's assume that we want to use PouchDB to sync data between the client and CouchDB. Let's also assume a design of a DB per user and an all_blog_posts database that stores the blog posts from all the users. In this design, we'd want to replicate all our user DBs to the all_blog_posts DB. At first glance, the obvious choice would be to use the _replicator database to perform these replications, but the big gotcha is that continuous replications via the _replicator database require a dedicated DB connection. Therefore, if we have say 10,000 users then we would need 10,000 concurrent database connections for these replications even though at any given time there may be at most 100 users making changes to their posts simultaneously. We can prevent this greedy use of resources by only replicating databases when a change occurs.
2. **Real-time Replication Between Clusters**: The built-in clustering in CouchDB 2 isn't designed to be used across different regions of the world. Spiegel tracks changes in real-time and then only schedules replications for databases that have changed. You can therefore use Spiegel to efficiently keep clusters, located in different regions of the world, in sync.
3. **Scalable Change Listening:** Let's assume that we have some routine that we want to run whenever there are changes, e.g. we want to calculate metrics using a series of views and then store these metrics in a database doc for quick retrieval later. We'd need to write a lot of boilerplate code to listen to _changes feeds for many databases, handle fault tolerance and support true scalability. Instead, we can provide a simple way of configuring a backend to use a user-defined API to execute these routines.

## Key Aspects
1. Should support any number of instances of each service for scalability. This way, you can add instances (e.g. via docker) to support any load
2. Must be fault tolerant and gracefully handle network issues, crashed database instances or other transient issues.

## TODO: insert diagram

## Spiegel User Defined Docs

1. `replicator`
    ```js
    {
      type: 'replicator',
      source: '<couch-url>', // e.g. https://user@db.example.com:6984. Passwords maintained via
                             // passwords config
      target: '<couch-url>',
      filter: '<filter>',
      query_params: '<query-params>'
      // ... any other params accepted by the [_replicate API](http://docs.couchdb.org/en/2.1.1/api/server/common.html#replicate)
      
      // The following attributes are automatically populated and managed by Spiegel
      dirty: '<true>|<false>',
      updated_at: '<ISO Timestamp>',
      locked_at: '<ISO Timestamp>|<null>'
    }
    ```

2. `on_change`
    ```js
    {
      type: 'on_change',

      db_name: '<reg-ex>', // Matches against a DB name
      
      // on_change only applies if this condition is met
      if: { 
        '<attr-1>': '<reg-ex>',
        '<attr-2>': '<reg-ex>',
        ...
      },
      
      url: '<api-url>', // e.g. https://user@api.example.com. Passwords maintained via
                        // passwords config
               
      // Parameters passed to API call
      params: {
        foo: 'bar',
        change: '$change'   // can use $change for change doc
        db_name: '$db_name' // $db_name is the name of matching DB
      },
      
      method: '<POST|PUT|GET|DELETE>'
      block: <true|false>, // API request must resolve before moving on
      debounce: <true|false> // Duplicate API requests as identifed by URL and params are ignored
    }
    ```

## Spiegel Internal Docs

1. `change_listener`
    ```js
    {
      _id: 'spiegel_cl_<db-name>', // Namespaced to prevent conflict with replicators and reserved ids like '_users'
      type: 'change_listener',
      db_name: '<db-name>',
      dirty: '<true>|<false>',
      updated_at: '<ISO-timestamp>',
      locked_at: '<ISO-timestamp>|<null>',
      last_seq: '<last-seq>' // Used to keep track of the current place in the _changes feed for
                             // the target DB
    }
    ```

2. `global`
    ```js
    {
      _id: '<global-name>',
      type: 'global',
      value: '<value>'
    }
    ```

## Processes

### Update Listener Processes
1. Listen to `_global_changes/_changes?since=lastSeq&limit=batchSize`, filtered by the `sieve` view. Creates or dirties any replicators that match the DB name. Creates or dirties any change_listeners that match the DB name.
2. Every `saveSeqAfterSeconds` the process saves the `lastSeq` global. This value is then used to start any new Update Listeners at the last sequence number so that they don't have to start from the beginning.

### Change Listener Processes
1. Lock the next dirty change_listener
2. Listen to a batch of `_changes` for the db_name specified in the change_listener
3. For all matching on_changes, issue API requests. If `block=true|undefined` then wait for response before moving on to next change. If `debounce=true` then use _Debouncer_ with respect to API URL and params so that back-to-back duplicate requests are only executed once.
4. Update `change_listener.last_seq` so that subsequent processing can resume from where we left off
5. Attempt to clean and unlock change_listener. If there is a conflict, e.g. because the change_listener was dirtied from another change, just unlock the change_listener and leave it dirty so that the change_listener can be reprocessed.
6. Every `checkStalledSeconds` check for any change_listeners that have stalled for at least `retryAfterSeconds`, i.e. are still locked and then unlock these change_listeners. A change_listener can stall in certain error cases, including when a process locks the change_listener and then restarts/crashes before unlocking the change_listener.

### Replicator Processes
1. Lock the next dirty replicator
2. Perform the replication by making a request to CouchDB's `_replicate` API
3. Attempt to clean and unlock replicator. If there is a conflict, e.g. because the replicator was dirtied when a change occurred since the replication, just unlock the replicator and leave it dirty so that the replicator can be reprocessed.
4. Every `checkStalledSeconds` check for any replicators that have stalled for at least `retryAfterSeconds`, i.e. are still locked and then unlock these replicators. A replicator can stall in certain error cases, including when a process locks the replicator and then restarts/crashes before unlocking the replicator.

## Passwords Config
The passwords config specifies the passwords so that they don't have to be stored in the on_change and replicator docs.
    ```js
    {
      '<host>': {
        '<username1>': '<password1>',
        '<username2>': '<password2>',
        ...
      },
      '<host2>': {
        '<username3>': '<password3>',
        ...
      }
      ...
    }
    ```
