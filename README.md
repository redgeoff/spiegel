# spiegel
Scalable replication and change listening for CouchDB

Status
---
I used a simplified version of the below design in CouchDB 1 for a proprietary project [Quizster](https://quizster.co) and it worked very well. I now plan to port this design to work with CouchDB 2 and will open source it shortly.


Problems Spiegel will solve:
---
1. The _replicator database is a powerful tool, but in certain cases it does not scale well. Consider the example where we have users posting blog entries. Let's assume that we want to use PouchDB to sync data between the client and CouchDB. Let's also assume a design of a DB per user and an all_blog_posts database that stores the blog posts from all the users. In this design, we'd want to replicate all our user DBs to the all_blog_posts DB. At first glance, the obvious choice would be to use the _replicator database to perform these replications, but the big gotcha is that continuous replications via the _replicator database require a dedicated DB connection. Therefore, if we have say 10,000 users then we would need 10,000 concurrent database connections for these replications even though there may be at most only 100 users making changes to their posts simultaneously. We can prevent this greedy use of resources by only replicating databases when a change occurs.
2. Let's assume that we have some routine that we want to run whenever there are changes, e.g. we want to calculate metrics using a series of views and then store these metrics in a database doc for quick retrieval later. We'd need to write a lot of boilerplate code to listen to _changes feeds for many databases, handle fault tolerance and support true scalability. Instead, we can provide a simple way of configuring a backend to use a user-defined API to execute these routines.


Any plans in CouchDB for similar native support?
---
1. Phase 1 of https://issues.apache.org/jira/browse/COUCHDB-3324 will make better use of system resources when replicating and a not-yet-specified phase 2 will add support for scheduling via _db_updates. (If these features become stable we should be able to incorporate them into Spiegel to further improve efficiency).
2. Hopefully, Spiegel can also serve as a proof-in-production for some other future CouchDB concepts. Some of these ideas however may not be best suited for the core database and can therefore live on in Spiegel.


Key Aspects
---
1. Should support any number of instances of each service for scalability. This way, you can add instances (e.g. via docker) to support any load
2. Must be fault tolerant and gracefully handle network issues, crashed database instances or other transient issues.


Spiegel User Defined Docs
---

1. `replicator`
    ```js
    {
      source: '<couch-url>', // e.g. https://user@db.example.com:6984. Passwords maintained via
                             // host_passwords config
      target: '<couch-url>',
      filter: '<filter>',
      query_params: '<query-params>'
    }
    ```

2. `sieve`
    ```js
    {
      id: '_design/sieve',
      views: {
        sieve: {
          map: 'function(doc) {
            if (!doc.key) {
              return;
            }
            if (/dbname1|dbname2/.test(doc.key)) {
              emit(/:(.*)$/.exec(doc.key))[1]);
            }
          }'
        }
      }
    }
    ```

3. `on_change`
    ```js
    {
      type: 'on_change',
      regex: '<regex>', // Matches against a DB name
      url: '<api-url>', // e.g. https://user@api.example.com. Passwords maintained via
                        // host_passwords config
      params: {
        foo: bar,
        changes: '${changes}' // can use ${changes} for JSON
      },
      method: '<post|put|get|delete>'
      block: <true|false>, // API request must resolve before moving on
      debounce: <true|false> // Duplicate API requests are ignored
    }
    ```


Spiegel Internal Docs
---

1. `Change Listener`
    ```js
    {
      type: 'change_listener',
      db_name: '<dbName>',
      dirty: '<true>|<false>',
      last_seq: '<last-seq>' // Used to keep track of the current place in the _changes feed for
                             // the target DB
    }
    ```


onChange()
---

1. For each on_change doc, issue a request to the specified URL.
2. If `block=true` then wait for response before moving on to the next change. If `block=false` then use _Throttler_ (restricted by `max_concurrent_api_requests`) so that we don’t exhaust resources waiting for many simultaneous API requests.
3. If `debounce=true` then use _Debouncer_ with respect to md5 hash of `{ url, params }` so that back-to-back duplicate requests are only executed once.


DBUpdatesListener Service
---
1. cache - JSON flat file (used to store details specific to service instance)
    * `last_seq` - the last sequence number to be processed
2. Listen to `_global_changes/_changes?since=cache.last_seq&heartbeat=true`, filtered by the `sieve` view. If a ChangesListener (CL) does not exist for the DB or CL is clean then mark CL as dirty. If `cache.last_seq` doesn't exist then use `last_seq` in `{ _id: 'config' }`, if specified, otherwise assume 0.
3. Every `save_seq_after_seconds` the DBUpdatesListener saves `last_seq` in the `{ _id: 'config' }` doc. This value is then used to start any new DBUpdatesListeners at the last sequence number so that they don't have to start from the beginning.


ChangesListener (CL) Service
---
1. Config
    * `max_concurrent_api_requests` - the max number of concurrent user-defined API requests. Let a user-defined API request be those requests made from Spiegel to any user-defined API, not including requests made to CouchDB
    * `host_passwords`
      ```js
      {
        '<host>': {
          '<username>': '<password>'
        }
      }
      ```
2. Listen to _changes feed on spiegel database to identify when any CLs are marked as dirty
    * List of dirty CLs is retrieved using a design doc on the spiegel DB
    * For each dirty CL:
      * Set `locked=<timestamp>`
      * If conflict then move to next CL
      * Run any replicators for the target DB using _Debouncer_. Use `host_passwords` to insert password for supplied username and hostname.
      * For all `on_change` docs, if on_change.regex matches DB name, execute `onChange()`.
      * Set `locked=false` and `dirty=false`. If another process marks this CL as dirty in the meantime, then a conflict will occur. If this is the case then just set `locked=false` (unlock CL) so that the CL will be processed later
    * Handle CL failures: Twice every `retry_change_listener_after_seconds`, look for any locked CLs that have been locked for `retry_change_listener_after_seconds` and then unlock them by setting `locked=false`


Misc
---
1. Use update handler to ensure that user does not place password in replicator or `on_change` URL. (Instead, need to use `host_passwords` construct)


Common config per service
---
1. `max_concurrent_db_connections` - the max number of concurrent DB connections (per service instance) to CouchDB. This is used to prevent the service from starving the database of DB connections.
2. `couchdb`
    ```js
    {
      scheme: '<https|http>',
      host: '<host>',
      port: <port>,
      username: '<username>',
      password: '<password>'
    }
    ```
